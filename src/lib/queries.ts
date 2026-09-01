import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { db, listings, orderItems, orders, savedProducts } from '@/db';

/** Active listings for the storefront, newest first. */
export async function activeListings(limit = 60) {
  return db
    .select()
    .from(listings)
    .where(eq(listings.status, 'active'))
    .orderBy(desc(listings.createdAt))
    .limit(limit);
}

export async function listingBySlug(slug: string) {
  const [row] = await db.select().from(listings).where(eq(listings.slug, slug)).limit(1);
  return row ?? null;
}

/**
 * Re-read listings by id for checkout.
 *
 * The cart lives in the browser, so its prices are attacker-controlled. Nothing
 * downstream may use them: totals are always rebuilt from these rows.
 */
export async function listingsForCheckout(ids: string[]) {
  if (ids.length === 0) return [];
  return db
    .select()
    .from(listings)
    .where(and(inArray(listings.id, ids), eq(listings.status, 'active')));
}

export async function allListings() {
  return db.select().from(listings).orderBy(desc(listings.updatedAt));
}

export async function savedByStatus(status: string) {
  return db
    .select()
    .from(savedProducts)
    .where(eq(savedProducts.status, status))
    .orderBy(desc(savedProducts.scoreTotal));
}

export async function orderByNumber(orderNumber: string) {
  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.orderNumber, orderNumber))
    .limit(1);
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  return { order, items };
}

export async function recentOrders(limit = 50) {
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
}

/** Revenue, cost and margin across paid orders, for the dashboard. */
export async function marginSummary() {
  const [row] = await db
    .select({
      orderCount: sql<number>`count(*)::int`,
      revenue: sql<number>`coalesce(sum(${orders.totalAmount}), 0)::int`,
      cost: sql<number>`coalesce(sum(${orders.costAmount}), 0)::int`,
    })
    .from(orders)
    .where(inArray(orders.status, ['paid', 'fulfilling', 'shipped']));
  return row ?? { orderCount: 0, revenue: 0, cost: 0 };
}
