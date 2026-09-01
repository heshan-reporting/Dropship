import { describe, expect, it } from 'vitest';
import { DEFAULT_SCORING, rankProducts, scoreProduct } from '../src/scoring/score.js';
import { computeEconomics, retailForTargetMargin } from '../src/scoring/economics.js';
import { screenPolicy, worstSeverity } from '../src/scoring/policy.js';
import { money, toDecimal } from '../src/core/normalize.js';
import type { NormalizedProduct, ProductSignals } from '../src/core/types.js';

function product(
  price: number,
  signals: ProductSignals = {},
  over: Partial<NormalizedProduct> = {},
): NormalizedProduct {
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
    ...over,
  };
}

/** A product that clears every bar, used as the control in comparisons. */
const healthySignals: ProductSignals = {
  rating: 4.6,
  reviewCount: 1200,
  unitsSold: 8000,
  shippingDays: { min: 4, max: 9 },
  verifiedSupplier: true,
};

describe('unit economics', () => {
  it('subtracts freight, fees and ad spend rather than assuming markup is profit', () => {
    const e = computeEconomics(product(4.2));
    expect(toDecimal(e.grossMargin)).toBeLessThan(toDecimal(e.suggestedRetail));
    // The whole point: a cheap product at 3x cannot absorb customer acquisition.
    expect(e.viable).toBe(false);
    expect(toDecimal(e.contributionMargin)).toBeLessThan(0);
  });

  it('finds higher-ticket products viable where cheap ones are not', () => {
    expect(computeEconomics(product(4.2)).viable).toBe(false);
    expect(computeEconomics(product(38)).viable).toBe(true);
  });

  it('prices off landed cost, so weight moves retail', () => {
    const light = computeEconomics(product(20, {}, { weightGrams: 100 }));
    const heavy = computeEconomics(product(20, {}, { weightGrams: 4000 }));
    expect(toDecimal(heavy.shipping)).toBeGreaterThan(toDecimal(light.shipping));
    expect(toDecimal(heavy.contributionMargin)).toBeLessThan(toDecimal(light.contributionMargin));
  });

  it('reports the most you could pay per customer', () => {
    const e = computeEconomics(product(30));
    expect(toDecimal(e.breakEvenCac)).toBeGreaterThan(0);
    expect(toDecimal(e.breakEvenCac)).toBeCloseTo(toDecimal(e.grossMargin), 2);
  });

  it('solves for the retail price that hits a target margin', () => {
    const p = product(4.2);
    const target = retailForTargetMargin(p, 0.15);
    const repriced = computeEconomics({ ...p, suggestedRetail: target });
    expect(repriced.contributionRate).toBeCloseTo(0.15, 2);
  });
});

describe('policy screening', () => {
  it('flags categories that cannot be advertised', () => {
    const matches = screenPolicy(product(20, {}, { title: 'Rechargeable Vape Pen Kit' }));
    expect(worstSeverity(matches)).toBe('prohibited');
  });

  it('catches counterfeit risk in brand names', () => {
    const matches = screenPolicy(product(20, {}, { title: 'AAA Quality Rolex Style Watch' }));
    expect(matches.some((m) => m.category === 'counterfeit risk')).toBe(true);
  });

  it('reports the term that matched so false positives are auditable', () => {
    const [match] = screenPolicy(product(20, {}, { title: 'Ceramic Coffee Mug' }));
    expect(match.term).toBe('ceramic');
    expect(match.severity).toBe('caution');
  });

  it('passes an ordinary product clean', () => {
    expect(screenPolicy(product(20, {}, { title: 'Collapsible Silicone Dog Bowl' }))).toEqual([]);
  });
});

