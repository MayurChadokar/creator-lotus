'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, count, date, percent, rupees, useApi } from '@/lib/api';
import { Button, Figure, Loaded, Notice, PageHead, PriceTag, Section, Status, useAct } from '@/components/ui';

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
      <PageHead title={me.data ? `Hello, ${me.data.full_name.split(' ')[0]}` : 'Earnings'} intro={me.data ? `You are on the ${me.data.tier} tier.` : undefined} />
      {missing && <Notice>Finish your profile to start submitting. <Link className="font-semibold underline" href="/creator/profile">Open profile</Link></Notice>}
      <Loaded state={subs}>
        <div className="mb-8 flex flex-wrap items-center gap-x-8 gap-y-4">
          <PriceTag label="On its way to you" amount={rupees(coming)} />
          <Figure label="Paid to you" value={rupees(paid, false)} />
          <Figure label="Posts being checked" value={count(inProgress)} />
          <Figure label={`Tax deducted, ${tax.data?.[0]?.tax_year ?? 'this year'}`} value={rupees(tax.data?.[0]?.tds_paise ?? 0, false)} />
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
        <Section title="Your posts">
          {s.length === 0 && <p className="py-5 text-muted">No posts yet. <Link className="text-link underline" href="/creator/campaigns">Pick a campaign</Link> to get started.</p>}
          <ul>{s.map((x) => <PostRow key={x.id} x={x} />)}</ul>
        </Section>
      </Loaded>
    </>
  );
}

function PostRow({ x }: { x: any }) {
  const [open, setOpen] = useState(false);
  const eng = x.engagement_bps ?? (x.views && x.likes !== null && x.comments !== null ? Math.floor(((x.likes + x.comments) * 10000) / x.views) : null);
  return (
    <li className="border-b border-line py-3">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-1">
        <div>
          <div className="font-semibold">{x.campaign}</div>
          <a className="text-sm text-link underline" href={x.post_url} target="_blank" rel="noreferrer">Open post</a>
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
