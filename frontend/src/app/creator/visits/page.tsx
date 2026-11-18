'use client';
import { useEffect, useState } from 'react';
import { api, useApi } from '@/lib/api';
import { Button, Fields, inputCls, Loaded, Notice, Section, Status, Table, useAct, useToast } from '@/components/ui';
import { CreatorPageHead } from '@/components/CreatorPageHead';

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
      <div className="mx-auto max-w-6xl">
      <CreatorPageHead eyebrow="Store coordination" title="Store visits" intro="Choose a store and time for your product demo. Your visit is confirmed once the store approves it." />
      <div className="mb-5 flex items-start gap-3 rounded-lg border border-[#cfe4ef] bg-[#edf7fc] px-4 py-3 text-sm leading-6 text-[#365b74]"><svg aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-[#318196]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5m0-8h.01"/></svg><p><strong>Before you book:</strong> Product demos take place in-store. Products cannot be taken away; booking ahead helps the team prepare your display.</p></div>
      <div className="grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <Section title="Request a visit" intro="Select a store, date and available time.">
        <div className="mb-4 max-w-md">
          <label htmlFor="visit-store" className="mb-2 block text-sm font-semibold">1. Select a store</label>
          <select id="visit-store" className={inputCls} value={storeId} onChange={(e) => setStoreId(e.target.value)}>
            <option value="">Choose…</option>
            {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.name}, {s.city}</option>)}
          </select>
        </div>
        {stores.error && <Notice tone="bad">{stores.error}</Notice>}
        {!storeId && <p className="rounded-md border border-dashed border-[#d5e2e9] bg-[#f8fbfc] px-4 py-4 text-sm text-muted">Select a store to see its available dates.</p>}
        {storeId && <Loaded state={slots}>
          {slots.data?.length === 0 && <p className="rounded-md border border-[#dce8ee] bg-[#f8fbfc] px-4 py-4 text-sm text-muted">This store has no open times right now. Try again later or choose another store.</p>}
          {!!slots.data?.length && <p className="mb-2 text-sm font-semibold">2. Choose a date</p>}
          <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Choose a day">
            {slots.data?.map((d) => (
              <button key={d.date} aria-pressed={day === d.date} onClick={() => { setDay(d.date); setSlot(null); }}
                className={`min-h-[42px] rounded-md border px-3 text-sm font-medium transition ${day === d.date ? 'border-[#147f80] bg-[#147f80] text-white' : 'border-line bg-white text-ink hover:border-[#147f80]'}`}>
                {ist(`${d.date}T12:00:00+05:30`, { weekday: 'short', day: 'numeric', month: 'short' })}
              </button>
            ))}
          </div>
          {current && <><p className="mb-2 text-sm font-semibold">3. Choose a time <span className="font-normal text-muted">(India time)</span></p><div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Choose a time">
            {current.slots.filter((s: any, i: number, all: any[]) => all.findIndex((item: any) => item.start === s.start) === i).map((s: any) => (
              <button key={s.start} aria-pressed={slot === s.start} onClick={() => setSlot(s.start)}
                className={`min-h-[40px] rounded-lg border px-3 text-sm font-medium ${slot === s.start ? 'border-[#168b8e] bg-[#e5f7f4] text-[#087c7d]' : 'border-line bg-white'}`}>
                {ist(s.start, { hour: 'numeric', minute: '2-digit' })}
              </button>
            ))}
          </div></>}
          {slot && <form className="max-w-md border-t border-[#e5ebf0] pt-4" onSubmit={async (e) => {
            e.preventDefault(); setErr(null);
            if (form.purpose.trim().length < 5) { setErr('Please describe what you plan to film in at least 5 characters.'); return; }
            if (form.purpose.trim().length > 500) { setErr('Please keep your visit description within 500 characters.'); return; }
            await run(async () => {
              try {
                await api('/influencer/visits', 'POST', { storeId, slotStart: slot, purpose: form.purpose.trim(), campaignId: form.campaignId || undefined });
              } catch (x) { setErr((x as Error).message); await slots.reload(); throw x; }
              toast('Request sent. The store will reply.');
              setSlot(null); setDay(null); setForm({ purpose: '', campaignId: '' });
              await Promise.all([mine.reload(), slots.reload()]);
            });
          }}>
            <p className="mb-4 text-sm font-semibold text-[#17365a]">4. Tell the store about your visit</p>
            {err && <Notice tone="bad">{err}</Notice>}
            <Fields values={form} set={(n, v) => setForm((f) => ({ ...f, [n]: v }))} fields={[
              ...(campaigns.length ? [{ name: 'campaignId', label: 'Campaign (optional)', type: 'select' as const, options: campaigns.map((c) => ({ value: c.id, label: c.title })) }] : []),
              { name: 'purpose', label: 'What will you film, and what should be ready?', type: 'textarea', required: true, hint: 'Describe your visit in 5–500 characters, for example: “Film a smartphone demo.”' },
            ]} />
            <Button className="mt-4" type="submit" kind="primary" busy={busy}>Request this time</Button>
          </form>}
        </Loaded>}
      </Section>
      <Section title="Your visits" intro="Track requests and store responses here.">
        <Loaded state={mine}>
          <Table rows={mine.data} rowKey={(r) => r.id} empty="No visits yet. Your requests will appear here after booking."
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
      </div>
      </div>
    </>
  );
}
