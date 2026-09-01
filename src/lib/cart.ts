'use client';

/**
 * Cart state, kept in localStorage.
 *
 * Guest checkout means there is no session to hang a server-side cart on, and a
 * browser cart avoids a whole class of state to manage. The trade-off is that
 * its contents are attacker-controlled — only listing ids and quantities are
 * ever sent to the server, and every price is re-read from the database at
 * checkout. Nothing here is trusted for money.
 */

const KEY = 'muttward.cart.v1';
const CHANGED = 'muttward:cart-changed';

export interface CartLine {
  listingId: string;
  quantity: number;
}

export function readCart(): CartLine[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((l) => l && typeof l.listingId === 'string' && Number.isInteger(l.quantity))
      .map((l) => ({ listingId: l.listingId, quantity: Math.max(1, Math.min(99, l.quantity)) }));
  } catch {
    // Private browsing, cleared storage, or a corrupt value: an empty cart is
    // always a safe answer.
    return [];
  }
}

function write(lines: CartLine[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(lines));
  } catch {
    // Storage unavailable — the cart simply will not persist across reloads.
  }
  window.dispatchEvent(new CustomEvent(CHANGED));
}

export function addToCart(listingId: string, quantity = 1): void {
  const lines = readCart();
  const existing = lines.find((l) => l.listingId === listingId);
  if (existing) existing.quantity = Math.min(99, existing.quantity + quantity);
  else lines.push({ listingId, quantity });
  write(lines);
}

export function setQuantity(listingId: string, quantity: number): void {
  const lines = readCart().filter((l) => l.listingId !== listingId);
  if (quantity > 0) lines.push({ listingId, quantity: Math.min(99, quantity) });
  write(lines);
}

export function clearCart(): void {
  write([]);
}

export function cartCount(lines: CartLine[]): number {
  return lines.reduce((sum, l) => sum + l.quantity, 0);
}

export function onCartChange(handler: () => void): () => void {
  window.addEventListener(CHANGED, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(CHANGED, handler);
    window.removeEventListener('storage', handler);
  };
}
