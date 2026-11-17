// Engine 3b: submissions, live post checks and the zero-pay rule.
import { addWorkingDays, audit, conflict, forbidden, istDate, loadHolidays, notFound, notify, pool, withTx, AppError, type Db } from '../core.js';
import { providers } from '../integrations/registry.js';
import type { PostCheck } from '../integrations/types.js';
import { releaseSlot, reserveSlot, settleSlot } from './budget.js';
import { computePay, maxPay, type RateTerms } from './pricing.js';
import { evaluateGate, parsePostUrl } from './qualityGate.js';

/**
 * Which pay applies, first match wins:
 * 1. the creator's own custom rate (a personal deal), x category multiplier
 * 2. the campaign's pay for the creator's level, used exactly as entered (no multiplier)
 * 3. the standard rate for the creator's level, x category multiplier
 */
export async function rateTermsFor(db: Db, influencerId: string, categoryId: string, campaignId?: string): Promise<RateTerms> {
  const { rows: [r] } = await db.query(
    `SELECT COALESCE(c.base_pay_paise, kc.base_pay_paise, rc.base_pay_paise) base,
            COALESCE(c.bonus_per_10k_paise, kc.bonus_per_10k_paise, rc.bonus_per_10k_paise) bonus,
            COALESCE(c.max_view_bonus_paise, kc.max_view_bonus_paise, rc.max_view_bonus_paise) cap,
            CASE WHEN c.influencer_id IS NULL AND kc.campaign_id IS NOT NULL THEN 10000 ELSE pc.multiplier_bps END mult
       FROM influencer_profiles p
       JOIN rate_cards rc ON rc.tier_id = p.tier_id
       JOIN product_categories pc ON pc.id = $2
       LEFT JOIN custom_rate_cards c ON c.influencer_id = p.user_id
       LEFT JOIN campaign_rate_cards kc ON kc.campaign_id = $3 AND kc.tier_id = p.tier_id
      WHERE p.user_id = $1`, [influencerId, categoryId, campaignId ?? null]);
  if (!r) throw new AppError(409, 'NO_RATE_CARD', 'No rate card is set up for this creator');
  return { basePayPaise: r.base, bonusPer10kPaise: r.bonus, maxViewBonusPaise: r.cap, multiplierBps: r.mult };
}

/** Everything a creator must have in place. Each failure tells them exactly what is missing. */
async function assertEligible(c: Db, influencerId: string, platform: string) {
  const { rows: [p] } = await c.query(
    `SELECT p.vetting_status, p.is_blacklisted,
            EXISTS (SELECT 1 FROM tax_records t WHERE t.influencer_id = p.user_id) has_tax,
            EXISTS (SELECT 1 FROM payout_accounts a WHERE a.influencer_id = p.user_id) has_payout,
            EXISTS (SELECT 1 FROM legal_acceptance_logs l JOIN legal_documents d ON d.id = l.document_id
                     WHERE l.influencer_id = p.user_id AND d.is_current) accepted_terms
       FROM influencer_profiles p WHERE p.user_id = $1`, [influencerId]);
  if (!p) throw notFound('Creator profile');
  if (p.is_blacklisted) throw forbidden('This account cannot take part in campaigns');
  if (p.vetting_status !== 'APPROVED') throw conflict('NOT_VETTED', 'Your profile is still awaiting approval');
  if (!p.accepted_terms) throw conflict('TERMS_NOT_ACCEPTED', 'Please accept the current Terms & Conditions first');
  if (!p.has_tax) throw conflict('PAN_MISSING', 'Please add your PAN first');
  if (!p.has_payout) throw conflict('PAYOUT_MISSING', 'Please add your bank account or UPI first');
  const { rows: [acct] } = await c.query(`SELECT id FROM social_accounts WHERE influencer_id=$1 AND platform=$2`, [influencerId, platform]);
  if (!acct) throw conflict('SOCIAL_NOT_CONNECTED', `Please connect your ${platform} account first`);
}

/** Stores a clean link built from the post id, never the address the creator pasted. */
const canonicalUrl = (p: { platform: string; key: string }) =>
  p.platform === 'YOUTUBE' ? `https://www.youtube.com/watch?v=${p.key}` : `https://www.instagram.com/p/${p.key}/`;

