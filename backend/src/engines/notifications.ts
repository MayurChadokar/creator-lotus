// Sends queued messages by email through Brevo. Without a key they wait in the outbox.
import { audit, Db, env, notify, pool } from '../core.js';

const site = () => process.env.PUBLIC_URL ?? process.env.URL ?? '';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
const inr = (p?: number) => (p === undefined ? '' : `Rs ${(p / 100).toLocaleString('en-IN')}`);

type Msg = { subject: string; text: string };
const TEMPLATES: Record<string, (p: any) => Msg> = {
  bank_details_changed: () => ({ subject: 'Your bank details were changed', text: 'The bank details on your account were just changed. Payments are on hold until our team confirms them. If this was not you, reply to your store immediately and change your password.' }),
  password_changed: () => ({ subject: 'Your password was changed', text: 'Your password was just changed. If this was not you, contact your store immediately.' }),
  password_reset: (p) => ({ subject: 'Reset your password', text: `Open this link to set a new password. It works once and expires in 1 hour:\n${p.link}\n\nIf you did not ask for this, ignore this email.` }),
  post_not_live: (p) => ({ subject: 'We could not find your post', text: `Your submitted post is not live, so it earns no payment. Reason: ${p.reason}` }),
  submission_rejected: (p) => ({ subject: 'Your post was not accepted', text: `Reason: ${p.reason}` }),
  submission_approved: (p) => ({ subject: 'Your post was approved', text: `You earned ${inr(p.grossPaise)} before tax. Payment is due by ${p.payoutDueDate}.` }),
  payout_paid: (p) => ({ subject: 'You have been paid', text: `${inr(p.netPaise)} was paid to your bank account.${p.utr ? ` Bank reference: ${p.utr}.` : ''}` }),
  payout_failed: (p) => ({ subject: 'Your payment did not go through', text: `Reason: ${p.reason}. Please check your bank details in your profile.` }),
  dispute_resolved: (p) => ({ subject: 'Your ticket was answered', text: `Your ticket was ${p.upheld ? 'upheld' : 'denied'}. See the reply under Help.` }),
  ad_rights_request: (p) => ({ subject: 'A store wants to run your post as an ad', text: `A store asked for ${p.durationDays}-day paid ad rights on your post. Reply in your portal.` }),
  visit_requested: (p) => ({ subject: 'New store visit request', text: `${p.creator} asked to visit on ${when(p.slotStart)}. Please approve or decline it.` }),
  visit_approved: (p) => ({ subject: 'Your store visit is approved', text: `Your visit to ${p.store} on ${when(p.slotStart)} is approved.${p.note ? ` Note from the store: ${p.note}` : ''}` }),
  visit_declined: (p) => ({ subject: 'Your store visit was declined', text: `Your visit to ${p.store} on ${when(p.slotStart)} was declined. Reason: ${p.note}. Please book another time.` }),
  visit_cancelled: (p) => ({ subject: 'A store visit was cancelled', text: `${p.creator} cancelled the visit on ${when(p.slotStart)}.` }),
  admin_alert: (p) => ({ subject: `Security alert: ${p.what}`, text: `${p.what}\nDone by: ${p.by}\n${p.detail ?? ''}\nCheck the audit log if you did not expect this.` }),
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Tells every other active admin about a sensitive action, so no admin acts unseen. */
export async function alertAdmins(db: Db, actorId: string | null, what: string, detail?: string): Promise<void> {
  const { rows: [me] } = await db.query(`SELECT full_name FROM users WHERE id=$1`, [actorId]);
  const { rows } = await db.query(`SELECT id FROM users WHERE role='ADMIN' AND is_active AND id IS DISTINCT FROM $1`, [actorId]);
  for (const a of rows) await notify(db, a.id, 'admin_alert', { what, by: me?.full_name ?? 'System', detail });
}

export async function flushOutbox(limit = 25): Promise<number> {
  if (!process.env.BREVO_API_KEY) return 0;
  const { rows: queued } = await pool.query(
    `SELECT n.id, n.template, n.payload, u.email, u.full_name, u.is_active FROM notifications_outbox n JOIN users u ON u.id=n.user_id
      WHERE n.status='QUEUED' ORDER BY n.created_at LIMIT $1`, [limit]);
  let sent = 0;
  for (const m of queued) {
    const build = TEMPLATES[m.template];
    if (!build || !m.is_active) { await pool.query(`UPDATE notifications_outbox SET status='FAILED' WHERE id=$1`, [m.id]); continue; }
    const { subject, text } = build(m.payload);
    const footer = site() ? `\n\n${site()}` : '';
    try {
      const res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: env('MAIL_FROM'), name: process.env.MAIL_FROM_NAME ?? 'Lotus Electronics Supermarket' },
          to: [{ email: m.email, name: m.full_name }], subject, textContent: text + footer,
          htmlContent: `<p>${esc(text + footer).replace(/\n/g, '<br>')}</p>`,
        }),
      });
      if (!res.ok) throw new Error(`Brevo answered ${res.status}`);
      await pool.query(`UPDATE notifications_outbox SET status='SENT', sent_at=now() WHERE id=$1`, [m.id]);
      sent++;
    } catch (e) {
      // Stays queued for the next run. Never fails the action that created the message.
      await audit(pool, null, 'EMAIL_SEND_FAILED', 'notification', m.id, (e as Error).message);
      break;
    }
  }
  return sent;
}
