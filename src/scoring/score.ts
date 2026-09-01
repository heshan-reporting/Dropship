import { formatMoney, toDecimal } from '../core/normalize.js';
import {
  computeEconomics,
  DEFAULT_ECONOMICS,
  retailForTargetMargin,
  type EconomicsConfig,
  type UnitEconomics,
} from './economics.js';
import { screenPolicy, worstSeverity, type PolicyMatch } from './policy.js';
import type { NormalizedProduct } from '../core/types.js';

/**
 * Product scoring built around one question: would selling this make money?
 *
 * The naive version of this — cheap product, high star rating, lots of sales —
 * reliably ranks money-losers at the top, because a $4 product marked up 3x
 * yields about $5 of margin and costs $15 to advertise. Unit economics are
 * therefore the heaviest factor here, and things that make a product
 * unsellable are treated as vetoes rather than as a few points off.
 */

export interface ScoreFactor {
  name: string;
  /** 0–1 before weighting. */
  value: number;
  weight: number;
  /** Why this factor landed where it did. */
  note: string;
}

export type FlagSeverity = 'blocker' | 'warning' | 'note';

export interface ScoreFlag {
  severity: FlagSeverity;
  code: string;
  message: string;
}

export interface ProductScore {
  /** 0–100, after any blocker caps are applied. */
  total: number;
  /** What the weighted factors alone produced, before caps. */
  rawTotal: number;
  factors: ScoreFactor[];
  flags: ScoreFlag[];
  economics: UnitEconomics;
  policy: PolicyMatch[];
  /**
   * 0–1. How much of the scoring model the source actually supported. A 70 built
   * on six known factors is a very different claim from a 70 built on two.
   */
  confidence: number;
  /** Factors that could not be judged because the source omitted the data. */
  unknowns: string[];
}

export interface ScoringConfig {
  economics: EconomicsConfig;
  /** Contribution margin per order below which a product is not worth selling. */
  minContribution: number;
  /** Delivery beyond this many days is treated as a blocker for paid traffic. */
  maxShippingDays: number;
  /** Distinct suppliers carrying the same item before it counts as saturated. */
  saturationThreshold: number;
  weights: Record<FactorName, number>;
}

type FactorName =
  | 'economics'
  | 'demand'
  | 'competition'
  | 'quality'
  | 'logistics'
  | 'supplier';

export const DEFAULT_SCORING: ScoringConfig = {
  economics: DEFAULT_ECONOMICS,
  minContribution: 5,
  maxShippingDays: 21,
  saturationThreshold: 4,
  weights: {
    economics: 0.35,
    demand: 0.2,
    competition: 0.15,
    quality: 0.15,
    logistics: 0.1,
    supplier: 0.05,
  },
};

