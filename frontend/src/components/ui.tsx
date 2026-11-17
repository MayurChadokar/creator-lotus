'use client';
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

// ---- Buttons ----
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { kind?: 'primary' | 'plain' | 'danger'; busy?: boolean };
export function Button({ kind = 'plain', busy, className = '', children, ...p }: BtnProps) {
  const look = {
    primary: 'bg-ink text-white hover:bg-[#1c3760] border-ink',
    plain: 'bg-white text-ink hover:bg-paper border-line',
    danger: 'bg-white text-stop hover:bg-red-50 border-stop',
  }[kind];
  return (
    <button {...p} disabled={busy || p.disabled}
      className={`min-h-[40px] border px-3.5 py-1.5 text-sm font-semibold rounded-[3px] disabled:opacity-50 ${look} ${className}`}>
      {children}
    </button>
  );
}

// ---- Status badges ----
const TONES: Record<string, string> = {
  good: 'text-go border-go', bad: 'text-stop border-stop', wait: 'text-wait border-wait', none: 'text-muted border-line',
};
export function Badge({ tone = 'none', children }: { tone?: keyof typeof TONES; children: ReactNode }) {
  return <span className={`inline-block whitespace-nowrap border rounded-full px-2 text-xs font-semibold leading-5 bg-white ${TONES[tone]}`}>{children}</span>;
}
const STATUS: Record<string, [string, keyof typeof TONES]> = {
  PENDING_VERIFICATION: ['Checking post', 'wait'], MEASURING: ['Collecting views', 'wait'], RESTRICTED: ['Needs review', 'wait'],
  REJECTED: ['Rejected', 'bad'], NOT_LIVE: ['Post not live', 'bad'], APPROVED: ['Approved', 'good'], IN_BATCH: ['In payment sheet', 'good'], PAID: ['Paid', 'good'], WITHDRAWN: ['Withdrawn', 'none'],
  DRAFT: ['Draft', 'none'], OPEN: ['Open', 'good'], PAUSED: ['Paused', 'wait'], LOCKED: ['Auto-locked', 'wait'], CLOSED: ['Closed', 'none'], EXPIRED: ['Expired', 'none'],
  PENDING_STEP_1: ['Waiting for approval', 'wait'], PENDING_STEP_2: ['Waiting for approval', 'wait'],
  PENDING: ['Pending', 'wait'], PROCESSING: ['Ready to pay', 'wait'], FAILED: ['Failed', 'bad'], VOID: ['Cancelled', 'none'], HELD: ['Held', 'wait'],
  RELEASING: ['Preparing', 'wait'], RELEASED: ['With bank', 'good'], CANCELLED: ['Cancelled', 'none'],
  SETTLED: ['Settled', 'good'],
  RESOLVED_UPHELD: ['Upheld', 'good'], RESOLVED_DENIED: ['Denied', 'none'],
  REQUESTED: ['Waiting for reply', 'wait'], COMPLETED: ['Visited', 'good'], NO_SHOW: ['No-show', 'bad'],  ACCEPTED: ['Accepted', 'good'], DECLINED: ['Declined', 'none'], REVOKED: ['Revoked', 'none'],
};
export const Status = ({ value }: { value: string }) => {
  const [label, tone] = STATUS[value] ?? [value, 'none'];
  return <Badge tone={tone}>{label}</Badge>;
};

// ---- The price tag, used only for money that matters ----
export const PriceTag = ({ label, amount }: { label: string; amount: string }) => (
  <div className="price-tag">
    <span className="text-xs font-medium">{label}</span>
    <span className="display text-xl sm:text-2xl">{amount}</span>
  </div>
);
/** A quiet figure for numbers that support the price tag. */
export const Figure = ({ label, value, tone }: { label: string; value: ReactNode; tone?: 'bad' }) => (
  <div className="min-w-[7rem]">
    <div className={`text-xl font-bold ${tone === 'bad' ? 'text-stop' : ''}`}>{value}</div>
    <div className="text-sm text-muted">{label}</div>
  </div>
);

// ---- Page structure ----
export const PageHead = ({ title, intro, action }: { title: string; intro?: string; action?: ReactNode }) => (
  <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
    <div className="max-w-2xl">
      <h1 className="display">{title}</h1>
      {intro && <p className="mt-1.5 text-muted">{intro}</p>}
    </div>
    {action && <div className="flex flex-wrap gap-2">{action}</div>}
  </div>
);
export const Section = ({ title, intro, action, children }: { title?: string; intro?: string; action?: ReactNode; children: ReactNode }) => (
  <section className="mb-8">
    {(title || action) && (
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-1.5">
        <div>
          {title && <h2 className="display">{title}</h2>}
          {intro && <p className="text-sm text-muted">{intro}</p>}
        </div>
        {action}
      </div>
    )}
    {children}
  </section>
);
export const Notice = ({ tone = 'info', children }: { tone?: 'info' | 'bad'; children: ReactNode }) => (
  <div role={tone === 'bad' ? 'alert' : undefined} className={`mb-4 border-l-4 bg-white px-3 py-2 text-sm ${tone === 'bad' ? 'border-stop' : 'border-tag'}`}>{children}</div>
);
export function Loaded({ state, children }: { state: { loading: boolean; error: string | null; data: unknown }; children: ReactNode }) {
  if (state.error && !state.data) return <Notice tone="bad">{state.error}</Notice>;
  if (state.loading && !state.data) return <p className="py-6 text-muted">Loading…</p>;
  return <>{children}</>;
}

