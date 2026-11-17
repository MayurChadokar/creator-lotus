'use client';
import Link from 'next/link';
import { date, useApi } from '@/lib/api';
import { Logo } from '@/components/Logo';
import { PriceTag } from '@/components/ui';

const STEPS = [
  ['Join and get approved', 'Add your PAN and payout details, connect your account, and our team reviews your profile.'],
  ['Pick a store campaign', 'Choose a brief for mobiles, TVs, ACs, laptops and more at a store near you.'],
  ['Film at the store, then post', 'Book a visit and film the demo at the store. Publish the video live on your own account, then paste the link here. We check it automatically.'],
  ['Get paid', 'Once your post passes, payment is due within 3 working days, after tax.'],
];

export default function Home() {
  const campaigns = useApi<any[]>('/public/campaigns');
  return (
    <div>
      <div className="bg-ink text-white">
        <header className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 md:px-8">
          <Logo light />
          <Link href="/login" className="min-h-[40px] content-center px-2 font-medium underline">Log in</Link>
        </header>
        <div className="mx-auto max-w-6xl px-4 pb-14 pt-8 md:px-8 md:pb-20 md:pt-14">
          <h1 className="display max-w-4xl" style={{ fontSize: 'clamp(2.3rem, 7vw, 4.6rem)' }}>Make videos for your nearest Lotus Electronics store. Get paid for real views.</h1>
          <p className="mt-5 max-w-xl text-lg text-white/85">Paid campaigns for local creators from Lotus Electronics Supermarket, with your pay worked out in the open: base pay, a view bonus, and a higher rate on big-ticket products.</p>
          <div className="mt-7 flex flex-wrap items-center gap-6">
            <Link href="/register" className="inline-block rounded-[3px] bg-tag px-6 py-3 font-bold text-ink hover:bg-[#ffdf5c]">Join as a creator</Link>
            <PriceTag label="Payment due" amount="3 working days" />
          </div>
        </div>
      </div>
      <main className="mx-auto max-w-6xl px-4 py-12 md:px-8">
        <h2 className="display !text-2xl">How it works</h2>
        <ol className="mt-5 grid gap-6 md:grid-cols-4">
          {STEPS.map(([t, d], i) => (
            <li key={t} className="border-t-2 border-ink pt-3">
              <div className="display text-2xl">{i + 1}</div>
              <h3 className="mt-1 font-bold">{t}</h3>
              <p className="mt-1 text-muted">{d}</p>
            </li>
          ))}
        </ol>
        <h2 className="display mt-14 !text-2xl">Open campaigns</h2>
        {campaigns.error && <p className="mt-3 text-muted">Campaigns could not be loaded right now. Refresh to try again.</p>}
        {campaigns.data?.length === 0 && <p className="mt-3 text-muted">No campaigns are open today. Join now and you can apply as soon as one opens.</p>}
        <ul className="mt-3">
          {campaigns.data?.map((c) => (
            <li key={c.id} className="grid gap-1 border-b border-line py-4 md:grid-cols-[1fr_10rem_9rem] md:gap-6">
              <div><h3 className="font-bold">{c.title}</h3><p className="max-w-2xl text-muted">{c.brief}</p></div>
              <div>{c.category}{c.cities ? `, ${c.cities}` : ''}</div>
              <div className="text-muted">Until {date(c.expires_at)}</div>
            </li>
          ))}
        </ul>
        <p className="mt-12 text-sm text-muted">Store staff and admins can <Link href="/login" className="underline">log in here</Link>.</p>
      </main>
    </div>
  );
}
