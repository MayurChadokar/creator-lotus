'use client';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { Notice, PageForm } from '@/components/ui';
import { AuthPage } from '@/components/AuthPage';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  if (done) return <><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17365a]">Password updated</h1><div role="status" className="mt-5 rounded-md border border-[#bde4d2] bg-[#effaf4] px-4 py-4 text-sm leading-6 text-[#285f4c]">Your password has been changed and other sessions have been logged out. Payments are paused until your bank details are re-confirmed.</div><Link className="mt-6 inline-flex text-sm font-semibold text-[#147f80] hover:underline" href="/login">Continue to log in →</Link></>;
  if (!token) return <><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17365a]">Reset link incomplete</h1><div className="mt-5"><Notice tone="bad">This link is not complete. Please request a new one.</Notice></div><Link className="text-sm font-semibold text-[#147f80] hover:underline" href="/forgot">Request a new link →</Link></>;
  return (
    <><h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17365a]">Choose a new password</h1><p className="mb-7 mt-2 text-sm leading-6 text-[#65798a]">Enter a new password to secure your Lotus account.</p><PageForm submit="Set new password" fields={[{ name: 'password', label: 'New password', type: 'password', required: true, hint: 'Use at least 10 characters.' }]}
      onSubmit={async (v) => { await api('/auth/reset-password', 'POST', { token, password: v.password }); setDone(true); }} />
    </>
  );
}
export default function P() {
  return (
    <AuthPage>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#168b8e]">Account recovery</p>
      <Suspense fallback={<p className="mt-4 text-sm text-muted">Loading…</p>}><Reset /></Suspense>
    </AuthPage>
  );
}
