import type { ReactNode } from 'react';

export function CreatorPageHead({ eyebrow, title, intro, action }: { eyebrow: string; title: string; intro: string; action?: ReactNode }) {
  return <header className="mb-6 flex flex-wrap items-end justify-between gap-4 border-b border-[#dce7ef] pb-5">
    <div className="max-w-3xl"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.14em] text-[#168b8e]">{eyebrow}</p><h1 className="text-3xl font-semibold tracking-tight text-[#17365a]">{title}</h1><p className="mt-2 text-sm leading-6 text-[#596f82]">{intro}</p></div>
    {action && <div>{action}</div>}
  </header>;
}
