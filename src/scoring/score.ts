import { toDecimal } from '../core/normalize.js';
import type { NormalizedProduct } from '../core/types.js';

/**
 * Transparent, explainable product scoring.
 *
 * Deliberately not an LLM call: the factors below are the ones dropshippers
 * actually argue about, and a numeric breakdown you can inspect beats a model
 * asserting "8/10" with no way to audit it. An AI pass is better spent on the
 * things heuristics genuinely cannot judge — creative angle, saturation,
 * ad-policy risk — layered on top of this, not replacing it.
 */

export interface ScoreFactor {
  name: string;
  /** 0–1 before weighting. */
  value: number;
  weight: number;
  /** Why this factor landed where it did. */
  note: string;
}

export interface ProductScore {
  /** 0–100. */
  total: number;
  factors: ScoreFactor[];
  /** Factors that could not be judged because the source omitted the data. */
  unknowns: string[];
}

export interface ScoringConfig {
  /** Retail multiple you intend to sell at. Drives the margin factor. */
  targetMarkup: number;
  /** Ceiling for impulse-buy pricing, in major units. */
  impulseCeiling: number;
  /** Shipping beyond this many days is treated as a hard negative. */
  maxAcceptableShippingDays: number;
}

export const DEFAULT_SCORING: ScoringConfig = {
  targetMarkup: 3,
  impulseCeiling: 40,
  maxAcceptableShippingDays: 14,
};

export function scoreProduct(
  product: NormalizedProduct,
  config: ScoringConfig = DEFAULT_SCORING,
): ProductScore {
  const factors: ScoreFactor[] = [];
  const unknowns: string[] = [];
  const s = product.signals;

  // --- Margin headroom -----------------------------------------------------
  // Cheap enough to mark up and still land under the impulse ceiling.
  const cost = toDecimal(product.price);
  const projectedRetail = cost * config.targetMarkup;
  let marginValue: number;
  let marginNote: string;
  if (cost <= 0) {
    marginValue = 0;
    marginNote = 'no usable cost price';
  } else if (projectedRetail <= config.impulseCeiling) {
    // Reward room to breathe, but do not reward near-zero cost items that are
    // usually low quality or mispriced listings.
    marginValue = cost < 1 ? 0.6 : 1;
    marginNote = `$${cost.toFixed(2)} → $${projectedRetail.toFixed(2)} retail, inside impulse range`;
  } else {
    const overshoot = projectedRetail / config.impulseCeiling;
    marginValue = Math.max(0, 1 - (overshoot - 1));
    marginNote = `$${projectedRetail.toFixed(2)} projected retail exceeds $${config.impulseCeiling} impulse ceiling`;
  }
  factors.push({ name: 'margin', value: marginValue, weight: 0.3, note: marginNote });

  // --- Demand --------------------------------------------------------------
  if (s.unitsSold !== undefined || s.reviewCount !== undefined) {
    // Log scale: the gap between 10 and 100 sales matters far more than
    // between 10,000 and 100,000.
    const volume = s.unitsSold ?? (s.reviewCount ?? 0) * 20;
    const value = Math.min(1, Math.log10(volume + 1) / 4); // saturates near 10k
    factors.push({
      name: 'demand',
      value,
      weight: 0.25,
      note: s.unitsSold !== undefined
        ? `${s.unitsSold.toLocaleString()} units sold`
        : `${s.reviewCount?.toLocaleString()} reviews (sales estimated)`,
    });
  } else {
    unknowns.push('demand');
  }

  // --- Quality -------------------------------------------------------------
  if (s.rating !== undefined) {
    // Below 3.5 stars is disqualifying in practice; above 4.7 barely differs.
    const value = Math.max(0, Math.min(1, (s.rating - 3.5) / 1.2));
    factors.push({
      name: 'quality',
      value,
      weight: 0.2,
      note: `${s.rating.toFixed(1)}★${s.reviewCount ? ` over ${s.reviewCount.toLocaleString()} reviews` : ''}`,
    });
  } else {
    unknowns.push('quality');
  }

  // --- Shipping ------------------------------------------------------------
  if (s.shippingDays) {
    const worst = s.shippingDays.max;
    const value = Math.max(0, Math.min(1, 1 - worst / config.maxAcceptableShippingDays));
    factors.push({
      name: 'shipping',
      value,
      weight: 0.15,
      note: `${s.shippingDays.min}–${worst} days`,
    });
  } else {
    unknowns.push('shipping');
  }

  // --- Supplier trust ------------------------------------------------------
  const trustParts: string[] = [];
  let trust = 0.5; // neutral prior
  if (s.verifiedSupplier) {
    trust += 0.3;
    trustParts.push('verified supplier');
  }
  if (product.supplier?.yearsActive !== undefined) {
    const years = product.supplier.yearsActive;
    trust += Math.min(0.2, years * 0.04);
    trustParts.push(`${years}y trading`);
  }
  factors.push({
    name: 'supplier',
    value: Math.min(1, trust),
    weight: 0.1,
    note: trustParts.length ? trustParts.join(', ') : 'no trust signals, neutral prior',
  });

  // Re-weight across the factors we could actually judge, so a source that
  // omits sales data is not silently penalised against one that reports it.
  const weightSum = factors.reduce((sum, f) => sum + f.weight, 0);
  const total = weightSum === 0
    ? 0
    : factors.reduce((sum, f) => sum + f.value * f.weight, 0) / weightSum;

  return { total: Math.round(total * 100), factors, unknowns };
}

export interface ScoredProduct extends NormalizedProduct {
  score: ProductScore;
}

/** Score a batch and return it ranked best-first. */
export function rankProducts(
  products: NormalizedProduct[],
  config: ScoringConfig = DEFAULT_SCORING,
): ScoredProduct[] {
  return products
    .map((p) => ({ ...p, score: scoreProduct(p, config) }))
    .sort((a, b) => {
      if (b.score.total !== a.score.total) return b.score.total - a.score.total;
      // Break ties toward the record we know more about.
      return a.score.unknowns.length - b.score.unknowns.length;
    });
}
