import { eq, inArray } from 'drizzle-orm';
import { db, customers, fulfilments, listings, orderItems, orders } from '@/db';
import { getProvider, type ShippingAddress } from '@/lib/fulfilment';
import { newId } from '@/lib/money';
import { STORE, FLAT_SHIPPING, FREE_SHIPPING_THRESHOLD } from '@/lib/store';

/** Unambiguous alphabet — no O/0 or I/1 to misread off a support email. */
const ALPHABET = 'ACDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newOrderNumber(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${STORE.orderPrefix}-${out}`;
}

export interface PricedLine {
  listingId: string;
  title: string;
  image: string | null;
  quantity: number;
  unitPriceAmount: number;
  unitCostAmount: number;
  currency: string;
  fulfilmentProvider: string;
  providerProductId: string | null;
  providerVariantId: string | null;
}

export interface PricedCart {
  lines: PricedLine[];
  currency: string;
  subtotal: number;
  shipping: number;
  total: number;
  /** Total unit cost, carried onto the order so margin needs no later join. */
  cost: number;
}

/**
 * Turn client-supplied cart lines into a priced cart using database values.
 *
 * The browser sends listing ids and quantities and nothing else. Prices,
 * currency and costs all come from these rows, so a tampered cart can change
 * *what* is bought but never *what it costs*.
 */
export async function priceCart(
  requested: { listingId: string; quantity: number }[],
): Promise<PricedCart> {
  const wanted = new Map<string, number>();
  for (const line of requested) {
    if (typeof line?.listingId !== 'string' || !line.listingId) continue;
    const qty = Math.max(1, Math.min(99, Math.floor(Number(line.quantity) || 0)));
    wanted.set(line.listingId, Math.min(99, (wanted.get(line.listingId) ?? 0) + qty));
  }

  const rows = wanted.size
    ? await db
        .select()
        .from(listings)
        .where(inArray(listings.id, [...wanted.keys()]))
    : [];

  const lines: PricedLine[] = [];
  for (const row of rows) {
    // Silently drop anything no longer for sale rather than selling a draft.
    if (row.status !== 'active') continue;
    const quantity = wanted.get(row.id);
    if (!quantity) continue;
    const images = (row.images as string[]) ?? [];
    lines.push({
      listingId: row.id,
      title: row.title,
      image: images[0] ?? null,
      quantity,
      unitPriceAmount: row.priceAmount,
      unitCostAmount: row.costAmount,
      currency: row.currency,
      fulfilmentProvider: row.fulfilmentProvider,
      providerProductId: row.providerProductId,
      providerVariantId: row.providerVariantId,
    });
  }

  const currency = lines[0]?.currency ?? 'USD';
  const subtotal = lines.reduce((sum, l) => sum + l.unitPriceAmount * l.quantity, 0);
  const cost = lines.reduce((sum, l) => sum + l.unitCostAmount * l.quantity, 0);
  const shipping =
    lines.length === 0 || (FREE_SHIPPING_THRESHOLD !== null && subtotal >= FREE_SHIPPING_THRESHOLD)
      ? 0
      : FLAT_SHIPPING;

  return { lines, currency, subtotal, shipping, total: subtotal + shipping, cost };
}

/**
 * Write the order before sending the customer to Stripe.
 *
 * Prices are frozen here rather than recomputed when payment confirms. If a
 * listing were repriced mid-checkout, re-pricing on the webhook would record a
 * figure Stripe never charged — the order and the payment would silently
 * disagree. The row also makes abandoned checkouts visible.
 */
export async function createPendingOrder(cart: PricedCart): Promise<{
  orderId: string;
  orderNumber: string;
}> {
  const orderId = newId('ord');
  const orderNumber = newOrderNumber();

  await db.insert(orders).values({
    id: orderId,
    orderNumber,
    email: '',
    status: 'pending',
    currency: cart.currency,
    subtotalAmount: cart.subtotal,
    shippingAmount: cart.shipping,
    totalAmount: cart.total,
    costAmount: cart.cost,
  });

  await db.insert(orderItems).values(
    cart.lines.map((l) => ({
      id: newId('itm'),
      orderId,
      listingId: l.listingId,
      title: l.title,
      image: l.image,
      unitPriceAmount: l.unitPriceAmount,
      unitCostAmount: l.unitCostAmount,
      currency: l.currency,
      quantity: l.quantity,
      fulfilmentProvider: l.fulfilmentProvider,
      providerProductId: l.providerProductId,
      providerVariantId: l.providerVariantId,
    })),
  );

  return { orderId, orderNumber };
}

