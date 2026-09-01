'use client';

import { useEffect, useState } from 'react';
import { formatAmount } from '@/lib/money';

interface Flag {
  severity: 'blocker' | 'warning' | 'note';
  code: string;
  message: string;
}

interface Factor {
  name: string;
  value: number;
  weight: number;
  note: string;
}

interface Money {
  amount: number;
  currency: string;
}

interface Scored {
  id: string;
  title: string;
  url: string;
  images: string[];
  marketplace: string;
  price: Money;
  sourceCount?: number;
  score: {
    total: number;
    rawTotal: number;
    factors: Factor[];
    flags: Flag[];
    confidence: number;
    unknowns: string[];
    economics: {
      suggestedRetail: Money;
      shipping: Money;
      estimatedCac: Money;
      contributionMargin: Money;
      breakEvenCac: Money;
      viable: boolean;
    };
  };
}

interface SourceStatus {
  id: string;
  label: string;
  kind: string;
  configured: boolean;
}

export default function ResearchClient() {
  const [term, setTerm] = useState('');
  const [products, setProducts] = useState<Scored[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ elapsedMs: number; queried: string[]; skipped: string[] } | null>(null);
  const [sources, setSources] = useState<SourceStatus[]>([]);
  const [published, setPublished] = useState<Record<string, string>>({});

  useEffect(() => {
    fetch('/api/research')
      .then((r) => r.json())
      .then((d) => setSources(d.status ?? []))
      .catch(() => {});
  }, []);

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ term }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'Search failed');
        setProducts(null);
      } else {
        setProducts(data.products);
        setMeta({
          elapsedMs: data.elapsedMs,
          queried: data.sourcesQueried ?? [],
          skipped: data.sourcesSkipped ?? [],
        });
      }
    } catch {
      setError('Could not reach the search endpoint.');
    } finally {
      setLoading(false);
    }
  }

  async function publish(product: Scored) {
    const res = await fetch('/api/listings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ product, score: product.score }),
    });
    const data = await res.json();
    if (res.ok) setPublished((p) => ({ ...p, [product.id]: data.slug }));
    else setError(data.error ?? 'Could not publish');
  }

  const configured = sources.filter((s) => s.configured);

  return (
    <div className="mx-auto max-w-7xl px-5 py-8">
      <form onSubmit={search} className="flex gap-3">
        <input
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          placeholder="Search products — try “dog hoodie” or “pet portrait”"
          className="flex-1 rounded-full border border-black/15 bg-white px-5 py-3 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          disabled={loading}
          className="rounded-full bg-ink px-6 py-3 text-sm text-white transition hover:bg-black disabled:opacity-50"
        >
          {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        {sources.map((s) => (
          <span key={s.id} className={s.configured ? 'text-good' : undefined}>
            {s.configured ? '●' : '○'} {s.label}
          </span>
        ))}
        {sources.length > 0 && configured.length === 0 && (
          <span className="text-warn">
            No credentials set — add supplier keys to .env to search.
          </span>
        )}
      </div>

      {error && <p className="mt-6 text-sm text-bad">{error}</p>}

      {meta && (
        <p className="mt-6 text-xs text-muted">
          {products?.length ?? 0} results in {meta.elapsedMs}ms
          {meta.queried.length > 0 && <> · queried {meta.queried.join(', ')}</>}
          {meta.skipped.length > 0 && <> · skipped {meta.skipped.join(', ')}</>}
        </p>
      )}

      <div className="mt-6 space-y-3">
        {products?.map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            publishedSlug={published[p.id]}
            onPublish={() => publish(p)}
          />
        ))}
      </div>

      {products?.length === 0 && (
        <p className="mt-16 text-center text-sm text-muted">
          Nothing came back for that. Try a broader term.
        </p>
      )}
    </div>
  );
}

