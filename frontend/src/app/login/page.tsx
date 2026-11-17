'use client';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api, homeFor, setToken } from '@/lib/api';
import { Button, PageForm } from '@/components/ui';

export default function Login() {
  const router = useRouter();
  const [mfa, setMfa] = useState<{ token: string; mode: 'VERIFY' | 'SETUP' } | null>(null);
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [codes, setCodes] = useState<{ list: string[]; role: any } | null>(null);
  useEffect(() => {
    if (mfa?.mode === 'SETUP') api('/auth/mfa/setup', 'POST', { mfaToken: mfa.token }).then(setSetup).catch(() => setMfa(null));
  }, [mfa]);
  const finish = (r: any) => { setToken(r.token); router.replace(homeFor(r.role)); };
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Link href="/" aria-label="Home"><Logo /></Link>
      {codes ? (
        <>
          <h1 className="display mb-2 mt-8">Save your recovery codes</h1>
          <p className="mb-4 text-muted">If you lose your phone, each code works once in place of the 6-digit code. Keep them somewhere safe and private. They will not be shown again.</p>
          <ul className="mb-5 grid grid-cols-2 gap-2 border border-line bg-white p-3 font-semibold">{codes.list.map((c) => <li key={c}>{c}</li>)}</ul>
          <Button kind="primary" onClick={() => router.replace(homeFor(codes.role))}>I have saved them</Button>
        </>
      ) : mfa?.mode === 'SETUP' ? (
        <>
          <h1 className="display mb-2 mt-8">Turn on two-step login</h1>
          <p className="mb-4 text-muted">Admins can reach bank details, so a password alone is not enough. Install Google Authenticator or a similar app, scan this code, and enter the 6 digits it shows.</p>
          {setup && <>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={setup.qr} alt="Code to scan with your authenticator app" width={220} height={220} className="mb-3 border border-line" />
            <p className="mb-4 break-all text-sm text-muted">Cannot scan? Enter this key: <span data-testid="totp-secret" className="font-semibold text-ink">{setup.secret}</span></p>
            <PageForm submit="Turn on" fields={[{ name: 'code', label: '6-digit code', required: true }]} onSubmit={async (v) => {
              const r = await api('/auth/mfa/enable', 'POST', { mfaToken: mfa.token, code: v.code.trim() });
              setToken(r.token); setCodes({ list: r.recoveryCodes, role: r.role });
            }} />
          </>}
        </>
      ) : mfa ? (
        <>
          <h1 className="display mb-2 mt-8">Enter your code</h1>
          <p className="mb-5 text-muted">Open your authenticator app. If you lost your phone, enter a recovery code.</p>
          <PageForm submit="Verify" fields={[{ name: 'code', label: 'Code', required: true }]} onSubmit={async (v) => finish(await api('/auth/mfa/verify', 'POST', { mfaToken: mfa.token, code: v.code.trim() }))} />
        </>
      ) : (
        <>
          <h1 className="display mb-6 mt-8">Log in</h1>
          <PageForm submit="Log in" fields={[
            { name: 'email', label: 'Email', type: 'email', required: true },
            { name: 'password', label: 'Password', type: 'password', required: true },
          ]} onSubmit={async (v) => {
            const r = await api('/auth/login', 'POST', { email: v.email, password: v.password });
            if (r.mfaToken) setMfa({ token: r.mfaToken, mode: r.mfa }); else finish(r);
          }} />
          <p className="mt-5"><Link className="text-link underline" href="/forgot">Forgot your password?</Link></p>
          <p className="mt-3 text-muted">New creator? <Link className="text-link underline" href="/register">Join here</Link>.</p>
        </>
      )}
    </main>
  );
}
