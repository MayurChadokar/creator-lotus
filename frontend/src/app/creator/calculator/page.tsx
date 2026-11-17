'use client';
import { useEffect, useState } from 'react';
import { api, rupees, useApi } from '@/lib/api';
import { inputCls, Notice, PageHead, PriceTag } from '@/components/ui';

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
      api('/influencer/calculator', 'POST', { categoryId: cat, views }).then((x) => { if (!stale) { setR(x); setErr(null); } }).catch((e) => !stale && setErr(e.message));
    }, 150);
    return () => { stale = true; clearTimeout(t); };
  }, [cat, views]);
  return (
    <>
      <PageHead title="Earnings calculator" intro={`Your rate card${me.data ? ` on the ${me.data.tier} tier` : ''}. An estimate before tax, for a post that passes every check.`} />
      {err && <Notice tone="bad">{err}</Notice>}
      <div className="grid max-w-3xl gap-8 md:grid-cols-2">
        <div className="space-y-5">
          <div>
            <label htmlFor="cat" className="mb-1 block text-sm font-semibold">Product category</label>
            <select id="cat" className={inputCls} value={cat} onChange={(e) => setCat(e.target.value)}>
              {cats.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="views" className="mb-1 block text-sm font-semibold">Views: {views.toLocaleString('en-IN')}</label>
            <input id="views" type="range" min={0} max={1000000} step={5000} value={views} onChange={(e) => setViews(Number(e.target.value))} className="w-full accent-ink" />
          </div>
        </div>
        {r && (
          <div>
            <PriceTag label="You could earn" amount={rupees(r.grossPaise)} />
            <table className="mt-4 w-full text-sm">
              <tbody>
                <tr><td className="py-1">Base pay</td><td className="text-right">{rupees(r.basePaise)}</td></tr>
                <tr><td className="py-1">View bonus ({rupees(r.terms.bonusPer10kPaise, false)} per 10,000)</td><td className="text-right">{rupees(r.viewBonusPaise)}</td></tr>
                <tr><td className="py-1">Category multiplier</td><td className="text-right">{(r.terms.multiplierBps / 10000).toFixed(2)}x</td></tr>
              </tbody>
            </table>
            <p className="mt-2 text-sm text-muted">The view bonus stops at {rupees(r.terms.maxViewBonusPaise, false)}. TDS may be deducted when you are paid.</p>
          </div>
        )}
      </div>
    </>
  );
}
