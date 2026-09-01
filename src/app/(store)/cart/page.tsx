'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { clearCart, onCartChange, readCart, setQuantity } from '@/lib/cart';
import { formatAmount } from '@/lib/money';

interface ResolvedLine {
  listingId: string;
  title: string;
  image: string | null;
  quantity: number;
  unitPriceAmount: number;
  currency: string;
}

interface ResolvedCart {
  lines: ResolvedLine[];
  currency: string;
  subtotal: number;
  shipping: number;
  total: number;
}

export default function CartPage() {
  const [cart, setCart] = useState<ResolvedCart | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Every price shown here comes back from the server. The browser only ever
  // supplies ids and quantities, so a tampered cart cannot change what is owed.
  const refresh = useCallback(async () => {
    const lines = readCart();
    if (lines.length === 0) {
      setCart({ lines: [], currency: 'USD', subtotal: 0, shipping: 0, total: 0 });
      return;
    }
    try {
      const res = await fetch('/api/cart', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines }),
      });
      setCart(await res.json());
    } catch {
      setError('Could not load your cart. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    void refresh();
    return onCartChange(() => void refresh());
  }, [refresh]);

  async function checkout() {
    setCheckingOut(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lines: readCart() }),
      });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error ?? 'Could not start checkout.');
        setCheckingOut(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError('Could not reach checkout. Try again in a moment.');
      setCheckingOut(false);
    }
  }

  if (!cart) {
    return <p className="mx-auto max-w-3xl px-5 py-24 text-sm text-muted">Loading…</p>;
  }

  if (cart.lines.length === 0) {
    return (
      <div className="mx-auto max-w-3xl px-5 py-24 text-center">
        <h1 className="font-display text-3xl">Your cart is empty</h1>
        <Link
          href="/"
          className="mt-8 inline-block rounded-full bg-ink px-6 py-3 text-sm text-white transition hover:bg-black"
        >
          Browse the shop
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-5 py-12 lg:py-20">
      <h1 className="font-display text-3xl tracking-tight">Your cart</h1>

      <ul className="mt-10 divide-y divide-black/5">
        {cart.lines.map((line) => (
          <li key={line.listingId} className="flex gap-4 py-5">
            <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-bone-dark">
              {line.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={line.image} alt="" className="h-full w-full object-cover" />
              )}
            </div>

            <div className="flex flex-1 flex-col justify-between">
              <div className="flex justify-between gap-4">
                <p className="text-sm leading-snug">{line.title}</p>
                <p className="shrink-0 text-sm">
                  {formatAmount(line.unitPriceAmount * line.quantity, line.currency)}
                </p>
              </div>

              <div className="flex items-center gap-3">
                <label className="sr-only" htmlFor={`qty-${line.listingId}`}>
                  Quantity
                </label>
                <select
                  id={`qty-${line.listingId}`}
                  value={line.quantity}
                  onChange={(e) => setQuantity(line.listingId, Number(e.target.value))}
                  className="rounded border border-black/10 bg-transparent px-2 py-1 text-sm"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => setQuantity(line.listingId, 0)}
                  className="text-xs text-muted underline underline-offset-4 hover:text-ink"
                >
                  Remove
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>

      <dl className="mt-8 space-y-2 border-t border-black/5 pt-6 text-sm">
        <Row label="Subtotal" value={formatAmount(cart.subtotal, cart.currency)} />
        <Row
          label="Shipping"
          value={cart.shipping === 0 ? 'Free' : formatAmount(cart.shipping, cart.currency)}
        />
        <div className="flex justify-between border-t border-black/5 pt-3 text-base">
          <dt>Total</dt>
          <dd>{formatAmount(cart.total, cart.currency)}</dd>
        </div>
        <p className="pt-1 text-xs text-muted">Taxes calculated at checkout.</p>
      </dl>

      {error && <p className="mt-6 text-sm text-bad">{error}</p>}

      <button
        onClick={checkout}
        disabled={checkingOut}
        className="mt-8 w-full rounded-full bg-ink px-6 py-3.5 text-sm text-white transition hover:bg-black disabled:opacity-50"
      >
        {checkingOut ? 'Taking you to checkout…' : 'Checkout'}
      </button>

      <div className="mt-4 flex items-center justify-between text-xs text-muted">
        <span>Payment is handled securely by Stripe.</span>
        <button onClick={() => clearCart()} className="underline underline-offset-4">
          Empty cart
        </button>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-soft">{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
