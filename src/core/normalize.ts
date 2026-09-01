import type { Money, NormalizedProduct } from './types.js';

/** Build Money from a decimal amount, e.g. `money(12.99)` → 1299 cents USD. */
export function money(amount: number, currency = 'USD'): Money {
  if (!Number.isFinite(amount)) throw new RangeError(`Invalid amount: ${amount}`);
  return { amount: Math.round(amount * 100), currency: currency.toUpperCase() };
}

/** Money from already-minor units. */
export function minor(amount: number, currency = 'USD'): Money {
  return { amount: Math.round(amount), currency: currency.toUpperCase() };
}

export function toDecimal(m: Money): number {
  return m.amount / 100;
}

export function formatMoney(m: Money): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: m.currency,
  }).format(toDecimal(m));
}

const CURRENCY_SYMBOLS: Record<string, string> = {
  $: 'USD',
  '£': 'GBP',
  '€': 'EUR',
  '¥': 'CNY',
  '₹': 'INR',
  A$: 'AUD',
  'C$': 'CAD',
};

/**
 * Pull money out of the loose strings marketplaces emit: "US $12.99",
 * "$8.50 - $14.20", "£4.99/piece". Returns the low end plus, when the string
 * quotes a range, the high end.
 *
 * Returns null rather than guessing when nothing numeric is present.
 */
export function parsePriceRange(
  input: string,
  fallbackCurrency = 'USD',
): { price: Money; priceMax?: Money } | null {
  if (!input) return null;

  let currency = fallbackCurrency;
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOLS)) {
    if (input.includes(symbol)) {
      currency = code;
      break;
    }
  }
  // An explicit ISO code in the string wins over a symbol.
  const isoMatch = input.match(/\b(USD|GBP|EUR|CNY|AUD|CAD|INR|JPY)\b/i);
  if (isoMatch) currency = isoMatch[1].toUpperCase();

  // Grab numbers, tolerating thousands separators.
  const numbers = [...input.matchAll(/\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number.parseFloat(m[0].replace(/,/g, '')))
    .filter((n) => Number.isFinite(n));

  if (numbers.length === 0) return null;

  const low = Math.min(...numbers);
  const high = Math.max(...numbers);

  return high > low
    ? { price: money(low, currency), priceMax: money(high, currency) }
    : { price: money(low, currency) };
}

/** Collapse whitespace and strip marketplace title padding. */
export function cleanTitle(raw: string): string {
  return raw
    .replace(/\s+/g, ' ')
    .replace(/^[\s\-–|•]+|[\s\-–|•]+$/g, '')
    .trim();
}

/** Force protocol-relative and bare-path image URLs to absolute https. */
export function absoluteUrl(url: string, base?: string): string {
  if (!url) return '';
  if (url.startsWith('//')) return `https:${url}`;
  if (url.startsWith('http://') || url.startsWith('https://')) return url;
  if (base) {
    try {
      return new URL(url, base).toString();
    } catch {
      return url;
    }
  }
  return url;
}

/**
 * Normalise a title for fuzzy matching: lowercase, strip punctuation and the
 * filler words listings pad with, then sort remaining tokens so word order
 * does not defeat the comparison.
 */
function titleKey(title: string): string {
  const STOP = new Set([
    'the', 'a', 'an', 'for', 'with', 'and', 'of', 'in', 'to',
    'new', 'hot', 'sale', 'free', 'shipping', 'wholesale', 'high', 'quality',
    'pcs', 'set', 'pack',
  ]);
  return cleanTitle(title)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .sort()
    .join(' ');
}

/**
 * Remove duplicates across sources. Exact `id` matches go first; beyond that,
 * two products collapse when their normalised titles match and their prices sit
 * within 15% of each other — the same item relisted, not a genuine alternative.
 *
 * The survivor is the one from the richer source: an API result beats a scrape,
 * and among equals the one carrying more signals wins.
 */
export function dedupe(products: NormalizedProduct[]): NormalizedProduct[] {
  const byId = new Map<string, NormalizedProduct>();
  for (const p of products) {
    const existing = byId.get(p.id);
    if (!existing || richness(p) > richness(existing)) byId.set(p.id, p);
  }

  const kept: NormalizedProduct[] = [];
  const seen = new Map<string, NormalizedProduct[]>();

  for (const p of byId.values()) {
    const key = titleKey(p.title);
    if (!key) {
      kept.push(p);
      continue;
    }
    const bucket = seen.get(key);
    if (!bucket) {
      seen.set(key, [p]);
      kept.push(p);
      continue;
    }

    const twin = bucket.find((q) => priceWithin(q, p, 0.15));
    if (!twin) {
      bucket.push(p);
      kept.push(p);
      continue;
    }
    // Same item from two sources — keep whichever tells us more.
    if (richness(p) > richness(twin)) {
      kept[kept.indexOf(twin)] = p;
      bucket[bucket.indexOf(twin)] = p;
    }
  }

  return kept;
}

function priceWithin(a: NormalizedProduct, b: NormalizedProduct, tolerance: number): boolean {
  if (a.price.currency !== b.price.currency) return false;
  const lo = Math.min(a.price.amount, b.price.amount);
  const hi = Math.max(a.price.amount, b.price.amount);
  if (lo === 0) return hi === 0;
  return (hi - lo) / lo <= tolerance;
}

/** How much a record actually tells us — used to pick a winner among duplicates. */
function richness(p: NormalizedProduct): number {
  let score = p.kindWeight ?? 0;
  const s = p.signals;
  for (const v of [s.rating, s.reviewCount, s.unitsSold, s.shippingDays, s.verifiedSupplier]) {
    if (v !== undefined) score += 1;
  }
  if (p.description) score += 1;
  if (p.supplier) score += 1;
  score += Math.min(p.images.length, 3);
  return score;
}
