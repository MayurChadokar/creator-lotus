'use client';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { useState } from 'react';
import { api } from '@/lib/api';
import { Notice, PageForm } from '@/components/ui';

export default function Forgot() {
  const [done, setDone] = useState(false);
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Link href="/" aria-label="Home"><Logo /></Link>
      <h1 className="display mb-6 mt-8">Reset your password</h1>
      {done ? <Notice>If that email has an account, a reset link is on its way. It expires in 1 hour. No email? Ask your store to request a link from an admin.</Notice> : (
        <PageForm submit="Email me a reset link" fields={[{ name: 'email', label: 'Email', type: 'email', required: true }]}
          onSubmit={async (v) => { await api('/auth/forgot-password', 'POST', { email: v.email }); setDone(true); }} />
      )}
      <p className="mt-6"><Link className="text-link underline" href="/login">Back to log in</Link></p>
    </main>
  );
}
