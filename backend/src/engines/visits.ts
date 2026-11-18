// Store visit booking: stores publish non-rush windows, creators request a slot, the store team decides.
import { AppError, audit, conflict, forbidden, notFound, notify, pool, withTx } from '../core.js';
import { flushOutbox } from './notifications.js';

export const MIN_NOTICE_HOURS = 24;
export const BOOK_AHEAD_DAYS = 21;
export const MAX_OPEN_REQUESTS = 3;
export interface Window { weekday: number; start_time: string; end_time: string; slot_minutes: number; capacity: number }
export interface Slot { start: string; end: string; capacity: number }
type Actor = { id: string; role: string; storeId?: string | null };

const toMin = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const istIso = (date: string, min: number) => new Date(`${date}T${hhmm(min)}:00+05:30`).toISOString();

/** All slots for one date in India time. Only whole slots that fit inside a window count. */
export function slotsForDate(windows: Window[], date: string): Slot[] {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  const out = new Map<string, Slot>();
  for (const w of windows.filter((x) => x.weekday === weekday)) {
    for (let m = toMin(w.start_time); m + w.slot_minutes <= toMin(w.end_time); m += w.slot_minutes) {
      const slot = { start: istIso(date, m), end: istIso(date, m + w.slot_minutes), capacity: w.capacity };
      const existing = out.get(slot.start);
      if (!existing) out.set(slot.start, slot);
      else out.set(slot.start, { start: slot.start, end: existing.end < slot.end ? existing.end : slot.end, capacity: Math.min(existing.capacity, slot.capacity) });
    }
  }
  return [...out.values()].sort((a, b) => a.start.localeCompare(b.start));
}

const istDateOf = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(d);

export async function availableSlots(storeId: string) {
  const { rows: windows } = await pool.query(`SELECT * FROM store_visit_windows WHERE store_id=$1`, [storeId]);
  const { rows: closed } = await pool.query(`SELECT to_char(closed_date,'YYYY-MM-DD') d FROM store_visit_closures WHERE store_id=$1`, [storeId]);
  const { rows: taken } = await pool.query(
    `SELECT slot_start, COUNT(*)::int n FROM store_visits WHERE store_id=$1 AND status IN ('REQUESTED','APPROVED') AND slot_start > now() GROUP BY slot_start`, [storeId]);
  const counts = new Map(taken.map((t) => [new Date(t.slot_start).toISOString(), t.n as number]));
  const closedDays = new Set(closed.map((c) => c.d as string));
  const earliest = Date.now() + MIN_NOTICE_HOURS * 3600000;
  const days: { date: string; slots: { start: string; end: string; left: number }[] }[] = [];
  for (let i = 0; i <= BOOK_AHEAD_DAYS; i++) {
    const date = istDateOf(new Date(Date.now() + i * 86400000));
    if (closedDays.has(date)) continue;
    const slots = slotsForDate(windows, date)
      .filter((s) => new Date(s.start).getTime() >= earliest)
      .map((s) => ({ start: s.start, end: s.end, left: s.capacity - (counts.get(s.start) ?? 0) }))
      .filter((s) => s.left > 0);
    if (slots.length) days.push({ date, slots });
  }
  return days;
}