export function scoreProduct(
  product: NormalizedProduct,
  config: ScoringConfig = DEFAULT_SCORING,
): ProductScore {
  const factors: ScoreFactor[] = [];
  const flags: ScoreFlag[] = [];
  const unknowns: string[] = [];
  const s = product.signals;

  const economics = computeEconomics(product, config.economics);
  const policy = screenPolicy(product);

  // --- Unit economics ------------------------------------------------------
  // Scored on contribution margin per order, which is the number that decides
  // whether volume helps you or bankrupts you faster.
  const contribution = toDecimal(economics.contributionMargin);
  const economicsValue = clamp01(contribution / (config.minContribution * 4));
  factors.push({
    name: 'economics',
    value: economicsValue,
    weight: config.weights.economics,
    note: economics.viable
      ? `${formatMoney(economics.contributionMargin)}/order after ${formatMoney(economics.estimatedCac)} CAC`
      : `loses ${formatMoney({ ...economics.contributionMargin, amount: Math.abs(economics.contributionMargin.amount) })}/order once ads are paid for`,
  });

  if (contribution <= 0) {
    const target = retailForTargetMargin(product, 0.15, config.economics);
    flags.push({
      severity: 'blocker',
      code: 'negative-contribution',
      message:
        toDecimal(target) > 0
          ? `Unprofitable at a ${config.economics.targetMarkup}x markup. Needs ${formatMoney(target)} retail to clear 15%.`
          : 'Unprofitable at any realistic retail price under these cost assumptions.',
    });
  } else if (contribution < config.minContribution) {
    flags.push({
      severity: 'warning',
      code: 'thin-contribution',
      message: `Only ${formatMoney(economics.contributionMargin)}/order — one refund wipes out several sales.`,
    });
  }

  // --- Demand --------------------------------------------------------------
  if (s.unitsSold !== undefined || s.reviewCount !== undefined) {
    // Log scale: the gap between 10 and 100 sales matters far more than the gap
    // between 10,000 and 100,000.
    const volume = s.unitsSold ?? (s.reviewCount ?? 0) * 20;
    factors.push({
      name: 'demand',
      value: clamp01(Math.log10(volume + 1) / 4),
      weight: config.weights.demand,
      note:
        s.unitsSold !== undefined
          ? `${s.unitsSold.toLocaleString()} units sold`
          : `${s.reviewCount?.toLocaleString()} reviews (sales estimated)`,
    });
  } else {
    unknowns.push('demand');
  }

  // --- Competition ---------------------------------------------------------
  // Derived from the merge: how many distinct suppliers carry this same item.
  // Demand without competition is the whole game; demand with heavy competition
  // is a bidding war you will lose to whoever has better ad creative.
  const sourceCount = product.sourceCount ?? 1;
  const listingCount = product.listingCount ?? 1;
  if (listingCount > 1 || product.sourceCount !== undefined) {
    const saturation = clamp01((sourceCount - 1) / config.saturationThreshold);
    factors.push({
      name: 'competition',
      value: 1 - saturation,
      weight: config.weights.competition,
      note:
        sourceCount === 1
          ? 'found at a single supplier — little direct price competition'
          : `carried by ${sourceCount} suppliers across ${listingCount} listings`,
    });

    if (sourceCount >= config.saturationThreshold) {
      flags.push({
        severity: 'warning',
        code: 'saturated',
        message: `${sourceCount} suppliers carry this — expect price competition and high ad costs.`,
      });
    }
  } else {
    unknowns.push('competition');
  }

  // --- Quality -------------------------------------------------------------
  if (s.rating !== undefined) {
    // Shrink toward the prior when review counts are low, so 4.9 from three
    // reviews does not outrank 4.6 from twelve hundred.
    const PRIOR_RATING = 4.2;
    const PRIOR_WEIGHT = 30;
    const n = s.reviewCount ?? 0;
    const adjusted = (s.rating * n + PRIOR_RATING * PRIOR_WEIGHT) / (n + PRIOR_WEIGHT);

    factors.push({
      name: 'quality',
      // Below 3.5 stars is disqualifying in practice; above 4.7 barely differs.
      value: clamp01((adjusted - 3.5) / 1.2),
      weight: config.weights.quality,
      note:
        n > 0
          ? `${s.rating.toFixed(1)}★ over ${n.toLocaleString()} reviews (adjusted ${adjusted.toFixed(2)})`
          : `${s.rating.toFixed(1)}★ but no review count — heavily discounted`,
    });

    if (s.rating < 4.0 && n >= 50) {
      flags.push({
        severity: 'warning',
        code: 'low-rating',
        message: `${s.rating.toFixed(1)}★ over ${n.toLocaleString()} reviews — expect refunds and chargebacks.`,
      });
    }
  } else {
    unknowns.push('quality');
  }

  // --- Logistics -----------------------------------------------------------
  const logisticsParts: string[] = [];
  let logisticsValue: number | null = null;

  if (s.shippingDays) {
    const worst = s.shippingDays.max;
    logisticsValue = clamp01(1 - worst / config.maxShippingDays);
    logisticsParts.push(`${s.shippingDays.min}–${worst} days`);

    if (worst > config.maxShippingDays) {
      flags.push({
        severity: 'blocker',
        code: 'shipping-too-slow',
        message: `${worst}-day delivery — chargeback risk and unsellable on paid traffic.`,
      });
    }
  }

  if (product.weightGrams) {
    // Bulk quietly destroys margin; it is already priced into `economics`, but
    // it also predicts damage rates and return shipping cost.
    const bulkPenalty = clamp01(product.weightGrams / 2000);
    logisticsValue = logisticsValue === null ? 1 - bulkPenalty : (logisticsValue + (1 - bulkPenalty)) / 2;
    logisticsParts.push(`${(product.weightGrams / 1000).toFixed(2)}kg`);
  }

  if (logisticsValue === null) {
    unknowns.push('logistics');
  } else {
    factors.push({
      name: 'logistics',
      value: logisticsValue,
      weight: config.weights.logistics,
      note: logisticsParts.join(', '),
    });
  }

  // --- Supplier trust ------------------------------------------------------
  const trustParts: string[] = [];
  let trust = 0.5; // neutral prior
  if (s.verifiedSupplier) {
    trust += 0.3;
    trustParts.push('verified supplier');
  }
  if (product.supplier?.yearsActive !== undefined) {
    trust += Math.min(0.2, product.supplier.yearsActive * 0.04);
    trustParts.push(`${product.supplier.yearsActive}y trading`);
  }
  factors.push({
    name: 'supplier',
    value: clamp01(trust),
    weight: config.weights.supplier,
    note: trustParts.length ? trustParts.join(', ') : 'no trust signals, neutral prior',
  });

  // --- Policy --------------------------------------------------------------
  for (const match of policy) {
    flags.push({
      severity: match.severity === 'prohibited' ? 'blocker' : match.severity === 'restricted' ? 'warning' : 'note',
      code: `policy-${match.category.replace(/\s+/g, '-')}`,
      message:
        match.severity === 'prohibited'
          ? `Cannot be advertised on Meta or TikTok (${match.category}, matched "${match.term}").`
          : `${match.category} — expect ad review friction (matched "${match.term}").`,
    });
  }

  // Re-weight across the factors we could actually judge, so a source that omits
  // sales data is not silently punished against one that reports it.
  const weightSum = factors.reduce((sum, f) => sum + f.weight, 0);
  const rawTotal =
    weightSum === 0 ? 0 : factors.reduce((sum, f) => sum + f.value * f.weight, 0) / weightSum;

  // Blockers cap rather than subtract. "Cannot be advertised" is not worth a few
  // points off — it disqualifies the product, and averaging would let a strong
  // margin hide it near the top of the list.
  const CAPS: Record<string, number> = {
    'negative-contribution': 0.3,
    'shipping-too-slow': 0.35,
  };
  let cap = 1;
  for (const flag of flags) {
    if (flag.severity !== 'blocker') continue;
    cap = Math.min(cap, flag.code.startsWith('policy-') ? 0.25 : (CAPS[flag.code] ?? 0.3));
  }

  const totalWeight = Object.values(config.weights).reduce((a, b) => a + b, 0);
  const confidence = totalWeight === 0 ? 0 : weightSum / totalWeight;

  return {
    total: Math.round(Math.min(rawTotal, cap) * 100),
    rawTotal: Math.round(rawTotal * 100),
    factors,
    flags,
    economics,
    policy,
    confidence: Math.round(confidence * 100) / 100,
    unknowns,
  };
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
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
      // Break ties toward the product we actually know something about.
      if (b.score.confidence !== a.score.confidence) return b.score.confidence - a.score.confidence;
      return b.score.economics.contributionMargin.amount - a.score.economics.contributionMargin.amount;
    });
}

export { computeEconomics, DEFAULT_ECONOMICS, retailForTargetMargin } from './economics.js';
export { screenPolicy, worstSeverity } from './policy.js';
export type { UnitEconomics, EconomicsConfig, AdCostModel } from './economics.js';
export type { PolicyMatch, PolicySeverity } from './policy.js';
