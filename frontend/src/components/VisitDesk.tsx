'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Button, FormModal, Loaded, Section, Status, Table, useAct, useToast } from './ui';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const when = (d: string) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
type W = { weekday: number; start_time: string; end_time: string; slot_minutes: number; capacity: number };

export function VisitDesk({ base, storeId }: { base: string; storeId: string | null }) {
  const list = useApi<any[]>(`${base}/visits${storeId && base === '/admin' ? `?storeId=${storeId}` : ''}`);
  const [act, setAct] = useState<{ row: any; approve: boolean } | null>(null);
  const { busy, run } = useAct();
  const started = (r: any) => new Date(r.slot_start) <= new Date();
  return (
    <>
      <Section title="Visit requests">
        <Loaded state={list}>
          <Table rows={list.data} rowKey={(r) => r.id} empty="No visit requests yet. Creators can request times you open below."
            cols={[
              { head: 'When', cell: (r) => <span className="font-semibold">{when(r.slot_start)}</span> },
              { head: 'Creator', cell: (r) => <div className="text-left"><div className="font-medium">{r.creator}</div><div className="text-muted">{r.phone}</div></div> },
              { head: 'Needs', cell: (r) => <div className="max-w-sm text-left">{r.campaign && <div className="font-medium">{r.campaign}</div>}<p className="text-muted">{r.purpose}</p></div> },
              ...(base === '/admin' ? [{ head: 'Store', cell: (r: any) => r.store }] : []),
              { head: 'Status', cell: (r) => <div><Status value={r.status} />{r.decision_note && <p className="mt-1 text-xs text-muted">{r.decision_note}</p>}</div> },
              { head: '', cell: (r) => (
                <div className="flex flex-wrap justify-end gap-1.5">
                  {r.status === 'REQUESTED' && !started(r) && <>
                    <Button kind="primary" onClick={() => setAct({ row: r, approve: true })}>Approve</Button>
                    <Button kind="danger" onClick={() => setAct({ row: r, approve: false })}>Decline</Button>
                  </>}
                  {r.status === 'APPROVED' && started(r) && <>
                    <Button busy={busy} onClick={() => run(async () => { await api(`${base}/visits/${r.id}/outcome`, 'POST', { outcome: 'COMPLETED' }); await list.reload(); }, 'Visit marked as completed')}>Visited</Button>
                    <Button busy={busy} onClick={() => run(async () => { await api(`${base}/visits/${r.id}/outcome`, 'POST', { outcome: 'NO_SHOW' }); await list.reload(); }, 'Visit marked as no-show')}>No-show</Button>
                  </>}
                </div>
              ) },
            ]} />
        </Loaded>
      </Section>
      {storeId && <VisitTimes key={storeId} base={base} storeId={storeId} />}
      {act && <FormModal title={`${act.approve ? 'Approve' : 'Decline'} visit: ${act.row.creator}`} submit={act.approve ? 'Approve visit' : 'Decline visit'} danger={!act.approve} onClose={() => setAct(null)}
        intro={when(act.row.slot_start)}
        fields={[{ name: 'note', label: act.approve ? 'Note for the creator (optional)' : 'Why? The creator will see this', required: !act.approve, type: 'textarea' }]}
        onSubmit={async (v) => { await api(`${base}/visits/${act.row.id}/decide`, 'POST', { approve: act.approve, note: v.note || undefined }); await list.reload(); }} />}
    </>
  );
}

function VisitTimes({ base, storeId }: { base: string; storeId: string }) {
  const setup = useApi<any>(`${base}/stores/${storeId}/visit-setup`);
  const [rows, setRows] = useState<W[] | null>(null);
  const [closure, setClosure] = useState(false);
  const { busy, run } = useAct();
  const toast = useToast();
  useEffect(() => { if (setup.data && rows === null) setRows(setup.data.windows); }, [setup.data, rows]);
  const set = (i: number, k: keyof W, v: any) => setRows((r) => r!.map((x, j) => (j === i ? { ...x, [k]: v } : x)));
  const cell = 'min-h-[40px] border border-[#8795A6] bg-white px-2';
  return (
    <>
      <Section title="Times you take visits" intro="Leave out your rush hours. Creators can only request these times, at least 24 hours ahead." action={
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setRows((r) => [...(r ?? []), ...[1, 2, 3, 4, 5].map((weekday) => ({ weekday, start_time: '11:00', end_time: '13:00', slot_minutes: 60, capacity: 1 }))])}>Add weekday mornings</Button>
          <Button onClick={() => setRows((r) => [...(r ?? []), { weekday: 1, start_time: '11:00', end_time: '13:00', slot_minutes: 60, capacity: 1 }])}>Add a time</Button>
        </div>}>
        <Loaded state={setup}>
          {rows?.length === 0 && <p className="py-3 text-muted">No times yet, so creators cannot book this store. Add the hours that suit your team.</p>}
          <div className="space-y-2 py-2">
            {rows?.map((w, i) => (
              <div key={i} className="flex flex-wrap items-end gap-2 border-b border-line pb-2">
                <label className="text-sm">Day<select aria-label={`Day ${i + 1}`} className={`${cell} block`} value={w.weekday} onChange={(e) => set(i, 'weekday', Number(e.target.value))}>{DAYS.map((d, n) => <option key={d} value={n}>{d}</option>)}</select></label>
                <label className="text-sm">From<input aria-label={`From ${i + 1}`} type="time" className={`${cell} block`} value={w.start_time} onChange={(e) => set(i, 'start_time', e.target.value)} /></label>
                <label className="text-sm">To<input aria-label={`To ${i + 1}`} type="time" className={`${cell} block`} value={w.end_time} onChange={(e) => set(i, 'end_time', e.target.value)} /></label>
                <label className="text-sm">Each visit<select aria-label={`Length ${i + 1}`} className={`${cell} block`} value={w.slot_minutes} onChange={(e) => set(i, 'slot_minutes', Number(e.target.value))}><option value={30}>30 min</option><option value={60}>1 hour</option></select></label>
                <label className="text-sm">Creators at once<input aria-label={`Places ${i + 1}`} type="number" min={1} max={20} className={`${cell} block w-24`} value={w.capacity} onChange={(e) => set(i, 'capacity', Number(e.target.value))} /></label>
                <Button onClick={() => setRows((r) => r!.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button kind="primary" busy={busy} onClick={() => run(async () => { await api(`${base}/stores/${storeId}/visit-windows`, 'PUT', { windows: rows ?? [] }); toast('Visit times saved'); })}>Save times</Button>
            <Button onClick={() => setClosure(true)}>Close a date</Button>
          </div>
          {setup.data?.closures?.length > 0 && <p className="mt-3 text-sm text-muted">Closed: {setup.data.closures.map((c: any) => `${c.date} (${c.reason})`).join(', ')}</p>}
        </Loaded>
      </Section>
      {closure && <FormModal title="Close a date for visits" submit="Close date" onClose={() => setClosure(false)}
        intro="For sale days and busy festival dates. Visits already approved stay as they are."
        fields={[{ name: 'date', label: 'Date', type: 'date', required: true }, { name: 'reason', label: 'Reason', required: true, placeholder: 'Diwali sale' }]}
        onSubmit={async (v) => { await api(`${base}/stores/${storeId}/visit-closures`, 'POST', { date: v.date, reason: v.reason }); await setup.reload(); }} />}
    </>
  );
}
