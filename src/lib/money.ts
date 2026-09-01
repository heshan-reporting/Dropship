import { CURRENCY } from './store.js';

/**
 * Presentation helpers for money. Amounts are integer minor units everywhere —
 * the same convention the sourcing engine uses — and are only turned into
 * decimals at the moment they are rendered.
 */

export function formatAmount(amount: number, currency: string = CURRENCY): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    // Whole amounts read better without trailing zeroes on a storefront.
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount / 100);
}

/** Percentage margin of an order or line, guarding against divide-by-zero. */
export function marginPct(revenue: number, cost: number): number {
  if (revenue <= 0) return 0;
  return Math.round(((revenue - cost) / revenue) * 100);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

/** Short, collision-resistant id. Ordered by time so listings sort naturally. */
export function newId(prefix: string): string {
  const time = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${time}${rand}`;
}
