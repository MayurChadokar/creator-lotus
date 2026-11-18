'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, count, date, percent, rupees, useApi } from '@/lib/api';
import { Button, Loaded, Notice, Status, useAct } from '@/components/ui';

export default function Earnings() {
  const me = useApi<any>('/influencer/me');
  const subs = useApi<any[]>('/influencer/submissions');
  const tax = useApi<any[]>('/influencer/tax-summary');
  const ads = useApi<any[]>('/influencer/ad-requests');
  const { busy, run } = useAct();
  const s = subs.data ?? [];
  const paid = s.filter((x) => x.payout_status === 'PAID').reduce((n, x) => n + x.net_paise, 0);
  const coming = s.filter((x) => ['APPROVED', 'IN_BATCH'].includes(x.status)).reduce((n, x) => n + (x.net_paise ?? x.gross_paise ?? 0), 0);
  const inProgress = s.filter((x) => ['PENDING_VERIFICATION', 'MEASURING', 'RESTRICTED'].includes(x.status)).length;
  const missing = me.data && (!me.data.pan_last4 || !me.data.payout_account || !me.data.social || !me.data.terms_accepted || me.data.vetting_status !== 'APPROVED');
  return (
    <>
      <div className="mx-auto max-w-6xl">
      <section className="relative mb-6 overflow-hidden rounded-3xl border border-[#d6e7f3] bg-[#e8f2fa] px-6 py-7 text-[#17365a] shadow-sm sm:px-8 sm:py-9">
        <div aria-hidden="true" className="absolute -right-12 -top-24 h-64 w-64 rounded-full border-[38px] border-[#cfe3f1]/70" />
        <div aria-hidden="true" className="absolute -bottom-28 right-48 h-52 w-52 rounded-full bg-[#d8ebf3]/70" />
        <div className="relative flex flex-wrap items-end justify-between gap-5">
          <div><p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-[#267f89]">Lotus Creator Network</p>
            <h1 className="text-3xl font-semibold tracking-tight text-[#17365a] sm:text-4xl">{me.data ? `Hello, ${me.data.full_name.split(' ')[0]}!` : 'Your creator dashboard'}</h1>
            <p className="mt-2 max-w-xl text-sm leading-6 text-[#49657b]">Your creativity is making an impact. Here's a look at your posts and earnings.</p>
            {me.data && <TierBadge tier={me.data.tier} />}
          </div>
          <Link href="/creator/campaigns" className="inline-flex min-h-11 items-center justify-center rounded-xl bg-[#178d8f] px-5 text-sm font-semibold text-white shadow-sm transition hover:bg-[#11787a]">Explore campaigns <span aria-hidden="true" className="ml-2">→</span></Link>
        </div>
      </section>
      {missing && <Notice>Finish your profile to start submitting. <Link className="font-semibold underline" href="/creator/profile">Open profile</Link></Notice>}
      <Loaded state={subs}>
        <div className="mb-7 grid grid-cols-2 gap-3 xl:grid-cols-4">
          <Metric label="On its way to you" value={rupees(coming)} icon="pending" accent />
          <Metric label="Paid to you" value={rupees(paid, false)} icon="paid" />
          <Metric label="Posts being checked" value={count(inProgress)} icon="review" />
          <Metric label={`Tax deducted, ${tax.data?.[0]?.tax_year ?? 'this year'}`} value={rupees(tax.data?.[0]?.tds_paise ?? 0, false)} icon="tax" />
        </div>
        {ads.data?.filter((a) => a.status === 'REQUESTED').map((a) => (
          <Notice key={a.id}>
            <p>A store wants to run <a className="underline" href={a.post_url} target="_blank" rel="noreferrer">your post</a> as a paid ad for {a.duration_days} days.</p>
            <div className="mt-2 flex gap-2">
              <Button kind="primary" busy={busy} onClick={() => run(async () => { await api(`/influencer/ad-requests/${a.id}/respond`, 'POST', { accept: true }); await ads.reload(); }, 'Ad rights accepted')}>Accept</Button>
              <Button busy={busy} onClick={() => run(async () => { await api(`/influencer/ad-requests/${a.id}/respond`, 'POST', { accept: false }); await ads.reload(); }, 'Ad rights declined')}>Decline</Button>
            </div>
          </Notice>
        ))}
        <section className="rounded-2xl border border-[#dfe9e8] bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-bold uppercase tracking-[0.15em] text-[#138d8e]">Your activity</p><h2 className="mt-1 text-xl font-bold text-ink">Your posts</h2><p className="mt-1 text-sm text-muted">Track your content, reviews and payments in one place.</p></div><span className="rounded-full bg-[#eff8f7] px-3 py-1.5 text-xs font-bold text-[#177e7c]">{s.length} {s.length === 1 ? 'post' : 'posts'}</span></div>
          {s.length === 0 && <div className="rounded-xl border border-dashed border-[#bedbd7] bg-[#f7fbfa] px-5 py-8 text-center"><p className="font-semibold">Your creator journey starts here</p><p className="mt-1 text-sm text-muted">Choose a campaign and share your first post.</p><Link className="mt-4 inline-block font-bold text-[#087c7d] underline" href="/creator/campaigns">Explore campaigns →</Link></div>}
          <ul className="space-y-3">{s.map((x) => <PostRow key={x.id} x={x} />)}</ul>
        </section>
      </Loaded>
      </div>
    </>
  );
}

function TierBadge({ tier }: { tier: string }) {
  const colors: Record<string, string> = {
    nano: 'border-[#e9d396] bg-[#fff3cb] text-[#73550c]',
    micro: 'border-[#f1cfc4] bg-[#fff0e9] text-[#8a4936]',
    mid: 'border-[#d9cef1] bg-[#f2edfc] text-[#5c4580]',
    macro: 'border-[#e9d396] bg-[#fff3cb] text-[#73550c]',
  };
  return <span className={`mt-4 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${colors[String(tier).toLowerCase()] ?? colors.nano}`}><span aria-hidden="true">✦</span>{tier} creator</span>;
}

type MetricIconName = 'pending' | 'paid' | 'review' | 'tax';

function MetricIcon({ name }: { name: MetricIconName }) {
  return <svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {name === 'pending' && <><rect x="3" y="6" width="18" height="13" rx="3" /><path d="M3 10h18M15 15h3M7 3h10" /></>}
    {name === 'paid' && <><circle cx="12" cy="12" r="9" /><path d="M8.5 8.5h7M8.5 11h7M9 8.5c4.5 0 4.5 5 0 5l4.5 3" /></>}
    {name === 'review' && <><rect x="4" y="3" width="12" height="16" rx="2" /><path d="M8 7h4M8 10h4M8 13h3" /><circle cx="17.5" cy="17.5" r="3.5" /><path d="M17.5 15.8v1.8l1.2.8" /></>}
    {name === 'tax' && <><path d="M6 3.5h12v17l-3-1.7-3 1.7-3-1.7-3 1.7v-17Z" /><path d="M9 8h6M9 11.5h6M9 15h3" /></>}
  </svg>;
}

function Metric({ label, value, icon, accent = false }: { label: string; value: string; icon: MetricIconName; accent?: boolean }) {
  return <div className={`min-w-0 rounded-2xl border p-4 shadow-sm sm:p-5 ${accent ? 'border-[#b9e6df] bg-[#eaf8f5]' : 'border-[#dfe9e8] bg-white'}`}>
    <div className="mb-4 flex items-center justify-between gap-2"><span className="text-xs font-semibold leading-4 text-muted">{label}</span><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${accent ? 'bg-[#159b92] text-white' : 'bg-[#eef8f6] text-[#138d8e]'}`}><MetricIcon name={icon} /></span></div>
    <div className="break-words text-xl font-bold tracking-tight text-ink sm:text-2xl">{value}</div>
  </div>;
}

function PostRow({ x }: { x: any }) {
  const [open, setOpen] = useState(false);
  const eng = x.engagement_bps ?? (x.views && x.likes !== null && x.comments !== null ? Math.floor(((x.likes + x.comments) * 10000) / x.views) : null);
  return (
    <li className="rounded-xl border border-[#e2ecea] bg-[#fbfdfd] p-4 transition hover:border-[#b8dcd7] sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <div className="font-bold text-ink">{x.campaign}</div>
          <a className="mt-1 inline-block text-sm font-semibold text-[#087c7d] underline" href={x.post_url} target="_blank" rel="noreferrer">View post ↗</a>
        </div>
        <Status value={x.payout_status === 'PROCESSING' ? 'PROCESSING' : x.status} />
      </div>
      {x.status_reason && <p className="mt-1 text-sm text-muted">{x.status_reason}</p>}
      {x.status === 'MEASURING' && <p className="mt-1 text-sm text-muted">Final check on {date(x.measure_due_at)}. Keep the post live, because a deleted post earns nothing.</p>}
      {x.views !== null && <dl className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div><dt className="inline text-muted">Views </dt><dd className="inline font-semibold">{count(x.views)}</dd></div>
        <div><dt className="inline text-muted">Likes </dt><dd className="inline font-semibold">{x.likes === null ? 'Hidden' : count(x.likes)}</dd></div>
        <div><dt className="inline text-muted">Comments </dt><dd className="inline font-semibold">{x.comments === null ? 'Hidden' : count(x.comments)}</dd></div>
        <div><dt className="inline text-muted">Engagement </dt><dd className="inline font-semibold">{percent(eng)}</dd></div>
      </dl>}
      {x.gross_paise !== null && (
        <div className="mt-2 text-sm">
          <button className="font-semibold text-link underline" aria-expanded={open} onClick={() => setOpen(!open)}>
            {x.net_paise !== null ? `You receive ${rupees(x.net_paise)}` : `Earned ${rupees(x.gross_paise)} before tax`}
          </button>
          {open && (
            <table className="mt-2 w-full max-w-xs">
              <tbody>
                <tr><td>Earned</td><td className="text-right">{rupees(x.gross_paise)}</td></tr>
                {x.net_paise !== null && <>
                  <tr><td>Tax deducted (TDS)</td><td className="text-right">{x.tds_paise > 0 ? '-' : ''}{rupees(x.tds_paise)}</td></tr>
                  {x.benefit_tds_paise > 0 && <tr><td>Tax on free products or gifts</td><td className="text-right">-{rupees(x.benefit_tds_paise)}</td></tr>}
                  <tr className="border-t border-ink font-bold"><td>You receive</td><td className="text-right">{rupees(x.net_paise)}</td></tr>
                </>}
                {x.payout_due_date && x.payout_status !== 'PAID' && <tr><td className="pt-1 text-muted">Due by</td><td className="pt-1 text-right text-muted">{date(x.payout_due_date)}</td></tr>}
                {x.utr && <tr><td className="pt-1 text-muted">Bank reference</td><td className="pt-1 text-right text-muted">{x.utr}</td></tr>}
              </tbody>
            </table>
          )}
        </div>
      )}
    </li>
  );
}
