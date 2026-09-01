import { NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db, listings, savedProducts } from '@/db';
import { isAuthenticated } from '@/lib/auth';
import { newId, slugify } from '@/lib/money';
import { DEFAULT_ECONOMICS, computeEconomics, type NormalizedProduct } from '@/engine';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Publish a researched product as a listing.
 *
 * Retail defaults to the price the scorer says clears costs rather than a blunt
 * multiple of cost — that figure already accounts for freight, fees and ad
 * spend, so the listing starts profitable instead of needing to be caught later.
 */
export async function POST(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  let body: { product?: NormalizedProduct; score?: unknown; priceAmount?: number };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const product = body.product;
  if (!product?.id || !product.title) {
    return NextResponse.json({ error: 'A product is required' }, { status: 400 });
  }

  const economics = computeEconomics(product, DEFAULT_ECONOMICS);
  const priceAmount = body.priceAmount ?? economics.suggestedRetail.amount;

  // Only Printify can be placed automatically; anything else has to be bought
  // by hand, and the listing must say so rather than promising otherwise.
  const isPrintify = product.marketplace === 'printify';

  const id = newId('lst');
  const slug = await uniqueSlug(product.title);

  await db.insert(listings).values({
    id,
    slug,
    title: product.title,
    description: product.description ?? null,
    images: product.images ?? [],
    sourceKey: product.id,
    marketplace: product.marketplace,
    costAmount: product.price.amount,
    priceAmount,
    currency: product.price.currency,
    fulfilmentProvider: isPrintify ? 'printify' : 'manual',
    providerProductId: isPrintify ? product.sourceId : null,
    providerVariantId: null,
    status: 'draft',
    scoreSnapshot: body.score ?? null,
  });

  // Keep the research row in step so the product does not resurface as new.
  await db
    .update(savedProducts)
    .set({ status: 'listed', updatedAt: new Date() })
    .where(eq(savedProducts.sourceKey, product.id))
    .catch(() => {});

  return NextResponse.json({ id, slug, priceAmount });
}

/** Update price, status or copy on an existing listing. */
export async function PATCH(request: Request) {
  if (!(await isAuthenticated())) {
    return NextResponse.json({ error: 'Not authorised' }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    id?: string;
    priceAmount?: number;
    status?: string;
    title?: string;
    description?: string;
    providerVariantId?: string;
  } | null;

  if (!body?.id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof body.priceAmount === 'number' && body.priceAmount >= 0) {
    patch.priceAmount = Math.round(body.priceAmount);
  }
  if (body.status && ['draft', 'active', 'archived'].includes(body.status)) {
    patch.status = body.status;
  }
  if (typeof body.title === 'string' && body.title.trim()) patch.title = body.title.trim();
  if (typeof body.description === 'string') patch.description = body.description;
  if (typeof body.providerVariantId === 'string') {
    patch.providerVariantId = body.providerVariantId.trim() || null;
  }

  await db.update(listings).set(patch).where(eq(listings.id, body.id));
  return NextResponse.json({ ok: true });
}

/** Append a numeric suffix until the slug is free. */
async function uniqueSlug(title: string): Promise<string> {
  const base = slugify(title) || 'product';
  for (let attempt = 0; attempt < 25; attempt++) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const [taken] = await db
      .select({ id: listings.id })
      .from(listings)
      .where(eq(listings.slug, candidate))
      .limit(1);
    if (!taken) return candidate;
  }
  return `${base}-${Date.now().toString(36)}`;
}
