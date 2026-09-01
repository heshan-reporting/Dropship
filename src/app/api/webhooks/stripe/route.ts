import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import { markOrderPaid } from '@/lib/orders';
import { stripe } from '@/lib/stripe';
import type { ShippingAddress } from '@/lib/fulfilment';

// The signature is computed over the exact bytes Stripe sent, so this route
// must never let a framework parse or re-serialise the body first.
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Stripe webhook.
 *
 * This is the only place an order becomes paid. The browser's return from
 * checkout is a redirect the customer controls and is treated as cosmetic —
 * money is recognised here, after the signature verifies, or not at all.
 */
export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'Webhook secret not configured' }, { status: 503 });
  }

  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 400 });
  }

  const payload = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe().webhooks.constructEvent(payload, signature, secret);
  } catch (err) {
    // An unverifiable event is either misconfiguration or forgery. Refuse it,
    // and do not echo the reason back to the caller.
    console.error('Stripe signature verification failed:', err);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  if (event.type !== 'checkout.session.completed') {
    // Acknowledge everything else so Stripe stops retrying it.
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;
  const orderId = session.metadata?.orderId;
  if (!orderId) {
    console.error('checkout.session.completed without an orderId in metadata', session.id);
    // 200 rather than a retry: replaying this will not conjure the metadata.
    return NextResponse.json({ received: true });
  }

  if (session.payment_status !== 'paid') {
    return NextResponse.json({ received: true });
  }

  try {
    const result = await markOrderPaid({
      orderId,
      stripeSessionId: session.id,
      stripePaymentIntentId:
        typeof session.payment_intent === 'string' ? session.payment_intent : undefined,
      email: session.customer_details?.email ?? '',
      address: toShippingAddress(session),
      taxAmount: session.total_details?.amount_tax ?? 0,
    });

    if (!result) {
      console.error('Paid session referenced an unknown order', orderId);
      return NextResponse.json({ received: true });
    }

    return NextResponse.json({ received: true, orderNumber: result.orderNumber });
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient database
    // fault — the order is recoverable rather than silently lost.
    console.error('Failed to record paid order', orderId, err);
    return NextResponse.json({ error: 'Processing failed' }, { status: 500 });
  }
}

/** Map Stripe's collected address onto the fulfilment providers' shape. */
function toShippingAddress(session: Stripe.Checkout.Session): ShippingAddress | null {
  const details = session.collected_information?.shipping_details ?? session.customer_details;
  const address = details?.address;
  if (!address?.line1 || !address.country) return null;

  const fullName = (details?.name ?? '').trim();
  const parts = fullName.split(/\s+/);
  const firstName = parts[0] ?? '';
  const lastName = parts.slice(1).join(' ') || firstName;

  return {
    firstName,
    lastName,
    email: session.customer_details?.email ?? '',
    phone: session.customer_details?.phone ?? undefined,
    country: address.country,
    region: address.state ?? undefined,
    address1: address.line1,
    address2: address.line2 ?? undefined,
    city: address.city ?? '',
    postcode: address.postal_code ?? '',
  };
}
