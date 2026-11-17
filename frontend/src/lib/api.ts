'use client';
// Talks to the backend and keeps the login session in this browser.
import { useCallback, useEffect, useState } from 'react';

export const API = process.env.NEXT_PUBLIC_API_URL ?? '/api';
export const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Lotus Electronics Supermarket';
const KEY = 'session-token';

export type Role = 'ADMIN' | 'STORE_MANAGER' | 'INFLUENCER';
export const homeFor = (r: Role) => (r === 'ADMIN' ? '/admin' : r === 'STORE_MANAGER' ? '/manager' : '/creator');

export function getToken(): string | null {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
export function setToken(t: string | null) {
  try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* private browsing */ }
}
export function currentRole(): Role | null {
  const t = getToken();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return p.exp * 1000 > Date.now() ? p.role : null;
  } catch { return null; }
}

export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string, public fields?: Record<string, string[]>) { super(message); }
}

async function raw(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getToken();
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { ...(init.body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers },
    });
  } catch {
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }
  if (!res.ok) {
    const b = await res.json().catch(() => ({}));
    if (res.status === 401 && token && typeof window !== 'undefined' && b.code !== 'BAD_LOGIN') {
      setToken(null);
      window.location.href = '/login';
    }
    if (b.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined' && !window.location.pathname.startsWith('/change-password')) {
      window.location.href = '/change-password';
    }
    const first = b.fields ? (Object.values(b.fields).flat() as string[])[0] : undefined;
    throw new ApiError(first ?? b.error ?? 'That did not work. Try again.', res.status, b.code, b.fields);
  }
  return res;
}
export async function api<T = any>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const res = await raw(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  return res.json();
}
export async function download(path: string, filename: string) {
  const res = await raw(path);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
  return Number(res.headers.get('X-Skipped-Payments') ?? 0);
}

export function useApi<T = any>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const reload = useCallback(async () => {
    if (!path) return;
    try { setData(await api<T>(path)); setError(null); }
    catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }, [path]);
  useEffect(() => { reload(); }, [reload]);
  return { data, error, loading, reload };
}

export const rupees = (paise: number | null | undefined, decimals = true) =>
  paise === null || paise === undefined ? '-' :
  '₹' + (Number(paise) / 100).toLocaleString('en-IN', decimals ? { minimumFractionDigits: 2, maximumFractionDigits: 2 } : { maximumFractionDigits: 0 });
export const toPaise = (v: string | number) => Math.round(Number(v) * 100);
export const fromPaise = (p: number) => String(p / 100);
export const count = (n: number | null | undefined) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('en-IN'));
export const percent = (bps: number | null | undefined) => (bps === null || bps === undefined ? '-' : `${(bps / 100).toFixed(2)}%`);
export const date = (d: string | null | undefined) =>
  d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' }) : '-';
export const toIso = (local: string) => new Date(local).toISOString();
