import { Shell } from '@/components/Shell';
const NAV = [
  { href: '/admin', label: 'Campaigns' }, { href: '/admin/payments', label: 'Payments' }, { href: '/admin/creators', label: 'Creators' },
  { href: '/admin/matrix', label: 'Pay rates' }, { href: '/admin/visits', label: 'Store visits' }, { href: '/admin/review', label: 'Reviews and disputes' }, { href: '/admin/sharing', label: 'Share on our pages' }, { href: '/admin/audit', label: 'Audit log' },
];
export default function L({ children }: { children: React.ReactNode }) {
  return <Shell role="ADMIN" portal="Master admin" nav={NAV}>{children}</Shell>;
}
