// Sends queued messages through the configured provider. Without configuration they remain queued.
import { audit, Db, decrypt, env, notify, pool } from '../core.js';

const site = () => process.env.PUBLIC_URL ?? process.env.URL ?? '';
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' }) : '');
const inr = (p?: number) => (p === undefined ? '' : `Rs ${(p / 100).toLocaleString('en-IN')}`);

type Msg = { subject: string; text: string };
const TEMPLATES: Record<string, (p: any) => Msg> = {
  bank_details_changed: () => ({ subject: 'Your bank details were changed', text: 'The bank details on your account were just changed. Payments are on hold until our team confirms them. If this was not you, reply to your store immediately and change your password.' }),
  password_changed: () => ({ subject: 'Your password was changed', text: 'Your password was just changed. If this was not you, contact your store immediately.' }),
  password_reset: (p) => ({ subject: 'Reset your Lotus Creator password', text: `We received a request to reset your password. This link works once and expires in 1 hour.\n\n${p.link}\n\nIf you did not request this, you can safely ignore this email.` }),
  creator_registered: () => ({ subject: 'Welcome to Lotus Creator Network', text: 'Your account has been created and your profile is under review. Please complete your profile, including your PAN, payout details and social account, so our team can review it. We will email you when your profile is approved.' }),
  creator_approved: () => ({ subject: 'Your Lotus Creator profile is approved', text: 'Good news! Your creator profile has been approved. Sign in to explore open campaigns, check the requirements and start creating with Lotus.' }),
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

function htmlMessage(name: string, subject: string, text: string, action?: { label: string; url: string }): string {
  const logo = 'https://www.lotuselectronics.com/assets/images/lotus-logo.png';
  return `<!doctype html><html><body style="margin:0;background:#f3f8f7;font-family:Arial,sans-serif;color:#173b39"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 12px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#fff;border:1px solid #dce9e6;border-radius:8px"><tr><td style="padding:28px"><img src="${logo}" width="150" alt="Lotus Electronics Supermarket" style="display:block;max-width:150px;height:auto"><p style="margin:24px 0 8px;color:#168b8e;font-size:12px;font-weight:bold;letter-spacing:1px">LOTUS CREATOR NETWORK</p><h1 style="margin:0 0 20px;font-size:23px;line-height:1.3">${esc(subject)}</h1><p style="font-size:15px;line-height:1.6">Hello ${esc(name)},</p><p style="font-size:15px;line-height:1.7;white-space:pre-line">${esc(text)}</p>${action ? `<p style="margin:24px 0"><a href="${esc(action.url)}" style="display:inline-block;background:#147f80;color:#fff;text-decoration:none;padding:12px 20px;border-radius:5px;font-weight:bold">${esc(action.label)}</a></p>` : ''}<p style="margin:28px 0 0;border-top:1px solid #e5eeec;padding-top:18px;font-size:12px;line-height:1.6;color:#6a8079">Lotus Electronics Supermarket · Creator Network<br>Please do not share password reset links.</p></td></tr></table></td></tr></table></body></html>`;
}

/** Tells every other active admin about a sensitive action, so no admin acts unseen. */
export async function alertAdmins(db: Db, actorId: string | null, what: string, detail?: string): Promise<void> {
  const { rows: [me] } = await db.query(`SELECT full_name FROM users WHERE id=$1`, [actorId]);
  const { rows } = await db.query(`SELECT id FROM users WHERE role='ADMIN' AND is_active AND id IS DISTINCT FROM $1`, [actorId]);
  for (const a of rows) await notify(db, a.id, 'admin_alert', { what, by: me?.full_name ?? 'System', detail });
}

export async function flushOutbox(limit = 25): Promise<number> {
  const provider = (process.env.EMAIL_PROVIDER || process.env.TICKET_EMAIL_PROVIDER || (process.env.BREVO_API_KEY ? 'brevo' : '')).toLowerCase();
  if (provider === 'mailgun' ? !process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN || !process.env.MAILGUN_FROM : provider !== 'brevo' || !process.env.BREVO_API_KEY) return 0;
  const { rows: queued } = await pool.query(
    `SELECT n.id, n.template, n.payload, n.created_at, u.email, u.full_name, u.is_active FROM notifications_outbox n JOIN users u ON u.id=n.user_id
      WHERE n.status='QUEUED' ORDER BY n.created_at LIMIT $1`, [limit]);
  let sent = 0;
  for (const m of queued) {
    const build = TEMPLATES[m.template];
    if (!build || !m.is_active) { await pool.query(`UPDATE notifications_outbox SET status='FAILED' WHERE id=$1`, [m.id]); continue; }
    try {
      if (m.template === 'password_reset' && Date.now() - new Date(m.created_at).getTime() >= 3600000) { await pool.query(`UPDATE notifications_outbox SET status='FAILED' WHERE id=$1`, [m.id]); continue; }
      const payload = m.template === 'password_reset' && m.payload?.linkEnc ? { ...m.payload, link: decrypt(m.payload.linkEnc) } : m.payload;
      const { subject, text } = build(payload);
      const footer = site() ? `\n\n${site()}` : '';
      const actionUrl = m.template === 'password_reset' ? payload?.link : (m.template === 'creator_registered' || m.template === 'creator_approved') && site() ? `${site().replace(/\/$/, '')}/login` : undefined;
      const action = typeof actionUrl === 'string' && /^https?:\/\//i.test(actionUrl) ? { label: m.template === 'password_reset' ? 'Reset password' : 'Open creator portal', url: actionUrl } : undefined;
      const html = htmlMessage(m.full_name, subject, text, action);
      let res: Response;
      if (provider === 'mailgun') {
        const region = (process.env.MAILGUN_REGION ?? 'us').toLowerCase();
        if (!['us', 'eu'].includes(region)) throw new Error('Unsupported Mailgun region');
        const seconds = Number(process.env.MAILGUN_TIMEOUT ?? 30);
        const timeout = Number.isFinite(seconds) ? Math.max(1, Math.min(seconds, 60)) : 30;
        const body = new URLSearchParams({ from: env('MAILGUN_FROM'), to: m.email, subject, text: text + footer, html, 'o:tracking': 'no' });
        res = await fetch(`https://${region === 'eu' ? 'api.eu.mailgun.net' : 'api.mailgun.net'}/v3/${encodeURIComponent(env('MAILGUN_DOMAIN'))}/messages`, { method: 'POST', headers: { Authorization: `Basic ${Buffer.from(`api:${env('MAILGUN_API_KEY')}`).toString('base64')}`, 'content-type': 'application/x-www-form-urlencoded' }, body, signal: AbortSignal.timeout(timeout * 1000) });
      } else res = await fetch('https://api.brevo.com/v3/smtp/email', {
        method: 'POST',
        headers: { 'api-key': env('BREVO_API_KEY'), 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          sender: { email: env('MAIL_FROM'), name: process.env.MAIL_FROM_NAME ?? 'Lotus Electronics Supermarket' },
          to: [{ email: m.email, name: m.full_name }], subject, textContent: text + footer,
          htmlContent: html,
        }),
      });
      if (!res.ok) throw new Error(`Email provider answered ${res.status}`);
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
