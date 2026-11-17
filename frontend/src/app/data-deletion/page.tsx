import Link from 'next/link';
import { Logo } from '@/components/Logo';
const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Lotus Electronics Supermarket';
export const metadata = { title: `Delete your data | ${BRAND}` };
export default function DataDeletion() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 leading-relaxed">
      <Link href="/" aria-label="Home"><Logo /></Link>
      <h1 className="display mb-6 mt-8">Delete your data</h1>
      <ol className="list-decimal space-y-3 pl-5">
        <li>Log in and open Help.</li>
        <li>Raise a ticket with the subject &quot;Delete my data&quot;.</li>
        <li>We remove your bank details, Instagram connection and contact details, and close your account. Any unpaid amount must be settled first. We confirm by replying on the ticket within 30 days.</li>
      </ol>
      <p className="mt-6">To stop access straight away, remove this app in Instagram under Settings, Apps and websites.</p>
      <p className="mt-3 text-muted">Tax and payment records are kept for as long as the law requires.</p>
    </main>
  );
}
