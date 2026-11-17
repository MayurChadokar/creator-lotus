'use client';
import { useState } from 'react';

const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Lotus Electronics Supermarket';
const LOGO = process.env.NEXT_PUBLIC_LOGO_URL ?? 'https://www.lotuselectronics.com/assets/images/lotus-logo.png';

/** The store logo on a white plate, so it reads on any background. Falls back to the name. */
export function Logo({ light }: { light?: boolean }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`display text-base ${light ? 'text-tag' : ''}`}>{BRAND}</span>;
  return (
    <span className="inline-block rounded-[3px] bg-white px-2 py-1">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={LOGO} alt={BRAND} className="h-8 w-auto max-w-[170px] object-contain" onError={() => setFailed(true)} />
    </span>
  );
}
