'use client';

import { useEffect } from 'react';
import { clearCart } from '@/lib/cart';

/**
 * Empty the browser cart once an order page renders.
 *
 * Reaching this page means the items are on an order, so leaving them in the
 * cart would invite an accidental second purchase of the same thing.
 */
export default function ClearCartOnMount() {
  useEffect(() => {
    clearCart();
  }, []);
  return null;
}