export async function createSubmission(a: { influencerId: string; campaignId: string; storeId: string; postUrl: string; collabConfirmed?: boolean }): Promise<string> {
  const parsed = parsePostUrl(a.postUrl);
  if (!parsed) throw new AppError(400, 'BAD_URL', 'Please paste a valid Instagram post or reel link, or a YouTube video link');
  const id = await withTx(async (c) => {
    await assertEligible(c, a.influencerId, parsed.platform);
    const { rows: [k] } = await c.query(`SELECT category_id, measurement_days, collab_account, min_views, min_engagement_bps FROM campaigns WHERE id=$1`, [a.campaignId]);
    if (!k) throw notFound('Campaign');
    if (k.collab_account && parsed.platform === 'INSTAGRAM' && !a.collabConfirmed)
      throw new AppError(400, 'COLLAB_NEEDED', `Invite ${k.collab_account} as a collaborator on your Instagram post, then tick the box to confirm`);
    const tagged = await c.query(`SELECT 1 FROM campaign_stores WHERE campaign_id=$1 AND store_id=$2`, [a.campaignId, a.storeId]);
    if (!tagged.rowCount) throw conflict('STORE_NOT_IN_CAMPAIGN', 'This store is not part of this campaign');
    const dup = await c.query(
      `SELECT 1 FROM submissions WHERE platform=$1 AND platform_post_key=$2 AND status NOT IN ('NOT_LIVE','WITHDRAWN')`,
      [parsed.platform, parsed.key]);
    if (dup.rowCount) throw conflict('DUPLICATE_POST', 'This post has already been submitted');
    const mine = await c.query(
      `SELECT 1 FROM submissions WHERE campaign_id=$1 AND influencer_id=$2 AND status NOT IN ('NOT_LIVE','WITHDRAWN','REJECTED')`, [a.campaignId, a.influencerId]);
    if (mine.rowCount) throw conflict('ONE_ENTRY_PER_CAMPAIGN', 'You already have a post in this campaign. Each creator is paid once per campaign.');
    const terms = await rateTermsFor(c, a.influencerId, k.category_id, a.campaignId);
    const reserved = maxPay(terms);
    await reserveSlot(c, a.campaignId, reserved);
    const { rows: [s] } = await c.query(
      `INSERT INTO submissions (campaign_id, store_id, influencer_id, platform, post_url, platform_post_key,
                                reserved_paise, rate_snapshot, measure_due_at, collab_confirmed, gate_min_views, gate_min_engagement_bps)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(days => $9), $10, $11, $12) RETURNING id`,
      [a.campaignId, a.storeId, a.influencerId, parsed.platform, canonicalUrl(parsed), parsed.key, reserved, JSON.stringify(terms), k.measurement_days,
       Boolean(a.collabConfirmed && k.collab_account && parsed.platform === 'INSTAGRAM'), k.min_views, k.min_engagement_bps]);
    await audit(c, a.influencerId, 'SUBMISSION_CREATED', 'submission', s.id);
    return s.id as string;
  });
  await checkSubmission(id, 'INITIAL');
  return id;
}

/** Ends a submission with zero pay, handing its budget back to the campaign. */
async function closeUnpaid(c: Db, s: any, status: 'REJECTED' | 'NOT_LIVE', reason: string, actorId: string | null) {
  const holdsBudget = !['REJECTED', 'NOT_LIVE', 'WITHDRAWN', 'PAID'].includes(s.status);
  await c.query(`UPDATE submissions SET status=$2, status_reason=$3 WHERE id=$1`, [s.id, status, reason]);
  const { rows: [earning] } = await c.query(`SELECT id, gross_paise FROM earnings WHERE submission_id=$1 AND status<>'VOID'`, [s.id]);
  if (earning) {
    await c.query(`UPDATE earnings SET status='VOID' WHERE id=$1`, [earning.id]);
    const { rows: items } = await c.query(
      `SELECT id FROM payment_batch_items WHERE earning_id=$1 AND status IN ('PENDING','HELD','PROCESSING')`, [earning.id]);
    for (const it of items) await voidBatchItem(c, it.id, reason);
  }
  if (holdsBudget) await releaseSlot(c, s.campaign_id, earning ? earning.gross_paise : s.reserved_paise);
  await audit(c, actorId, `SUBMISSION_${status}`, 'submission', s.id, reason);
  await notify(c, s.influencer_id, status === 'NOT_LIVE' ? 'post_not_live' : 'submission_rejected', { submissionId: s.id, reason });
}

