'use client';
import Link from 'next/link';
import { Logo } from '@/components/Logo';
import { useRouter } from 'next/navigation';
import { api, setToken, useApi } from '@/lib/api';
import { Loaded, PageForm } from '@/components/ui';

export default function Register() {
  const router = useRouter();
  const stores = useApi<any[]>('/public/stores');
  return (
    <main className="login-page min-h-dvh bg-[#f4f8f8] px-5 py-6 sm:px-8">
      <header className="relative mx-auto flex w-full max-w-6xl flex-col items-center gap-3 sm:min-h-16 sm:justify-center"><Link href="/" aria-label="Home"><Logo large /></Link><Link href="/" className="text-sm font-semibold text-[#35645f] hover:text-[#116d6c] sm:absolute sm:right-0">← Back to home</Link></header>
      <div className="mx-auto my-10 w-full max-w-[500px] overflow-hidden rounded-lg border border-[#dce7e6] bg-white shadow-[0_10px_30px_rgba(20,65,65,0.06)]">
      <div className="h-1 bg-[#299c9b]" />
      <div className="px-6 py-8 sm:px-9 sm:py-9">
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#168b8e]">Lotus Creator Network</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight text-[#17365a]">Join as a creator</h1>
      <p className="mb-7 mt-2 text-sm leading-6 text-[#65798a]">Create your account to get started. You can add your PAN and payout details next.</p>
      <Loaded state={stores}>
        {stores.data && <PageForm submit="Create account" fields={[
          { name: 'fullName', label: 'Full name', required: true },
          { name: 'email', label: 'Email', type: 'email', required: true },
          { name: 'phone', label: 'Mobile number', required: true, placeholder: '10 digits', hint: 'We send campaign and payment updates here.' },
          { name: 'homeStoreId', label: 'Your nearest store', type: 'select', required: true, options: stores.data.map((s) => ({ value: s.id, label: `${s.name}, ${s.city}` })), hint: 'Where you will usually visit to film.' },
          { name: 'city', label: 'City' },
          { name: 'password', label: 'Password', type: 'password', required: true, hint: 'At least 10 characters.' },
          { name: 'consent', label: 'I agree to my details, PAN and bank details being used as the privacy policy explains.', type: 'checkbox' },
        ]} onSubmit={async (v) => {
          if (!v.consent) throw new Error('Please agree to the privacy policy to join.');
          // Location is optional: it lets nearby stores find you, and the form works without it.
          const pos = await new Promise<GeolocationPosition | null>((ok) => {
            if (!navigator.geolocation) return ok(null);
            navigator.geolocation.getCurrentPosition(ok, () => ok(null), { timeout: 6000 });
          });
          const r = await api('/auth/register', 'POST', {
            fullName: v.fullName, email: v.email, phone: v.phone, homeStoreId: v.homeStoreId, city: v.city || undefined, password: v.password, acceptPrivacy: true,
            latitude: pos?.coords.latitude, longitude: pos?.coords.longitude,
          });
          setToken(r.token);
          router.replace('/creator/profile');
        }} />}
      </Loaded>
      <p className="mt-5 text-sm"><Link className="font-semibold text-[#147f80] hover:underline" href="/privacy" target="_blank" rel="noreferrer">Read the privacy policy</Link></p>
      <div className="mt-7 border-t border-[#e5eeec] pt-6 text-sm text-[#65798a]">Already joined? <Link className="font-semibold text-[#147f80] hover:underline" href="/login">Log in</Link></div>
      </div></div>
      <p className="text-center text-xs text-[#758a89]">Lotus Electronics Supermarket · Creator Network</p>
    </main>
  );
}
