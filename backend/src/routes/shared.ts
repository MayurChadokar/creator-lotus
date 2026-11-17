// Post, dispute and ad-rights desks. Admins only.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { AppError, audit, conflict, forbidden, notFound, notify, pool } from '../core.js';
import { overrideSubmission, resolveDispute } from '../engines/liability.js';
import { reviewContent } from '../engines/verification.js';
import { decideVisit, recordOutcome, saveWindows } from '../engines/visits.js';

export const storeScope = (req: Request, column: string, startIndex: number): { sql: string; params: unknown[] } =>
  req.user.role === 'ADMIN' ? { sql: '', params: [] } : { sql: ` AND ${column} = $${startIndex}`, params: [req.user.storeId] };

export function sharedRoutes() {
  const r = Router();
  const actor = (req: Request) => req.user;

  r.get('/submissions', async (req, res) => {
    const q = z.object({ status: z.string().optional() }).parse(req.query);
    const scope = storeScope(req, 's.store_id', 2);
    const { rows } = await pool.query(
      `SELECT s.id, s.status, s.status_reason, s.content_review, s.platform, s.post_url, s.submitted_at, s.measure_due_at, s.store_id,
              u.full_name creator, k.title campaign, l.views, l.likes, l.comments, l.engagement_bps, l.gate_result, l.gate_reasons
         FROM submissions s JOIN users u ON u.id=s.influencer_id JOIN campaigns k ON k.id=s.campaign_id
         LEFT JOIN LATERAL (SELECT * FROM engagement_score_logs x WHERE x.submission_id=s.id ORDER BY x.logged_at DESC LIMIT 1) l ON TRUE
        WHERE ($1::text IS NULL OR s.status=$1)${scope.sql} ORDER BY s.submitted_at DESC LIMIT 500`, [q.status ?? null, ...scope.params]);
    res.json(rows);
  });
  r.post('/submissions/:id/content-review', async (req, res) => {
    const b = z.object({ decision: z.enum(['APPROVED', 'REJECTED']), reason: z.string().max(1000).optional() }).parse(req.body);
    await reviewContent(req.params.id!, actor(req), b.decision, b.reason);
    res.json({ ok: true });
  });
  r.post('/submissions/:id/force-approve', async (req, res) => {
    const b = z.object({ reason: z.string().min(5).max(1000), manualViews: z.number().int().min(0).optional() }).parse(req.body);
    await overrideSubmission(actor(req), req.params.id!, b.reason, b.manualViews);
    res.json({ ok: true });
  });

  r.get('/disputes', async (req, res) => {
    const scope = storeScope(req, 'd.store_id', 1);
    const { rows } = await pool.query(
      `SELECT d.*, u.full_name creator FROM dispute_tickets d JOIN users u ON u.id=d.influencer_id WHERE TRUE${scope.sql} ORDER BY d.status, d.created_at DESC LIMIT 500`, scope.params);
    res.json(rows);
  });
  r.post('/disputes/:id/resolve', async (req, res) => {
    const b = z.object({ uphold: z.boolean(), forceApprove: z.boolean().optional(), note: z.string().min(5).max(2000), manualViews: z.number().int().min(0).optional() }).parse(req.body);
    await resolveDispute(actor(req), req.params.id!, b);
    res.json({ ok: true });
  });

  r.post('/submissions/:id/ad-request', async (req, res) => {
    const b = z.object({ durationDays: z.union([z.literal(30), z.literal(90)]) }).parse(req.body);
    const { rows: [s] } = await pool.query(`SELECT * FROM submissions WHERE id=$1`, [req.params.id]);
    if (!s) throw notFound('Submission');
    if (req.user.role !== 'ADMIN' && s.store_id !== req.user.storeId) throw forbidden();
    if (!['APPROVED', 'IN_BATCH', 'PAID'].includes(s.status)) throw conflict('NOT_ELIGIBLE', 'Only approved posts can be requested for ads');
    const { rows: [a] } = await pool.query(
      `INSERT INTO ad_whitelisting_rights (submission_id, influencer_id, requested_by, duration_days) VALUES ($1,$2,$3,$4) RETURNING id`,
      [s.id, s.influencer_id, req.user.id, b.durationDays]);
    await audit(pool, req.user.id, 'AD_RIGHTS_REQUESTED', 'ad_right', a.id, null, { durationDays: b.durationDays });
    await notify(pool, s.influencer_id, 'ad_rights_request', { requestId: a.id, durationDays: b.durationDays });
    res.status(201).json(a);
  });

  // Creators near a store, within the 5 to 10 km geo-fence
  r.get('/stores/:id/nearby-creators', async (req, res) => {
    const q = z.object({ km: z.coerce.number().min(5).max(10).default(10) }).parse(req.query);
    if (req.user.role !== 'ADMIN' && req.params.id !== req.user.storeId) throw forbidden();
    const { rows } = await pool.query(
      `SELECT * FROM (
         SELECT p.user_id, u.full_name, t.name tier, p.city,
                6371 * 2 * ASIN(SQRT(POWER(SIN(RADIANS(p.latitude - st.latitude)/2),2)
                  + COS(RADIANS(st.latitude)) * COS(RADIANS(p.latitude)) * POWER(SIN(RADIANS(p.longitude - st.longitude)/2),2))) km
           FROM influencer_profiles p JOIN users u ON u.id=p.user_id JOIN tiers t ON t.id=p.tier_id CROSS JOIN stores st
          WHERE st.id=$1 AND p.latitude IS NOT NULL AND p.longitude IS NOT NULL
            AND p.vetting_status='APPROVED' AND NOT p.is_blacklisted
       ) x WHERE km <= $2 ORDER BY km`, [req.params.id, q.km]);
    res.json(rows);
  });
  return r;
}

