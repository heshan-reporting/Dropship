import { minor, money, toDecimal } from '../core/normalize.js';
import type { Money, NormalizedProduct } from '../core/types.js';

/**
 * Unit economics for a dropshipped product.
 *
 * This is the part most product-research tools skip, and it is the part that
 * decides whether a store makes money. A $4 product with a 3x markup looks
 * wonderful until you subtract freight, payment fees, and the ad spend needed
 * to find the customer — at which point it is a $9 loss per order.
 *
 * Everything here is a model, not a measurement. Replace `AdCostModel` with
 * your own numbers as soon as you have real campaign data; the defaults are
 * industry rules of thumb for cold paid social traffic, not your account.
 */

export interface AdCostModel {
  /**
   * Estimated cost to acquire one customer, as a function of retail price.
   * Cheap impulse products still cost real money to sell — CAC does not fall
   * to zero as price does, which is exactly why sub-$20 products struggle.
   */
  baseCac: number;
  /** Additional CAC per dollar of retail price. Higher tickets cost more to sell. */
  cacPerRetailDollar: number;
  /** Share of orders you expect to convert at all, once someone lands. */
  ceiling: number;
}

export interface EconomicsConfig {
  /** Retail multiple applied to landed cost. */
  targetMarkup: number;
  /** Payment processing, as a fraction of retail (Stripe/Shopify ≈ 2.9% + 30c). */
  paymentFeeRate: number;
  paymentFeeFixed: number;
  /** Freight estimate when the source gives no weight, as a fraction of cost. */
  fallbackShippingRate: number;
  /**
   * Ceiling on the cost-fraction fallback. Freight tracks size and weight, not
   * price — without a cap, a percentage estimate charges $17 to ship a $24 item
   * purely because it is expensive. Weight-based estimates ignore this bound.
   */
  fallbackShippingCeiling: number;
  /** Freight per kg when weight is known. */
  shippingPerKg: number;
  /** Minimum freight charge on any parcel. */
  shippingMinimum: number;
  /** Expected refund/chargeback rate, subtracted from contribution. */
  refundRate: number;
  ads: AdCostModel;
}

export const DEFAULT_ECONOMICS: EconomicsConfig = {
  targetMarkup: 3,
  paymentFeeRate: 0.029,
  paymentFeeFixed: 0.3,
  fallbackShippingRate: 0.7,
  fallbackShippingCeiling: 12,
  shippingPerKg: 8,
  shippingMinimum: 2.5,
  refundRate: 0.04,
  ads: {
    // Cold paid-social CPA rarely drops below ~$12 whatever you are selling.
    baseCac: 12,
    cacPerRetailDollar: 0.22,
    ceiling: 1,
  },
};

export interface UnitEconomics {
  productCost: Money;
  shipping: Money;
  /** Cost to get one unit to the customer's door. */
  landedCost: Money;
  suggestedRetail: Money;
  paymentFees: Money;
  refundAllowance: Money;
  /** Retail less landed cost, fees and refunds — before advertising. */
  grossMargin: Money;
  estimatedCac: Money;
  /** What you actually keep per order. Negative means you pay to sell. */
  contributionMargin: Money;
  /** The most you could pay per customer and still break even. */
  breakEvenCac: Money;
  /** Contribution as a fraction of retail. */
  contributionRate: number;
  /** True when a sale makes money under these assumptions. */
  viable: boolean;
}

export function computeEconomics(
  product: NormalizedProduct,
  config: EconomicsConfig = DEFAULT_ECONOMICS,
): UnitEconomics {
  const cost = toDecimal(product.price);
  const shipping = estimateShipping(product, cost, config);
  const landed = cost + shipping;

  // Anchor retail on product cost, not landed cost. The market prices a blanket
  // on what a blanket is worth; it does not pay you extra because yours shipped
  // from further away. Marking up landed cost would inflate retail in step with
  // freight and hide exactly the margin problem heavy items cause — so freight
  // is subtracted as a cost below rather than multiplied into the price.
  const retail = product.suggestedRetail
    ? toDecimal(product.suggestedRetail)
    : cost * config.targetMarkup;

  const fees = retail * config.paymentFeeRate + config.paymentFeeFixed;
  const refunds = retail * config.refundRate;
  const gross = retail - landed - fees - refunds;

  const cac = Math.min(
    config.ads.baseCac + retail * config.ads.cacPerRetailDollar,
    retail * config.ads.ceiling,
  );

  const contribution = gross - cac;

  return {
    productCost: money(cost),
    shipping: money(shipping),
    landedCost: money(landed),
    suggestedRetail: money(retail),
    paymentFees: money(fees),
    refundAllowance: money(refunds),
    grossMargin: money(gross),
    estimatedCac: money(cac),
    contributionMargin: money(contribution),
    breakEvenCac: money(Math.max(0, gross)),
    contributionRate: retail > 0 ? contribution / retail : 0,
    viable: contribution > 0,
  };
}

/**
 * Freight estimate. Weight is far more predictive than price, so use it when
 * the source reports it and fall back to a cost multiple when it does not.
 */
function estimateShipping(
  product: NormalizedProduct,
  cost: number,
  config: EconomicsConfig,
): number {
  if (product.weightGrams && product.weightGrams > 0) {
    return Math.max(config.shippingMinimum, (product.weightGrams / 1000) * config.shippingPerKg);
  }
  return Math.min(
    config.fallbackShippingCeiling,
    Math.max(config.shippingMinimum, cost * config.fallbackShippingRate),
  );
}

/** Retail price at which this product would break even on advertising. */
export function retailForTargetMargin(
  product: NormalizedProduct,
  targetContributionRate: number,
  config: EconomicsConfig = DEFAULT_ECONOMICS,
): Money {
  const cost = toDecimal(product.price);
  const shipping = estimateShipping(product, cost, config);
  const landed = cost + shipping;

  // Solve retail for: (R - landed - fees(R) - refunds(R) - cac(R)) / R = target
  const a =
    1 -
    config.paymentFeeRate -
    config.refundRate -
    config.ads.cacPerRetailDollar -
    targetContributionRate;
  const b = landed + config.paymentFeeFixed + config.ads.baseCac;

  if (a <= 0) return minor(0); // No price satisfies the target under these costs.
  return money(b / a);
}
