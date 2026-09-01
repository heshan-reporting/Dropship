import { NextResponse } from 'next/server';
import { createEngine, rankProducts, type Marketplace } from '@/engine';
import { db, priceObservations } from '@/db';
import { isAuthenticated } from '@/lib/auth';
import { newId } from '@/lib/money';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Supplier APIs are slow and several run in parallel; the default would cut
// searches off mid-flight.
export const maxDuration = 60;

/**
 * Run a sourcing search and score the results.
 *
 * Admin-only: this spends supplier API quota and, when the scrape fallback is
 * reached, real Bright Data credits. It must not be reachable from the
 * storefront by anyone who guesses the path.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  let body: { term?: string; marketplace?: string; limit?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const term = (body.term ?? '').trim();
  if (!term) {
    return NextResponse.json({ error: 'Enter something to search for' }, { status: 400 });
  }

  const engine = createEngine();
  const configured = engine.status().filter((s) => s.configured);
  if (configured.length === 0) {
    return NextResponse.json(
      { error: 'No sources configured. Add supplier credentials to .env.', status: engine.status() },
      { status: 503 },
    );
  }

  const result = await engine.search({
    term,
    limit: Math.min(body.limit ?? 24, 60),
    marketplaces: body.marketplace ? [body.marketplace as Marketplace] : undefined,
  });

  const ranked = rankProducts(result.products);

  // Snapshot supplier cost on every search. Margin erosion is silent, and this
  // is what gives the overview something to compare against later.
  if (ranked.length > 0) {
    await db
      .insert(priceObservations)
      .values(
        ranked.map((p) => ({
          id: newId('px'),
          sourceKey: p.id,
          costAmount: p.price.amount,
          currency: p.price.currency,
          contributionAmount: p.score.economics.contributionMargin.amount,
        })),
      )
      .catch(() => {
        // Price history is a nicety; never fail a search because it did not write.
      });
  }

  return NextResponse.json({
    products: ranked,
    errors: result.errors,
    sourcesQueried: result.sourcesQueried,
    sourcesSkipped: result.sourcesSkipped,
    elapsedMs: result.elapsedMs,
  });
}

/** Which sources currently have credentials, for the empty state. */
export async function GET() {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }
  return NextResponse.json({ status: createEngine().status() });
}