/** The only thing a store login can do. Managers see just their own store here. */
export function visitRoutes() {
  const r = Router();
  const actor = (req: Request) => req.user;

  // ---- Store visits ----
  r.get('/visits', async (req, res) => {
    const q = z.object({ storeId: z.string().uuid().optional() }).parse(req.query);
    const scope = storeScope(req, 'v.store_id', 2);
    const { rows } = await pool.query(
      `SELECT v.id, v.slot_start, v.slot_end, v.purpose, v.status, v.decision_note, s.name store, u.full_name creator, u.phone, k.title campaign
         FROM store_visits v JOIN stores s ON s.id=v.store_id JOIN users u ON u.id=v.influencer_id LEFT JOIN campaigns k ON k.id=v.campaign_id
        WHERE ($1::uuid IS NULL OR v.store_id=$1)${scope.sql} AND v.slot_start > now() - INTERVAL '14 days'
        ORDER BY (v.status='REQUESTED') DESC, v.slot_start LIMIT 300`, [q.storeId ?? null, ...scope.params]);
    res.json(rows);
  });
  r.post('/visits/:id/decide', async (req, res) => {
    const b = z.object({ approve: z.boolean(), note: z.string().max(500).optional() }).parse(req.body);
    await decideVisit(actor(req), req.params.id!, b);
    res.json({ ok: true });
  });
  r.post('/visits/:id/outcome', async (req, res) => {
    const b = z.object({ outcome: z.enum(['COMPLETED', 'NO_SHOW']) }).parse(req.body);
    await recordOutcome(actor(req), req.params.id!, b.outcome);
    res.json({ ok: true });
  });
  const storeGuard = (req: Request) => { if (req.user.role !== 'ADMIN' && req.params.id !== req.user.storeId) throw forbidden(); };
  r.get('/stores/:id/visit-setup', async (req, res) => {
    storeGuard(req);
    const [w, c] = await Promise.all([
      pool.query(`SELECT weekday, start_time, end_time, slot_minutes, capacity FROM store_visit_windows WHERE store_id=$1 ORDER BY weekday, start_time`, [req.params.id]),
      pool.query(`SELECT to_char(closed_date,'YYYY-MM-DD') date, reason FROM store_visit_closures WHERE store_id=$1 AND closed_date >= CURRENT_DATE ORDER BY closed_date`, [req.params.id]),
    ]);
    res.json({ windows: w.rows, closures: c.rows });
  });
  r.put('/stores/:id/visit-windows', async (req, res) => {
    const t = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use a time like 11:00');
    const b = z.object({ windows: z.array(z.object({ weekday: z.number().int().min(0).max(6), start_time: t, end_time: t, slot_minutes: z.union([z.literal(30), z.literal(60)]), capacity: z.number().int().min(1).max(20) })).max(50) }).parse(req.body);
    await saveWindows(actor(req), req.params.id!, b.windows);
    res.json({ ok: true });
  });
  r.post('/stores/:id/visit-closures', async (req, res) => {
    storeGuard(req);
    const b = z.object({ date: z.string().date(), reason: z.string().min(2).max(200) }).parse(req.body);
    await pool.query(`INSERT INTO store_visit_closures VALUES ($1,$2,$3) ON CONFLICT (store_id, closed_date) DO UPDATE SET reason=$3`, [req.params.id, b.date, b.reason]);
    await audit(pool, req.user.id, 'VISIT_CLOSURE_ADDED', 'store', req.params.id!, b.reason, { date: b.date });
    res.status(201).json({ ok: true });
  });
  return r;
}
