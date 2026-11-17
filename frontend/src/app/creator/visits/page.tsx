'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Button, Fields, inputCls, Loaded, Notice, PageHead, Section, Status, Table, useAct, useToast } from '@/components/ui';

const ist = (d: string, o: Intl.DateTimeFormatOptions) => new Date(d).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', ...o });
const when = (d: string) => ist(d, { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

export default function Visits() {
  const stores = useApi<any[]>('/public/stores');
  const me = useApi<any>('/influencer/me');
  const camps = useApi<any[]>('/influencer/campaigns');
  const mine = useApi<any[]>('/influencer/visits');
  const [storeId, setStoreId] = useState('');
  useEffect(() => { if (!storeId && me.data?.home_store_id) setStoreId(me.data.home_store_id); }, [me.data, storeId]);
  const slots = useApi<any[]>(storeId ? `/influencer/visits/slots?storeId=${storeId}` : null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, any>>({ purpose: '', campaignId: '' });
  const [err, setErr] = useState<string | null>(null);
  const { busy, run } = useAct();
  const toast = useToast();
  useEffect(() => { setDay(null); setSlot(null); }, [storeId]);
  const current = slots.data?.find((d) => d.date === day);
  const campaigns = (camps.data ?? []).filter((c) => c.stores?.some((s: any) => s.id === storeId));
  return (
    <>
      <PageHead title="Book a store visit" intro="Product demos happen at the store, and products cannot be taken away. Choose a time so the team can set up the display. Your visit is confirmed only after the store approves it." />
      <Section title="Choose a time">
        <div className="mb-4 max-w-md">
          <label htmlFor="visit-store" className="mb-1 block text-sm font-semibold">Store</label>
          <select id="visit-store" className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Choose…</option>
            {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}, {s.city}</option>)}
          </select>
        </div>
        {storeId && <Loaded state={slots}>
          {slots.data?.length === 0 && <p className="py-2 text-muted">This store has no open times right now. Try again later or choose another store.</p>}
          <div className="mb-3 flex flex-wrap gap-1.5" role="group" aria-label="Choose a day">
            {slots.data?.map((d) => (
              <button key={d.date} aria-pressed={day === d.date} onClick={() => { setDay(d.date); setSlot(null); }}
                className={`min-h-[40px] rounded-[3px] border px-3 text-sm font-medium ${day === d.date ? 'border-ink bg-ink text-white' : 'border-line bg-white'}`}>
                {ist(`${d.date}T12:00:00+05:30`, { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
          {current && <div className="mb-4 flex flex-wrap gap-1.5" role="group" aria-label="Choose a time">
            {current.slots.map((s: any) => (
              <button key={s.start} aria-pressed={slot === s.start} onClick={() => setSlot(s.start)}
                className={`min-h-[40px] rounded-[3px] border px-3 text-sm font-medium ${slot === s.start ? 'border-ink bg-tag' : 'border-line bg-white'}`}>
                {ist(s.start, { hour: 'numeric', minute: '2-digit' })}
              </button>
            ))}
          </div>}
          {slot && <form className="max-w-md" onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            await run(async () => {
              try {
                await api('/influencer/visits', 'POST', { storeId, slotStart: slot, purpose: form.purpose.trim(), campaignId: form.campaignId || undefined });
              } catch (x) { setErr((x as Error).message); await slots.reload(); throw x; }
              toast('Request sent. The store will reply.');
              setSlot(null); setDay(null); setForm({ purpose: '', campaignId: '' });
              await Promise.all([mine.reload(), slots.reload()]);
            });
          }}>
            {err && <Notice tone="bad">{err}</Notice>}
            <Fields values={form} set={(n, v) => setForm((f) => ({ ...f, [n]: v }))} fields={[
              ...(campaigns.length ? [{ name: 'campaignId', label: 'Campaign (optional)', type: 'select' as const, options: campaigns.map((c) => ({ value: c.id, label: c.title })) }] : []),
              { name: 'purpose', label: 'What will you film, and what should be ready?', type: 'textarea', required: true },
            ]} />
            <Button className="mt-4" type="submit" kind="primary" busy={busy}>Request this time</Button>
          </form>}
        </Loaded>}
      </Section>
      <Section title="Your visits">
        <Loaded state={mine}>
          <Table rows={mine.data} rowKey={(r) => r.id} empty="You have no visits yet."
            cols={[
              { head: 'When', cell: (r) => <span className="font-semibold">{when(r.slot_start)}</span> },
              { head: 'Store', cell: (r) => r.store },
              { head: 'Status', cell: (r) => <div><Status value={r.status} />{r.decision_note && <p className="mt-1 text-xs text-muted">{r.decision_note}</p>}</div> },
              { head: '', cell: (r) => ['REQUESTED', 'APPROVED'].includes(r.status) && new Date(r.slot_start) > new Date() && (
                <Button busy={busy} onClick={() => run(async () => { await api(`/influencer/visits/${r.id}/cancel`, 'POST'); await Promise.all([mine.reload(), slots.reload()]); }, 'Visit cancelled')}>Cancel</Button>
              ) },
            ]} />
        </Loaded>
      </Section>
    </>
  );
}
