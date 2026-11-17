import type { Metadata, Viewport } from 'next';
import { ToastHost } from '@/components/ui';
import './globals.css';

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_BRAND_NAME ?? 'Lotus Electronics Supermarket',
  description: 'Local creator campaigns at Lotus Electronics Supermarket',
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en-IN"><body><ToastHost>{children}</ToastHost></body></html>;
}
