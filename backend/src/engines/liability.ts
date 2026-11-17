// Engine 4: the dispute and override desk. Admins only.
import { AppError, audit, conflict, forbidden, notFound, notify, withTx } from '../core.js';
import { reserveSlot } from './budget.js';
import { approveEarning } from './verification.js';

export interface Actor { id: string; role: string; storeId?: string | null }
const assertAdmin = (a: Actor) => { if (a.role !== 'ADMIN') throw forbidden('Only an admin can do this'); };

export async function raiseDispute(influencerId: string, i: { submissionId?: string; subject: string; description: string }): Promise<string> {
  return withTx(async (c) => {
    let storeId: string | null = null;
    if (i.submissionId) {
      const { rows: [s] } = await c.query(`SELECT store_id, influencer_id FROM submissions WHERE id=$1`, [i.submissionId]);
      if (!s || s.influencer_id !== influencerId) throw notFound('Submission');
      storeId = s.store_id;
    }
    const { rows: [t] } = await c.query(
      `INSERT INTO dispute_tickets (influencer_id, submission_id, store_id, subject, description) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [influencerId, i.submissionId ?? null, storeId, i.subject, i.description]);
    await audit(c, influencerId, 'DISPUTE_RAISED', 'dispute', t.id);
    return t.id as string;
  });
}

/**
 * Closes a ticket, optionally force-approving its submission.
 *
 * What an admin can override:
 *   Post confirmed live, gate failed or flagged   -> yes
 *   Post cannot be checked (platform API failing) -> yes; audited waiver, admin enters the views
 *   Post confirmed missing or deleted             -> no. This is the zero-pay rule.
 */
export async function resolveDispute(a: Actor, ticketId: string, i: { uphold: boolean; forceApprove?: boolean; note: string; manualViews?: number }): Promise<void> {
  assertAdmin(a);
  if (!i.note?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'A resolution note is required');
  await withTx(async (c) => {
    const { rows: [t] } = await c.query(`SELECT * FROM dispute_tickets WHERE id=$1 FOR UPDATE`, [ticketId]);
    if (!t) throw notFound('Dispute');
    if (t.status !== 'OPEN') throw conflict('TICKET_CLOSED', 'This ticket is already resolved');
    if (i.forceApprove) {
      if (!i.uphold) throw new AppError(400, 'BAD_REQUEST', 'Force approval requires upholding the ticket');
      if (!t.submission_id) throw new AppError(400, 'NO_SUBMISSION', 'This ticket is not linked to a submission');
      await forceApprove(c, a, t.submission_id, i.note, i.manualViews);
    }
    await c.query(
      `UPDATE dispute_tickets SET status=$2, resolution_note=$3, resolved_by=$4, resolved_at=now() WHERE id=$1`,
      [ticketId, i.uphold ? 'RESOLVED_UPHELD' : 'RESOLVED_DENIED', i.note, a.id]);
    await audit(c, a.id, i.forceApprove ? 'DISPUTE_FORCE_APPROVED' : 'DISPUTE_RESOLVED', 'dispute', ticketId, i.note, { submissionId: t.submission_id });
    await notify(c, t.influencer_id, 'dispute_resolved', { ticketId, upheld: i.uphold });
  });
}

async function forceApprove(c: any, a: Actor, submissionId: string, reason: string, manualViews?: number) {
  const { rows: [s] } = await c.query(`SELECT * FROM submissions WHERE id=$1 FOR UPDATE`, [submissionId]);
  if (!s) throw notFound('Submission');
  if (s.status === 'NOT_LIVE') throw conflict('ZERO_PAY_RULE', 'The post is confirmed missing or deleted, so it cannot be paid');
  if (!['PENDING_VERIFICATION', 'MEASURING', 'RESTRICTED', 'REJECTED'].includes(s.status)) {
    throw conflict('NOT_OVERRIDABLE', `A ${s.status} submission cannot be overridden`);
  }
  const { rows: [last] } = await c.query(
    `SELECT id, outcome FROM social_link_verifications WHERE submission_id=$1 ORDER BY checked_at DESC LIMIT 1`, [submissionId]);
  let views: number;
  let verificationId: string | null = null;
  if (last?.outcome === 'LIVE') {
    const { rows: [m] } = await c.query(`SELECT views FROM engagement_score_logs WHERE verification_id=$1`, [last.id]);
    views = m.views;
    verificationId = last.id;
  } else if (last?.outcome === 'NOT_FOUND') {
    throw conflict('ZERO_PAY_RULE', 'The latest check found no live post, so it cannot be paid');
  } else if (last?.outcome === 'NOT_OWNER') {
    throw conflict('NOT_OWNER', "The post is not on this creator's account, so it cannot be paid");
  } else {
    if (manualViews === undefined || manualViews < 0) throw new AppError(400, 'VIEWS_REQUIRED', 'Enter the views you confirmed by hand');
    views = manualViews;
    await c.query(`UPDATE submissions SET live_check_waived=TRUE WHERE id=$1`, [submissionId]);
    await audit(c, a.id, 'LIVE_CHECK_WAIVED', 'submission', submissionId, reason, { manualViews });
  }
  if (s.status === 'REJECTED') await reserveSlotForOverride(c, s);
  await c.query(`UPDATE submissions SET content_review='APPROVED', reviewed_by=$2 WHERE id=$1`, [submissionId, a.id]);
  await approveEarning(c, s, views, verificationId);
  await audit(c, a.id, 'SUBMISSION_FORCE_APPROVED', 'submission', submissionId, reason, { views });
}

/** A rejected submission already gave back its budget, so the override must take it again. */
async function reserveSlotForOverride(c: any, s: any) {
  const { rows: [k] } = await c.query(`SELECT status FROM campaigns WHERE id=$1 FOR UPDATE`, [s.campaign_id]);
  const wasOpen = k.status === 'OPEN';
  if (!wasOpen) {
    const { rows: [fit] } = await c.query(
      `UPDATE campaigns SET reserved_paise=reserved_paise+$2, active_submissions=active_submissions+1
        WHERE id=$1 AND reserved_paise+$2<=budget_paise AND active_submissions<submission_quota RETURNING id`,
      [s.campaign_id, s.reserved_paise]);
    if (!fit) throw conflict('BUDGET_EXHAUSTED', 'Campaign has no budget or quota left. Increase it before overriding.');
  } else {
    await reserveSlot(c, s.campaign_id, s.reserved_paise);
  }
}

/** Direct override from the review panel, for example clearing a RESTRICTED post without a ticket. */
export async function overrideSubmission(a: Actor, submissionId: string, reason: string, manualViews?: number): Promise<void> {
  assertAdmin(a);
  if (!reason?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'A reason is required');
  await withTx(async (c) => {
    const { rows: [s] } = await c.query(`SELECT store_id FROM submissions WHERE id=$1`, [submissionId]);
    if (!s) throw notFound('Submission');
    await forceApprove(c, a, submissionId, reason, manualViews);
  });
}
