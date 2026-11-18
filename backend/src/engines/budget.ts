// Engine 1: campaign budget and quota tracking.
// Each change locks the campaign row first, so 100 creators submitting in the same
// second are handled one at a time and cannot overspend together.
import { AppError, audit, conflict, notFound, pool, withTx, type Db } from '../core.js';

/** Smallest amount any standard rate card could need on this campaign's category. */
async function cheapestReservation(c: Db, categoryId: string): Promise<number> {
  const r = await c.query(
    `SELECT COALESCE(MIN(ROUND((rc.base_pay_paise + rc.max_view_bonus_paise) * pc.multiplier_bps / 10000.0)), 0)::bigint AS m
       FROM rate_cards rc CROSS JOIN product_categories pc WHERE pc.id = $1`, [categoryId]);
  return r.rows[0].m as number;
}

/** Locks the campaign automatically when no further submission could fit. */
async function applyAutoLock(c: Db, id: string): Promise<void> {
  const { rows: [k] } = await c.query(`SELECT * FROM campaigns WHERE id=$1`, [id]);
  const quotaFull = k.active_submissions >= k.submission_quota;
  const budgetFull = k.budget_paise - k.reserved_paise < (await cheapestReservation(c, k.category_id));
  if (k.status === 'OPEN' && (quotaFull || budgetFull)) {
    const reason = quotaFull ? 'QUOTA' : 'BUDGET';
    await c.query(`UPDATE campaigns SET status='LOCKED', lock_reason=$2 WHERE id=$1`, [id, reason]);
    await audit(c, null, 'CAMPAIGN_AUTO_LOCKED', 'campaign', id, reason);
  } else if (k.status === 'LOCKED' && !quotaFull && !budgetFull && new Date(k.expires_at) > new Date()) {
    await c.query(`UPDATE campaigns SET status='OPEN', lock_reason=NULL WHERE id=$1`, [id]);
    await audit(c, null, 'CAMPAIGN_AUTO_REOPENED', 'campaign', id, 'Budget or quota became available again');
  }
}

/** Reserves a creator's maximum possible pay. Must run inside the caller's transaction. */
export async function reserveSlot(c: Db, campaignId: string, amountPaise: number): Promise<void> {
  const { rows: [k] } = await c.query(`SELECT * FROM campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
  if (!k) throw notFound('Campaign');
  const now = new Date();
  if (k.status !== 'OPEN') throw conflict('CAMPAIGN_NOT_OPEN', `This campaign is ${k.status.toLowerCase()}`);
  if (now < new Date(k.starts_at)) throw conflict('CAMPAIGN_NOT_STARTED', 'This campaign has not started yet');
  if (now >= new Date(k.expires_at)) throw conflict('CAMPAIGN_EXPIRED', 'This campaign has expired');
  if (k.reserved_paise + amountPaise > k.budget_paise) {
    throw conflict('BUDGET_EXHAUSTED', 'Not enough campaign budget left for this submission');
  }
  await c.query(
    `UPDATE campaigns SET reserved_paise = reserved_paise + $2, active_submissions = active_submissions + 1 WHERE id=$1`,
    [campaignId, amountPaise]);
  await applyAutoLock(c, campaignId);
}

/** Returns the money and quota place of a submission that earned nothing. */
export async function releaseSlot(c: Db, campaignId: string, amountPaise: number): Promise<void> {
  await c.query(`SELECT 1 FROM campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
  await c.query(
    `UPDATE campaigns SET reserved_paise = reserved_paise - $2, active_submissions = active_submissions - 1 WHERE id=$1`,
    [campaignId, amountPaise]);
  await applyAutoLock(c, campaignId);
}

/** On approval, shrinks the reservation from the maximum to the actual amount earned. */
export async function settleSlot(c: Db, campaignId: string, reservedPaise: number, actualPaise: number): Promise<void> {
  await c.query(`SELECT 1 FROM campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
  await c.query(`UPDATE campaigns SET reserved_paise = reserved_paise - $2 WHERE id=$1`, [campaignId, reservedPaise - actualPaise]);
  await applyAutoLock(c, campaignId);
}

const ALLOWED: Record<string, string[]> = {
  DRAFT: ['OPEN', 'CLOSED'], OPEN: ['PAUSED', 'CLOSED'], PAUSED: ['OPEN', 'CLOSED'], LOCKED: ['CLOSED'],
  CLOSED: [], EXPIRED: [],
};

export async function setCampaignStatus(campaignId: string, next: string, actorId: string, reason?: string): Promise<void> {
  await withTx(async (c) => {
    const { rows: [k] } = await c.query(`SELECT * FROM campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
    if (!k) throw notFound('Campaign');
    if (!ALLOWED[k.status]?.includes(next)) {
      throw new AppError(409, 'BAD_TRANSITION', `Cannot move a ${k.status} campaign to ${next}`);
    }
    if (next === 'OPEN' && new Date(k.expires_at) <= new Date()) throw conflict('CAMPAIGN_EXPIRED', 'Expiry date has passed');
    await c.query(`UPDATE campaigns SET status=$2, lock_reason=NULL WHERE id=$1`, [campaignId, next]);
    await audit(c, actorId, `CAMPAIGN_${next}`, 'campaign', campaignId, reason);
    if (next === 'OPEN') await applyAutoLock(c, campaignId);
  });
}

/** Admin top-up. A campaign locked for lack of budget reopens by itself if it now fits. */
export async function changeBudget(campaignId: string, budgetPaise: number, quota: number, actorId: string, reason: string): Promise<void> {
  await withTx(async (c) => {
    const { rows: [k] } = await c.query(`SELECT * FROM campaigns WHERE id=$1 FOR UPDATE`, [campaignId]);
    if (!k) throw notFound('Campaign');
    if (budgetPaise < k.reserved_paise || quota < k.active_submissions) {
      throw conflict('BELOW_COMMITTED', 'Budget and quota cannot go below what is already committed');
    }
    await c.query(`UPDATE campaigns SET budget_paise=$2, submission_quota=$3 WHERE id=$1`, [campaignId, budgetPaise, quota]);
    await audit(c, actorId, 'CAMPAIGN_BUDGET_CHANGED', 'campaign', campaignId, reason,
      { fromBudget: k.budget_paise, toBudget: budgetPaise, fromQuota: k.submission_quota, toQuota: quota });
    await applyAutoLock(c, campaignId);
  });
}

export async function expireCampaigns(): Promise<number> {
  const r = await pool.query(
    `UPDATE campaigns SET status='EXPIRED', lock_reason=NULL
      WHERE status IN ('OPEN','PAUSED','LOCKED','DRAFT') AND expires_at <= UTC_TIMESTAMP() RETURNING id`);
  return r.rowCount ?? 0;
}