export async function requestVisit(influencerId: string, i: { storeId: string; slotStart: string; purpose: string; campaignId?: string }): Promise<string> {
  const id = await withTx(async (c) => {
    const { rows: [p] } = await c.query(`SELECT vetting_status, is_blacklisted FROM influencer_profiles WHERE user_id=$1`, [influencerId]);
    if (!p || p.vetting_status !== 'APPROVED' || p.is_blacklisted) throw conflict('NOT_VETTED', 'You can book a visit once your profile is approved');
    // One booking at a time per store, so two people cannot take the last place together.
    const { rows: [store] } = await c.query(`SELECT id, is_active FROM stores WHERE id=$1 FOR UPDATE`, [i.storeId]);
    if (!store?.is_active) throw notFound('Store');
    if (i.campaignId) {
      const t = await c.query(`SELECT 1 FROM campaign_stores WHERE campaign_id=$1 AND store_id=$2`, [i.campaignId, i.storeId]);
      if (!t.rowCount) throw conflict('STORE_NOT_IN_CAMPAIGN', 'This store is not part of that campaign');
    }
    const start = new Date(i.slotStart);
    if (Number.isNaN(start.getTime())) throw new AppError(400, 'BAD_SLOT', 'Choose a time from the list');
    const date = istDateOf(start);
    const { rows: windows } = await c.query(`SELECT * FROM store_visit_windows WHERE store_id=$1`, [i.storeId]);
    const slot = slotsForDate(windows, date).find((s) => s.start === start.toISOString());
    if (!slot) throw conflict('BAD_SLOT', 'This store does not take visits at that time');
    const shut = await c.query(`SELECT 1 FROM store_visit_closures WHERE store_id=$1 AND closed_date=$2`, [i.storeId, date]);
    if (shut.rowCount) throw conflict('STORE_CLOSED', 'The store is not taking visits that day');
    if (start.getTime() < Date.now() + MIN_NOTICE_HOURS * 3600000) throw conflict('TOO_SOON', `Please book at least ${MIN_NOTICE_HOURS} hours ahead`);
    if (start.getTime() > Date.now() + (BOOK_AHEAD_DAYS + 1) * 86400000) throw conflict('TOO_FAR', `You can book up to ${BOOK_AHEAD_DAYS} days ahead`);
    const { rows: [mine] } = await c.query(`SELECT COUNT(*)::int n FROM store_visits WHERE influencer_id=$1 AND status='REQUESTED'`, [influencerId]);
    if (mine.n >= MAX_OPEN_REQUESTS) throw conflict('TOO_MANY', `You already have ${MAX_OPEN_REQUESTS} requests waiting. Wait for a reply or cancel one.`);
    const { rows: [used] } = await c.query(`SELECT COUNT(*)::int n FROM store_visits WHERE store_id=$1 AND slot_start=$2 AND status IN ('REQUESTED','APPROVED')`, [i.storeId, start]);
    if (used.n >= slot.capacity) throw conflict('SLOT_FULL', 'That time was just taken. Please choose another.');
    const { rows: [v] } = await c.query(
      `INSERT INTO store_visits (store_id, influencer_id, campaign_id, slot_start, slot_end, purpose) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [i.storeId, influencerId, i.campaignId ?? null, start, slot.end, i.purpose]);
    await audit(c, influencerId, 'VISIT_REQUESTED', 'visit', v.id);
    const { rows: [me] } = await c.query(`SELECT full_name FROM users WHERE id=$1`, [influencerId]);
    const { rows: team } = await c.query(`SELECT id FROM users WHERE role='STORE_MANAGER' AND store_id=$1 AND is_active`, [i.storeId]);
    for (const t of team) await notify(c, t.id, 'visit_requested', { creator: me.full_name, slotStart: start.toISOString() });
    return v.id as string;
  });
  await flushOutbox();
  return id;
}

export async function cancelVisit(influencerId: string, visitId: string): Promise<void> {
  await withTx(async (c) => {
    const { rows: [v] } = await c.query(`SELECT * FROM store_visits WHERE id=$1 AND influencer_id=$2 FOR UPDATE`, [visitId, influencerId]);
    if (!v) throw notFound('Visit');
    if (!['REQUESTED', 'APPROVED'].includes(v.status) || new Date(v.slot_start) < new Date()) throw conflict('BAD_STATE', 'This visit can no longer be cancelled');
    await c.query(`UPDATE store_visits SET status='CANCELLED' WHERE id=$1`, [visitId]);
    await audit(c, influencerId, 'VISIT_CANCELLED', 'visit', visitId);
    const { rows: [me] } = await c.query(`SELECT full_name FROM users WHERE id=$1`, [influencerId]);
    const { rows: team } = await c.query(`SELECT id FROM users WHERE role='STORE_MANAGER' AND store_id=$1 AND is_active`, [v.store_id]);
    for (const t of team) await notify(c, t.id, 'visit_cancelled', { creator: me.full_name, slotStart: v.slot_start });
  });
  await flushOutbox();
}

export async function decideVisit(a: Actor, visitId: string, i: { approve: boolean; note?: string }): Promise<void> {
  await withTx(async (c) => {
    const { rows: [v] } = await c.query(`SELECT v.*, s.name store FROM store_visits v JOIN stores s ON s.id=v.store_id WHERE v.id=$1 FOR UPDATE OF v`, [visitId]);
    if (!v) throw notFound('Visit');
    if (a.role !== 'ADMIN' && v.store_id !== a.storeId) throw forbidden('This visit belongs to another store');
    if (v.status !== 'REQUESTED') throw conflict('BAD_STATE', 'This request has already been answered');
    if (new Date(v.slot_start) < new Date()) throw conflict('PAST', 'This time has passed');
    if (!i.approve && !i.note?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Please tell the creator why');
    await c.query(`UPDATE store_visits SET status=$2, decision_note=$3, decided_by=$4, decided_at=now() WHERE id=$1`,
      [visitId, i.approve ? 'APPROVED' : 'DECLINED', i.note?.trim() || null, a.id]);
    await audit(c, a.id, i.approve ? 'VISIT_APPROVED' : 'VISIT_DECLINED', 'visit', visitId, i.note);
    await notify(c, v.influencer_id, i.approve ? 'visit_approved' : 'visit_declined', { store: v.store, slotStart: v.slot_start, note: i.note?.trim() });
  });
  await flushOutbox();
}

export async function recordOutcome(a: Actor, visitId: string, outcome: 'COMPLETED' | 'NO_SHOW'): Promise<void> {
  await withTx(async (c) => {
    const { rows: [v] } = await c.query(`SELECT * FROM store_visits WHERE id=$1 FOR UPDATE`, [visitId]);
    if (!v) throw notFound('Visit');
    if (a.role !== 'ADMIN' && v.store_id !== a.storeId) throw forbidden('This visit belongs to another store');
    if (v.status !== 'APPROVED') throw conflict('BAD_STATE', 'Only an approved visit can be marked');
    if (new Date(v.slot_start) > new Date()) throw conflict('NOT_YET', 'This visit has not started yet');
    await c.query(`UPDATE store_visits SET status=$2 WHERE id=$1`, [visitId, outcome]);
    await audit(c, a.id, `VISIT_${outcome}`, 'visit', visitId);
  });
}

export async function saveWindows(a: Actor, storeId: string, windows: Omit<Window, never>[]): Promise<void> {
  if (a.role !== 'ADMIN' && storeId !== a.storeId) throw forbidden();
  for (const w of windows) {
    if (w.start_time >= w.end_time) throw new AppError(400, 'BAD_TIME', 'Each window must end after it starts');
    if (toMin(w.end_time) - toMin(w.start_time) < w.slot_minutes) throw new AppError(400, 'BAD_TIME', 'A window must be long enough for one slot');
  }
  for (let d = 0; d < 7; d++) {
    const day = windows.filter((w) => w.weekday === d).sort((x, y) => x.start_time.localeCompare(y.start_time));
    for (let i = 1; i < day.length; i++) if (day[i]!.start_time < day[i - 1]!.end_time) throw new AppError(400, 'OVERLAP', 'Two windows overlap on the same day');
  }
  await withTx(async (c) => {
    await c.query(`SELECT id FROM stores WHERE id=$1 FOR UPDATE`, [storeId]);
    await c.query(`DELETE FROM store_visit_windows WHERE store_id=$1`, [storeId]);
    for (const w of windows) {
      await c.query(`INSERT INTO store_visit_windows (store_id, weekday, start_time, end_time, slot_minutes, capacity) VALUES ($1,$2,$3,$4,$5,$6)`,
        [storeId, w.weekday, w.start_time, w.end_time, w.slot_minutes, w.capacity]);
    }
    await audit(c, a.id, 'VISIT_WINDOWS_SAVED', 'store', storeId, null, { count: windows.length });
  });
}