// ---- Tables ----
export interface Col<T> { head: string; cell: (row: T) => ReactNode; right?: boolean }
export function Table<T>({ cols, rows, rowKey, empty }: { cols: Col<T>[]; rows: T[] | null | undefined; rowKey: (r: T) => string; empty: string }) {
  if (!rows?.length) return <p className="py-5 text-muted">{empty}</p>;
  return (
    <table className="stack-table w-full border-collapse text-sm">
      <thead>
        <tr>{cols.map((c) => <th key={c.head} scope="col" className={`border-b border-line px-2 py-2 font-semibold text-muted align-bottom ${c.right ? 'text-right' : 'text-left'}`}>{c.head}</th>)}</tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={rowKey(r)}>
            {cols.map((c) => <td key={c.head} data-label={c.head} className={`border-b border-line px-2 py-2.5 align-top ${c.right ? 'text-right' : ''}`}>{c.cell(r)}</td>)}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Toast messages ----
type Toast = { text: string; bad?: boolean } | null;
const ToastCtx = createContext<(text: string, bad?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastHost({ children }: { children: ReactNode }) {
  const [t, setT] = useState<Toast>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = (text: string, bad?: boolean) => {
    setT({ text, bad }); clearTimeout(timer.current);
    timer.current = setTimeout(() => setT(null), bad ? 8000 : 4000);
  };
  return (
    <ToastCtx.Provider value={show}>
      {children}
      <div aria-live="polite" className="pointer-events-none fixed bottom-20 left-4 right-4 z-[60] md:bottom-6 md:left-auto md:w-96">
        {t && <div className={`pointer-events-auto rounded-[3px] px-4 py-3 text-sm font-medium text-white shadow-lg ${t.bad ? 'bg-stop' : 'bg-ink'}`}>{t.text}</div>}
      </div>
    </ToastCtx.Provider>
  );
}
/** Runs an action, reporting success or the server's explanation. */
export function useAct() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try { await fn(); if (done) toast(done); return true; }
    catch (e) { toast((e as Error).message, true); return false; }
    finally { setBusy(false); }
  };
  return { busy, run };
}

// ---- Dialogs ----
export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const d = ref.current; if (d && !d.open) d.showModal(); return () => d?.close(); }, []);
  return (
    <dialog ref={ref} onCancel={(e) => { e.preventDefault(); onClose?.(); }}
      className={`w-[calc(100%-1.5rem)] ${wide ? 'max-w-2xl' : 'max-w-lg'} max-h-[90dvh] border-t-4 border-tag bg-white p-0 text-ink shadow-2xl backdrop:bg-ink/60`}>
      <div className="p-5">
        <h2 className="display mb-4">{title}</h2>
        {children}
      </div>
    </dialog>
  );
}

export interface Field {
  name: string; label: string; hint?: string; required?: boolean; tab?: string; third?: boolean; // third: sits three to a row on wider screens
  initial?: string | boolean | string[];
  type?: 'text' | 'textarea' | 'number' | 'rupees' | 'select' | 'checks' | 'checkbox' | 'datetime' | 'email' | 'password' | 'date';
  options?: { value: string; label: string }[]; min?: number; max?: number; step?: string; placeholder?: string; show?: (v: Record<string, any>) => boolean;
}
export const inputCls = 'w-full min-h-[42px] border border-[#8795A6] bg-white px-3 py-2 rounded-[3px]';

