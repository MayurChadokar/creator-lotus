import { Shell } from '@/components/Shell';
const NAV = [
  { href: '/creator', label: 'Earnings' }, { href: '/creator/campaigns', label: 'Campaigns' }, { href: '/creator/visits', label: 'Visits' },
  { href: '/creator/help', label: 'Help' }, { href: '/creator/profile', label: 'Profile' },
];
export default function L({ children }: { children: React.ReactNode }) {
  return <Shell role="INFLUENCER" portal="Creator portal" nav={NAV}>{children}</Shell>;
}
