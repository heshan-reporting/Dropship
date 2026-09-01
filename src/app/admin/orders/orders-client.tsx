'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatAmount, marginPct } from '@/lib/money';

interface Fulfilment {
  id: string;
  provider: string;
  status: string;
  externalId: string | null;
  trackingNumber: string | null;
  trackingUrl: string | null;
  lastError: string | null;
}

interface Item {
  id: string;
  title: string;
  quantity: number;
  unitPriceAmount: number;
  unitCostAmount: number;
  currency: string;
  fulfilmentProvider: string;
}

interface Order {
  id: string;
  orderNumber: string;
  email: string;
  status: string;
  currency: string;
  totalAmount: number;
  costAmount: number;
  createdAt: string;
  address: Record<string, string> | null;
  items: Item[];
  fulfilments: Fulfilment[];
}

export default function OrdersClient({ orders }: { orders: Order[] }) {
  const needsWork = orders.filter((o) =>
    o.fulfilments.some((f) => f.status === 'queued' || f.status === 'failed'),
  );

  return (
    <div className="mx-auto max-w-5xl px-5 py-8">
      <div className="flex items-baseline justify-between">
        <h1 className="font-display text-2xl tracking-tight">Orders</h1>
        {needsWork.length > 0 && (
          <p className="text-sm text-warn">
            {needsWork.length} {needsWork.length === 1 ? 'order needs' : 'orders need'} action
          </p>
        )}
      </div>

      {orders.length === 0 ? (
        <p className="mt-6 text-sm text-ink-soft">
          No orders yet. They appear here the moment Stripe confirms a payment.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {orders.map((o) => (
            <OrderCard key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

function OrderCard({ order }: { order: Order }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [open, setOpen] = useState(
    order.fulfilments.some((f) => f.status === 'queued' || f.status === 'failed'),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const margin = marginPct(order.totalAmount, order.costAmount);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/fulfilment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.error ?? 'Action failed');
      else startTransition(() => router.refresh());
    } catch {
      setError('Could not reach the server.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 bg-white/60">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-4 px-4 py-3 text-left"
      >
        <span className="font-mono text-sm">{order.orderNumber}</span>
        <StatusPill status={order.status} />
        <span className="flex-1 truncate text-xs text-muted">{order.email}</span>
        <span className="text-sm tabular-nums">
          {formatAmount(order.totalAmount, order.currency)}
        </span>
        <span
          className={`w-12 text-right text-xs tabular-nums ${
            margin < 30 ? 'text-warn' : 'text-good'
          }`}
        >
          {margin}%
        </span>
      </button>

      {open && (
        <div className="space-y-4 border-t border-black/5 px-4 py-4">
          <ul className="space-y-1 text-sm">
            {order.items.map((i) => (
              <li key={i.id} className="flex justify-between gap-4">
                <span className="text-ink-soft">
                  {i.quantity}× {i.title}
                </span>
                <span className="tabular-nums text-muted">
                  {formatAmount(i.unitCostAmount * i.quantity, i.currency)} cost →{' '}
                  {formatAmount(i.unitPriceAmount * i.quantity, i.currency)}
                </span>
              </li>
            ))}
          </ul>

          {order.address && (
            <p className="text-xs leading-relaxed text-muted">
              {[
                `${order.address.firstName ?? ''} ${order.address.lastName ?? ''}`.trim(),
                order.address.address1,
                order.address.address2,
                order.address.city,
                order.address.region,
                order.address.postcode,
                order.address.country,
              ]
                .filter(Boolean)
                .join(', ')}
            </p>
          )}

          {order.fulfilments.map((f) => (
            <FulfilmentRow key={f.id} fulfilment={f} busy={busy} onAct={act} />
          ))}

          {error && <p className="text-sm text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}

function FulfilmentRow({
  fulfilment,
  busy,
  onAct,
}: {
  fulfilment: Fulfilment;
  busy: boolean;
  onAct: (body: Record<string, unknown>) => Promise<void>;
}) {
  const [tracking, setTracking] = useState(fulfilment.trackingNumber ?? '');
  const automatic = fulfilment.provider !== 'manual';

  return (
    <div className="rounded border border-black/10 bg-bone p-3">
      <div className="flex items-center gap-3">
        <span className="text-xs uppercase tracking-wide text-muted">
          {fulfilment.provider}
        </span>
        <StatusPill status={fulfilment.status} />
        {fulfilment.externalId && (
          <span className="font-mono text-[10px] text-muted">
            {fulfilment.externalId}
          </span>
        )}
      </div>

      {fulfilment.lastError && (
        <p className="mt-2 text-xs text-bad">{fulfilment.lastError}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {automatic && fulfilment.externalId && (
          <button
            onClick={() => void onAct({ action: 'sync', fulfilmentId: fulfilment.id })}
            disabled={busy}
            className="rounded-full border border-black/15 px-3 py-1 text-xs transition hover:border-black/30 disabled:opacity-50"
          >
            Check status
          </button>
        )}

        {fulfilment.status !== 'shipped' && (
          <>
            <input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="Tracking number"
              className="w-44 rounded border border-black/15 bg-white px-2 py-1 text-xs"
            />
            <button
              onClick={() =>
                void onAct({
                  action: 'update',
                  fulfilmentId: fulfilment.id,
                  trackingNumber: tracking,
                  status: 'shipped',
                })
              }
              disabled={busy || !tracking.trim()}
              className="rounded-full bg-ink px-3 py-1 text-xs text-white transition hover:bg-black disabled:opacity-40"
            >
              Mark shipped
            </button>
          </>
        )}

        {fulfilment.trackingUrl && (
          <a
            href={fulfilment.trackingUrl}
            target="_blank"
            rel="noreferrer"
            className="text-xs underline underline-offset-4"
          >
            Track →
          </a>
        )}
      </div>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone: Record<string, string> = {
    paid: 'bg-blue-100 text-blue-800',
    fulfilling: 'bg-amber-100 text-amber-800',
    queued: 'bg-amber-100 text-amber-800',
    submitted: 'bg-blue-100 text-blue-800',
    shipped: 'bg-green-100 text-green-800',
    failed: 'bg-red-100 text-red-800',
    cancelled: 'bg-stone-200 text-stone-700',
    refunded: 'bg-stone-200 text-stone-700',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone[status] ?? 'bg-stone-200 text-stone-700'}`}>
      {status}
    </span>
  );
}
