import Link from 'next/link';
import { activeListings } from '@/lib/queries';
import { formatAmount } from '@/lib/money';
import { STORE } from '@/lib/store';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const products = await activeListings();

  return (
    <>
      <section className="mx-auto max-w-6xl px-5 pb-10 pt-16 sm:pt-24">
        <h1 className="max-w-2xl font-display text-4xl leading-tight tracking-tight sm:text-6xl">
          {STORE.tagline}
        </h1>
        <p className="mt-5 max-w-lg text-lg text-ink-soft">
          Considered pieces for people who talk about their dog more than they talk
          about themselves. Printed to order, shipped worldwide.
        </p>
      </section>

      <section className="mx-auto max-w-6xl px-5 pb-24">
        {products.length === 0 ? (
          <EmptyCatalogue />
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 lg:grid-cols-3">
            {products.map((p) => {
              const images = (p.images as string[]) ?? [];
              return (
                <Link key={p.id} href={`/product/${p.slug}`} className="group">
                  <div className="aspect-square overflow-hidden rounded-lg bg-bone-dark">
                    {images[0] && (
                      // Supplier CDNs vary too widely for next/image config to be
                      // worth it here, and these are already CDN-optimised.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={images[0]}
                        alt={p.title}
                        className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                      />
                    )}
                  </div>
                  <h2 className="mt-3 text-sm leading-snug">{p.title}</h2>
                  <p className="mt-1 text-sm text-ink-soft">
                    {formatAmount(p.priceAmount, p.currency)}
                  </p>
                </Link>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}

function EmptyCatalogue() {
  return (
    <div className="rounded-lg border border-dashed border-black/15 px-6 py-16 text-center">
      <p className="font-display text-xl">Nothing listed yet</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-ink-soft">
        Find products in the research tool, then publish the ones that clear their
        costs. Anything you activate shows up here.
      </p>
      <Link
        href="/admin/research"
        className="mt-6 inline-block rounded-full bg-ink px-5 py-2.5 text-sm text-white transition hover:bg-black"
      >
        Open research
      </Link>
    </div>
  );
}
