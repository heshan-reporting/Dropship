import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/pg-core';

/**
 * Money is stored the way the engine models it: integer minor units plus an ISO
 * currency code, never a float. Every amount column below is minor units.
 */

/**
 * Products surfaced by the sourcing engine and kept for consideration. This is
 * the research surface — nothing here is for sale yet.
 *
 * The full NormalizedProduct and its score are kept as JSON rather than shredded
 * into columns: the engine owns that shape, and re-deriving it on every read
 * would put two competing definitions of a product in the codebase.
 */
export const savedProducts = pgTable(
  'saved_products',
  {
    id: text('id').primaryKey(),
    /** Composite key from the engine, e.g. `printify-api:1234`. */
    sourceKey: text('source_key').notNull(),
    marketplace: varchar('marketplace', { length: 32 }).notNull(),
    title: text('title').notNull(),
    /** Serialised NormalizedProduct. */
    product: jsonb('product').notNull(),
    /** Serialised ProductScore as at the time it was saved. */
    score: jsonb('score'),
    scoreTotal: integer('score_total'),
    /** watching | rejected | listed */
    status: varchar('status', { length: 16 }).notNull().default('watching'),
    note: text('note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceKeyIdx: uniqueIndex('saved_products_source_key_idx').on(t.sourceKey),
    statusIdx: index('saved_products_status_idx').on(t.status, t.scoreTotal),
  }),
);

/**
 * Supplier cost observed over time.
 *
 * Margin erosion is silent: a supplier lifts unit cost by a dollar and a product
 * that cleared CAC quietly stops doing so. Snapshotting cost on every search is
 * what makes that visible, and it is why the margin view has anything to show on
 * day one rather than only after months of orders.
 */
export const priceObservations = pgTable(
  'price_observations',
  {
    id: text('id').primaryKey(),
    sourceKey: text('source_key').notNull(),
    costAmount: integer('cost_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    /** Contribution per order at this cost, so trends need no recompute. */
    contributionAmount: integer('contribution_amount'),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    sourceKeyIdx: index('price_observations_source_key_idx').on(t.sourceKey, t.observedAt),
  }),
);

/** Products listed for sale in the storefront. */
export const listings = pgTable(
  'listings',
  {
    id: text('id').primaryKey(),
    slug: varchar('slug', { length: 160 }).notNull(),
    title: text('title').notNull(),
    description: text('description'),
    images: jsonb('images').notNull().default([]),

    /** Provenance back to the engine result this came from. */
    sourceKey: text('source_key'),
    marketplace: varchar('marketplace', { length: 32 }),

    /** What you pay per unit. */
    costAmount: integer('cost_amount').notNull(),
    /** What the customer pays. */
    priceAmount: integer('price_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),

    /**
     * printify routes automatically; manual lands in a queue to place by hand.
     * Chosen per listing because only some sources can be automated.
     */
    fulfilmentProvider: varchar('fulfilment_provider', { length: 16 })
      .notNull()
      .default('manual'),
    providerProductId: text('provider_product_id'),
    providerVariantId: text('provider_variant_id'),

    /** draft | active | archived */
    status: varchar('status', { length: 16 }).notNull().default('draft'),
    /** Score at listing time, so later drift is visible. */
    scoreSnapshot: jsonb('score_snapshot'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugIdx: uniqueIndex('listings_slug_idx').on(t.slug),
    statusIdx: index('listings_status_idx').on(t.status),
  }),
);

/**
 * Customers exist as soon as someone orders, keyed by email, whether or not they
 * ever create an account. "Guest checkout with optional accounts" then needs no
 * migration later — a login flow just reads the record already sitting here.
 */
export const customers = pgTable(
  'customers',
  {
    id: text('id').primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    name: text('name'),
    /** Set only if they later claim the account. Null for pure guests. */
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: uniqueIndex('customers_email_idx').on(t.email),
  }),
);

export const orders = pgTable(
  'orders',
  {
    id: text('id').primaryKey(),
    /** Human-facing reference, e.g. MW-1043. */
    orderNumber: varchar('order_number', { length: 32 }).notNull(),
    customerId: text('customer_id').references(() => customers.id),
    email: varchar('email', { length: 320 }).notNull(),

    /** pending | paid | fulfilling | shipped | cancelled | refunded */
    status: varchar('status', { length: 16 }).notNull().default('pending'),

    currency: varchar('currency', { length: 3 }).notNull(),
    subtotalAmount: integer('subtotal_amount').notNull(),
    shippingAmount: integer('shipping_amount').notNull().default(0),
    taxAmount: integer('tax_amount').notNull().default(0),
    totalAmount: integer('total_amount').notNull(),
    /** Sum of unit costs, so margin needs no re-read of listings. */
    costAmount: integer('cost_amount').notNull().default(0),

    /** Stripe owns the payment page; only references to it are kept. */
    stripeSessionId: text('stripe_session_id'),
    stripePaymentIntentId: text('stripe_payment_intent_id'),

    shippingAddress: jsonb('shipping_address'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    paidAt: timestamp('paid_at', { withTimezone: true }),
  },
  (t) => ({
    orderNumberIdx: uniqueIndex('orders_order_number_idx').on(t.orderNumber),
    sessionIdx: index('orders_stripe_session_idx').on(t.stripeSessionId),
    statusIdx: index('orders_status_idx').on(t.status, t.createdAt),
  }),
);

export const orderItems = pgTable(
  'order_items',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    listingId: text('listing_id').references(() => listings.id),

    /** Snapshots — a later listing edit must not rewrite order history. */
    title: text('title').notNull(),
    image: text('image'),
    unitPriceAmount: integer('unit_price_amount').notNull(),
    unitCostAmount: integer('unit_cost_amount').notNull(),
    currency: varchar('currency', { length: 3 }).notNull(),
    quantity: integer('quantity').notNull(),

    fulfilmentProvider: varchar('fulfilment_provider', { length: 16 }).notNull(),
    providerProductId: text('provider_product_id'),
    providerVariantId: text('provider_variant_id'),
  },
  (t) => ({
    orderIdx: index('order_items_order_idx').on(t.orderId),
  }),
);

/** One fulfilment attempt per order per provider. */
export const fulfilments = pgTable(
  'fulfilments',
  {
    id: text('id').primaryKey(),
    orderId: text('order_id')
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    provider: varchar('provider', { length: 16 }).notNull(),
    /** queued | submitted | shipped | failed | cancelled */
    status: varchar('status', { length: 16 }).notNull().default('queued'),
    externalId: text('external_id'),
    trackingNumber: text('tracking_number'),
    trackingUrl: text('tracking_url'),
    /** Last provider error, so a failed order can be retried knowingly. */
    lastError: text('last_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    orderIdx: index('fulfilments_order_idx').on(t.orderId),
    statusIdx: index('fulfilments_status_idx').on(t.status),
  }),
);

export type SavedProduct = typeof savedProducts.$inferSelect;
export type Listing = typeof listings.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type Fulfilment = typeof fulfilments.$inferSelect;
export type Customer = typeof customers.$inferSelect;
