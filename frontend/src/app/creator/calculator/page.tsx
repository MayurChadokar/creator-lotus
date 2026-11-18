'use client';
import { useEffect, useState } from 'react';
import { api, rupees, useApi } from '@/lib/api';
import { inputCls, Notice } from '@/components/ui';
import { CreatorPageHead } from '@/components/CreatorPageHead';
import Link from 'next/link';

export default function Calculator() {
  const cats = useApi<any[]>('/public/categories');
  const me = useApi<any>('/influencer/me');
  const [cat, setCat] = useState('');
  const [views, setViews] = useState(50000);
  const [r, setR] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { if (!cat && cats.data?.[0]) setCat(cats.data[0].id); }, [cats.data, cat]);
  useEffect(() => {
    if (!cat) return;
    let stale = false;
    const t = setTimeout(() => {
      api('/influencer/calculator', 'POST', { categoryId: cat, views }).then((x) => { if (!stale) { setR(x); setErr(null); } }).catch((e) => { if (!stale) { setR(null); setErr(e.message); } });
    }, 150);
    return () => { stale = true; clearTimeout(t); };
  }, [cat, views]);
  return (
    <div className="mx-auto max-w-6xl">
      <CreatorPageHead eyebrow="Planning tools" title="Earnings calculator" intro={`Estimate your earnings based on your rate card${me.data ? ` and ${me.data.tier} tier` : ''}.`} action={<Link href="/creator/campaigns" className="inline-flex min-h-[38px] items-center rounded-md border border-[#cbd7e1] bg-white px-4 text-sm font-semibold text-[#24435e] hover:bg-[#f4f8fa]">← Back to campaigns</Link>} />
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="rounded-lg border border-[#dce4ed] bg-white p-5 shadow-sm sm:p-6">
          <div className="mb-6 border-b border-[#e5ebf0] pb-4"><h2 className="text-base font-semibold text-[#17365a]">Estimate details</h2><p className="mt-1 text-sm text-muted">Choose a category and adjust expected views.</p></div>
          <div className="space-y-6">
          <div>
            <label htmlFor="cat" className="mb-2 block text-sm font-semibold">Product category</label>
            <select id="cat" className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>
              {!cats.data?.length && <option value="">{cats.loading ? 'Loading categories…' : 'No categories available'}</option>}
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            {cats.error && <p className="mt-2 text-sm text-stop">{cats.error}</p>}
          </div>
          <div>
            <div className="mb-3 flex items-center justify-between gap-3"><label htmlFor="views" className="text-sm font-semibold">Expected views</label><span className="rounded-md border border-[#d7e7ec] bg-[#f2f9f8] px-3 py-1 text-sm font-semibold text-[#147f80]">{views.toLocaleString('en-IN')}</span></div>
            <input id="views" type="range" min={0} max={1000000} step={5000} value={views} onChange={(e) => setViews(Number(e.target.value))} className="w-full accent-[#168f91]" />
            <div className="mt-1 flex justify-between text-xs text-muted"><span>0</span><span>10,00,000 views</span></div>
          </div>
          </div>
        </section>
        <section className="rounded-lg border border-[#dce4ed] bg-white p-5 shadow-sm sm:p-6" aria-live="polite">
          <div className="mb-5 border-b border-[#e5ebf0] pb-4"><h2 className="text-base font-semibold text-[#17365a]">Estimated earnings</h2><p className="mt-1 text-sm text-muted">A breakdown based on your selections.</p></div>
        {r && (
          <div>
            <div className="rounded-md border border-[#cde7e2] bg-[#eff9f6] px-4 py-4"><p className="text-xs font-semibold uppercase tracking-wide text-[#35786d]">Estimated total · before tax</p><p className="mt-1 text-3xl font-semibold tracking-tight text-[#17365a]">{rupees(r.grossPaise)}</p></div>
            <table className="mt-4 w-full text-sm">
              <tbody>
                <tr className="border-b border-[#edf1f4]"><td className="py-3 text-muted">Base pay</td><td className="text-right font-semibold">{rupees(r.basePaise)}</td></tr>
                <tr className="border-b border-[#edf1f4]"><td className="py-3 text-muted">View bonus ({rupees(r.terms.bonusPer10kPaise, false)} per 10,000)</td><td className="text-right font-semibold">{rupees(r.viewBonusPaise)}</td></tr>
                <tr><td className="py-3 text-muted">Category multiplier</td><td className="text-right font-semibold">{(r.terms.multiplierBps / 10000).toFixed(2)}x</td></tr>
              </tbody>
            </table>
            <p className="mt-3 text-sm leading-6 text-muted">The view bonus stops at {rupees(r.terms.maxViewBonusPaise, false)}. This estimate assumes the post passes all checks; TDS may be deducted when you are paid.</p>
          </div>
        )}
        {!r && <p className="py-4 text-sm text-muted">{err || cats.error ? 'The estimate is unavailable right now.' : 'Select a category to see your estimate.'}</p>}
        </section>
      </div>
    </div>
  );
}
