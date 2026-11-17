'use client';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState } from 'react';
import { api } from '@/lib/api';
import { Notice, PageForm } from '@/components/ui';

function Reset() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  if (done) return <><Notice>Your password is changed and other devices are logged out. Any payments pause until our team re-confirms your bank details.</Notice><Link className="text-link underline" href="/login">Log in</Link></>;
  if (!token) return <Notice tone="bad">This link is not complete. Please ask for a new one.</Notice>;
  return (
    <PageForm submit="Set new password" fields={[{ name: 'password', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters.' }]}
      onSubmit={async (v) => { await api('/auth/reset-password', 'POST', { token, password: v.password }); setDone(true); }} />
  );
}
export default function P() {
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Link href="/" aria-label="Home"><Logo /></Link>
      <h1 className="display mb-6 mt-8">Choose a new password</h1>
      <Suspense><Reset /></Suspense>
    </main>
  );
}
