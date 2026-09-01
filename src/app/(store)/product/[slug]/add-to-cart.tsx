'use client';

import { useState } from 'react';
import { addToCart } from '@/lib/cart';

export default function AddToCart({ listingId }: { listingId: string }) {
  const [added, setAdded] = useState(false);

  return (
    <button
      onClick={() => {
        addToCart(listingId);
        setAdded(true);
        // Revert the confirmation so the control stays usable for a second add.
        setTimeout(() => setAdded(false), 1800);
      }}
      className="mt-8 w-full rounded-full bg-ink px-6 py-3.5 text-sm text-white transition hover:bg-black active:scale-[0.99]"
    >
      {added ? 'Added to cart' : 'Add to cart'}
    </button>
  );
}
