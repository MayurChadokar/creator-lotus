import bcrypt from 'bcryptjs';
import { Router } from 'express';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { AppError, audit, conflict, encrypt, env, forbidden, lookupHash, notFound, notify, pool, withTx } from '../core.js';
import { raiseDispute } from '../engines/liability.js';
import { computePay, maxPay } from '../engines/pricing.js';
import { flushOutbox } from '../engines/notifications.js';
import { createSubmission, rateTermsFor } from '../engines/verification.js';
import { availableSlots, cancelVisit, requestVisit } from '../engines/visits.js';
import { connectInstagram, instagramAuthorizeUrl } from '../integrations/instagram.js';
import { resolveChannel } from '../integrations/youtube.js';
import { requireRole } from './auth.js';

export const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const GSTIN_RE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function influencerRoutes() {
  const r = Router();
  r.use(requireRole('INFLUENCER'));

  r.get('/me', async (req, res) => {
    const { rows: [p] } = await pool.query(
      `SELECT u.full_name, u.email, u.phone, p.vetting_status, p.home_store_id, p.is_blacklisted, p.city, t.name tier,
              tx.pan_last4, tx.pan_status, tx.legal_name pan_legal_name, tx.gstin,
              pa.masked_display payout_account, pa.account_holder payout_account_holder, pa.ifsc payout_ifsc, pa.verified_at IS NOT NULL bank_confirmed,
              (SELECT json_agg(json_build_object('platform',s.platform,'handle',s.handle,'followers',s.followers))
                 FROM social_accounts s WHERE s.influencer_id=p.user_id) social,
              EXISTS (SELECT 1 FROM legal_acceptance_logs l JOIN legal_documents d ON d.id=l.document_id
                       WHERE l.influencer_id=p.user_id AND d.is_current) terms_accepted
         FROM influencer_profiles p JOIN users u ON u.id=p.user_id JOIN tiers t ON t.id=p.tier_id
         LEFT JOIN tax_records tx ON tx.influencer_id=p.user_id LEFT JOIN payout_accounts pa ON pa.influencer_id=p.user_id
        WHERE p.user_id=$1`, [req.user.id]);
    res.json(p);
  });

  r.put('/tax', async (req, res) => {
    const b = z.object({
      pan: z.string().transform((s) => s.trim().toUpperCase()).refine((s) => PAN_RE.test(s), 'Enter a valid 10-character PAN'),
      legalName: z.string().min(2).max(120),
      gstin: z.string().transform((s) => s.trim().toUpperCase()).refine((s) => GSTIN_RE.test(s), 'Enter a valid GSTIN').optional(),
    }).parse(req.body);
    await withTx(async (c) => {
      await c.query(
        `INSERT INTO tax_records (influencer_id, pan_encrypted, pan_lookup_hash, pan_last4, legal_name, gstin)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (influencer_id) DO UPDATE SET pan_encrypted=EXCLUDED.pan_encrypted, pan_lookup_hash=EXCLUDED.pan_lookup_hash,
           pan_last4=EXCLUDED.pan_last4, legal_name=EXCLUDED.legal_name, gstin=EXCLUDED.gstin, pan_status='UNVERIFIED', updated_at=now()`,
        [req.user.id, encrypt(b.pan), lookupHash(b.pan), b.pan.slice(-4), b.legalName, b.gstin ?? null]);
      await audit(c, req.user.id, 'TAX_RECORD_SAVED', 'influencer', req.user.id);
    });
    res.json({ panLast4: b.pan.slice(-4) });
  });

  r.put('/payout-account', async (req, res) => {
    const b = z.object({
      currentPassword: z.string().min(1).max(200), accountHolder: z.string().min(2).max(120), accountNumber: z.string().regex(/^\d{6,20}$/, 'Enter a valid account number'),
      ifsc: z.string().transform((s) => s.trim().toUpperCase()).refine((s) => /^[A-Z]{4}0[A-Z0-9]{6}$/.test(s), 'Enter a valid IFSC'),
    }).parse(req.body);
    // A stolen session alone must not be able to redirect someone's money.
    const { rows: [me] } = await pool.query(`SELECT password_hash FROM users WHERE id=$1`, [req.user.id]);
    if (!(await bcrypt.compare(b.currentPassword, me.password_hash))) throw new AppError(400, 'BAD_PASSWORD', 'Your password is not right');
    const masked = `A/c ending ${b.accountNumber.slice(-4)}`;
    await pool.query(
      `INSERT INTO payout_accounts (influencer_id, account_type, account_holder, account_number_enc, ifsc, masked_display, account_lookup_hash)
       VALUES ($1,'BANK',$2,$3,$4,$5,$6)
       ON CONFLICT (influencer_id) DO UPDATE SET account_type='BANK', account_holder=EXCLUDED.account_holder,
         account_number_enc=EXCLUDED.account_number_enc, ifsc=EXCLUDED.ifsc, upi_id=NULL, masked_display=EXCLUDED.masked_display,
         account_lookup_hash=EXCLUDED.account_lookup_hash, verified_at=NULL, verified_by=NULL, updated_at=now()`,
      [req.user.id, b.accountHolder, encrypt(b.accountNumber), b.ifsc, masked, lookupHash(`bank:${b.ifsc.slice(0, 4)}:${b.accountNumber.replace(/^0+/, '')}`)]);
    await audit(pool, req.user.id, 'BANK_DETAILS_SAVED', 'influencer', req.user.id);
    await notify(pool, req.user.id, 'bank_details_changed'); // warns the real owner if an account was taken over
    await flushOutbox();
    res.json({ maskedDisplay: masked });
  });

  r.get('/social/instagram/connect-url', (req, res) => {
    if (!process.env.INSTAGRAM_APP_ID) throw new AppError(503, 'NOT_READY', 'Instagram connection is waiting for Meta approval. Please use YouTube for now.');
    const state = jwt.sign({ uid: req.user.id, purpose: 'ig' }, env('JWT_SECRET'), { expiresIn: '15m' });
    res.json({ url: instagramAuthorizeUrl(state) });
  });
  r.post('/social/instagram/connect', async (req, res) => {
    const b = z.object({ code: z.string().min(1), state: z.string().min(1) }).parse(req.body);
    let st: { uid?: string; purpose?: string };
    try { st = jwt.verify(b.state, env('JWT_SECRET')) as typeof st; } catch { throw new AppError(400, 'BAD_STATE', 'Please start connecting again'); }
    if (st.uid !== req.user.id || st.purpose !== 'ig') throw forbidden();
    const a = await connectInstagram(b.code);
    await pool.query(
      `INSERT INTO social_accounts (influencer_id, platform, external_id, handle, followers, access_token_enc, token_expires_at)
       VALUES ($1,'INSTAGRAM',$2,$3,$4,$5, now()+make_interval(secs => $6))
       ON CONFLICT (influencer_id, platform) DO UPDATE SET external_id=EXCLUDED.external_id, handle=EXCLUDED.handle, followers=EXCLUDED.followers,
         access_token_enc=EXCLUDED.access_token_enc, token_expires_at=EXCLUDED.token_expires_at, connected_at=now()`,
      [req.user.id, a.externalId, a.handle, a.followers, encrypt(a.token), a.expiresInSeconds]);
    res.json({ handle: a.handle });
  });
  // Proves channel ownership: the creator puts a one-time code in their channel description.
  r.post('/social/youtube/start', async (req, res) => {
    const b = z.object({ handle: z.string().min(2).max(100) }).parse(req.body);
    if (!process.env.YOUTUBE_API_KEY) throw new AppError(503, 'NOT_READY', 'YouTube connection is not switched on yet. Please try again later.');
    const ch = await resolveChannel(b.handle);
    if (!ch) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'We could not find that YouTube channel');
    const code = `CD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
    const proof = jwt.sign({ uid: req.user.id, purpose: 'yt', channelId: ch.id, handle: b.handle.replace(/^@/, ''), code }, env('JWT_SECRET'), { expiresIn: '1h', algorithm: 'HS256' });
    res.json({ channel: ch.title, code, proof });
  });
  r.post('/social/youtube/connect', async (req, res) => {
    const b = z.object({ proof: z.string() }).parse(req.body);
    let p: { uid?: string; purpose?: string; channelId?: string; handle?: string; code?: string };
    try { p = jwt.verify(b.proof, env('JWT_SECRET'), { algorithms: ['HS256'] }) as typeof p; } catch { throw new AppError(400, 'BAD_STATE', 'That code has expired. Please start again.'); }
    if (p.uid !== req.user.id || p.purpose !== 'yt') throw forbidden();
    const ch = await resolveChannel(p.handle!);
    if (!ch || ch.id !== p.channelId) throw new AppError(404, 'CHANNEL_NOT_FOUND', 'We could not find that YouTube channel');
    if (!ch.description.includes(p.code!)) throw new AppError(400, 'CODE_NOT_FOUND', `We could not find ${p.code} in your channel description. Save it there, wait a minute, and try again.`);
    await pool.query(
      `INSERT INTO social_accounts (influencer_id, platform, external_id, handle, followers) VALUES ($1,'YOUTUBE',$2,$3,$4)
       ON CONFLICT (influencer_id, platform) DO UPDATE SET external_id=EXCLUDED.external_id, handle=EXCLUDED.handle, followers=EXCLUDED.followers, connected_at=now()`,
      [req.user.id, ch.id, p.handle, ch.followers]);
    await audit(pool, req.user.id, 'YOUTUBE_CONNECTED', 'influencer', req.user.id, null, { channelId: ch.id });
    res.json({ channel: ch.title });
  });

  r.get('/legal/current', async (_q, res) => {
    const { rows: [d] } = await pool.query(`SELECT id, version, title, body, content_hash FROM legal_documents WHERE is_current`);
    if (!d) throw notFound('Terms');
    res.json(d);
  });
  r.post('/legal/accept', async (req, res) => {
    const b = z.object({ documentId: z.string().uuid() }).parse(req.body);
    const { rows: [d] } = await pool.query(`SELECT id, content_hash, is_current FROM legal_documents WHERE id=$1`, [b.documentId]);
    if (!d?.is_current) throw conflict('NOT_CURRENT', 'These terms have been updated. Please read the latest version.');
    await pool.query(
      `INSERT INTO legal_acceptance_logs (influencer_id, document_id, content_hash, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (influencer_id, document_id) DO NOTHING`,
      [req.user.id, d.id, d.content_hash, req.ip, req.header('user-agent') ?? null]);
    res.json({ accepted: true });
  });

  r.get('/campaigns', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT k.id, k.title, k.brief, k.expires_at, k.category_id, pc.name category, k.min_engagement_bps, k.min_views, k.measurement_days, k.posting_hashtags, k.posting_mentions, k.posting_guidelines, k.required_disclosure, k.collab_account,
              (SELECT json_agg(json_build_object('id',s.id,'name',s.name,'city',s.city)) FROM campaign_stores cs JOIN stores s ON s.id=cs.store_id WHERE cs.campaign_id=k.id) stores,
              (SELECT x.status FROM submissions x WHERE x.campaign_id=k.id AND x.influencer_id=$1 AND x.status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED') LIMIT 1) my_entry
         FROM campaigns k JOIN product_categories pc ON pc.id=k.category_id
        WHERE k.status='OPEN' AND k.starts_at<=now() AND k.expires_at>now() ORDER BY k.expires_at`, [req.user.id]);
    // Each creator sees the pay that would apply to them in each campaign.
    for (const k of rows) {
      try { const t = await rateTermsFor(pool, req.user.id, k.category_id, k.id); k.my_pay = { ...t, maxPaise: maxPay(t) }; } catch { k.my_pay = null; }
    }
    res.json(rows);
  });

  // Earnings calculator: same engine that decides real pay
  r.post('/calculator', async (req, res) => {
    const b = z.object({ categoryId: z.string().uuid(), views: z.number().int().min(0).max(100000000), campaignId: z.string().uuid().optional() }).parse(req.body);
    const terms = await rateTermsFor(pool, req.user.id, b.categoryId, b.campaignId);
    res.json({ ...computePay(terms, b.views), terms });
  });

  r.post('/submissions', async (req, res) => {
    const b = z.object({ campaignId: z.string().uuid(), storeId: z.string().uuid(), postUrl: z.string().url(), collabConfirmed: z.boolean().optional() }).parse(req.body);
    const id = await createSubmission({ influencerId: req.user.id, ...b });
    const { rows: [s] } = await pool.query(`SELECT id, status, status_reason, measure_due_at FROM submissions WHERE id=$1`, [id]);
    res.status(201).json(s);
  });

  // Verification and earnings health tracker
  r.get('/submissions', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT s.id, k.title campaign, s.platform, s.post_url, s.status, s.status_reason, s.content_review, s.measure_due_at, s.submitted_at,
              l.views, l.likes, l.comments, l.engagement_bps, l.logged_at last_checked,
              e.gross_paise, e.payout_due_date, i.tds_paise, i.benefit_tds_paise, i.net_paise, i.status payout_status, i.utr
         FROM submissions s JOIN campaigns k ON k.id=s.campaign_id
         LEFT JOIN LATERAL (SELECT * FROM engagement_score_logs x WHERE x.submission_id=s.id ORDER BY x.logged_at DESC LIMIT 1) l ON TRUE
         LEFT JOIN earnings e ON e.submission_id=s.id AND e.status<>'VOID'
         LEFT JOIN payment_batch_items i ON i.earning_id=e.id AND i.status NOT IN ('VOID','FAILED')
        WHERE s.influencer_id=$1 ORDER BY s.submitted_at DESC`, [req.user.id]);
    res.json(rows);
  });

  r.get('/tax-summary', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT tax_year, SUM(gross_paise)::bigint gross_paise, SUM(tds_paise)::bigint tds_paise FROM tds_ledger
        WHERE influencer_id=$1 AND NOT is_void GROUP BY tax_year ORDER BY tax_year DESC`, [req.user.id]);
    res.json(rows);
  });

  r.get('/visits/slots', async (req, res) => {
    const q = z.object({ storeId: z.string().uuid() }).parse(req.query);
    res.json(await availableSlots(q.storeId));
  });
  r.get('/visits', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT v.id, v.slot_start, v.slot_end, v.purpose, v.status, v.decision_note, s.name store, s.city, k.title campaign
         FROM store_visits v JOIN stores s ON s.id=v.store_id LEFT JOIN campaigns k ON k.id=v.campaign_id
        WHERE v.influencer_id=$1 ORDER BY v.slot_start DESC LIMIT 100`, [req.user.id]);
    res.json(rows);
  });
  r.post('/visits', async (req, res) => {
    const b = z.object({ storeId: z.string().uuid(), slotStart: z.string().datetime(), purpose: z.string().trim().min(5, 'Please describe your visit in at least 5 characters.').max(500, 'Please keep your visit description within 500 characters.'), campaignId: z.string().uuid().optional() }).parse(req.body);
    res.status(201).json({ id: await requestVisit(req.user.id, b) });
  });
  r.post('/visits/:id/cancel', async (req, res) => {
    await cancelVisit(req.user.id, req.params.id!);
    res.json({ ok: true });
  });

  r.get('/ad-requests', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT a.id, a.duration_days, a.status, a.starts_at, a.ends_at, s.post_url FROM ad_whitelisting_rights a JOIN submissions s ON s.id=a.submission_id
        WHERE a.influencer_id=$1 ORDER BY a.created_at DESC`, [req.user.id]);
    res.json(rows);
  });
  r.post('/ad-requests/:id/respond', async (req, res) => {
    const b = z.object({ accept: z.boolean() }).parse(req.body);
    const { rows: [a] } = await pool.query(
      `UPDATE ad_whitelisting_rights SET status=$3, responded_at=now(),
              starts_at=CASE WHEN $3='ACCEPTED' THEN now() END,
              ends_at=CASE WHEN $3='ACCEPTED' THEN now()+make_interval(days => duration_days) END
        WHERE id=$1 AND influencer_id=$2 AND status='REQUESTED' RETURNING id`,
      [req.params.id, req.user.id, b.accept ? 'ACCEPTED' : 'DECLINED']);
    if (!a) throw notFound('Open request');
    await audit(pool, req.user.id, b.accept ? 'AD_RIGHTS_ACCEPTED' : 'AD_RIGHTS_DECLINED', 'ad_right', a.id);
    res.json({ ok: true });
  });

  r.post('/disputes', async (req, res) => {
    const b = z.object({ submissionId: z.string().uuid().optional(), subject: z.string().min(3).max(150), description: z.string().min(10).max(4000) }).parse(req.body);
    res.status(201).json({ id: await raiseDispute(req.user.id, b) });
  });
  r.get('/disputes', async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, submission_id, subject, description, status, resolution_note, created_at, resolved_at FROM dispute_tickets WHERE influencer_id=$1 ORDER BY created_at DESC`, [req.user.id]);
    res.json(rows);
  });
  return r;
}
