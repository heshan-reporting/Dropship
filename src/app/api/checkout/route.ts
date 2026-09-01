import { NextResponse } from 'next/server';
import { createPendingOrder, priceCart } from '@/lib/orders';
import { siteUrl, stripe, stripeConfigured } from '@/lib/stripe';
import { STORE } from '@/lib/store';

export const dynamic = 'force-dynamic';

/**
 * Start a checkout.
 *
 * Prices come from `priceCart` (database values), the order is written before
 * the redirect so the amounts are frozen, and only the order id travels to
 * Stripe as metadata — the webhook reads it back rather than trusting anything
 * the browser might have supplied.
 */
export async function POST(request: Request) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: 'Payments are not configured yet. Add STRIPE_SECRET_KEY to .env.' },
      { status: 503 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const requested = Array.isArray((body as { lines?: unknown })?.lines)
    ? (body as { lines: { listingId: string; quantity: number }[] }).lines
    : [];

  const cart = await priceCart(requested);
  if (cart.lines.length === 0) {
    return NextResponse.json({ error: 'Your cart is empty' }, { status: 400 });
  }

  const { orderId, orderNumber } = await createPendingOrder(cart);

  try {
    const session = await stripe().checkout.sessions.create({
      mode: 'payment',
      // Guest checkout: Stripe collects the email, no account required here.
      customer_creation: 'if_required',
      billing_address_collection: 'auto',
      shipping_address_collection: {
        // Printify prints regionally; anywhere it ships, we sell.
        allowed_countries: [
          'US', 'CA', 'GB', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL',
          'BE', 'AT', 'DK', 'SE', 'NO', 'FI', 'PT', 'PL', 'CZ', 'JP', 'SG',
        ],
      },
      line_items: [
        ...cart.lines.map((l) => ({
          quantity: l.quantity,
          price_data: {
            currency: l.currency.toLowerCase(),
            unit_amount: l.unitPriceAmount,
            product_data: {
              name: l.title,
              images: l.image ? [l.image] : undefined,
            },
          },
        })),
        ...(cart.shipping > 0
          ? [
              {
                quantity: 1,
                price_data: {
                  currency: cart.currency.toLowerCase(),
                  unit_amount: cart.shipping,
                  product_data: { name: 'Shipping' },
                },
              },
            ]
          : []),
      ],
      // The webhook trusts this and nothing else from the client.
      metadata: { orderId, orderNumber, store: STORE.name },
      success_url: `${siteUrl()}/order/${orderNumber}?session={CHECKOUT_SESSION_ID}`,
      cancel_url: `${siteUrl()}/cart`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Could not start checkout';
    // The pending order stays behind deliberately — it is the record of a
    // checkout that was attempted and failed, which is worth being able to see.
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
