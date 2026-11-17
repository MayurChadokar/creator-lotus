import { Shell } from '@/components/Shell';
const NAV = [{ href: '/manager', label: 'Store visits' }];
export default function L({ children }: { children: React.ReactNode }) {
  return <Shell role="STORE_MANAGER" portal="Store team" nav={NAV}>{children}</Shell>;
}
