/**
 * Store identity and commercial defaults.
 *
 * Everything customer-visible about the brand routes through here, so renaming
 * the store is one edit rather than a search across templates.
 */
export const STORE = {
  name: 'Muttward',
  tagline: 'Good things for good dogs',
  domain: 'muttward.com',
  /** Prefix for human-facing order references, e.g. MW-1043. */
  orderPrefix: 'MW',
  supportEmail: 'hello@muttward.com',
} as const;

/**
 * Settlement currency. The schema and engine both carry a currency per amount,
 * so multi-currency display is a presentation change rather than a migration —
 * but every order settles here until FX conversion is wired up.
 */
export const CURRENCY = 'USD';

/** Free shipping above this order value, in minor units. Set to null to disable. */
export const FREE_SHIPPING_THRESHOLD = 6000;

/** Flat shipping charged below the threshold, in minor units. */
export const FLAT_SHIPPING = 695;