/** Cancels a payment line and undoes its tax entry and any recovery of tax on benefits. */
export async function voidBatchItem(c: Db, itemId: string, reason: string): Promise<void> {
  await c.query(`UPDATE payment_batch_items SET status='VOID', status_reason=$2 WHERE id=$1`, [itemId, reason]);
  await c.query(`UPDATE tds_ledger SET is_void=TRUE WHERE batch_item_id=$1`, [itemId]);
  const { rows: rec } = await c.query(`UPDATE benefit_recoveries SET is_void=TRUE WHERE batch_item_id=$1 AND NOT is_void RETURNING benefit_id, amount_paise`, [itemId]);
  for (const r of rec) {
    await c.query(`UPDATE benefit_records SET recovered_paise = recovered_paise - $2, status='OPEN' WHERE id=$1`, [r.benefit_id, r.amount_paise]);
  }
}

export type CheckPurpose = 'INITIAL' | 'SCHEDULED' | 'FINAL' | 'PRE_PAYOUT';

/** Asks Meta or YouTube about the post, logs the answer and applies the consequences. */
export async function checkSubmission(id: string, purpose: CheckPurpose): Promise<{ outcome: PostCheck['outcome']; check: PostCheck; verificationId: string }> {
  const { rows: [q] } = await pool.query(
    `SELECT s.platform, s.platform_post_key, s.platform_media_id, a.external_id, a.access_token_enc
       FROM submissions s LEFT JOIN social_accounts a ON a.influencer_id = s.influencer_id AND a.platform = s.platform
      WHERE s.id=$1`, [id]);
  if (!q) throw notFound('Submission');
  // The network call happens outside the database lock so a slow API cannot hold up others.
  const check: PostCheck = q.external_id
    ? await providers[q.platform as 'INSTAGRAM' | 'YOUTUBE'].fetchPost({
        key: q.platform_post_key, mediaId: q.platform_media_id, accountExternalId: q.external_id, accessTokenEnc: q.access_token_enc })
    : { outcome: 'API_ERROR', detail: 'Social account is no longer connected' };

  return withTx(async (c) => {
    const { rows: [s] } = await c.query(`SELECT s.*, k.starts_at campaign_starts_at FROM submissions s JOIN campaigns k ON k.id=s.campaign_id WHERE s.id=$1 FOR UPDATE OF s`, [id]);
    const { rows: [v] } = await c.query(
      `INSERT INTO social_link_verifications (submission_id, purpose, outcome, detail) VALUES ($1,$2,$3,$4) RETURNING id`,
      [id, purpose, check.outcome, check.detail ?? null]);
    const result = { outcome: check.outcome, check, verificationId: v.id as string };
    if (check.outcome === 'API_ERROR') {
      await audit(c, null, 'VERIFICATION_API_ERROR', 'submission', id, check.detail);
      return result; // A failed check proves nothing either way. The post is neither passed nor punished.
    }
    if (check.outcome === 'NOT_FOUND') {
      if (s.status !== 'PAID' && !s.live_check_waived) await closeUnpaid(c, s, 'NOT_LIVE', check.detail ?? 'Post is not live', null);
      else await audit(c, null, 'PAID_POST_REMOVED', 'submission', id, check.detail);
      return result;
    }
    if (check.outcome === 'NOT_OWNER') {
      // Not this creator's post: closes without blocking the real owner from submitting it.
      await closeUnpaid(c, s, 'NOT_LIVE', check.detail ?? 'Not the creator\'s post', null);
      return result;
    }
    if (check.publishedAt && check.publishedAt < new Date(s.campaign_starts_at)) {
      await closeUnpaid(c, s, 'REJECTED', 'Post was published before the campaign started', null);
      return result;
    }
    await c.query(`UPDATE submissions SET last_live_check_at=now(), platform_media_id=COALESCE($2,platform_media_id) WHERE id=$1`, [id, check.mediaId ?? null]);
    const m = check.metrics!;
    await c.query(
      `INSERT INTO engagement_score_logs (submission_id, verification_id, views, likes, comments, reach, followers)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [id, v.id, m.views, m.likes, m.comments, m.reach ?? null, m.followers ?? null]);
    if (s.status === 'PENDING_VERIFICATION') {
      await c.query(`UPDATE submissions SET status='MEASURING', status_reason=NULL WHERE id=$1`, [id]);
    }
    return result;
  });
}

/** Turns a submission into a payable earning. Must run inside a transaction with the row locked. */
export async function approveEarning(c: Db, s: any, views: number, verificationId: string | null): Promise<void> {
  const terms = s.rate_snapshot as RateTerms;
  const pay = computePay(terms, views);
  const gross = Math.min(pay.grossPaise, s.reserved_paise); // can never exceed what the budget reserved
  const today = istDate();
  const due = addWorkingDays(today, 3, await loadHolidays(c));
  await c.query(
    `INSERT INTO earnings (submission_id, influencer_id, verification_id, views_at_final, base_pay_paise, view_bonus_paise,
                           multiplier_bps, gross_paise, payout_due_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [s.id, s.influencer_id, verificationId, views, pay.basePaise, pay.viewBonusPaise, terms.multiplierBps, gross, due]);
  await c.query(`UPDATE submissions SET status='APPROVED', status_reason=NULL, approved_at=now() WHERE id=$1`, [s.id]);
  await settleSlot(c, s.campaign_id, s.reserved_paise, gross);
  await notify(c, s.influencer_id, 'submission_approved', { submissionId: s.id, grossPaise: gross, payoutDueDate: due });
}

/** End of the measurement window: final check, then the quality gate decides. */
export async function finalizeSubmission(id: string): Promise<string> {
  const { outcome, check, verificationId } = await checkSubmission(id, 'FINAL');
  if (outcome !== 'LIVE') return outcome;
  return withTx(async (c) => {
    const { rows: [s] } = await c.query(
      `SELECT s.*, COALESCE(s.gate_min_engagement_bps, k.min_engagement_bps) min_engagement_bps, COALESCE(s.gate_min_views, k.min_views) min_views, k.required_disclosure, k.posting_hashtags, k.posting_mentions
         FROM submissions s JOIN campaigns k ON k.id = s.campaign_id WHERE s.id=$1 FOR UPDATE OF s`, [id]);
    if (s.status !== 'MEASURING') return s.status as string;
    const { rows: history } = await c.query(
      `SELECT views FROM engagement_score_logs WHERE submission_id=$1 AND verification_id<>$2 ORDER BY logged_at`, [id, verificationId]);
    const gate = evaluateGate(check.metrics!, {
      minEngagementBps: s.min_engagement_bps, minViews: s.min_views, requireDisclosure: s.required_disclosure,
      requiredTags: [...(s.posting_hashtags ?? []), ...(s.posting_mentions ?? [])],
    }, check.caption ?? null, history);
    await c.query(`UPDATE engagement_score_logs SET engagement_bps=$2, gate_result=$3, gate_reasons=$4 WHERE verification_id=$1`,
      [verificationId, gate.engagementBps, gate.result, gate.reasons]);
    if (gate.result === 'FAIL') {
      await closeUnpaid(c, s, 'REJECTED', gate.reasons.join('; '), null);
      return 'REJECTED';
    }
    if (gate.result === 'REVIEW') {
      await c.query(`UPDATE submissions SET status='RESTRICTED', status_reason=$2 WHERE id=$1`, [id, gate.reasons.join('; ')]);
      await audit(c, null, 'SUBMISSION_RESTRICTED', 'submission', id, gate.reasons.join('; '));
      return 'RESTRICTED';
    }
    if (s.content_review !== 'APPROVED') {
      await c.query(`UPDATE submissions SET status_reason='Passed checks; waiting for store content review' WHERE id=$1`, [id]);
      return 'WAITING_CONTENT_REVIEW';
    }
    await approveEarning(c, s, check.metrics!.views, verificationId);
    return 'APPROVED';
  });
}

/** Store manager's review of the creative itself. */
export async function reviewContent(id: string, actor: { id: string; role: string; storeId?: string | null }, decision: 'APPROVED' | 'REJECTED', reason?: string): Promise<void> {
  let due = false;
  await withTx(async (c) => {
    const { rows: [s] } = await c.query(`SELECT * FROM submissions WHERE id=$1 FOR UPDATE`, [id]);
    if (!s) throw notFound('Submission');
    if (actor.role !== 'ADMIN') throw forbidden('Only an admin can review posts');
    if (!['PENDING_VERIFICATION', 'MEASURING', 'RESTRICTED'].includes(s.status)) throw conflict('NOT_REVIEWABLE', `Submission is ${s.status}`);
    if (decision === 'REJECTED' && !reason) throw new AppError(400, 'REASON_REQUIRED', 'Please give a reason');
    await c.query(`UPDATE submissions SET content_review=$2, reviewed_by=$3 WHERE id=$1`, [id, decision, actor.id]);
    await audit(c, actor.id, `CONTENT_${decision}`, 'submission', id, reason);
    if (decision === 'REJECTED') await closeUnpaid(c, s, 'REJECTED', reason!, actor.id);
    else due = s.status === 'MEASURING' && new Date(s.measure_due_at) <= new Date();
  });
  if (due) await finalizeSubmission(id);
}
