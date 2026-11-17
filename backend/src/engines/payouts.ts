// Payment sheet desk: builds batches, computes TDS,
// re-checks every post right before paying, and produces the file for the company's bank.
import { addWorkingDays, AppError, audit, conflict, decrypt, istDate, loadHolidays, notFound, notify, pool, taxYear, withTx, type Db } from '../core.js';
import { computeNet, computeTds } from './pricing.js';
import { checkSubmission, voidBatchItem } from './verification.js';

export interface HeldEarning { earningId: string; influencerId: string; reason: string }

async function holdReason(c: Db, influencerId: string): Promise<string | null> {
  const { rows: [r] } = await c.query(
    `SELECT p.is_blacklisted, p.engagement_type,
            EXISTS (SELECT 1 FROM payout_accounts a WHERE a.influencer_id=p.user_id AND a.account_type='BANK') has_account,
            EXISTS (SELECT 1 FROM payout_accounts a WHERE a.influencer_id=p.user_id AND a.verified_at IS NOT NULL) bank_confirmed,
            EXISTS (SELECT 1 FROM tax_records t WHERE t.influencer_id=p.user_id AND t.pan_status IN ('VERIFIED','INOPERATIVE')) pan_confirmed
       FROM influencer_profiles p WHERE p.user_id=$1`, [influencerId]);
  if (r.is_blacklisted) return 'Creator is blacklisted';
  if (r.engagement_type === 'SALARIED') return 'Salaried employee: pay through payroll, where section 192 applies';
  if (!r.has_account) return 'No bank account on file';
  if (!r.pan_confirmed) return 'PAN is waiting for an admin to confirm it';
  if (!r.bank_confirmed) return 'Bank details are waiting for an admin to confirm them';
  return null;
}

const RULE_FOR: Record<string, string> = { PROFESSIONAL: 'PROF_194J', CONTRACT_INDIVIDUAL: 'CONTRACT_194C_IND', CONTRACT_OTHER: 'CONTRACT_194C_OTHER' };

export async function activeRule(c: Db, code: string, date: string) {
  const { rows: [rule] } = await c.query(`SELECT * FROM tds_rules WHERE code=$1 AND effective_from <= $2 ORDER BY effective_from DESC LIMIT 1`, [code, date]);
  if (!rule) throw new AppError(500, 'NO_TDS_RULE', `No TDS rule is set up for ${code}`);
  return rule;
}
export const ruleTerms = (rule: any) => ({ rateBps: rule.rate_bps, noPanRateBps: rule.no_pan_rate_bps, annualThresholdPaise: rule.annual_threshold_paise, singleThresholdPaise: rule.single_threshold_paise });

/** Creates a tax entry, any recovery of tax on benefits, and the payment line for one earning. */
async function addItem(c: Db, batchId: string, e: any, today: string): Promise<void> {
  const { rows: [p] } = await c.query(`SELECT engagement_type FROM influencer_profiles WHERE user_id=$1`, [e.influencer_id]);
  const code = RULE_FOR[p.engagement_type]!;
  const rule = await activeRule(c, code, today);
  const year = taxYear(today);
  await c.query(`SELECT 1 FROM tax_records WHERE influencer_id=$1 FOR UPDATE`, [e.influencer_id]);
  // Thresholds run separately for each section, and a tax return not being filed changes nothing here.
  const { rows: [prior] } = await c.query(
    `SELECT COALESCE(SUM(gross_paise),0)::bigint g, COALESCE(SUM(tds_paise),0)::bigint t
       FROM tds_ledger WHERE influencer_id=$1 AND tax_year=$2 AND rule_code=$3 AND NOT is_void`, [e.influencer_id, year, code]);
  const { rows: [tax] } = await c.query(`SELECT pan_status, pan_encrypted FROM tax_records WHERE influencer_id=$1`, [e.influencer_id]);
  const panOperative = !!tax && tax.pan_status !== 'INOPERATIVE';
  const { tdsPaise, rateBps } = computeTds({
    grossPaise: e.gross_paise, priorGrossThisYearPaise: prior.g, priorTdsThisYearPaise: prior.t, panOperative, rule: ruleTerms(rule),
  });
  const { rows: benefits } = await c.query(
    `SELECT id, tds_paise - recovered_paise AS open FROM benefit_records
      WHERE influencer_id=$1 AND status='OPEN' ORDER BY created_at FOR UPDATE`, [e.influencer_id]);
  const { benefitTdsPaise, netPaise } = computeNet(e.gross_paise, tdsPaise, benefits.reduce((n, l) => n + l.open, 0));
  const { rows: [item] } = await c.query(
    `INSERT INTO payment_batch_items (batch_id, earning_id, influencer_id, gross_paise, tds_paise, benefit_tds_paise, net_paise)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [batchId, e.id, e.influencer_id, e.gross_paise, tdsPaise, benefitTdsPaise, netPaise]);
  await c.query(
    `INSERT INTO tds_ledger (influencer_id, batch_item_id, tds_rule_id, rule_code, tax_year, gross_paise, tds_paise, rate_bps, pan_applied, pan_encrypted)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [e.influencer_id, item.id, rule.id, code, year, e.gross_paise, tdsPaise, rateBps, panOperative, tax?.pan_encrypted ?? null]);
  let left = benefitTdsPaise;
  for (const l of benefits) {
    if (left <= 0) break;
    const take = Math.min(left, l.open);
    await c.query(`INSERT INTO benefit_recoveries (benefit_id, batch_item_id, amount_paise) VALUES ($1,$2,$3)`, [l.id, item.id, take]);
    await c.query(
      `UPDATE benefit_records SET recovered_paise=recovered_paise+$2,
              status=CASE WHEN recovered_paise+$2>=tds_paise THEN 'SETTLED' ELSE status END WHERE id=$1`, [l.id, take]);
    left -= take;
  }
  await c.query(`UPDATE earnings SET status='IN_BATCH' WHERE id=$1`, [e.id]);
  await c.query(`UPDATE submissions SET status='IN_BATCH' WHERE id=$1`, [e.submission_id]);
}

