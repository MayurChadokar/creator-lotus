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
    <main className="mx-auto max-w-md px-4 py-12">
      <Link href="/" aria-label="Home"><Logo /></Link>
      <h1 className="display mb-2 mt-8">Join as a creator</h1>
      <p className="mb-6 text-muted">Takes about a minute. You will add your PAN and payout details next.</p>
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
      <p className="mt-4 text-sm"><Link className="text-link underline" href="/privacy" target="_blank">Read the privacy policy</Link></p>
      <p className="mt-6 text-muted">Already joined? <Link className="text-link underline" href="/login">Log in</Link>.</p>
    </main>
  );
}
