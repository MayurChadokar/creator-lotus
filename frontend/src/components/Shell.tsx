'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, currentRole, setToken, type Role } from '@/lib/api';
import { Logo } from './Logo';
import { FormModal, useToast } from './ui';

export function Shell({ role, portal, nav, children }: { role: Role; portal: string; nav: { href: string; label: string }[]; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [ok, setOk] = useState(false);
  const [pw, setPw] = useState(false);
  useEffect(() => {
    if (currentRole() !== role) router.replace('/login'); else setOk(true);
  }, [role, router]);
  if (!ok) return null;
  const root = nav[0]!.href;
  const active = (h: string) => (h === root ? path === h : path.startsWith(h));
  const logOut = () => { setToken(null); router.replace('/login'); };
  return (
    <div className="min-h-dvh md:pl-56">
      <aside className="fixed inset-y-0 left-0 hidden w-56 flex-col bg-ink text-white md:flex">
        <div className="px-5 py-5">
          <Logo light />
          <div className="mt-2 text-sm text-white/70">{portal}</div>
        </div>
        <nav aria-label="Main" className="flex-1">
          {nav.map((n) => (
            <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
              className={`block border-l-4 px-4 py-2.5 text-sm font-medium ${active(n.href) ? 'border-tag bg-white/10 text-white' : 'border-transparent text-white/80 hover:bg-white/5'}`}>
              {n.label}
            </Link>
          ))}
        </nav>
        <button onClick={() => setPw(true)} className="mx-4 mb-2 text-left text-sm text-white/80 underline">Change password</button>
        <button onClick={logOut} className="mx-4 mb-4 border border-white/30 px-3 py-2 text-left text-sm rounded-[3px] hover:bg-white/10">Log out</button>
      </aside>
      <header className="flex items-center justify-between bg-ink px-4 py-3 text-white md:hidden">
        <Logo light />
        <div><button onClick={() => setPw(true)} className="min-h-[36px] px-2 text-sm underline">Password</button><button onClick={logOut} className="min-h-[36px] px-2 text-sm underline">Log out</button></div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6 pb-24 md:px-8 md:py-8 md:pb-10">{children}</main>
      <nav aria-label="Main" className="fixed inset-x-0 bottom-0 z-40 flex overflow-x-auto border-t border-white/20 bg-ink md:hidden">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} aria-current={active(n.href) ? 'page' : undefined}
            ref={(el) => { if (el && active(n.href)) el.scrollIntoView({ inline: 'center', block: 'nearest' }); }}
            className={`flex min-h-[56px] flex-1 items-center justify-center whitespace-nowrap border-t-[3px] px-2 text-center text-[13px] font-medium ${active(n.href) ? 'border-tag text-white' : 'border-transparent text-white/75'}`}>
            {n.label}
          </Link>
        ))}
      </nav>
      {pw && <FormModal title="Change password" submit="Change password" onClose={() => setPw(false)}
        fields={[
          { name: 'current', label: 'Current password', type: 'password', required: true },
          { name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters.' },
        ]}
        onSubmit={async (v) => { const r = await api('/auth/change-password', 'POST', { current: v.current, next: v.next }); setToken(r.token); toast('Password changed. Other devices are logged out.'); }} />}
    </div>
  );
}
