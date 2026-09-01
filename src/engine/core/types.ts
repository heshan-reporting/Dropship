/**
 * Core contracts for the sourcing engine.
 *
 * Every source — whether it is a first-class API or a scraper standing in for
 * one — implements `SourceAdapter` and emits `NormalizedProduct`. Nothing
 * downstream (scoring, storefront, exports) should ever see a vendor payload.
 */

/** Marketplace a product came from, independent of *how* it was fetched. */
export type Marketplace =
  | 'aliexpress'
  | 'alibaba'
  | 'cj'
  | 'printify'
  | 'amazon'
  | 'temu';

/** Unique id for one adapter. Two adapters may share a marketplace. */
export type SourceId = string;

/** How an adapter talks to its marketplace. */
export type AdapterKind = 'api' | 'scrape';

/**
 * Money is held in minor units (cents) to keep arithmetic exact. Use the
 * helpers in `normalize.ts` rather than building these by hand.
 */
export interface Money {
  /** Integer minor units, e.g. 1299 for $12.99. */
  amount: number;
  /** ISO 4217, uppercase. */
  currency: string;
}

/** Signals the scoring layer reads. All optional — sources vary wildly. */
export interface ProductSignals {
  /** 0–5. */
  rating?: number;
  reviewCount?: number;
  unitsSold?: number;
  /** Country codes or free-text warehouse locations. */
  shipsFrom?: string[];
  shippingDays?: { min: number; max: number };
  inStock?: boolean;
  /** Marketplace-verified / assessed supplier badge. */
  verifiedSupplier?: boolean;
}

export interface Supplier {
  name: string;
  url?: string;
  country?: string;
  yearsActive?: number;
  responseRate?: number;
}

/**
 * The single shape every source collapses into. Adding a marketplace means
 * writing a mapper to this — never widening it with vendor-specific fields.
 */
export interface NormalizedProduct {
  /** Stable composite key: `${source}:${sourceId}`. */
  id: string;
  source: SourceId;
  marketplace: Marketplace;
  sourceId: string;
  url: string;

  title: string;
  description?: string;
  images: string[];
  category?: string;
  tags?: string[];

  /** Unit cost to you at MOQ. */
  price: Money;
  /** Upper bound when the source quotes a range. */
  priceMax?: Money;
  /** Source's suggested retail, where offered. */
  suggestedRetail?: Money;
  /** Minimum order quantity. */
  moq?: number;

  supplier?: Supplier;
  signals: ProductSignals;

  /** Shipping weight in grams, where the source reports it. Drives freight cost. */
  weightGrams?: number;

  /**
   * How many distinct sources carried this same product, and how many listings
   * in total. Stamped by `dedupe` — the duplicates it collapses are themselves
   * the saturation signal, so they are counted rather than discarded.
   */
  sourceCount?: number;
  listingCount?: number;

  /** ISO 8601. */
  fetchedAt: string;
  /**
   * Stamped by the orchestrator (API=5, scrape=0) so that dedupe can prefer a
   * first-class API record over a scraped one without inspecting adapters.
   * @internal
   */
  kindWeight?: number;
  /** Original payload. Populated only when `SearchQuery.includeRaw` is set. */
  raw?: unknown;
}

export interface SearchQuery {
  /** Free-text product idea, e.g. "collapsible dog bowl". */
  term: string;
  limit?: number;
  minPrice?: Money;
  maxPrice?: Money;
  /** Restrict the fan-out. Omit to query everything configured. */
  marketplaces?: Marketplace[];
  /** Attach vendor payloads to results. Verbose; off by default. */
  includeRaw?: boolean;
}

export interface AdapterContext {
  /** Cooperative cancellation — the orchestrator wires per-adapter timeouts. */
  signal: AbortSignal;
  log: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface AdapterCapabilities {
  /** Can return a supplier's contact/company record. */
  supplierDetail: boolean;
  /** Exposes a real MOQ rather than assuming 1. */
  moq: boolean;
  /** Reports units sold / order counts. */
  salesVolume: boolean;
  /** Can fulfil orders through the same integration. */
  fulfilment: boolean;
}

export interface SourceAdapter {
  readonly id: SourceId;
  readonly label: string;
  readonly marketplace: Marketplace;
  readonly kind: AdapterKind;
  readonly capabilities: AdapterCapabilities;

  /** False when credentials are absent — the orchestrator then skips it. */
  isConfigured(): boolean;

  search(query: SearchQuery, ctx: AdapterContext): Promise<NormalizedProduct[]>;

  /** Optional deep-fetch for a single product. */
  getProduct?(sourceId: string, ctx: AdapterContext): Promise<NormalizedProduct | null>;
}

export interface SourceError {
  source: SourceId;
  marketplace: Marketplace;
  kind: AdapterKind;
  message: string;
  /** True when a fallback adapter was tried after this failure. */
  recovered: boolean;
}

export interface SearchResult {
  products: NormalizedProduct[];
  errors: SourceError[];
  /** Adapters that actually ran, in the order they resolved. */
  sourcesQueried: SourceId[];
  /** Adapters skipped for missing credentials. */
  sourcesSkipped: SourceId[];
  elapsedMs: number;
}
