'use client';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { Notice } from '@/components/ui';

/** Instagram sends the creator back here after they approve the connection. */
function Finish() {
  const q = useSearchParams();
  const router = useRouter();
  const [err, setErr] = useState<string | null>(null);
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const code = q.get('code'); const state = q.get('state');
    if (!code || !state) { setErr('Instagram did not finish connecting. You may have cancelled, or your account may not be a Business or Creator account.'); return; }
    api('/influencer/social/instagram/connect', 'POST', { code: code.replace(/#_$/, ''), state })
      .then(() => router.replace('/creator/profile')).catch((e) => setErr(e.message));
  }, [q, router]);
  return err ? <><Notice tone="bad">{err}</Notice><Link className="text-link underline" href="/creator/profile">Back to profile</Link></> : <p>Connecting Instagram…</p>;
}
export default function P() { return <Suspense><Finish /></Suspense>; }
