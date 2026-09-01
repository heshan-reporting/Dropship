import Link from 'next/link';
import { STORE } from '@/lib/store';
import CartButton from './cart-button';

export default function StoreLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-20 border-b border-black/5 bg-bone/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
          <Link href="/" className="flex items-baseline gap-2">
            <span className="font-display text-2xl tracking-tight">
              {STORE.name}
            </span>
            <span className="hidden text-xs text-muted sm:inline">{STORE.tagline}</span>
          </Link>
          <CartButton />
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <footer className="border-t border-black/5 py-10">
        <div className="mx-auto max-w-6xl px-5 text-sm text-ink-soft">
          <p className="font-display text-lg text-ink">{STORE.name}</p>
          <p className="mt-1">{STORE.tagline}</p>
          <p className="mt-4 text-xs text-muted">
            Questions? {STORE.supportEmail}
          </p>
        </div>
      </footer>
    </div>
  );
}