describe('scoreProduct', () => {
  it('ranks a profitable product above a cheap one that loses money', () => {
    const cheap = scoreProduct(product(4.2, healthySignals));
    const viable = scoreProduct(product(38, healthySignals));
    expect(viable.total).toBeGreaterThan(cheap.total);
    expect(cheap.flags.some((f) => f.code === 'negative-contribution')).toBe(true);
  });

  it('caps a blocked product instead of averaging the blocker away', () => {
    // Strong on every other axis, but unprofitable — must not surface near the top.
    const s = scoreProduct(product(4.2, healthySignals));
    expect(s.rawTotal).toBeGreaterThan(s.total);
    expect(s.total).toBeLessThanOrEqual(30);
  });

  it('vetoes a product that cannot be advertised however good the margins', () => {
    const s = scoreProduct(product(45, healthySignals, { title: 'Premium Vape Starter Kit' }));
    expect(s.flags.some((f) => f.severity === 'blocker')).toBe(true);
    expect(s.total).toBeLessThanOrEqual(25);
  });

  it('tells you the retail price that would fix an unprofitable product', () => {
    const s = scoreProduct(product(4.2, healthySignals));
    const flag = s.flags.find((f) => f.code === 'negative-contribution');
    expect(flag?.message).toMatch(/Needs \$\d+\.\d\d retail/);
  });

  it('penalises saturation found across suppliers', () => {
    const rare = scoreProduct(product(38, healthySignals, { sourceCount: 1, listingCount: 1 }));
    const everywhere = scoreProduct(product(38, healthySignals, { sourceCount: 5, listingCount: 9 }));
    expect(rare.total).toBeGreaterThan(everywhere.total);
    expect(everywhere.flags.some((f) => f.code === 'saturated')).toBe(true);
  });

  it('shrinks ratings toward the prior when reviews are thin', () => {
    const thin = scoreProduct(product(38, { rating: 4.9, reviewCount: 3 }));
    const proven = scoreProduct(product(38, { rating: 4.6, reviewCount: 1200 }));
    const qualityOf = (s: ReturnType<typeof scoreProduct>) =>
      s.factors.find((f) => f.name === 'quality')!.value;
    expect(qualityOf(proven)).toBeGreaterThan(qualityOf(thin));
  });

  it('blocks shipping too slow to run paid traffic against', () => {
    const s = scoreProduct(product(38, { ...healthySignals, shippingDays: { min: 18, max: 35 } }));
    expect(s.flags.some((f) => f.code === 'shipping-too-slow')).toBe(true);
    expect(s.total).toBeLessThan(scoreProduct(product(38, healthySignals)).total);
  });

  it('scores demand on a log scale so early traction counts most', () => {
    const demandOf = (units: number) =>
      scoreProduct(product(38, { unitsSold: units })).factors.find((f) => f.name === 'demand')!.value;
    expect(demandOf(110) - demandOf(10)).toBeGreaterThan((demandOf(1100) - demandOf(1000)) * 10);
  });

  it('reports confidence so a sparse score is not mistaken for a sure thing', () => {
    const bare = scoreProduct(product(38));
    const full = scoreProduct(product(38, healthySignals, { sourceCount: 2, weightGrams: 300 }));
    expect(full.confidence).toBeGreaterThan(bare.confidence);
    expect(bare.unknowns).toContain('demand');
    expect(bare.unknowns).toContain('quality');
  });

  it('keeps the total inside 0-100', () => {
    const best = scoreProduct(
      product(45, { rating: 5, reviewCount: 5000, unitsSold: 100_000, shippingDays: { min: 1, max: 3 }, verifiedSupplier: true },
        { sourceCount: 1, weightGrams: 150 }),
    );
    const worst = scoreProduct(product(2, { rating: 1, reviewCount: 900, unitsSold: 0 }));
    expect(best.total).toBeLessThanOrEqual(100);
    expect(best.total).toBeGreaterThan(60);
    expect(worst.total).toBeGreaterThanOrEqual(0);
  });

  it('respects a tightened contribution floor', () => {
    const p = product(24, healthySignals);
    const lenient = scoreProduct(p, DEFAULT_SCORING);
    const strict = scoreProduct(p, { ...DEFAULT_SCORING, minContribution: 20 });
    expect(strict.total).toBeLessThan(lenient.total);
  });
});

describe('rankProducts', () => {
  it('puts the money-maker first and the money-loser last', () => {
    const ranked = rankProducts([
      product(4.2, healthySignals, { id: 'a:1', title: 'Cheap bowl' }),
      product(38, healthySignals, { id: 'b:2', title: 'Weighted blanket' }),
      product(45, healthySignals, { id: 'c:3', title: 'Vape starter kit' }),
    ]);
    expect(ranked[0].title).toBe('Weighted blanket');
    expect(ranked[0].score.economics.viable).toBe(true);
  });
});
