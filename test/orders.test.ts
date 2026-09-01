import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { createTestDb } from './helpers/test-db.js';
import * as schema from '../src/db/schema.js';

/**
 * Order pipeline, end to end against a real Postgres.
 *
 * These cover the paths where a bug costs actual money: pricing a cart the
 * browser controls, freezing those prices before payment, and recognising a
 * payment exactly once no matter how many times Stripe retries the webhook.
 */

const { db } = await createTestDb();

// The modules under test import the app's database handle; point it at the
// throwaway Postgres instead.
vi.mock('@/db', () => ({ db, ...schema }));

// Keep fulfilment off the network — this suite is about order bookkeeping.
const submitted: { orderNumber: string; lines: number }[] = [];
vi.mock('@/lib/fulfilment', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/fulfilment/types.js')>(
    '../src/lib/fulfilment/types.js',
  );
  return {
    ...actual,
    getProvider: (id: string) => ({
      id: id === 'printify' ? 'printify' : 'manual',
      label: id,
      automatic: id === 'printify',
      isConfigured: () => true,
      submit: async (req: { orderNumber: string; lines: unknown[] }) => {
        submitted.push({ orderNumber: req.orderNumber, lines: req.lines.length });
        return { status: 'submitted' as const, externalId: `ext_${req.orderNumber}` };
      },
      check: async () => ({ status: 'submitted' as const }),
    }),
  };
});

const { priceCart, createPendingOrder, markOrderPaid } = await import('../src/lib/orders.js');

const ADDRESS = {
  firstName: 'Sam',
  lastName: 'Rivera',
  email: 'sam@example.com',
  country: 'US',
  region: 'CA',
  address1: '1 Bark Lane',
  city: 'Oakland',
  postcode: '94612',
};

async function seedListing(over: Partial<typeof schema.listings.$inferInsert> = {}) {
  const id = over.id ?? `lst_${Math.random().toString(36).slice(2, 9)}`;
  await db.insert(schema.listings).values({
    id,
    slug: over.slug ?? id,
    title: 'Good Boy Hoodie',
    images: ['https://example.com/a.jpg'],
    costAmount: 2200,
    priceAmount: 6600,
    currency: 'USD',
    fulfilmentProvider: 'printify',
    providerProductId: 'pf_1',
    providerVariantId: '4012',
    status: 'active',
    ...over,
  });
  return id;
}

beforeEach(async () => {
  submitted.length = 0;
  for (const table of [
    schema.fulfilments,
    schema.orderItems,
    schema.orders,
    schema.customers,
    schema.listings,
  ]) {
    await db.delete(table);
  }
});

describe('priceCart', () => {
  it('prices from the database, ignoring anything the browser claims', async () => {
    const id = await seedListing();
    // A tampered cart asking for a cheaper price and a silly quantity.
    const cart = await priceCart([
      { listingId: id, quantity: 2, unitPriceAmount: 1 } as never,
    ]);

    expect(cart.lines).toHaveLength(1);
    expect(cart.lines[0].unitPriceAmount).toBe(6600);
    expect(cart.subtotal).toBe(13200);
    expect(cart.cost).toBe(4400);
  });

  it('refuses to sell a draft or archived listing', async () => {
    const draft = await seedListing({ status: 'draft' });
    const archived = await seedListing({ status: 'archived' });
    const cart = await priceCart([
      { listingId: draft, quantity: 1 },
      { listingId: archived, quantity: 1 },
    ]);
    expect(cart.lines).toHaveLength(0);
  });

  it('ignores unknown listing ids rather than failing the whole cart', async () => {
    const id = await seedListing();
    const cart = await priceCart([
      { listingId: id, quantity: 1 },
      { listingId: 'lst_does_not_exist', quantity: 1 },
    ]);
    expect(cart.lines).toHaveLength(1);
  });

  it('clamps absurd quantities', async () => {
    const id = await seedListing();
    const cart = await priceCart([{ listingId: id, quantity: 100_000 }]);
    expect(cart.lines[0].quantity).toBe(99);
  });

  it('charges shipping below the free threshold and not above it', async () => {
    const cheap = await seedListing({ priceAmount: 1500 });
    const dear = await seedListing({ priceAmount: 9000 });

    expect((await priceCart([{ listingId: cheap, quantity: 1 }])).shipping).toBeGreaterThan(0);
    expect((await priceCart([{ listingId: dear, quantity: 1 }])).shipping).toBe(0);
  });
});

