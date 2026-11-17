'use client';
import { useRouter } from 'next/navigation';
import { Logo } from '@/components/Logo';
import { api, homeFor, setToken } from '@/lib/api';
import { PageForm } from '@/components/ui';

export default function ChangePassword() {
  const router = useRouter();
  return (
    <main className="mx-auto max-w-md px-4 py-12">
      <Logo />
      <h1 className="display mb-2 mt-8">Choose your own password</h1>
      <p className="mb-6 text-muted">You were given a temporary password. Replace it to continue.</p>
      <PageForm submit="Save password" fields={[
        { name: 'current', label: 'Temporary password', type: 'password', required: true },
        { name: 'next', label: 'New password', type: 'password', required: true, hint: 'At least 10 characters.' },
      ]} onSubmit={async (v) => {
        const r = await api('/auth/change-password', 'POST', { current: v.current, next: v.next });
        setToken(r.token); router.replace(homeFor(r.role));
      }} />
    </main>
  );
}
