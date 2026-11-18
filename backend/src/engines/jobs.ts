// The nightly and hourly housekeeping. Each step keeps going if one record has a problem.
import { audit, encrypt, pool } from '../core.js';
import { refreshInstagramToken } from '../integrations/instagram.js';
import { expireCampaigns } from './budget.js';
import { flushOutbox } from './notifications.js';
import { generateBatch, releaseBatch } from './payouts.js';
import { checkSubmission, finalizeSubmission } from './verification.js';

async function each<T>(items: T[], fn: (x: T) => Promise<unknown>, errors: string[]) {
  for (const x of items) {
    try { await fn(x); } catch (e) { errors.push((e as Error).message); }
  }
}

/** Moves creators up or down using their last 5 finished posts (minimum 3). */
export async function reviewTiers(): Promise<number> {
  const { rows: tiers } = await pool.query(`SELECT * FROM tiers ORDER BY rank DESC`);
  const { rows: people } = await pool.query(
    `SELECT p.user_id, p.tier_id, AVG(x.views)::bigint avg_views, AVG(x.eng)::int avg_eng, COUNT(*)::int n
       FROM influencer_profiles p
       JOIN LATERAL (
         SELECT e.views_at_final views,
                (SELECT l.engagement_bps FROM engagement_score_logs l WHERE l.verification_id=e.verification_id) eng
           FROM earnings e WHERE e.influencer_id=p.user_id AND e.status<>'VOID' ORDER BY e.created_at DESC LIMIT 5
       ) x ON TRUE
      WHERE NOT p.tier_locked GROUP BY p.user_id, p.tier_id HAVING COUNT(*) >= 3`);
  let changed = 0;
  for (const p of people) {
    const fit = tiers.find((t) => p.avg_views >= t.min_avg_views && (p.avg_eng ?? 0) >= t.min_engagement_bps) ?? tiers[tiers.length - 1];
    if (fit.id !== p.tier_id) {
      await pool.query(`UPDATE influencer_profiles SET tier_id=$2 WHERE user_id=$1`, [p.user_id, fit.id]);
      await audit(pool, null, 'TIER_CHANGED', 'influencer', p.user_id, null, { from: p.tier_id, to: fit.id, avgViews: p.avg_views });
      changed++;
    }
  }
  return changed;
}

export async function runJobs() {
  const errors: string[] = [];
  const expired = await expireCampaigns();
  await pool.query(`UPDATE store_visits SET status='EXPIRED' WHERE status='REQUESTED' AND slot_start < now()`);
  await pool.query(`DELETE FROM password_resets WHERE expires_at < now() - INTERVAL '7 days'`);
  await pool.query(`DELETE FROM auth_attempts WHERE at < now() - INTERVAL '2 days'`);
  // 1. Retry first checks that have not succeeded yet
  const { rows: pending } = await pool.query(`SELECT id FROM submissions WHERE status='PENDING_VERIFICATION'`);
  await each(pending, (s) => checkSubmission(s.id, 'SCHEDULED'), errors);
  // 2. Daily check on posts still being measured, which catches deletions early
  const { rows: measuring } = await pool.query(
    `SELECT id FROM submissions WHERE status='MEASURING' AND measure_due_at > now()
       AND (last_live_check_at IS NULL OR last_live_check_at < now() - INTERVAL '20 hours')`);
  await each(measuring, (s) => checkSubmission(s.id, 'SCHEDULED'), errors);
  // 3. Finish posts whose measurement window has ended
  const { rows: due } = await pool.query(`SELECT id FROM submissions WHERE status='MEASURING' AND measure_due_at <= now()`);
  await each(due, (s) => finalizeSubmission(s.id), errors);
  // 4. Refresh Instagram connections expiring within 10 days
  const { rows: tokens } = await pool.query(
    `SELECT id, access_token_enc FROM social_accounts WHERE platform='INSTAGRAM' AND token_expires_at < now() + INTERVAL '10 days'`);
  await each(tokens, async (t) => {
    const r = await refreshInstagramToken(t.access_token_enc);
    await pool.query(`UPDATE social_accounts SET access_token_enc=$2, token_expires_at=now()+make_interval(secs => $3) WHERE id=$1`,
      [t.id, encrypt(r.token), r.expiresInSeconds]);
  }, errors);
  // 5. Paid ad rights that have run out
  await pool.query(`UPDATE ad_whitelisting_rights SET status='EXPIRED' WHERE status='ACCEPTED' AND ends_at < now()`);
  const tiersChanged = await reviewTiers();
  // 6. Payouts: finish any interrupted preparation, then draft today's sheet for approval.
  // Approved sheets wait for a person to press Prepare, so the live check stays close to payment.
  const { rows: stuck } = await pool.query(`SELECT id FROM payment_batches WHERE status='RELEASING'`);
  await each(stuck, (b) => releaseBatch(b.id, null, true), errors);
  // One sheet per day, however often this job runs
  const { rows: [{ batch_exists }] } = await pool.query(`SELECT EXISTS (SELECT 1 FROM payment_batches WHERE created_at >= UTC_TIMESTAMP() - INTERVAL 330 MINUTE + INTERVAL 330 MINUTE AND DATE(CONVERT_TZ(created_at,'+00:00','+05:30'))=DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+05:30'))) AS batch_exists`);
  const batch = batch_exists ? null : await generateBatch(null);
  const emails = await flushOutbox(200);
  return { emails, expired, firstChecks: pending.length, dailyChecks: measuring.length, finalized: due.length, tiersChanged, batch, errors };
}
