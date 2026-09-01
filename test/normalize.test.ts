import { describe, expect, it } from 'vitest';
import {
  dedupe,
  formatMoney,
  money,
  parsePriceRange,
  toDecimal,
} from '../src/engine/core/normalize.js';
import type { NormalizedProduct } from '../src/engine/core/types.js';

describe('money', () => {
  it('stores minor units to keep arithmetic exact', () => {
    expect(money(12.99)).toEqual({ amount: 1299, currency: 'USD' });
    // The classic float trap: 0.1 + 0.2 in decimal dollars.
    expect(money(0.1).amount + money(0.2).amount).toBe(money(0.3).amount);
  });

  it('round-trips through decimals and formats', () => {
    expect(toDecimal(money(4.5))).toBe(4.5);
    expect(formatMoney(money(1234.5))).toBe('$1,234.50');
  });
});

describe('parsePriceRange', () => {
  it('reads a single price', () => {
    expect(parsePriceRange('US $12.99')).toEqual({ price: money(12.99) });
  });

  it('reads a range and keeps both ends', () => {
    expect(parsePriceRange('$8.50 - $14.20')).toEqual({
      price: money(8.5),
      priceMax: money(14.2),
    });
  });

  it('detects currency from symbol and from ISO code', () => {
    expect(parsePriceRange('£4.99/piece')!.price.currency).toBe('GBP');
    expect(parsePriceRange('4.99 EUR')!.price.currency).toBe('EUR');
  });

  it('handles thousands separators', () => {
    expect(parsePriceRange('$1,299.00')).toEqual({ price: money(1299) });
  });

  it('returns null rather than guessing when there is no number', () => {
    expect(parsePriceRange('Contact supplier')).toBeNull();
    expect(parsePriceRange('')).toBeNull();
  });
});

function product(over: Partial<NormalizedProduct> = {}): NormalizedProduct {
  return {
    id: 'src:1',
    source: 'src',
    marketplace: 'aliexpress',
    sourceId: '1',
    url: 'https://example.com/1',
    title: 'Collapsible Silicone Dog Bowl',
    images: [],
    price: money(5),
    signals: {},
    fetchedAt: new Date().toISOString(),
    ...over,
  };
}

describe('dedupe', () => {
  it('collapses the same listing seen twice', () => {
    const out = dedupe([product(), product()]);
    expect(out).toHaveLength(1);
  });

  it('treats reordered, padded titles at a similar price as one product', () => {
    const a = product({ id: 'a:1', source: 'a', title: 'Collapsible Silicone Dog Bowl' });
    const b = product({
      id: 'b:2',
      source: 'b',
      title: 'Hot Sale Dog Bowl Silicone Collapsible - Free Shipping',
      price: money(5.4),
    });
    expect(dedupe([a, b])).toHaveLength(1);
  });

  it('keeps genuinely different price points apart', () => {
    const a = product({ id: 'a:1', source: 'a', price: money(5) });
    const b = product({ id: 'b:2', source: 'b', price: money(30) });
    expect(dedupe([a, b])).toHaveLength(2);
  });

  it('prefers the API record over the scraped one', () => {
    const scraped = product({ id: 'a:1', source: 'scrape', kindWeight: 0 });
    const api = product({ id: 'b:1', source: 'api', kindWeight: 5, price: money(5.1) });
    const [survivor] = dedupe([scraped, api]);
    expect(survivor.source).toBe('api');
  });

  it('prefers the richer record when both are the same kind', () => {
    const thin = product({ id: 'a:1', source: 'a' });
    const rich = product({
      id: 'b:1',
      source: 'b',
      price: money(5.2),
      description: 'Folds flat',
      signals: { rating: 4.6, reviewCount: 900, unitsSold: 5000 },
    });
    const [survivor] = dedupe([thin, rich]);
    expect(survivor.source).toBe('b');
  });
});
