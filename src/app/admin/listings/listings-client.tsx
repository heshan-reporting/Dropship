'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { formatAmount, marginPct } from '@/lib/money';

interface Row {
  id: string;
  slug: string;
  title: string;
  image: string | null;
  costAmount: number;
  priceAmount: number;
  currency: string;
  status: string;
  fulfilmentProvider: string;
  providerVariantId: string | null;
}

export default function ListingsClient({ listings }: { listings: Row[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function patch(id: string, body: Record<string, unknown>) {
    const res = await fetch('/api/listings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, ...body }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? 'Update failed');
      return;
    }
    setError(null);
    startTransition(() => router.refresh());
  }

  if (listings.length === 0) {
    return (
      <div className="mx-auto max-w-7xl px-5 py-8">
        <h1 className="font-display text-2xl tracking-tight">Listings</h1>
        <p className="mt-4 text-sm text-ink-soft">
          Nothing listed yet. Publish something from Research to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <h1 className="font-display text-2xl tracking-tight">Listings</h1>
      {error && <p className="mt-3 text-sm text-bad">{error}</p>}

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[52rem] text-sm">
          <thead>
            <tr className="border-b border-black/10 text-left text-xs text-muted">
              <th className="pb-2 font-normal">Product</th>
              <th className="pb-2 font-normal">Cost</th>
              <th className="pb-2 font-normal">Price</th>
              <th className="pb-2 font-normal">Margin</th>
              <th className="pb-2 font-normal">Fulfilment</th>
              <th className="pb-2 font-normal">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {listings.map((l) => (
              <ListingRow key={l.id} row={l} onPatch={patch} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ListingRow({
  row,
  onPatch,
}: {
  row: Row;
  onPatch: (id: string, body: Record<string, unknown>) => Promise<void>;
}) {
  const [price, setPrice] = useState((row.priceAmount / 100).toFixed(2));
  const [variant, setVariant] = useState(row.providerVariantId ?? '');
  const margin = marginPct(row.priceAmount, row.costAmount);

  // Printify cannot place an order without a variant id, so a listing that
  // claims automatic fulfilment while missing one would fail at the worst
  // possible moment — after the customer has paid.
  const blocked = row.fulfilmentProvider === 'printify' && !row.providerVariantId;

  return (
    <tr className="align-middle">
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 overflow-hidden rounded bg-bone-dark">
            {row.image && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={row.image} alt="" className="h-full w-full object-cover" />
            )}
          </div>
          <div className="min-w-0">
            <p className="max-w-xs truncate">{row.title}</p>
            <a
              href={`/product/${row.slug}`}
              className="text-xs text-muted underline underline-offset-2"
            >
              /{row.slug}
            </a>
          </div>
        </div>
      </td>

      <td className="py-3 pr-4 tabular-nums text-ink-soft">
        {formatAmount(row.costAmount, row.currency)}
      </td>

      <td className="py-3 pr-4">
        <input
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          onBlur={() => {
            const next = Math.round(Number.parseFloat(price) * 100);
            if (Number.isFinite(next) && next !== row.priceAmount) {
              void onPatch(row.id, { priceAmount: next });
            }
          }}
          className="w-20 rounded border border-black/15 bg-white px-2 py-1 text-sm tabular-nums"
        />
      </td>

      <td className="py-3 pr-4">
        <span className={margin < 40 ? 'text-warn' : 'text-good'}>
          {margin}%
        </span>
      </td>

      <td className="py-3 pr-4">
        {row.fulfilmentProvider === 'printify' ? (
          <div>
            <input
              value={variant}
              onChange={(e) => setVariant(e.target.value)}
              onBlur={() => {
                if (variant !== (row.providerVariantId ?? '')) {
                  void onPatch(row.id, { providerVariantId: variant });
                }
              }}
              placeholder="variant id"
              className={`w-28 rounded border bg-white px-2 py-1 text-xs ${
                blocked ? 'border-bad' : 'border-black/15'
              }`}
            />
            {blocked && (
              <p className="mt-1 text-[10px] text-bad">Needed before going live</p>
            )}
          </div>
        ) : (
          <span className="text-xs text-muted">manual</span>
        )}
      </td>

      <td className="py-3">
        <select
          value={row.status}
          onChange={(e) => void onPatch(row.id, { status: e.target.value })}
          disabled={blocked && row.status !== 'active'}
          className="rounded border border-black/15 bg-white px-2 py-1 text-xs disabled:opacity-50"
        >
          <option value="draft">Draft</option>
          <option value="active">Active</option>
          <option value="archived">Archived</option>
        </select>
      </td>
    </tr>
  );
}
