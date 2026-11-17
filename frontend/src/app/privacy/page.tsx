import Link from 'next/link';
import { Logo } from '@/components/Logo';
const BRAND = process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Lotus Electronics Supermarket';
export const metadata = { title: `Privacy policy | ${BRAND}` };
export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12 leading-relaxed">
      <Link href="/" aria-label="Home"><Logo /></Link>
      <h1 className="display mb-2 mt-8">Privacy policy</h1>
      <p className="mb-6 text-muted">How Lotus Electronics Supermarket handles information from creators who join its store campaigns.</p>
      <div className="space-y-5">
        <section><h2 className="display mb-1">What we collect</h2><p>Your name, email, mobile number, city and, if you allow it, your location. Your PAN and bank account details. The Instagram or YouTube account you connect, and the links you submit.</p></section>
        <section><h2 className="display mb-1">What we read from Instagram and YouTube</h2><p>Your account name and follower count, and for your own posts: the link, caption, publish date, likes, comments, views and reach. We never post, comment or message for you.</p></section>
        <section><h2 className="display mb-1">Why we use it</h2><p>To confirm your submitted post is live on your own account, work out your pay, deduct tax as the law requires, pay you, and let nearby stores find you. We do not sell your information or use it for advertising.</p></section>
        <section><h2 className="display mb-1">Who can see it</h2><p>Company admins. Store teams see only your name, mobile number and visit details. Only admins can see your bank details and full PAN. We share what is legally required with tax authorities and our bank, to pay you.</p></section>
        <section><h2 className="display mb-1">How we protect it</h2><p>PAN, bank account numbers and Instagram connection tokens are stored encrypted. Staff actions on money and bank details are logged.</p></section>
        <section><h2 className="display mb-1">How long we keep it</h2><p>While your account is active, and after that only as long as tax and accounting laws require. You can disconnect Instagram at any time from your Instagram settings.</p></section>
        <section><h2 className="display mb-1">Deleting your data</h2><p>See <Link className="text-link underline" href="/data-deletion">how to request deletion</Link>.</p></section>
      </div>
    </main>
  );
}
