import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, rankProducts, scoreProduct } from '../src/scoring/score.js';
import { money } from '../src/core/normalize.js';
import type { NormalizedProduct, ProductSignals } from '../src/core/types.js';

function product(price: number, signals: ProductSignals = {}): NormalizedProduct {
  return {
    id: `t:${price}`,
    source: 't',
    marketplace: 'cj',
    sourceId: String(price),
    url: 'https://example.com',
    title: 'Test product',
    images: [],
    price: money(price),
    signals,
    fetchedAt: new Date().toISOString(),
  };
}

describe('scoreProduct', () => {
  it('rewards a price that leaves room under the impulse ceiling', () => {
    const cheap = scoreProduct(product(8));  // → $24 retail at 3x
    const dear = scoreProduct(product(60));  // → $180 retail
    expect(cheap.total).toBeGreaterThan(dear.total);
  });

  it('does not reward suspiciously near-free listings as much as viable ones', () => {
    const nearFree = scoreProduct(product(0.4));
    const viable = scoreProduct(product(8));
    const marginOf = (s: ReturnType<typeof scoreProduct>) =>
      s.factors.find((f) => f.name === 'margin')!.value;
    expect(marginOf(nearFree)).toBeLessThan(marginOf(viable));
  });

  it('rewards more sales, monotonically', () => {
    const none = scoreProduct(product(10, { unitsSold: 0 }));
    const some = scoreProduct(product(10, { unitsSold: 100 }));
    const many = scoreProduct(product(10, { unitsSold: 10_000 }));

    expect(some.total).toBeGreaterThan(none.total);
    expect(many.total).toBeGreaterThan(some.total);
  });

  it('scores demand on a log scale so early traction counts most', () => {
    // The same absolute gain in units sold should barely register once a
    // product is already selling well.
    const demandOf = (units: number) =>
      scoreProduct(product(10, { unitsSold: units })).factors.find((f) => f.name === 'demand')!
        .value;

    const earlyGain = demandOf(110) - demandOf(10);
    const lateGain = demandOf(1100) - demandOf(1000);

    expect(earlyGain).toBeGreaterThan(lateGain * 10);
  });

  it('treats sub-3.5 star ratings as disqualifying', () => {
    const bad = scoreProduct(product(10, { rating: 3.0 }));
    expect(bad.factors.find((f) => f.name === 'quality')!.value).toBe(0);
  });

  it('penalises slow shipping', () => {
    const fast = scoreProduct(product(10, { shippingDays: { min: 2, max: 5 } }));
    const slow = scoreProduct(product(10, { shippingDays: { min: 20, max: 40 } }));
    expect(fast.total).toBeGreaterThan(slow.total);
  });

  it('reports what it could not judge instead of assuming', () => {
    const bare = scoreProduct(product(10));
    expect(bare.unknowns).toContain('demand');
    expect(bare.unknowns).toContain('quality');
    expect(bare.unknowns).toContain('shipping');
  });

  it('re-weights so a sparse source is not punished for missing fields', () => {
    // Identical strong margin; one source simply reports less.
    const sparse = scoreProduct(product(8));
    const detailed = scoreProduct(
      product(8, { rating: 4.8, unitsSold: 8000, shippingDays: { min: 3, max: 6 } }),
    );
    // Sparse still scores respectably rather than collapsing toward zero.
    expect(sparse.total).toBeGreaterThan(50);
    expect(detailed.total).toBeGreaterThan(sparse.total);
  });

  it('keeps the total inside 0-100', () => {
    const best = scoreProduct(
      product(5, {
        rating: 5,
        unitsSold: 1_000_000,
        shippingDays: { min: 1, max: 2 },
        verifiedSupplier: true,
      }),
    );
    const worst = scoreProduct(product(5000, { rating: 1, unitsSold: 0 }));
    expect(best.total).toBeLessThanOrEqual(100);
    expect(worst.total).toBeGreaterThanOrEqual(0);
  });

  it('respects a custom markup target', () => {
    const p = product(15);
    const aggressive = scoreProduct(p, { ...DEFAULT_SCORING, targetMarkup: 5 });
    const modest = scoreProduct(p, { ...DEFAULT_SCORING, targetMarkup: 2 });
    expect(modest.total).toBeGreaterThan(aggressive.total);
  });
});

describe('rankProducts', () => {
  it('orders best-first and breaks ties toward the better-known product', () => {
    const ranked = rankProducts([
      product(60),
      product(8, { rating: 4.8, unitsSold: 9000, shippingDays: { min: 3, max: 5 } }),
      product(25),
    ]);
    expect(ranked[0].price).toEqual(money(8));
    expect(ranked[0].score.total).toBeGreaterThan(ranked[1].score.total);
  });
});
