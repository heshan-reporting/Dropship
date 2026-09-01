import { desc, eq, inArray } from 'drizzle-orm';
import { db, fulfilments, orderItems, orders } from '@/db';
import OrdersClient from './orders-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Orders' };

export default async function OrdersPage() {
  // Pending orders are abandoned checkouts, not sales — keep them out of the
  // working view so the queue reflects real work.
  const rows = await db
    .select()
    .from(orders)
    .where(inArray(orders.status, ['paid', 'fulfilling', 'shipped', 'refunded', 'cancelled']))
    .orderBy(desc(orders.createdAt))
    .limit(100);

  const ids = rows.map((r) => r.id);
  const [items, fuls] = await Promise.all([
    ids.length ? db.select().from(orderItems).where(inArray(orderItems.orderId, ids)) : [],
    ids.length ? db.select().from(fulfilments).where(inArray(fulfilments.orderId, ids)) : [],
  ]);

  return (
    <OrdersClient
      orders={rows.map((o) => ({
        id: o.id,
        orderNumber: o.orderNumber,
        email: o.email,
        status: o.status,
        currency: o.currency,
        totalAmount: o.totalAmount,
        costAmount: o.costAmount,
        createdAt: o.createdAt.toISOString(),
        address: o.shippingAddress as Record<string, string> | null,
        items: items
          .filter((i) => i.orderId === o.id)
          .map((i) => ({
            id: i.id,
            title: i.title,
            quantity: i.quantity,
            unitPriceAmount: i.unitPriceAmount,
            unitCostAmount: i.unitCostAmount,
            currency: i.currency,
            fulfilmentProvider: i.fulfilmentProvider,
          })),
        fulfilments: fuls
          .filter((f) => f.orderId === o.id)
          .map((f) => ({
            id: f.id,
            provider: f.provider,
            status: f.status,
            externalId: f.externalId,
            trackingNumber: f.trackingNumber,
            trackingUrl: f.trackingUrl,
            lastError: f.lastError,
          })),
      }))}
    />
  );
}
