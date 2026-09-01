import Link from 'next/link';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { db, fulfilments, listings, orders } from '@/db';
import { formatAmount, marginPct } from '@/lib/money';
import { marginSummary } from '@/lib/queries';
import { CURRENCY } from '@/lib/store';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Overview' };

export default async function AdminOverview() {
  const [summary, counts, queue] = await Promise.all([
    marginSummary(),
    db
      .select({
        status: listings.status,
        n: sql<number>`count(*)::int`,
      })
      .from(listings)
      .groupBy(listings.status),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(fulfilments)
      .where(inArray(fulfilments.status, ['queued', 'failed'])),
  ]);

  const active = counts.find((c) => c.status === 'active')?.n ?? 0;
  const drafts = counts.find((c) => c.status === 'draft')?.n ?? 0;
  const needsAction = queue[0]?.n ?? 0;
  const profit = summary.revenue - summary.cost;

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <h1 className="font-display text-2xl tracking-tight">Overview</h1>

      <div className="mt-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Revenue" value={formatAmount(summary.revenue, CURRENCY)} />
        <Stat
          label="Gross profit"
          value={formatAmount(profit, CURRENCY)}
          sub={summary.revenue > 0 ? `${marginPct(summary.revenue, summary.cost)}% margin` : undefined}
          tone={profit > 0 ? 'good' : profit < 0 ? 'bad' : undefined}
        />
        <Stat label="Orders" value={String(summary.orderCount)} />
        <Stat
          label="Needs fulfilling"
          value={String(needsAction)}
          tone={needsAction > 0 ? 'warn' : undefined}
          href={needsAction > 0 ? '/admin/orders' : undefined}
        />
      </div>

      <div className="mt-8 grid gap-4 lg:grid-cols-2">
        <Card title="Catalogue">
          <p className="text-sm text-ink-soft">
            {active} live {active === 1 ? 'listing' : 'listings'}
            {drafts > 0 && <> · {drafts} in draft waiting to be published</>}
          </p>
          <div className="mt-4 flex gap-2">
            <Link
              href="/admin/research"
              className="rounded-full bg-ink px-4 py-2 text-xs text-white transition hover:bg-black"
            >
              Find products
            </Link>
            <Link
              href="/admin/listings"
              className="rounded-full border border-black/15 px-4 py-2 text-xs transition hover:border-black/30"
            >
              Manage listings
            </Link>
          </div>
        </Card>

        <Card title="Margin health">
          {summary.orderCount === 0 ? (
            <p className="text-sm text-ink-soft">
              No orders yet. Once they arrive, realised margin per order shows here against
              what the scorer predicted at listing time.
            </p>
          ) : (
            <p className="text-sm text-ink-soft">
              {formatAmount(Math.round(profit / summary.orderCount), CURRENCY)} average gross
              profit per order, before advertising. Compare that against the CAC assumption in{' '}
              <code className="rounded bg-black/5 px-1 py-0.5 text-xs">
                src/engine/scoring/economics.ts
              </code>{' '}
              — if your real CPA is higher, every score is optimistic.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  tone,
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: 'good' | 'bad' | 'warn';
  href?: string;
}) {
  const toneClass =
    tone === 'good'
      ? 'text-good'
      : tone === 'bad'
        ? 'text-bad'
        : tone === 'warn'
          ? 'text-warn'
          : '';

  const body = (
    <div className="rounded-lg border border-black/10 bg-white/60 p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl tabular-nums ${toneClass}`}>{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted">{sub}</p>}
    </div>
  );

  return href ? (
    <Link href={href} className="transition hover:opacity-80">
      {body}
    </Link>
  ) : (
    body
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-black/10 bg-white/60 p-5">
      <h2 className="text-sm font-medium">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}
