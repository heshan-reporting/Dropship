import Link from 'next/link';
import { redirect } from 'next/navigation';
import { adminConfigured, isAuthenticated } from '@/lib/auth';
import { STORE } from '@/lib/store';

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/research', label: 'Research' },
  { href: '/admin/listings', label: 'Listings' },
  { href: '/admin/orders', label: 'Orders' },
];

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Refusing to render is the safe failure here: an unset password must never
  // mean an open admin area.
  if (!adminConfigured()) {
    return (
      <div className="mx-auto max-w-lg px-5 py-24">
        <h1 className="font-display text-2xl">Admin is locked</h1>
        <p className="mt-3 text-sm text-ink-soft">
          Set <code className="rounded bg-black/5 px-1.5 py-0.5">ADMIN_PASSWORD</code> in your
          environment, then reload. Until then the admin area stays closed rather than open.
        </p>
      </div>
    );
  }

  // Login lives outside /admin so it does not inherit this layout and loop.
  if (!(await isAuthenticated())) redirect('/login');

  return (
    <div className="flex min-h-screen flex-col">
      <header className="border-b border-black/5 bg-white/50">
        <div className="mx-auto flex max-w-7xl items-center gap-8 px-5 py-3">
          <Link href="/admin" className="font-display text-lg">
            {STORE.name}
            <span className="ml-2 text-xs text-muted">admin</span>
          </Link>
          <nav className="flex flex-1 gap-1">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded px-3 py-1.5 text-sm text-ink-soft transition hover:bg-black/5 hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <Link href="/" className="text-xs text-muted hover:text-ink">
            View store →
          </Link>
        </div>
      </header>
      <main className="flex-1">{children}</main>
    </div>
  );
}
