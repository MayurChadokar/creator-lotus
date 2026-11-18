'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { PageForm } from '@/components/ui';
import { AuthPage } from '@/components/AuthPage';

export default function Forgot() {
  const [done, setDone] = useState(false);
  return (
    <AuthPage>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#168b8e]">Account recovery</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17365a]">{done ? 'Check your email' : 'Forgot your password?'}</h1>
      {done ? <div role="status" className="mt-5 rounded-md border border-[#bde4d2] bg-[#effaf4] px-4 py-4 text-sm leading-6 text-[#285f4c]">If an active account matches that email, a reset link will be sent. The link expires after 1 hour. Please check your spam folder too.</div> : (<>
        <p className="mb-7 mt-2 text-sm leading-6 text-[#65798a]">Enter the email linked to your account and we’ll send you a password reset link.</p>
        <PageForm submit="Email me a reset link" fields={[{ name: 'email', label: 'Email', type: 'email', required: true }]}
          onSubmit={async (v) => { await api('/auth/forgot-password', 'POST', { email: v.email }); setDone(true); }} />
      </>)}
      <div className="mt-7 border-t border-[#e5eeec] pt-6 text-sm"><Link className="font-semibold text-[#147f80] hover:underline" href="/login">← Back to log in</Link></div>
    </AuthPage>
  );
}
