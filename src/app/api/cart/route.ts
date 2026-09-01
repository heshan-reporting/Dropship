import { NextResponse } from 'next/server';
import { priceCart } from '@/lib/orders';

export const dynamic = 'force-dynamic';

/**
 * Resolve browser cart lines into displayable, server-priced lines.
 *
 * The cart page never renders a price it invented — it sends ids and quantities
 * and shows back exactly what the database says, so what the customer sees is
 * what checkout will charge.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const lines = Array.isArray((body as { lines?: unknown })?.lines)
    ? ((body as { lines: { listingId: string; quantity: number }[] }).lines)
    : [];

  const cart = await priceCart(lines);

  return NextResponse.json({
    lines: cart.lines.map((l) => ({
      listingId: l.listingId,
      title: l.title,
      image: l.image,
      quantity: l.quantity,
      unitPriceAmount: l.unitPriceAmount,
      currency: l.currency,
    })),
    currency: cart.currency,
    subtotal: cart.subtotal,
    shipping: cart.shipping,
    total: cart.total,
  });
}