/**
 * Mark a pending order paid and queue its fulfilment.
 *
 * Stripe retries webhooks on any non-2xx, so this is idempotent: an order
 * already past `pending` returns without re-dispatching fulfilment, which would
 * otherwise place the same supplier order twice.
 */
export async function markOrderPaid(input: {
  orderId: string;
  stripeSessionId: string;
  stripePaymentIntentId?: string;
  email: string;
  address: ShippingAddress | null;
  taxAmount?: number;
}): Promise<{ orderNumber: string; alreadyHandled: boolean } | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, input.orderId)).limit(1);
  if (!order) return null;
  if (order.status !== 'pending') {
    return { orderNumber: order.orderNumber, alreadyHandled: true };
  }

  // A customer row exists from the first order onward, so an account claimed
  // later already has its history attached.
  let customerId: string | null = order.customerId;
  if (!customerId && input.email) {
    const [found] = await db
      .select({ id: customers.id })
      .from(customers)
      .where(eq(customers.email, input.email))
      .limit(1);
    if (found) {
      customerId = found.id;
    } else {
      customerId = newId('cus');
      await db.insert(customers).values({ id: customerId, email: input.email });
    }
  }

  const tax = input.taxAmount ?? 0;
  await db
    .update(orders)
    .set({
      status: 'paid',
      email: input.email,
      customerId,
      taxAmount: tax,
      totalAmount: order.subtotalAmount + order.shippingAmount + tax,
      stripeSessionId: input.stripeSessionId,
      stripePaymentIntentId: input.stripePaymentIntentId ?? null,
      shippingAddress: input.address,
      paidAt: new Date(),
    })
    .where(eq(orders.id, input.orderId));

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, input.orderId));
  await dispatchFulfilment(input.orderId, order.orderNumber, input.address, items);

  return { orderNumber: order.orderNumber, alreadyHandled: false };
}

interface DispatchLine {
  quantity: number;
  title: string;
  fulfilmentProvider: string;
  providerProductId: string | null;
  providerVariantId: string | null;
}

/**
 * Group lines by provider and hand each group to its provider.
 *
 * A provider failing here must not fail the webhook: the customer has already
 * paid, and losing the order to a 500 would be far worse than a fulfilment that
 * needs retrying. Failures are recorded on the fulfilment row instead, where the
 * admin queue can surface and retry them.
 */
async function dispatchFulfilment(
  orderId: string,
  orderNumber: string,
  address: ShippingAddress | null,
  lines: DispatchLine[],
): Promise<void> {
  const byProvider = new Map<string, DispatchLine[]>();
  for (const line of lines) {
    // Anything without provider identifiers cannot be placed automatically,
    // whatever the listing claims.
    const key = line.providerProductId ? line.fulfilmentProvider : 'manual';
    byProvider.set(key, [...(byProvider.get(key) ?? []), line]);
  }

  for (const [providerId, group] of byProvider) {
    const provider = getProvider(providerId);
    const fulfilmentId = newId('ful');

    if (!address || !provider.automatic) {
      await db.insert(fulfilments).values({
        id: fulfilmentId,
        orderId,
        provider: provider.automatic ? provider.id : 'manual',
        status: 'queued',
        lastError: address ? null : 'No shipping address captured at checkout',
      });
      continue;
    }

    try {
      const result = await provider.submit({
        orderId,
        orderNumber,
        address,
        lines: group.map((l) => ({
          providerProductId: l.providerProductId,
          providerVariantId: l.providerVariantId,
          quantity: l.quantity,
          title: l.title,
        })),
      });

      await db.insert(fulfilments).values({
        id: fulfilmentId,
        orderId,
        provider: provider.id,
        status: result.status === 'submitted' ? 'submitted' : 'queued',
        externalId: result.externalId ?? null,
        lastError: result.status === 'failed' ? (result.message ?? 'Submit failed') : null,
      });
    } catch (err) {
      // Never rethrow: the payment succeeded, so the order must survive.
      await db.insert(fulfilments).values({
        id: fulfilmentId,
        orderId,
        provider: provider.id,
        status: 'failed',
        lastError: err instanceof Error ? err.message : String(err),
      });
    }
  }

  await db.update(orders).set({ status: 'fulfilling' }).where(eq(orders.id, orderId));
}
