import bcrypt from 'bcryptjs';
import ExcelJS from 'exceljs';
import crypto from 'node:crypto';
import { Router } from 'express';
import { z } from 'zod';
import { AppError, audit, conflict, decrypt, istDate, notFound, pool, taxYear, withTx, type Db } from '../core.js';
import { changeBudget, setCampaignStatus } from '../engines/budget.js';
import { approveBatch, bankPaymentLines, csvCell, batchCsv, generateBatch, recordBankFailed, recordBankPaid, releaseBatch, activeRule, ruleTerms } from '../engines/payouts.js';
import { computeTds } from '../engines/pricing.js';
import { alertAdmins, flushOutbox } from '../engines/notifications.js';
import { createResetLink, requireRole } from './auth.js';
import { sharedRoutes, visitRoutes } from './shared.js';

const money = z.number().int().min(0);

export function adminRoutes() {
  const r = Router();
  r.use(requireRole('ADMIN'));
  r.use(sharedRoutes());
  r.use(visitRoutes());

  // ---- Stores and staff ----
  r.get('/stores', async (_q, res) => res.json((await pool.query(`SELECT * FROM stores ORDER BY name`)).rows));
  r.post('/stores', async (req, res) => {
    const b = z.object({ code: z.string().min(2).max(20), name: z.string().min(2), city: z.string().min(2), state: z.string().min(2), latitude: z.number(), longitude: z.number() }).parse(req.body);
    const { rows: [s] } = await pool.query(
      `INSERT INTO stores (code, name, city, state, latitude, longitude) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`, [b.code, b.name, b.city, b.state, b.latitude, b.longitude]);
    await audit(pool, req.user.id, 'STORE_CREATED', 'store', s.id);
    res.status(201).json(s);
  });
  r.get('/staff', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.role, u.full_name, u.email, u.is_active, u.must_change_password, u.mfa_enabled_at IS NOT NULL mfa_on, s.name store
         FROM users u LEFT JOIN stores s ON s.id=u.store_id WHERE u.role<>'INFLUENCER' ORDER BY u.role, u.full_name`);
    res.json(rows);
  });
  // Disabling also ends their sessions. You cannot disable yourself, so one admin always remains.
  r.post('/staff/:id/active', async (req, res) => {
    const b = z.object({ active: z.boolean(), reason: z.string().min(3).max(300) }).parse(req.body);
    if (req.params.id === req.user.id) throw conflict('SELF', 'You cannot disable your own login.');
    const u = await pool.query(`UPDATE users SET is_active=$2, token_version=token_version+1 WHERE id=$1 AND role<>'INFLUENCER'`, [req.params.id, b.active]);
    if (!u.rowCount) throw notFound('Staff member');
    await audit(pool, req.user.id, b.active ? 'STAFF_ENABLED' : 'STAFF_DISABLED', 'user', req.params.id!, b.reason);
    res.json({ ok: true });
  });
  // For anyone who cannot receive email. The link is shown once and should go to them directly.
  r.post('/users/:id/reset-link', async (req, res) => {
    if (req.params.id === req.user.id) throw conflict('SELF', 'Another admin must do this for you, or use Forgot password.');
    const { rows: [u] } = await pool.query(`SELECT id, role, full_name FROM users WHERE id=$1 AND is_active`, [req.params.id]);
    if (!u) throw notFound('User');
    const link = await createResetLink(u.id, req.user.id, 24);
    await alertAdmins(pool, req.user.id, 'A password reset link was created by an admin', u.full_name); await flushOutbox();
    res.json({ link });
  });
  // Honours a deletion request. Tax and payment records stay, as the law requires.
  r.post('/influencers/:id/erase', async (req, res) => {
    const b = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    await withTx(async (c) => {
      const { rows: [p] } = await c.query(`SELECT * FROM influencer_profiles WHERE user_id=$1 FOR UPDATE`, [req.params.id]);
      if (!p) throw notFound('Creator');
      const { rows: [open] } = await c.query(
        `SELECT EXISTS (SELECT 1 FROM earnings WHERE influencer_id=$1 AND status IN ('PAYABLE','IN_BATCH')) money,
                EXISTS (SELECT 1 FROM benefit_records WHERE influencer_id=$1 AND status='OPEN') benefits,
                EXISTS (SELECT 1 FROM submissions WHERE influencer_id=$1 AND status IN ('PENDING_VERIFICATION','MEASURING','RESTRICTED')) posts`, [req.params.id]);
      if (open.money || open.benefits || open.posts) throw conflict('OPEN_ITEMS', 'This creator has unpaid money, tax owed on a benefit or a post in progress. Settle those first.');
      await c.query(`DELETE FROM social_accounts WHERE influencer_id=$1`, [req.params.id]);
      await c.query(`DELETE FROM payout_accounts WHERE influencer_id=$1`, [req.params.id]);
      await c.query(`UPDATE store_visits SET status='CANCELLED' WHERE influencer_id=$1 AND status IN ('REQUESTED','APPROVED')`, [req.params.id]);
      await c.query(`UPDATE influencer_profiles SET latitude=NULL, longitude=NULL, city=NULL, erased_at=now(), vetting_status='REJECTED' WHERE user_id=$1`, [req.params.id]);
      await c.query(
        `UPDATE users SET full_name='Deleted creator', email=$2, phone=NULL, password_hash='erased', is_active=FALSE, token_version=token_version+1 WHERE id=$1`,
        [req.params.id, `erased-${req.params.id}@deleted.invalid`]);
      await audit(c, req.user.id, 'CREATOR_ERASED', 'influencer', req.params.id!, b.reason);
    });
    res.json({ ok: true });
  });
  // For an admin who lost their phone: another admin clears it and they set it up again.
  r.post('/staff/:id/reset-two-step', async (req, res) => {
    const b = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    if (req.params.id === req.user.id) throw conflict('SELF', 'Another admin must do this for you.');
    const u = await pool.query(`UPDATE users SET totp_secret_enc=NULL, mfa_enabled_at=NULL, recovery_hashes='{}', token_version=token_version+1 WHERE id=$1 AND role='ADMIN'`, [req.params.id]);
    if (!u.rowCount) throw notFound('Admin');
    await audit(pool, req.user.id, 'MFA_RESET', 'user', req.params.id!, b.reason);
    await alertAdmins(pool, req.user.id, "An admin's two-step login was reset", b.reason); await flushOutbox();
    res.json({ ok: true });
  });
  r.post('/staff', async (req, res) => {
    const b = z.object({ role: z.enum(['ADMIN', 'STORE_MANAGER']), fullName: z.string().min(2), email: z.string().email(), password: z.string().min(10).max(72), storeId: z.string().uuid().optional(), yourPassword: z.string().optional() }).parse(req.body);
    if (b.role === 'ADMIN') {
      // A new admin can reach bank details, so re-check who is asking and tell the other admins.
      const { rows: [me] } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
      if (!b.yourPassword || !(await bcrypt.compare(b.yourPassword, me.password_hash))) throw new AppError(400, 'BAD_PASSWORD', 'Your own password is not right');
    }
    const { rows: [u] } = await pool.query(
      `INSERT INTO users (role, full_name, email, password_hash, store_id, must_change_password) VALUES ($1,$2,$3,$4,$5,TRUE) RETURNING id`,
      [b.role, b.fullName, b.email.toLowerCase(), await bcrypt.hash(b.password, 12), b.role === 'STORE_MANAGER' ? b.storeId : null]);
    await audit(pool, req.user.id, 'STAFF_CREATED', 'user', u.id, null, { role: b.role });
    if (b.role === 'ADMIN') { await alertAdmins(pool, req.user.id, 'A new admin login was created', b.email); await flushOutbox(); }
    res.status(201).json(u);
  });

  r.get('/security-status', (_q, res) => { res.json({ twoStepOff: process.env.ADMIN_TWO_STEP === 'off' }); });

  // ---- Campaign desk ----
  r.get('/campaigns', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT k.*, pc.name category, k.budget_paise - k.reserved_paise AS remaining_paise,
              COALESCE((SELECT SUM(e.gross_paise) FROM earnings e JOIN submissions s ON s.id=e.submission_id WHERE s.campaign_id=k.id AND e.status='PAID'),0)::bigint paid_paise,
              (SELECT array_agg(store_id) FROM campaign_stores cs WHERE cs.campaign_id=k.id) store_ids,
              (SELECT json_agg(json_build_object('tier_id',x.tier_id,'base_pay_paise',x.base_pay_paise,'bonus_per_10k_paise',x.bonus_per_10k_paise,'max_view_bonus_paise',x.max_view_bonus_paise)) FROM campaign_rate_cards x WHERE x.campaign_id=k.id) tier_rates
         FROM campaigns k JOIN product_categories pc ON pc.id=k.category_id ORDER BY k.created_at DESC`);
    res.json(rows);
  });
  const postingSpecs = {
    postingHashtags: z.array(z.string().regex(/^#[\p{L}\p{N}_]{1,60}$/u, 'Hashtags can use letters, numbers and _ only')).max(20).default([]),
    postingMentions: z.array(z.string().regex(/^@[A-Za-z0-9._]{1,60}$/, 'Enter mentions like @lotuselectronics')).max(10).default([]),
    postingGuidelines: z.string().max(2000).optional(),
    collabAccount: z.string().regex(/^@[A-Za-z0-9._]{1,30}$/, 'Enter the Instagram account like @lotuselectronics').optional(),
  };
  const targets = {
    minEngagementBps: z.number().int().min(50, 'Engagement must be at least 0.5%').max(1000, 'Engagement can be at most 10%').default(150),
    minViews: z.number().int().min(0).max(100000000).default(500),
    measurementDays: z.number().int().min(1).max(90).default(7),
  };
  const tierRates = z.array(z.object({ tierId: z.string().uuid(), basePayPaise: money, bonusPer10kPaise: money, maxViewBonusPaise: money })).max(20).default([]);
  const saveTierRates = async (c: Db, campaignId: string, rates: z.infer<typeof tierRates>) => {
    await c.query(`DELETE FROM campaign_rate_cards WHERE campaign_id=$1`, [campaignId]);
    for (const t of rates)
      await c.query(`INSERT INTO campaign_rate_cards (campaign_id, tier_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise) VALUES ($1,$2,$3,$4,$5)`,
        [campaignId, t.tierId, t.basePayPaise, t.bonusPer10kPaise, t.maxViewBonusPaise]);
  };
  r.post('/campaigns', async (req, res) => {
    const b = z.object({
      title: z.string().min(3).max(150), brief: z.string().min(10).max(5000), categoryId: z.string().uuid(), storeIds: z.array(z.string().uuid()).min(1),
      startsAt: z.string().datetime(), expiresAt: z.string().datetime(), budgetPaise: z.number().int().positive(), submissionQuota: z.number().int().positive(),
      ...targets, requiredDisclosure: z.boolean().default(true), tierRates,
      ...postingSpecs,
    }).parse(req.body);
    const id = await withTx(async (c) => {
      const { rows: [k] } = await c.query(
        `INSERT INTO campaigns (title, brief, category_id, starts_at, expires_at, budget_paise, submission_quota, min_engagement_bps, min_views, measurement_days, required_disclosure, created_by, posting_hashtags, posting_mentions, posting_guidelines, collab_account)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [b.title, b.brief, b.categoryId, b.startsAt, b.expiresAt, b.budgetPaise, b.submissionQuota, b.minEngagementBps, b.minViews, b.measurementDays, b.requiredDisclosure, req.user.id,
         b.postingHashtags, b.postingMentions, b.postingGuidelines?.trim() || null, b.collabAccount ?? null]);
      for (const s of b.storeIds) await c.query(`INSERT INTO campaign_stores VALUES ($1,$2)`, [k.id, s]);
      await saveTierRates(c, k.id, b.tierRates);
      await audit(c, req.user.id, 'CAMPAIGN_CREATED', 'campaign', k.id);
      return k.id as string;
    });
    res.status(201).json({ id, status: 'DRAFT' });
  });
  // Changes apply to posts not yet finally checked.
  r.put('/campaigns/:id/posting', async (req, res) => {
    const b = z.object({ ...postingSpecs, requiredDisclosure: z.boolean().optional() }).parse(req.body);
    const u = await pool.query(`UPDATE campaigns SET posting_hashtags=$2, posting_mentions=$3, posting_guidelines=$4, collab_account=$5, required_disclosure=COALESCE($6, required_disclosure) WHERE id=$1`,
      [req.params.id, b.postingHashtags, b.postingMentions, b.postingGuidelines?.trim() || null, b.collabAccount ?? null, b.requiredDisclosure ?? null]);
    if (!u.rowCount) throw notFound('Campaign');
    await audit(pool, req.user.id, 'POSTING_SPECS_CHANGED', 'campaign', req.params.id!, null, b);
    res.json({ ok: true });
  });
  // Posts that passed content review, for the team to show on the company's own pages.
  r.get('/sharing', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, s.platform, s.post_url, s.status, s.collab_confirmed, s.shared_at, k.title campaign, k.collab_account,
              u.full_name creator, st.name store, w.full_name shared_by_name
         FROM submissions s JOIN campaigns k ON k.id=s.campaign_id JOIN users u ON u.id=s.influencer_id
         JOIN stores st ON st.id=s.store_id LEFT JOIN users w ON w.id=s.shared_by
        WHERE s.content_review='APPROVED' AND s.status IN ('MEASURING','APPROVED','IN_BATCH','PAID')
        ORDER BY s.shared_at IS NOT NULL, s.shared_at DESC NULLS FIRST, s.submitted_at DESC LIMIT 300`);
    res.json(rows);
  });
  r.post('/sharing/:id', async (req, res) => {
    const { done } = z.object({ done: z.boolean() }).parse(req.body);
    const u = await pool.query(
      `UPDATE submissions SET shared_at = CASE WHEN $2 THEN now() END, shared_by = CASE WHEN $2 THEN $3::uuid END
        WHERE id=$1 AND content_review='APPROVED' AND (shared_at IS NULL) = $2`, [req.params.id, done, req.user.id]);
    if (!u.rowCount) throw conflict('SHARING_CHANGED', 'This post was already updated. Refresh the page.');
    await audit(pool, req.user.id, done ? 'POST_SHARED' : 'POST_SHARE_UNDONE', 'submission', req.params.id!);
    res.json({ ok: true });
  });
  r.post('/campaigns/:id/status', async (req, res) => {
    const b = z.object({ status: z.enum(['OPEN', 'PAUSED', 'CLOSED']), reason: z.string().max(500).optional() }).parse(req.body);
    await setCampaignStatus(req.params.id!, b.status, req.user.id, b.reason);
    res.json({ ok: true });
  });
  // Pay and targets for one campaign. Posts already submitted keep the pay and targets they started with.
  r.put('/campaigns/:id/terms', async (req, res) => {
    const b = z.object({ ...targets, tierRates }).parse(req.body);
    await withTx(async (c) => {
      const { rows: [k] } = await c.query(`SELECT status, min_views, min_engagement_bps, measurement_days FROM campaigns WHERE id=$1 FOR UPDATE`, [req.params.id]);
      if (!k) throw notFound('Campaign');
      if (['CLOSED', 'EXPIRED'].includes(k.status)) throw conflict('CAMPAIGN_ENDED', 'This campaign has ended, so its pay and targets cannot change');
      const { rows: before } = await c.query(`SELECT tier_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise FROM campaign_rate_cards WHERE campaign_id=$1`, [req.params.id]);
      await c.query(`UPDATE campaigns SET min_views=$2, min_engagement_bps=$3, measurement_days=$4 WHERE id=$1`, [req.params.id, b.minViews, b.minEngagementBps, b.measurementDays]);
      await saveTierRates(c, req.params.id!, b.tierRates);
      await audit(c, req.user.id, 'CAMPAIGN_TERMS_CHANGED', 'campaign', req.params.id!, null,
        { before: { minViews: k.min_views, minEngagementBps: k.min_engagement_bps, measurementDays: k.measurement_days, tierRates: before }, after: b });
    });
    res.json({ ok: true });
  });
  r.put('/campaigns/:id/budget', async (req, res) => {
    const b = z.object({ budgetPaise: z.number().int().positive(), submissionQuota: z.number().int().positive(), reason: z.string().min(3).max(500) }).parse(req.body);
    await changeBudget(req.params.id!, b.budgetPaise, b.submissionQuota, req.user.id, b.reason);
    res.json({ ok: true });
  });

  // ---- Payment matrix ----
  r.get('/matrix', async (_q, res) => {
    const [tiers, cats, custom] = await Promise.all([
      pool.query(`SELECT t.*, rc.base_pay_paise, rc.bonus_per_10k_paise, rc.max_view_bonus_paise FROM tiers t LEFT JOIN rate_cards rc ON rc.tier_id=t.id ORDER BY t.rank`),
      pool.query(`SELECT * FROM product_categories ORDER BY name`),
      pool.query(`SELECT c.*, u.full_name FROM custom_rate_cards c JOIN users u ON u.id=c.influencer_id ORDER BY u.full_name`),
    ]);
    res.json({ tiers: tiers.rows, categories: cats.rows, customRateCards: custom.rows });
  });
  r.put('/matrix/tiers/:id', async (req, res) => {
    const b = z.object({ basePayPaise: money, bonusPer10kPaise: money, maxViewBonusPaise: money, minAvgViews: z.number().int().min(0), minEngagementBps: z.number().int().min(0) }).parse(req.body);
    await withTx(async (c) => {
      const t = await c.query(`UPDATE tiers SET min_avg_views=$2, min_engagement_bps=$3 WHERE id=$1`, [req.params.id, b.minAvgViews, b.minEngagementBps]);
      if (!t.rowCount) throw notFound('Tier');
      await c.query(
        `INSERT INTO rate_cards (tier_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (tier_id) DO UPDATE SET base_pay_paise=$2, bonus_per_10k_paise=$3, max_view_bonus_paise=$4, updated_by=$5, updated_at=now()`,
        [req.params.id, b.basePayPaise, b.bonusPer10kPaise, b.maxViewBonusPaise, req.user.id]);
      await audit(c, req.user.id, 'RATE_CARD_CHANGED', 'tier', req.params.id!, null, b);
    });
    res.json({ ok: true });
  });
  r.post('/matrix/tiers', async (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(40), basePayPaise: money, bonusPer10kPaise: money, maxViewBonusPaise: money, minAvgViews: z.number().int().min(0), minEngagementBps: z.number().int().min(0) }).parse(req.body);
    const id = await withTx(async (c) => {
      const { rows: [t] } = await c.query(
        `INSERT INTO tiers (name, rank, min_avg_views, min_engagement_bps) SELECT $1, COALESCE(MAX(rank),0)+1, $2, $3 FROM tiers RETURNING id`, [b.name, b.minAvgViews, b.minEngagementBps]);
      await c.query(`INSERT INTO rate_cards (tier_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise, updated_by) VALUES ($1,$2,$3,$4,$5)`, [t.id, b.basePayPaise, b.bonusPer10kPaise, b.maxViewBonusPaise, req.user.id]);
      await audit(c, req.user.id, 'TIER_ADDED', 'tier', t.id, null, b);
      return t.id as string;
    });
    res.status(201).json({ id });
  });
  r.post('/matrix/categories', async (req, res) => {
    const b = z.object({ name: z.string().trim().min(2).max(60), multiplierBps: z.number().int().min(1000).max(100000) }).parse(req.body);
    const { rows: [c] } = await pool.query(`INSERT INTO product_categories (name, multiplier_bps) VALUES ($1,$2) RETURNING id`, [b.name, b.multiplierBps]);
    await audit(pool, req.user.id, 'CATEGORY_ADDED', 'category', c.id, null, b);
    res.status(201).json(c);
  });
  r.put('/matrix/categories/:id', async (req, res) => {
    const b = z.object({ multiplierBps: z.number().int().min(1000).max(100000) }).parse(req.body);
    const u = await pool.query(`UPDATE product_categories SET multiplier_bps=$2 WHERE id=$1`, [req.params.id, b.multiplierBps]);
    if (!u.rowCount) throw notFound('Category');
    await audit(pool, req.user.id, 'MULTIPLIER_CHANGED', 'category', req.params.id!, null, b);
    res.json({ ok: true });
  });
  r.put('/influencers/:id/custom-rate', async (req, res) => {
    const b = z.object({ basePayPaise: money, bonusPer10kPaise: money, maxViewBonusPaise: money, reason: z.string().min(3).max(500) }).parse(req.body);
    await pool.query(
      `INSERT INTO custom_rate_cards (influencer_id, base_pay_paise, bonus_per_10k_paise, max_view_bonus_paise, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (influencer_id) DO UPDATE SET base_pay_paise=$2, bonus_per_10k_paise=$3, max_view_bonus_paise=$4, reason=$5, created_by=$6`,
      [req.params.id, b.basePayPaise, b.bonusPer10kPaise, b.maxViewBonusPaise, b.reason, req.user.id]);
    await audit(pool, req.user.id, 'CUSTOM_RATE_SET', 'influencer', req.params.id!, b.reason, b);
    res.json({ ok: true });
  });
  r.get('/tds-rules', async (_q, res) => res.json((await pool.query(`SELECT * FROM tds_rules ORDER BY effective_from DESC`)).rows));
  r.post('/tds-rules', async (req, res) => {
    const b = z.object({ code: z.enum(['PROF_194J', 'CONTRACT_194C_IND', 'CONTRACT_194C_OTHER', 'BENEFIT_194R']), label: z.string().min(3), legacySection: z.string().min(2), rateBps: z.number().int().min(0).max(10000), noPanRateBps: z.number().int().min(0).max(10000), annualThresholdPaise: money, singleThresholdPaise: money.optional(), effectiveFrom: z.string().date() }).parse(req.body);
    const { rows: [t] } = await pool.query(
      `INSERT INTO tds_rules (code, label, legacy_section, rate_bps, no_pan_rate_bps, annual_threshold_paise, single_threshold_paise, effective_from) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [b.code, b.label, b.legacySection, b.rateBps, b.noPanRateBps, b.annualThresholdPaise, b.singleThresholdPaise ?? null, b.effectiveFrom]);
    await audit(pool, req.user.id, 'TDS_RULE_ADDED', 'tds_rule', t.id, null, b);
    res.status(201).json(t);
  });
  // How a creator is engaged decides their TDS section.
  r.put('/influencers/:id/engagement', async (req, res) => {
    const b = z.object({ type: z.enum(['PROFESSIONAL', 'CONTRACT_INDIVIDUAL', 'CONTRACT_OTHER', 'SALARIED']), reason: z.string().min(3).max(300) }).parse(req.body);
    const u = await pool.query(`UPDATE influencer_profiles SET engagement_type=$2 WHERE user_id=$1`, [req.params.id, b.type]);
    if (!u.rowCount) throw notFound('Creator');
    await audit(pool, req.user.id, 'ENGAGEMENT_TYPE_CHANGED', 'influencer', req.params.id!, b.reason, { type: b.type });
    res.json({ ok: true });
  });
  // Section 194R: free products, gifts, paid travel or experiences.
  r.get('/benefits', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT b.id, b.description, b.value_paise, b.given_on::text, b.tds_paise, b.recovered_paise, b.rate_bps, b.recover_from_payout, b.status, u.full_name creator
         FROM benefit_records b JOIN users u ON u.id=b.influencer_id ORDER BY b.created_at DESC LIMIT 300`);
    res.json(rows);
  });
  r.post('/benefits', async (req, res) => {
    const b = z.object({ influencerId: z.string().uuid(), description: z.string().min(3).max(300), valuePaise: z.number().int().positive(), givenOn: z.string().date(), recoverFromPayout: z.boolean() }).parse(req.body);
    const id = await withTx(async (c) => {
      const { rows: [p] } = await c.query(`SELECT user_id FROM influencer_profiles WHERE user_id=$1 FOR UPDATE`, [b.influencerId]);
      if (!p) throw notFound('Creator');
      const rule = await activeRule(c, 'BENEFIT_194R', b.givenOn);
      const year = taxYear(b.givenOn);
      const { rows: [prior] } = await c.query(
        `SELECT COALESCE(SUM(value_paise),0)::bigint g, COALESCE(SUM(tds_paise),0)::bigint t FROM benefit_records WHERE influencer_id=$1 AND tax_year=$2 AND status<>'VOID'`, [b.influencerId, year]);
      const { rows: [tax] } = await c.query(`SELECT pan_status, pan_encrypted FROM tax_records WHERE influencer_id=$1`, [b.influencerId]);
      const panOperative = !!tax && tax.pan_status !== 'INOPERATIVE';
      const { tdsPaise, rateBps } = computeTds({ grossPaise: b.valuePaise, priorGrossThisYearPaise: prior.g, priorTdsThisYearPaise: prior.t, panOperative, rule: ruleTerms(rule) });
      const open = b.recoverFromPayout && tdsPaise > 0;
      const { rows: [r] } = await c.query(
        `INSERT INTO benefit_records (influencer_id, tds_rule_id, description, value_paise, given_on, tax_year, tds_paise, rate_bps, pan_applied, pan_encrypted, recover_from_payout, status, recorded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id, tds_paise`,
        [b.influencerId, rule.id, b.description, b.valuePaise, b.givenOn, year, tdsPaise, rateBps, panOperative, tax?.pan_encrypted ?? null, b.recoverFromPayout, open ? 'OPEN' : 'SETTLED', req.user.id]);
      await audit(c, req.user.id, 'BENEFIT_RECORDED', 'benefit', r.id, b.description, { valuePaise: b.valuePaise, tdsPaise });
      return r;
    });
    res.status(201).json(id);
  });
  r.post('/benefits/:id/void', async (req, res) => {
    const b = z.object({ reason: z.string().min(3).max(300) }).parse(req.body);
    const u = await pool.query(`UPDATE benefit_records SET status='VOID' WHERE id=$1 AND recovered_paise=0 AND status<>'VOID'`, [req.params.id]);
    if (!u.rowCount) throw conflict('BAD_STATE', 'This entry has already had tax recovered from a payment, so it cannot be cancelled');
    await audit(pool, req.user.id, 'BENEFIT_VOIDED', 'benefit', req.params.id!, b.reason);
    res.json({ ok: true });
  });
  r.get('/holidays', async (_q, res) => {
    res.json((await pool.query(`SELECT to_char(holiday_date,'YYYY-MM-DD') date, name FROM bank_holidays ORDER BY holiday_date DESC LIMIT 60`)).rows);
  });
  r.post('/holidays', async (req, res) => {
    const b = z.object({ date: z.string().date(), name: z.string().min(2) }).parse(req.body);
    await pool.query(`INSERT INTO bank_holidays VALUES ($1,$2) ON CONFLICT (holiday_date) DO UPDATE SET name=$2`, [b.date, b.name]);
    res.status(201).json({ ok: true });
  });
  r.post('/legal-documents', async (req, res) => {
    const b = z.object({ version: z.string().min(1).max(30), title: z.string().min(3), body: z.string().min(50) }).parse(req.body);
    const id = await withTx(async (c) => {
      await c.query(`UPDATE legal_documents SET is_current=FALSE WHERE is_current`);
      const { rows: [d] } = await c.query(
        `INSERT INTO legal_documents (version, title, body, content_hash, is_current) VALUES ($1,$2,$3,$4,TRUE) RETURNING id`,
        [b.version, b.title, b.body, crypto.createHash('sha256').update(b.body).digest('hex')]);
      await audit(c, req.user.id, 'LEGAL_PUBLISHED', 'legal_document', d.id);
      return d.id as string;
    });
    res.status(201).json({ id });
  });

  // ---- Vetting and blacklist ----
  r.get('/influencers', async (req, res) => {
    const q = z.object({ vetting: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT p.user_id, u.full_name, u.email, u.phone, t.name tier, p.city, p.vetting_status, p.is_blacklisted, p.engagement_type, p.vetting_step1_by, p.erased_at IS NOT NULL erased, p.blacklist_reason, pa.verified_at IS NOT NULL bank_confirmed, pa.influencer_id IS NOT NULL has_bank, tx.pan_last4, tx.pan_status, tx.legal_name, tx.updated_at IS NOT NULL has_pan,
              (SELECT json_agg(json_build_object('platform',s.platform,'handle',s.handle,'followers',s.followers)) FROM social_accounts s WHERE s.influencer_id=p.user_id) social
         FROM influencer_profiles p JOIN users u ON u.id=p.user_id JOIN tiers t ON t.id=p.tier_id LEFT JOIN tax_records tx ON tx.influencer_id=p.user_id LEFT JOIN payout_accounts pa ON pa.influencer_id=p.user_id
        WHERE ($1::text IS NULL OR p.vetting_status=$1) AND p.erased_at IS NULL ORDER BY p.created_at DESC LIMIT 1000`, [q.vetting ?? null]);
    res.json(rows);
  });
  // Any one admin can approve a creator. Approving also confirms the PAN.
  r.post('/influencers/:id/vet', async (req, res) => {
    const b = z.object({ approve: z.boolean(), reason: z.string().min(3).max(500) }).parse(req.body);
    await withTx(async (c) => {
      const { rows: [p] } = await c.query(`SELECT * FROM influencer_profiles WHERE user_id=$1 FOR UPDATE`, [req.params.id]);
      if (!p) throw notFound('Creator');
      if (!['PENDING_STEP_1', 'PENDING_STEP_2'].includes(p.vetting_status)) throw conflict('BAD_STATE', 'This creator is not awaiting approval');
      if (b.approve) {
        const has = await c.query(`SELECT 1 FROM tax_records WHERE influencer_id=$1`, [p.user_id]);
        if (!has.rowCount) throw conflict('PAN_MISSING', 'This creator has not added a PAN yet');
        await c.query(`UPDATE tax_records SET pan_status='VERIFIED' WHERE influencer_id=$1 AND pan_status='UNVERIFIED'`, [p.user_id]);
      }
      await c.query(`UPDATE influencer_profiles SET vetting_status=$2 WHERE user_id=$1`, [p.user_id, b.approve ? 'APPROVED' : 'REJECTED']);
      await audit(c, req.user.id, b.approve ? 'VETTING_APPROVED' : 'VETTING_REJECTED', 'influencer', p.user_id, b.reason);
    });
    res.json({ ok: true });
  });
  r.post('/influencers/:id/blacklist', async (req, res) => {
    const b = z.object({ blacklisted: z.boolean(), reason: z.string().min(3).max(500) }).parse(req.body);
    const u = await pool.query(`UPDATE influencer_profiles SET is_blacklisted=$2, blacklist_reason=$3 WHERE user_id=$1`, [req.params.id, b.blacklisted, b.blacklisted ? b.reason : null]);
    if (!u.rowCount) throw notFound('Creator');
    await audit(pool, req.user.id, b.blacklisted ? 'BLACKLISTED' : 'UNBLACKLISTED', 'influencer', req.params.id!, b.reason);
    res.json({ ok: true });
  });

  // ---- Store promo codes ----
  r.post('/promo-codes', async (req, res) => {
    const b = z.object({ code: z.string().min(3).max(30).transform((s) => s.toUpperCase()), influencerId: z.string().uuid(), campaignId: z.string().uuid().optional(), storeId: z.string().uuid().optional() }).parse(req.body);
    const { rows: [p] } = await pool.query(
      `INSERT INTO promo_codes (code, influencer_id, campaign_id, store_id) VALUES ($1,$2,$3,$4) RETURNING id`, [b.code, b.influencerId, b.campaignId ?? null, b.storeId ?? null]);
    await audit(pool, req.user.id, 'PROMO_CREATED', 'promo_code', p.id);
    res.status(201).json(p);
  });
  r.get('/promo-codes', async (_q, res) => {
    const { rows } = await pool.query(`SELECT p.*, u.full_name creator FROM promo_codes p JOIN users u ON u.id=p.influencer_id ORDER BY p.sales_paise DESC`);
    res.json(rows);
  });
  r.post('/promo-codes/:code/redemption', async (req, res) => {
    const b = z.object({ salePaise: money }).parse(req.body);
    const u = await pool.query(`UPDATE promo_codes SET redemptions=redemptions+1, sales_paise=sales_paise+$2 WHERE code=$1`, [req.params.code!.toUpperCase(), b.salePaise]);
    if (!u.rowCount) throw notFound('Promo code');
    res.json({ ok: true });
  });

  // ---- Payment sheet desk ----
  r.get('/payment-batches', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, SUM(CASE WHEN i.status NOT IN ('VOID','FAILED') THEN 1 ELSE 0 END) items,
              COALESCE(SUM(CASE WHEN i.status NOT IN ('VOID','FAILED') THEN i.gross_paise ELSE 0 END),0) gross_paise,
              COALESCE(SUM(CASE WHEN i.status NOT IN ('VOID','FAILED') THEN i.tds_paise ELSE 0 END),0) tds_paise,
              COALESCE(SUM(CASE WHEN i.status NOT IN ('VOID','FAILED') THEN i.net_paise ELSE 0 END),0) net_paise
         FROM payment_batches b LEFT JOIN payment_batch_items i ON i.batch_id=b.id GROUP BY b.id ORDER BY b.created_at DESC LIMIT 200`);
    res.json(rows);
  });
  r.get('/payable-queue', async (_q, res) => {
    const { rows } = await pool.query(
      `SELECT e.id, u.full_name creator, e.gross_paise, e.payout_due_date, e.payout_due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date AS overdue
         FROM earnings e JOIN users u ON u.id=e.influencer_id WHERE e.status='PAYABLE' ORDER BY e.payout_due_date`);
    res.json(rows);
  });
  r.get('/payment-batches/:id/items', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT i.id, i.status, i.status_reason, i.gross_paise, i.tds_paise, i.benefit_tds_paise, i.net_paise, i.utr, i.paid_at,
              u.full_name creator, t.pan_last4, s.post_url, k.title campaign, e.views_at_final, e.payout_due_date
         FROM payment_batch_items i JOIN users u ON u.id=i.influencer_id JOIN earnings e ON e.id=i.earning_id
         JOIN submissions s ON s.id=e.submission_id JOIN campaigns k ON k.id=s.campaign_id
         LEFT JOIN tax_records t ON t.influencer_id=i.influencer_id
        WHERE i.batch_id=$1 ORDER BY u.full_name`, [req.params.id]);
    res.json(rows);
  });
  r.get('/finance-summary', async (_q, res) => {
    const year = taxYear(istDate());
    const { rows: [s] } = await pool.query(
      `SELECT (SELECT COALESCE(SUM(gross_paise),0)::bigint FROM earnings WHERE status='PAYABLE') queue_paise,
              (SELECT COUNT(*)::int FROM earnings WHERE status='PAYABLE' AND payout_due_date < (now() AT TIME ZONE 'Asia/Kolkata')::date) overdue,
              (SELECT COALESCE(SUM(net_paise),0)::bigint FROM payment_batch_items WHERE status='PAID') paid_paise,
              ((SELECT COALESCE(SUM(tds_paise),0)::bigint FROM tds_ledger WHERE tax_year=$1 AND NOT is_void) + (SELECT COALESCE(SUM(tds_paise),0)::bigint FROM benefit_records WHERE tax_year=$1 AND status<>'VOID')) tds_paise`, [year]);
    res.json({ ...s, taxYear: year });
  });
  // Full PANs are needed for TDS returns, so this file is logged each time it is downloaded.
  r.get('/tax-report.csv', async (req, res) => {
    const year = z.string().regex(/^\d{4}-\d{2}$/).default(taxYear(istDate())).parse(req.query.year);
    const { rows } = await pool.query(
      `SELECT x.legal_name, COALESCE(l.pan_encrypted, x.pan_encrypted) pan_encrypted, r.legacy_section, l.rate_bps, l.pan_applied, l.gross_paise, l.tds_paise, l.created_at::date::text AS on_date, i.status
         FROM tds_ledger l JOIN tax_records x ON x.influencer_id=l.influencer_id JOIN tds_rules r ON r.id=l.tds_rule_id
         JOIN payment_batch_items i ON i.id=l.batch_item_id
        WHERE l.tax_year=$1 AND NOT l.is_void ORDER BY l.created_at`, [year]);
    const { rows: benefits } = await pool.query(
      `SELECT x.legal_name, COALESCE(b.pan_encrypted, x.pan_encrypted) pan_encrypted, r.legacy_section, b.rate_bps, b.pan_applied, b.value_paise gross_paise, b.tds_paise, b.given_on::text AS on_date, b.status
         FROM benefit_records b JOIN users u ON u.id=b.influencer_id LEFT JOIN tax_records x ON x.influencer_id=b.influencer_id JOIN tds_rules r ON r.id=b.tds_rule_id
        WHERE b.tax_year=$1 AND b.status<>'VOID' ORDER BY b.created_at`, [year]);
    rows.push(...benefits);
    await audit(pool, req.user.id, 'TAX_REPORT_DOWNLOADED', 'tax_year', year);
    const lines = rows.map((r) => [r.on_date, r.legal_name, r.pan_encrypted ? decrypt(r.pan_encrypted) : 'NO PAN', r.legacy_section, (r.rate_bps / 100).toFixed(2), r.pan_applied ? 'Yes' : 'No',
      (r.gross_paise / 100).toFixed(2), (r.tds_paise / 100).toFixed(2), r.status].map(csvCell).join(','));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="tds-${year}.csv"`);
    res.send(['Date,Legal name,PAN,Old section,Rate %,PAN applied,Gross (Rs),TDS (Rs),Payment status', ...lines].join('\n') + '\n');
  });
  r.post('/payment-batches', async (req, res) => res.status(201).json(await generateBatch(req.user.id)));
  r.post('/payment-batches/:id/approve', async (req, res) => { await approveBatch(req.params.id!, req.user.id); res.json({ ok: true }); });
  r.post('/payment-batches/:id/release', async (req, res) => res.json(await releaseBatch(req.params.id!, req.user.id)));
  // Excel file, because a CSV opened in Excel silently corrupts long account numbers.
  r.get('/payment-batches/:id/bank-file.xlsx', async (req, res) => {
    const q = z.object({ reExportReason: z.string().min(3).max(300).optional() }).parse(req.query);
    const { lines, skipped } = await bankPaymentLines(req.params.id!, req.user.id, q.reExportReason);
    if (q.reExportReason) { await alertAdmins(pool, req.user.id, 'A bank file was downloaded a second time', q.reExportReason); await flushOutbox(); }
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Payments');
    ws.columns = [
      { header: 'Beneficiary name', key: 'name', width: 28 }, { header: 'Account number', key: 'accountNumber', width: 24, style: { numFmt: '@' } },
      { header: 'IFSC', key: 'ifsc', width: 14 }, { header: 'Amount (Rs)', key: 'rupees', width: 14, style: { numFmt: '0.00' } },
      { header: 'Payment reference', key: 'reference', width: 30 }, { header: 'Email', key: 'email', width: 28 }, { header: 'Mobile', key: 'phone', width: 14, style: { numFmt: '@' } },
    ];
    ws.getRow(1).font = { bold: true };
    lines.forEach((l) => ws.addRow(l));
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="bank-payments-${req.params.id}.xlsx"`);
    res.setHeader('X-Skipped-Payments', String(skipped));
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  });
  r.post('/payment-items/:id/paid', async (req, res) => {
    const b = z.object({ utr: z.string().trim().min(6, 'Enter the bank reference (UTR)').max(40) }).parse(req.body);
    await recordBankPaid(req.params.id!, b.utr, req.user.id);
    res.json({ ok: true });
  });
  r.post('/payment-items/:id/failed', async (req, res) => {
    const b = z.object({ reason: z.string().trim().min(3).max(300) }).parse(req.body);
    await recordBankFailed(req.params.id!, b.reason, req.user.id);
    res.json({ ok: true });
  });
  r.post('/influencers/:id/bank/confirm', async (req, res) => {
    const b = z.object({ viewedVersion: z.string() }).parse(req.body);
    // Confirms exactly what the admin looked at, not anything changed since.
    const u = await pool.query(`UPDATE payout_accounts SET verified_at=now(), verified_by=$2 WHERE influencer_id=$1 AND updated_at::text=$3`, [req.params.id, req.user.id, b.viewedVersion]);
    if (!u.rowCount) throw conflict('CHANGED', 'These details changed while you were looking. Please open them again.');
    await audit(pool, req.user.id, 'BANK_DETAILS_CONFIRMED', 'influencer', req.params.id!);
    res.json({ ok: true });
  });
  r.get('/influencers/:id/pan', async (req, res) => {
    const { rows: [t] } = await pool.query(`SELECT pan_encrypted, legal_name, pan_status, updated_at::text AS version FROM tax_records WHERE influencer_id=$1`, [req.params.id]);
    if (!t) throw notFound('PAN');
    await audit(pool, req.user.id, 'PAN_VIEWED', 'influencer', req.params.id!);
    res.json({ pan: decrypt(t.pan_encrypted), legalName: t.legal_name, status: t.pan_status, version: t.version });
  });
  r.post('/influencers/:id/pan/confirm', async (req, res) => {
    const b = z.object({ viewedVersion: z.string() }).parse(req.body);
    const u = await pool.query(`UPDATE tax_records SET pan_status='VERIFIED' WHERE influencer_id=$1 AND updated_at::text=$2`, [req.params.id, b.viewedVersion]);
    if (!u.rowCount) throw conflict('CHANGED', 'This PAN changed while you were looking. Please open it again.');
    await audit(pool, req.user.id, 'PAN_CONFIRMED', 'influencer', req.params.id!);
    res.json({ ok: true });
  });
  // Invalid or inoperative PAN: payment can go ahead, with TDS at the higher rate (20%).
  r.post('/influencers/:id/pan/invalid', async (req, res) => {
    const b = z.object({ viewedVersion: z.string() }).parse(req.body);
    const u = await pool.query(`UPDATE tax_records SET pan_status='INOPERATIVE' WHERE influencer_id=$1 AND updated_at::text=$2`, [req.params.id, b.viewedVersion]);
    if (!u.rowCount) throw conflict('CHANGED', 'This PAN changed while you were looking. Please open it again.');
    await audit(pool, req.user.id, 'PAN_MARKED_INVALID', 'influencer', req.params.id!);
    res.json({ ok: true });
  });
  r.get('/influencers/:id/bank', async (req, res) => {
    const { rows: [a] } = await pool.query(`SELECT account_holder, account_number_enc, ifsc, verified_at, updated_at::text AS version FROM payout_accounts WHERE influencer_id=$1`, [req.params.id]);
    if (!a) throw notFound('Bank details');
    await audit(pool, req.user.id, 'BANK_DETAILS_VIEWED', 'influencer', req.params.id!);
    res.json({ accountHolder: a.account_holder, accountNumber: decrypt(a.account_number_enc), ifsc: a.ifsc, confirmed: !!a.verified_at, version: a.version });
  });
  r.get('/payment-batches/:id/report.csv', async (req, res) => {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="payment-sheet-${req.params.id}.csv"`);
    res.send(await batchCsv(req.params.id!));
  });
  r.get('/audit', async (req, res) => {
    const q = z.object({ entityType: z.string().optional(), entityId: z.string().optional() }).parse(req.query);
    const { rows } = await pool.query(
      `SELECT a.*, u.full_name actor FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_id
        WHERE ($1::text IS NULL OR a.entity_type=$1) AND ($2::text IS NULL OR a.entity_id=$2) ORDER BY a.id DESC LIMIT 500`, [q.entityType ?? null, q.entityId ?? null]);
    res.json(rows);
  });
  return r;
}
