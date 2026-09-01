import Link from 'next/link';
import { notFound } from 'next/navigation';
import { orderByNumber } from '@/lib/queries';
import { formatAmount } from '@/lib/money';
import { STORE } from '@/lib/store';
import ClearCartOnMount from './clear-cart';

export const dynamic = 'force-dynamic';

export const metadata = { title: 'Order confirmed' };

export default async function OrderPage({ params }: { params: Promise<{ number: string }> }) {
  const { number } = await params;
  const result = await orderByNumber(number.toUpperCase());
  if (!result) notFound();

  const { order, items } = result;

  // Stripe redirects here the moment it takes the card, but the webhook is what
  // actually marks the order paid and the two race. Say "processing" rather than
  // claiming a confirmation the database has not seen yet.
  const settled = order.status !== 'pending';

  return (
    <div className="mx-auto max-w-2xl px-5 py-16 lg:py-24">
      <ClearCartOnMount />

      <p className="text-xs uppercase tracking-widest text-muted">
        {settled ? 'Order confirmed' : 'Payment processing'}
      </p>
      <h1 className="mt-3 font-display text-4xl tracking-tight">
        {settled ? 'Thank you.' : 'Nearly there.'}
      </h1>
      <p className="mt-4 text-ink-soft">
        {settled ? (
          <>
            Order <span className="text-ink">{order.orderNumber}</span> is confirmed
            {order.email ? (
              <>
                {' '}
                and a receipt is on its way to{' '}
                <span className="text-ink">{order.email}</span>
              </>
            ) : null}
            .
          </>
        ) : (
          <>
            Your payment is being confirmed. This page updates once it clears — keep{' '}
            <span className="text-ink">{order.orderNumber}</span> for your records.
          </>
        )}
      </p>

      <ul className="mt-10 divide-y divide-black/5 border-y border-black/5">
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-4 py-4">
            <div className="h-14 w-14 shrink-0 overflow-hidden rounded bg-bone-dark">
              {item.image && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.image} alt="" className="h-full w-full object-cover" />
              )}
            </div>
            <div className="flex-1 text-sm">
              <p>{item.title}</p>
              <p className="text-muted">Qty {item.quantity}</p>
            </div>
            <p className="text-sm">
              {formatAmount(item.unitPriceAmount * item.quantity, item.currency)}
            </p>
          </li>
        ))}
      </ul>

      <dl className="mt-6 space-y-2 text-sm">
        <div className="flex justify-between">
          <dt className="text-ink-soft">Subtotal</dt>
          <dd>{formatAmount(order.subtotalAmount, order.currency)}</dd>
        </div>
        <div className="flex justify-between">
          <dt className="text-ink-soft">Shipping</dt>
          <dd>
            {order.shippingAmount === 0
              ? 'Free'
              : formatAmount(order.shippingAmount, order.currency)}
          </dd>
        </div>
        {order.taxAmount > 0 && (
          <div className="flex justify-between">
            <dt className="text-ink-soft">Tax</dt>
            <dd>{formatAmount(order.taxAmount, order.currency)}</dd>
          </div>
        )}
        <div className="flex justify-between border-t border-black/5 pt-3 text-base">
          <dt>Total</dt>
          <dd>{formatAmount(order.totalAmount, order.currency)}</dd>
        </div>
      </dl>

      <p className="mt-10 text-xs text-muted">
        Questions about this order? Email {STORE.supportEmail} quoting {order.orderNumber}.
      </p>

      <Link
        href="/"
        className="mt-8 inline-block rounded-full border border-black/15 px-5 py-2.5 text-sm transition hover:border-black/30"
      >
        Continue shopping
      </Link>
    </div>
  );
}