function ProductRow({
  product,
  publishedSlug,
  onPublish,
}: {
  product: Scored;
  publishedSlug?: string;
  onPublish: () => void;
}) {
  const [open, setOpen] = useState(false);
  const { score } = product;
  const e = score.economics;
  const capped = score.total < score.rawTotal;

  return (
    <div className="rounded-lg border border-black/10 bg-white/60">
      <div className="flex items-start gap-4 p-4">
        <div className="h-20 w-20 shrink-0 overflow-hidden rounded bg-bone-dark">
          {product.images[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={product.images[0]} alt="" className="h-full w-full object-cover" />
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="truncate text-sm">{product.title}</p>
              <p className="mt-1 text-xs text-muted">
                {product.marketplace}
                {product.sourceCount && product.sourceCount > 1 && (
                  <> · {product.sourceCount} suppliers</>
                )}
                {' · '}
                <a href={product.url} target="_blank" rel="noreferrer" className="underline">
                  source
                </a>
              </p>
            </div>

            <ScoreBadge total={score.total} capped={capped} raw={score.rawTotal} />
          </div>

          <p className="mt-2 text-xs text-ink-soft">
            {formatAmount(product.price.amount, product.price.currency)} cost →{' '}
            {formatAmount(e.suggestedRetail.amount, e.suggestedRetail.currency)} retail ·{' '}
            <span className={e.viable ? 'text-good' : 'text-bad'}>
              {e.viable ? '+' : ''}
              {formatAmount(e.contributionMargin.amount, e.contributionMargin.currency)}/order
            </span>{' '}
            after {formatAmount(e.estimatedCac.amount, e.estimatedCac.currency)} CAC
          </p>

          {score.flags.length > 0 && (
            <ul className="mt-2 space-y-1">
              {score.flags.map((f, i) => (
                <li
                  key={i}
                  className={`text-xs ${
                    f.severity === 'blocker'
                      ? 'text-bad'
                      : f.severity === 'warning'
                        ? 'text-warn'
                        : 'text-muted'
                  }`}
                >
                  {f.severity === 'blocker' ? '✗' : f.severity === 'warning' ? '!' : '·'}{' '}
                  {f.message}
                </li>
              ))}
            </ul>
          )}

          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={() => setOpen((v) => !v)}
              className="text-xs text-muted underline underline-offset-4 hover:text-ink"
            >
              {open ? 'Hide breakdown' : 'Why this score'}
            </button>

            {publishedSlug ? (
              <a
                href={`/product/${publishedSlug}`}
                className="text-xs text-good underline underline-offset-4"
              >
                Listed as draft →
              </a>
            ) : (
              <button
                onClick={onPublish}
                className="rounded-full border border-black/15 px-3 py-1 text-xs transition hover:border-black/30"
              >
                Publish as draft
              </button>
            )}
          </div>
        </div>
      </div>

      {open && (
        <div className="border-t border-black/5 px-4 py-4">
          <div className="space-y-2.5">
            {score.factors.map((f) => (
              <div key={f.name} className="grid grid-cols-[7rem_3rem_1fr] items-center gap-3">
                <span className="text-xs text-ink-soft">{f.name}</span>
                <span className="text-right text-xs tabular-nums">
                  {Math.round(f.value * 100)}%
                </span>
                <div className="flex items-center gap-3">
                  <div
                    className="score-bar w-32 text-brand"
                    style={{ ['--value' as string]: f.value * 100 }}
                  />
                  <span className="text-xs text-muted">{f.note}</span>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">
            Break-even CAC {formatAmount(e.breakEvenCac.amount, e.breakEvenCac.currency)} ·
            confidence {Math.round(score.confidence * 100)}%
            {score.unknowns.length > 0 && <> · unknown: {score.unknowns.join(', ')}</>}
          </p>
        </div>
      )}
    </div>
  );
}

function ScoreBadge({ total, capped, raw }: { total: number; capped: boolean; raw: number }) {
  const tone =
    total >= 65 ? 'text-good' : total >= 40 ? 'text-warn' : 'text-bad';
  return (
    <div className="shrink-0 text-right">
      <span className={`text-2xl tabular-nums ${tone}`}>{total}</span>
      {capped && <p className="text-[10px] text-muted">capped from {raw}</p>}
    </div>
  );
}
