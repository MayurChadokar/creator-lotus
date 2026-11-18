'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api, currentRole, setToken, useApi, type Role } from '@/lib/api';
import { Logo } from './Logo';
import { FormModal, useToast } from './ui';

export function Shell({ role, portal, nav, children }: { role: Role; portal: string; nav: { href: string; label: string }[]; children: ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const toast = useToast();
  const [ok, setOk] = useState(false);
  const [pw, setPw] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [search, setSearch] = useState('');
  const creator = useApi<{ tier?: string }>(ok && role === 'INFLUENCER' ? '/influencer/me' : null);
  useEffect(() => {
    if (currentRole() !== role) router.replace('/login'); else setOk(true);
  }, [role, router]);
  if (!ok) return null;
  const root = nav[0]!.href;
  const active = (h: string) => (h === root ? path === h : path.startsWith(h));
  const logOut = () => { setToken(null); router.replace('/login'); };
  const initials = role === 'ADMIN' ? 'AD' : role === 'STORE_MANAGER' ? 'SM' : 'CR';
  const matches = search.trim() ? nav.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase())) : [];
  return (
    <div className={`min-h-dvh transition-[padding] ${role === 'INFLUENCER' && collapsed ? 'md:pl-20' : 'md:pl-60'} ${role === 'INFLUENCER' ? 'creator-portal bg-[#f4f7fb]' : 'bg-[#f6f8fb]'}`}>
      {mobileOpen && <button aria-label="Close menu" className="fixed inset-0 z-40 bg-ink/50 md:hidden" onClick={() => setMobileOpen(false)} />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-60 flex-col transition-all md:translate-x-0 ${role === 'INFLUENCER' ? `border-r border-[#258d8b] bg-[#2b9e9d] text-white ${collapsed ? 'md:w-20' : ''}` : 'bg-[#082a46] text-white'} ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        <div className="border-b border-white/20 px-5 py-6">
          <div className={collapsed && role === 'INFLUENCER' ? 'md:hidden' : ''}><Logo light={role !== 'INFLUENCER'} large={role === 'INFLUENCER'} /></div>
          {role === 'INFLUENCER' && <button type="button" aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} className={`hidden h-9 w-9 items-center justify-center rounded-md border border-white/40 text-white hover:bg-white/15 md:flex ${collapsed ? 'mx-auto' : 'mt-3'}`}><svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/><path d={collapsed ? 'm13 9 3 3-3 3' : 'm16 9-3 3 3 3'}/></svg></button>}
          <div className={`mt-4 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] ${role === 'INFLUENCER' ? 'text-[#103f3f]' : 'text-white/55'} ${collapsed && role === 'INFLUENCER' ? 'md:hidden' : ''}`}><span className="h-1.5 w-1.5 rounded-full bg-[#103f3f]" />{portal}</div>
          {role === 'INFLUENCER' && <div className={`mt-5 flex items-center gap-3 rounded-lg border border-white/25 bg-[#167e7d]/40 px-3 py-3 ${collapsed ? 'md:hidden' : ''}`}>
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-[#edda9c]/70 bg-[#fff4cf] text-[#85631c]"><svg aria-hidden="true" className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="m12 3 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4-3.9-3.8 5.4-.8L12 3Z"/><path d="M8.5 19.5h7"/></svg></span>
            <div className="min-w-0"><p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#d1efeb]">Creator tier</p>
            <p className="mt-0.5 truncate text-sm font-semibold text-white">{creator.data?.tier ? `${creator.data.tier} creator` : creator.error ? 'Tier unavailable' : 'Loading tier…'}</p></div>
          </div>}
        </div>
        <nav aria-label="Main" className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          {role === 'INFLUENCER' && <p className={`px-3 pb-3 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#174d4d] ${collapsed ? 'md:hidden' : ''}`}>Workspace</p>}
          {nav.map((n) => (
            <Link key={n.href} href={n.href} title={n.label} onClick={() => setMobileOpen(false)} aria-current={active(n.href) ? 'page' : undefined}
              className={`relative flex min-h-11 items-center gap-3 rounded-md px-3 py-2.5 text-sm font-medium transition ${role === 'INFLUENCER' ? (active(n.href) ? 'bg-[#d4f1ed] text-[#173f40] shadow-[inset_3px_0_0_#165e5e]' : 'text-[#173f40] hover:bg-white/20 hover:text-[#103435]') : (active(n.href) ? 'bg-[#0f9d8a] text-white' : 'text-[#c2d1df] hover:bg-white/10 hover:text-white')} ${collapsed && role === 'INFLUENCER' ? 'md:justify-center md:px-0' : ''}`}>
              <NavIcon label={n.label} />
              <span className={collapsed && role === 'INFLUENCER' ? 'md:hidden' : ''}>{n.label}</span>
            </Link>
          ))}
        </nav>
        <div className="border-t border-white/20 p-3">
          {role === 'INFLUENCER' && <p className={`px-3 pb-2 pt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-[#174d4d] ${collapsed ? 'md:hidden' : ''}`}>Account</p>}
          <button title="Change password" onClick={() => setPw(true)} className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${role === 'INFLUENCER' ? 'text-[#102f30] hover:bg-white/20' : 'text-white/70 hover:bg-white/10 hover:text-white'} ${collapsed && role === 'INFLUENCER' ? 'md:justify-center md:px-0' : ''}`}><NavIcon label="Password" /><span className={collapsed && role === 'INFLUENCER' ? 'md:hidden' : ''}>Change password</span></button>
          <button title="Log out" onClick={logOut} className={`flex min-h-10 w-full items-center gap-3 rounded-md px-3 text-left text-sm ${role === 'INFLUENCER' ? 'text-[#102f30] hover:bg-white/20' : 'text-white/70 hover:bg-white/10 hover:text-white'} ${collapsed && role === 'INFLUENCER' ? 'md:justify-center md:px-0' : ''}`}><NavIcon label="Logout" /><span className={collapsed && role === 'INFLUENCER' ? 'md:hidden' : ''}>Log out</span></button>
        </div>
      </aside>
      <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-[#dfe6ee] bg-white/95 px-4 backdrop-blur md:px-6">
        <button aria-label="Open menu" onClick={() => setMobileOpen(true)} className="grid h-10 w-10 place-items-center rounded-lg border border-line md:hidden"><span className="text-xl">☰</span></button>
        {role === 'INFLUENCER' ? <div className="relative max-w-md flex-1">
          <svg aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6b8090]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4 4"/></svg>
          <input aria-label="Search creator pages" value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => { if (e.key === 'Escape') setSearch(''); if (e.key === 'Enter' && matches[0]) { router.push(matches[0].href); setSearch(''); } }} className="h-10 w-full rounded-md border border-line bg-[#f8fafc] pl-10 pr-3 text-sm outline-none focus:border-[#0f9d8a]" placeholder="Find a page…" />
          {search.trim() && <div className="absolute left-0 right-0 top-full mt-1 rounded-md border border-[#dce6ed] bg-white p-1 shadow-lg">{matches.length ? matches.map((item) => <Link key={item.href} href={item.href} onClick={() => setSearch('')} className="flex items-center gap-3 rounded px-3 py-2.5 text-sm text-[#17365a] hover:bg-[#edf7f6]"><NavIcon label={item.label} />{item.label}</Link>) : <p className="px-3 py-2.5 text-sm text-muted">No matching pages</p>}</div>}
        </div> : <label className="relative hidden max-w-2xl flex-1 md:block"><span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">⌕</span><input className="h-10 w-full rounded-xl border border-line bg-[#f8fafc] pl-9 pr-3 text-sm outline-none focus:border-[#0f9d8a]" placeholder="Search campaigns, creators, stores, reviews, payments…" /></label>}
        <div className="ml-auto flex items-center gap-2">
          {role === 'INFLUENCER' ? <Link href="/creator/help" aria-label="Help" className="flex min-h-10 items-center gap-2 rounded-md px-2 text-sm font-semibold text-[#36536b] hover:bg-paper"><NavIcon label="Help" /><span className="hidden sm:inline">Help</span></Link> : <><button aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-full text-lg hover:bg-paper">♢<span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-stop" /></button><button className="hidden min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-semibold hover:bg-paper sm:flex">? <span>Help</span></button></>}
          <div className="mx-1 h-7 w-px bg-line" />
          <div className="grid h-9 w-9 place-items-center rounded-full bg-[#0f9d8a] text-xs font-bold text-white">{initials}</div>
          <div className="hidden leading-tight lg:block"><div className="text-sm font-bold">{role === 'ADMIN' ? 'Operations Admin' : portal}</div><div className="text-xs text-muted">{portal}</div></div>
        </div>
      </header>
      <main className="mx-auto max-w-[1540px] px-4 py-5 md:px-6 md:py-6">{children}</main>
      {pw && <FormModal title="Change password" submit="Change password" onClose={() => setPw(false)}
        fields={[
          { name: 'current', label: 'Current password', type: 'password', required: true },
          { name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters.' },
        ]}
        onSubmit={async (v) => { const r = await api('/auth/change-password', 'POST', { current: v.current, next: v.next }); setToken(r.token); toast('Password changed. Other devices are logged out.'); }} />}
    </div>
  );
}

function NavIcon({ label }: { label: string }) {
  const paths: Record<string, string> = {
    Dashboard: 'M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1v-8.5Z',
    Earnings: 'M4 6.5h16v12H4v-12Zm0 3.5h16M15 15h2',
    Campaigns: 'M4 13v-2l11-4v10L4 13Zm11-3 5-2v8l-5-2M6 14l1 6h3l-1-7',
    Creators: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m7-10a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm13 10v-2a4 4 0 0 0-3-3.87m-2-11.96a4 4 0 0 1 0 7.75',
    Reviews: 'm12 3 2.75 5.57L21 9.48l-4.5 4.39 1.06 6.2L12 17.15l-5.56 2.92 1.06-6.2L3 9.48l6.25-.91L12 3Z',
    'Store visits': 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    Visits: 'M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Zm-8 3a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z',
    Help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm-2.5-11a2.5 2.5 0 1 1 4.2 1.8c-1.1 1-1.7 1.2-1.7 2.7m0 3h.01',
    Profile: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM5 20a7 7 0 0 1 14 0',
    Payments: 'M3 6h18v12H3V6Zm0 4h18M7 15h3',
    'Pay rates': 'M4 7h16M4 12h16M4 17h16M8 4v6m8-1v6m-8-1v6',
    'Social sharing': 'M18 8a3 3 0 1 0-2.83-4M6 14a3 3 0 1 0 0-6m12 12a3 3 0 1 0 0-6M8.6 10.5l6.8-3M8.6 12.5l6.8 3',
    'Audit log': 'M6 3h12v18H6V3Zm3 5h6m-6 4h6m-6 4h4',
    Password: 'M5 11h14v10H5V11Zm3 0V8a4 4 0 0 1 8 0v3', Logout: 'M10 17l5-5-5-5m5 5H3m12-9h5a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-5',
  };
  return <svg aria-hidden="true" className="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[label] ?? paths.Dashboard} /></svg>;
}
