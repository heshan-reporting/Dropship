import type { Metadata } from 'next';
import { STORE } from '@/lib/store';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${STORE.name} — ${STORE.tagline}`, template: `%s · ${STORE.name}` },
  description: STORE.tagline,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
