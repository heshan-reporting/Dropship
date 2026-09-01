'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cartCount, onCartChange, readCart } from '@/lib/cart';

export default function CartButton() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    const sync = () => setCount(cartCount(readCart()));
    sync();
    return onCartChange(sync);
  }, []);

  return (
    <Link
      href="/cart"
      className="relative rounded-full border border-black/10 px-4 py-2 text-sm transition hover:border-black/25"
    >
      Cart
      {count > 0 && (
        <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-white">
          {count}
        </span>
      )}
    </Link>
  );
}
