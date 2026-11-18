import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from './Logo';

export function AuthPage({ children }: { children: ReactNode }) {
  return <main className="login-page flex min-h-dvh flex-col bg-[#f4f8f8] px-5 py-6 sm:px-8">
    <header className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-3 sm:min-h-16 sm:justify-center"><Link href="/" aria-label="Home"><Logo large /></Link><Link href="/" className="text-sm font-semibold text-[#35645f] hover:text-[#116d6c] sm:absolute sm:right-0">← Back to home</Link></header>
    <div className="flex flex-1 items-center justify-center py-10"><div className="w-full max-w-[460px] overflow-hidden rounded-lg border border-[#dce7e6] bg-white shadow-[0_10px_30px_rgba(20,65,65,0.06)]"><div className="h-1 bg-[#299c9b]" /><div className="px-6 py-8 sm:px-9 sm:py-9">{children}</div></div></div>
    <p className="text-center text-xs text-[#758a89]">Lotus Electronics Supermarket · Creator Network</p>
  </main>;
}