export function Fields({ fields, values, set }: { fields: Field[]; values: Record<string, any>; set: (name: string, v: any) => void }) {
  return (
    <div className="grid grid-cols-1 gap-y-4 sm:grid-cols-6 sm:gap-x-3">
      {fields.filter((f) => !f.show || f.show(values)).map((f) => <div key={`w-${f.name}`} className={f.third ? 'sm:col-span-2 flex flex-col justify-end' : 'sm:col-span-6'}>{((f: Field) => {
        const id = `f-${f.name}`;
        const label = <label htmlFor={id} className="mb-1 block text-sm font-semibold">{f.label}{f.type === 'rupees' ? ' (₹)' : ''}</label>;
        const hint = f.hint && <p className="mt-1 text-sm text-muted">{f.hint}</p>;
        const v = values[f.name];
        if (f.type === 'checkbox') return (
          <div key={f.name}>
            <label className="flex items-start gap-2 text-sm"><input id={id} type="checkbox" className="mt-1 h-4 w-4" checked={!!v} onChange={(e) => set(f.name, e.target.checked)} />{f.label}</label>
            {hint}
          </div>
        );
        if (f.type === 'checks') return (
          <fieldset key={f.name}>
            <legend className="mb-1 text-sm font-semibold">{f.label}</legend>
            <div className="grid max-h-44 gap-1 overflow-y-auto border border-line p-2 sm:grid-cols-2">
              {f.options?.map((o) => (
                <label key={o.value} className="flex items-center gap-2 py-0.5 text-sm">
                  <input type="checkbox" className="h-4 w-4" checked={(v ?? []).includes(o.value)}
                    onChange={(e) => set(f.name, e.target.checked ? [...(v ?? []), o.value] : (v ?? []).filter((x: string) => x !== o.value))} />
                  {o.label}
                </label>
              ))}
            </div>
            {hint}
          </fieldset>
        );
        if (f.type === 'select') return (
          <div key={f.name}>{label}
            <select id={id} className={inputCls} required={f.required} value={v ?? ''} onChange={(e) => set(f.name, e.target.value)}>
              <option value="">Choose…</option>
              {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>{hint}
          </div>
        );
        if (f.type === 'textarea') return (
          <div key={f.name}>{label}<textarea id={id} rows={4} className={inputCls} required={f.required} value={v ?? ''} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />{hint}</div>
        );
        const htmlType = f.type === 'rupees' ? 'number' : f.type === 'datetime' ? 'datetime-local' : f.type ?? 'text';
        return (
          <div key={f.name}>{label}
            <input id={id} type={htmlType} className={inputCls} required={f.required} value={v ?? ''} min={f.min ?? (f.type === 'rupees' ? 0 : undefined)} max={f.max}
              step={f.step ?? (f.type === 'rupees' ? '0.01' : undefined)} placeholder={f.placeholder} onChange={(e) => set(f.name, e.target.value)} />{hint}
          </div>
        );
      })(f)}</div>)}
    </div>
  );
}

const initialValues = (fields: Field[]) => Object.fromEntries(fields.map((f) => [f.name, f.initial ?? (f.type === 'checks' ? [] : f.type === 'checkbox' ? false : '')]));

/** A dialog with a form. Stays open and shows the problem if saving fails. */
export function FormModal({ title, intro, fields, submit, danger, onSubmit, onClose, wide, firstTab = 'Details' }: {
  title: string; intro?: ReactNode; fields: Field[]; submit: string; danger?: boolean; wide?: boolean; firstTab?: string;
  onSubmit: (v: Record<string, any>) => Promise<unknown>; onClose: () => void;
}) {
  const [values, setValues] = useState<Record<string, any>>(() => initialValues(fields));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tabOf = (f: Field) => f.tab ?? firstTab;
  const tabs = [...new Set(fields.map(tabOf))];
  const [tab, setTab] = useState(tabs[0]!);
  return (
    <Modal title={title} onClose={onClose} wide={wide}>
      <form onSubmit={async (e) => {
        e.preventDefault(); setErr(null);
        // Fields on a hidden tab are not checked by the browser, so check them here.
        const empty = fields.find((f) => f.required && (!f.show || f.show(values)) && (values[f.name] === '' || values[f.name] === undefined || (f.type === 'checkbox' && !values[f.name])));
        if (empty) { setTab(tabOf(empty)); setErr(`${empty.type === 'checkbox' ? 'Please tick: ' : 'Please fill in '}${empty.label}${tabs.length > 1 ? ` on the ${tabOf(empty)} tab` : ''}.`); return; }
        setBusy(true);
        try { await onSubmit(values); onClose(); } catch (x) { setErr((x as Error).message); setBusy(false); }
      }}>
        {intro && <div className="mb-4 text-sm text-muted">{intro}</div>}
        {tabs.length > 1 && (
          <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
            {tabs.map((t) => (
              <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
                className={`-mb-px min-h-[40px] border-b-[3px] px-3 text-sm font-semibold ${tab === t ? 'border-ink text-ink' : 'border-transparent text-muted'}`}>{t}</button>
            ))}
          </div>
        )}
        {err && <Notice tone="bad">{err}</Notice>}
        <Fields fields={fields.filter((f) => tabOf(f) === tab)} values={values} set={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button type="button" onClick={onClose}>Cancel</Button>
          <Button type="submit" kind={danger ? 'danger' : 'primary'} busy={busy}>{submit}</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Inline form on a page, for profile steps and the like. */
export function PageForm({ fields, submit, onSubmit }: { fields: Field[]; submit: string; onSubmit: (v: Record<string, any>) => Promise<unknown> }) {
  const [values, setValues] = useState<Record<string, any>>(() => initialValues(fields));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <form className="max-w-md" onSubmit={async (e) => {
      e.preventDefault(); setBusy(true); setErr(null);
      try { await onSubmit(values); } catch (x) { setErr((x as Error).message); } finally { setBusy(false); }
    }}>
      {err && <Notice tone="bad">{err}</Notice>}
      <Fields fields={fields} values={values} set={(n, v) => setValues((s) => ({ ...s, [n]: v }))} />
      <Button className="mt-4" type="submit" kind="primary" busy={busy}>{submit}</Button>
    </form>
  );
}