/** Collects all payable earnings into a sheet. Locked creators stay out and are reported. */
export async function generateBatch(actorId: string | null): Promise<{ batchId: string | null; items: number; held: HeldEarning[] }> {
  return withTx(async (c) => {
    const today = istDate();
    const { rows: earnings } = await c.query(
      `SELECT e.* FROM earnings e WHERE e.status='PAYABLE' ORDER BY e.created_at FOR UPDATE SKIP LOCKED`);
    const held: HeldEarning[] = [];
    const payable: any[] = [];
    for (const e of earnings) {
      const reason = await holdReason(c, e.influencer_id);
      if (reason) held.push({ earningId: e.id, influencerId: e.influencer_id, reason });
      else payable.push(e);
    }
    if (!payable.length) return { batchId: null, items: 0, held };
    const holidays = await loadHolidays(c);
    const dayBefore = new Date(`${today}T00:00:00Z`);
    dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
    const scheduled = addWorkingDays(dayBefore.toISOString().slice(0, 10), 1, holidays);
    const ref = `PAY-${today.replaceAll('-', '')}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const { rows: [b] } = await c.query(
      `INSERT INTO payment_batches (reference, generated_by, scheduled_for) VALUES ($1,$2,$3) RETURNING id`, [ref, actorId, scheduled]);
    for (const e of payable) await addItem(c, b.id, e, today);
    await audit(c, actorId, 'BATCH_GENERATED', 'payment_batch', b.id, null, { items: payable.length, held: held.length });
    return { batchId: b.id as string, items: payable.length, held };
  });
}

/** Any admin can approve a sheet, including the one who created it. */
export async function approveBatch(batchId: string, actorId: string): Promise<void> {
  await withTx(async (c) => {
    const { rows: [b] } = await c.query(`SELECT * FROM payment_batches WHERE id=$1 FOR UPDATE`, [batchId]);
    if (!b) throw notFound('Batch');
    if (b.status !== 'DRAFT') throw conflict('BAD_STATE', `Batch is ${b.status}`);
    await c.query(`UPDATE payment_batches SET status='APPROVED', approved_by=$2, approved_at=now() WHERE id=$1`, [batchId, actorId]);
    await audit(c, actorId, 'BATCH_APPROVED', 'payment_batch', batchId);
  });
}

/** Puts an earning back in the queue for the next sheet, undoing tax and benefit recoveries. */
async function returnToQueue(c: Db, itemId: string, reason: string): Promise<void> {
  const { rows: [i] } = await c.query(`SELECT earning_id FROM payment_batch_items WHERE id=$1`, [itemId]);
  await voidBatchItem(c, itemId, reason);
  const { rows: [e] } = await c.query(`UPDATE earnings SET status='PAYABLE' WHERE id=$1 RETURNING submission_id`, [i.earning_id]);
  await c.query(`UPDATE submissions SET status='APPROVED' WHERE id=$1`, [e.submission_id]);
}

async function markPaid(c: Db, itemId: string, utr: string | null, actorId: string | null): Promise<void> {
  const { rows: [i] } = await c.query(
    `UPDATE payment_batch_items SET status='PAID', utr=COALESCE($2,utr), paid_at=now(), paid_recorded_by=$3 WHERE id=$1 AND status<>'PAID' RETURNING earning_id, influencer_id, net_paise`, [itemId, utr, actorId]);
  if (!i) return;
  const { rows: [e] } = await c.query(`UPDATE earnings SET status='PAID' WHERE id=$1 RETURNING submission_id`, [i.earning_id]);
  await c.query(`UPDATE submissions SET status='PAID' WHERE id=$1`, [e.submission_id]);
  await notify(c, i.influencer_id, 'payout_paid', { netPaise: i.net_paise, utr });
}

/**
 * Prepares an approved sheet for payment from the company bank account.
 * Every post gets a fresh live check. Lines that pass become PROCESSING: ready to pay.
 * resume=true finishes a run that was interrupted.
 */
export async function releaseBatch(batchId: string, actorId: string | null, resume = false) {
  const from = resume ? ['APPROVED', 'RELEASING'] : ['APPROVED'];
  const claimed = await pool.query(`UPDATE payment_batches SET status='RELEASING', prepared_by=COALESCE($3,prepared_by) WHERE id=$1 AND status = ANY($2) RETURNING id`, [batchId, from, actorId]);
  if (!claimed.rowCount) throw conflict('BAD_STATE', 'Only an approved batch can be prepared');
  await audit(pool, actorId, 'BATCH_PREPARE_STARTED', 'payment_batch', batchId);
  const { rows: items } = await pool.query(
    `SELECT i.*, e.submission_id, s.live_check_waived
       FROM payment_batch_items i JOIN earnings e ON e.id=i.earning_id JOIN submissions s ON s.id=e.submission_id
      WHERE i.batch_id=$1 AND i.status='PENDING'`, [batchId]);
  const result = { ready: 0, settled: 0, voided: 0, requeued: 0 };
  for (const it of items) {
    // Zero-pay rule: a fresh live check immediately before payment.
    if (!it.live_check_waived) {
      const { outcome, check } = await checkSubmission(it.submission_id, 'PRE_PAYOUT');
      if (outcome === 'NOT_FOUND' || outcome === 'NOT_OWNER') { result.voided++; continue; } // already voided by the check
      if (outcome === 'API_ERROR') {
        await withTx((c) => returnToQueue(c, it.id, `Live check unavailable: ${check.detail}`));
        result.requeued++;
        continue;
      }
    }
    const lock = await withTx(async (c) => {
      const { rows: [still] } = await c.query(`SELECT status FROM payment_batch_items WHERE id=$1 FOR UPDATE`, [it.id]);
      if (still.status !== 'PENDING') return 'Already handled';
      const reason = await holdReason(c, it.influencer_id);
      if (reason) { await returnToQueue(c, it.id, reason); return reason; }
      await c.query(`UPDATE payment_batch_items SET status='PROCESSING' WHERE id=$1 AND status='PENDING'`, [it.id]);
      if (it.net_paise === 0) await markPaid(c, it.id, null, actorId); // fully offset by tax owed on a benefit
      return null;
    });
    if (lock) { result.requeued++; continue; }
    if (it.net_paise === 0) result.settled++; else result.ready++;
  }
  await pool.query(`UPDATE payment_batches SET status='RELEASED', released_at=now() WHERE id=$1`, [batchId]);
  await audit(pool, actorId, 'BATCH_PREPARED', 'payment_batch', batchId, null, result);
  return result;
}

/**
 * The payments the bank should make, with full account details.
 * The file may be opened days after preparing, so any check older than 24 hours is repeated.
 * Posts now deleted drop out; posts that cannot be checked are left out and reported.
 */
export async function bankPaymentLines(batchId: string, actorId: string, reExportReason?: string) {
  const stale = await pool.query(
    `SELECT i.id, e.submission_id FROM payment_batch_items i JOIN earnings e ON e.id=i.earning_id JOIN submissions s ON s.id=e.submission_id
      WHERE i.batch_id=$1 AND i.status='PROCESSING' AND NOT s.live_check_waived
        AND (s.last_live_check_at IS NULL OR s.last_live_check_at < now() - INTERVAL '24 hours')`, [batchId]);
  const unverified = new Set<string>();
  for (const r of stale.rows) {
    const { outcome } = await checkSubmission(r.submission_id, 'PRE_PAYOUT');
    if (outcome !== 'LIVE') unverified.add(r.id);
  }
  const { rows } = await pool.query(
    `SELECT i.id, i.net_paise, a.verified_at, b.reference, a.account_holder, a.account_number_enc, a.ifsc, u.email, u.phone
       FROM payment_batch_items i JOIN payment_batches b ON b.id=i.batch_id
       JOIN payout_accounts a ON a.influencer_id=i.influencer_id JOIN users u ON u.id=i.influencer_id
      WHERE i.batch_id=$1 AND i.status='PROCESSING' AND i.net_paise > 0 AND ($2::boolean OR i.exported_at IS NULL) ORDER BY a.account_holder`, [batchId, !!reExportReason]);
  const included = rows.filter((r) => !unverified.has(r.id) && r.verified_at);
  // A line goes on one file only, unless someone gives a reason, so a repeat upload cannot pay twice by accident.
  await pool.query(`UPDATE payment_batch_items SET exported_at=now() WHERE id = ANY($1::uuid[])`, [included.map((r) => r.id)]);
  await audit(pool, actorId, reExportReason ? 'BANK_FILE_RE_EXPORTED' : 'BANK_FILE_DOWNLOADED', 'payment_batch', batchId, reExportReason, { lines: included.length });
  return {
    skipped: rows.filter((r) => unverified.has(r.id) || !r.verified_at).length,
    // Details changed after preparing are left out until confirmed: the classic fraud route.
    lines: included.map((r) => ({
      name: r.account_holder as string, accountNumber: decrypt(r.account_number_enc), ifsc: r.ifsc as string, rupees: r.net_paise / 100,
      reference: `${r.reference}-${String(r.id).slice(0, 8)}`, email: r.email as string, phone: (r.phone ?? '') as string,
    })),
  };
}

/** Admin records that the bank paid this line, with the bank's reference number. */
export async function recordBankPaid(itemId: string, utr: string, actorId: string): Promise<void> {
  await withTx(async (c) => {
    const { rows: [i] } = await c.query(`SELECT status FROM payment_batch_items WHERE id=$1 FOR UPDATE`, [itemId]);
    if (!i) throw notFound('Payment');
    if (i.status !== 'PROCESSING') throw conflict('BAD_STATE', 'Only a payment that is ready to pay can be marked paid');
    await markPaid(c, itemId, utr, actorId);
    await audit(c, actorId, 'BANK_PAYMENT_RECORDED', 'batch_item', itemId, null, { utr });
  });
}

/** The bank refused or returned a payment: tax and recoveries are undone and it joins the next sheet. */
export async function recordBankFailed(itemId: string, reason: string, actorId: string): Promise<void> {
  await withTx(async (c) => {
    const { rows: [i] } = await c.query(`SELECT status, influencer_id FROM payment_batch_items WHERE id=$1 FOR UPDATE`, [itemId]);
    if (!i) throw notFound('Payment');
    if (!['PROCESSING', 'PAID'].includes(i.status)) throw conflict('BAD_STATE', 'This payment cannot be marked failed');
    await returnToQueue(c, itemId, reason);
    await c.query(`UPDATE payment_batch_items SET status='FAILED' WHERE id=$1`, [itemId]);
    await audit(c, actorId, 'BANK_PAYMENT_FAILED', 'batch_item', itemId, reason);
    await notify(c, i.influencer_id, 'payout_failed', { reason });
  });
}

export const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // stops spreadsheet formula injection
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
const rupees = (p: number) => (p / 100).toFixed(2);

export async function batchCsv(batchId: string): Promise<string> {
  const { rows } = await pool.query(
    `SELECT b.reference, u.full_name, t.legal_name, t.pan_last4, k.title campaign, st.name store, s.post_url,
            e.views_at_final, e.payout_due_date::text, i.gross_paise, i.tds_paise, i.benefit_tds_paise, i.net_paise,
            i.status, i.utr, i.status_reason
       FROM payment_batch_items i JOIN payment_batches b ON b.id=i.batch_id
       JOIN earnings e ON e.id=i.earning_id JOIN submissions s ON s.id=e.submission_id
       JOIN campaigns k ON k.id=s.campaign_id JOIN stores st ON st.id=s.store_id
       JOIN users u ON u.id=i.influencer_id LEFT JOIN tax_records t ON t.influencer_id=i.influencer_id
      WHERE i.batch_id=$1 ORDER BY u.full_name`, [batchId]);
  const head = ['Batch','Creator','Legal name','PAN (last 4)','Campaign','Store','Post URL','Final views','Due date','Gross (Rs)','TDS (Rs)','TDS on benefits (Rs)','Net (Rs)','Status','UTR','Note'];
  const lines = rows.map((r) => [r.reference, r.full_name, r.legal_name, r.pan_last4, r.campaign, r.store, r.post_url, r.views_at_final,
    r.payout_due_date, rupees(r.gross_paise), rupees(r.tds_paise), rupees(r.benefit_tds_paise), rupees(r.net_paise), r.status, r.utr, r.status_reason].map(csvCell).join(','));
  return [head.join(','), ...lines].join('\n') + '\n';
}