describe('order lifecycle', () => {
  it('freezes prices at checkout so a later reprice cannot desync from Stripe', async () => {
    const id = await seedListing();
    const cart = await priceCart([{ listingId: id, quantity: 1 }]);
    const { orderId } = await createPendingOrder(cart);

    // Someone edits the price while the customer is on Stripe's page.
    await db
      .update(schema.listings)
      .set({ priceAmount: 9900 })
      .where(eq(schema.listings.id, id));

    await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_1',
      email: 'sam@example.com',
      address: ADDRESS,
    });

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    // The order must record what was actually charged, not today's price.
    expect(order.subtotalAmount).toBe(6600);
  });

  it('records a paid order with its cost, for margin without a join', async () => {
    const id = await seedListing();
    const cart = await priceCart([{ listingId: id, quantity: 3 }]);
    const { orderId } = await createPendingOrder(cart);

    await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_2',
      email: 'sam@example.com',
      address: ADDRESS,
      taxAmount: 500,
    });

    const [order] = await db.select().from(schema.orders).where(eq(schema.orders.id, orderId));
    expect(order.status).toBe('fulfilling');
    expect(order.costAmount).toBe(6600);
    expect(order.taxAmount).toBe(500);
    expect(order.totalAmount).toBe(order.subtotalAmount + order.shippingAmount + 500);
    expect(order.paidAt).not.toBeNull();
  });

  it('is idempotent — a replayed webhook does not fulfil twice', async () => {
    const id = await seedListing();
    const cart = await priceCart([{ listingId: id, quantity: 1 }]);
    const { orderId } = await createPendingOrder(cart);

    const first = await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_3',
      email: 'sam@example.com',
      address: ADDRESS,
    });
    const second = await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_3',
      email: 'sam@example.com',
      address: ADDRESS,
    });

    expect(first?.alreadyHandled).toBe(false);
    expect(second?.alreadyHandled).toBe(true);

    // The important assertion: one supplier order, not two.
    expect(submitted).toHaveLength(1);
    const rows = await db
      .select()
      .from(schema.fulfilments)
      .where(eq(schema.fulfilments.orderId, orderId));
    expect(rows).toHaveLength(1);
  });

  it('creates the customer on first order and reuses it on the second', async () => {
    const id = await seedListing();

    for (const session of ['cs_4', 'cs_5']) {
      const cart = await priceCart([{ listingId: id, quantity: 1 }]);
      const { orderId } = await createPendingOrder(cart);
      await markOrderPaid({
        orderId,
        stripeSessionId: session,
        email: 'repeat@example.com',
        address: ADDRESS,
      });
    }

    const people = await db.select().from(schema.customers);
    expect(people).toHaveLength(1);
    expect(people[0].claimedAt).toBeNull(); // still a guest
  });

  it('queues manual fulfilment instead of pretending it shipped', async () => {
    const id = await seedListing({
      fulfilmentProvider: 'manual',
      providerProductId: null,
      providerVariantId: null,
    });
    const cart = await priceCart([{ listingId: id, quantity: 1 }]);
    const { orderId } = await createPendingOrder(cart);

    await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_6',
      email: 'sam@example.com',
      address: ADDRESS,
    });

    const [row] = await db
      .select()
      .from(schema.fulfilments)
      .where(eq(schema.fulfilments.orderId, orderId));
    expect(row.provider).toBe('manual');
    expect(row.status).toBe('queued');
    expect(submitted).toHaveLength(0);
  });

  it('splits a mixed cart across providers', async () => {
    const auto = await seedListing();
    const manual = await seedListing({
      fulfilmentProvider: 'manual',
      providerProductId: null,
    });
    const cart = await priceCart([
      { listingId: auto, quantity: 1 },
      { listingId: manual, quantity: 1 },
    ]);
    const { orderId } = await createPendingOrder(cart);

    await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_7',
      email: 'sam@example.com',
      address: ADDRESS,
    });

    const rows = await db
      .select()
      .from(schema.fulfilments)
      .where(eq(schema.fulfilments.orderId, orderId));
    expect(rows.map((r) => r.provider).sort()).toEqual(['manual', 'printify']);
  });

  it('queues rather than dispatching when no address was captured', async () => {
    const id = await seedListing();
    const cart = await priceCart([{ listingId: id, quantity: 1 }]);
    const { orderId } = await createPendingOrder(cart);

    await markOrderPaid({
      orderId,
      stripeSessionId: 'cs_8',
      email: 'sam@example.com',
      address: null,
    });

    const [row] = await db
      .select()
      .from(schema.fulfilments)
      .where(eq(schema.fulfilments.orderId, orderId));
    expect(row.status).toBe('queued');
    expect(row.lastError).toMatch(/no shipping address/i);
    expect(submitted).toHaveLength(0);
  });

  it('returns null for a payment against an unknown order', async () => {
    const result = await markOrderPaid({
      orderId: 'ord_missing',
      stripeSessionId: 'cs_9',
      email: 'sam@example.com',
      address: ADDRESS,
    });
    expect(result).toBeNull();
  });

  it('gives every order a distinct, readable reference', async () => {
    const id = await seedListing();
    const numbers = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const cart = await priceCart([{ listingId: id, quantity: 1 }]);
      const { orderNumber } = await createPendingOrder(cart);
      expect(orderNumber).toMatch(/^MW-[ACDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
      numbers.add(orderNumber);
    }
    expect(numbers.size).toBe(20);
  });
});
