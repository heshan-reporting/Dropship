import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { listingBySlug } from '@/lib/queries';
import { formatAmount } from '@/lib/money';
import AddToCart from './add-to-cart';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const listing = await listingBySlug(slug);
  return { title: listing?.title ?? 'Not found' };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const listing = await listingBySlug(slug);

  // A draft or archived listing must not be reachable by guessing its URL.
  if (!listing || listing.status !== 'active') notFound();

  const images = (listing.images as string[]) ?? [];

  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-5 py-12 lg:grid-cols-2 lg:gap-16 lg:py-20">
      <div className="space-y-3">
        <div className="aspect-square overflow-hidden rounded-lg bg-bone-dark">
          {images[0] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={images[0]} alt={listing.title} className="h-full w-full object-cover" />
          )}
        </div>
        {images.length > 1 && (
          <div className="grid grid-cols-4 gap-3">
            {images.slice(1, 5).map((src, i) => (
              <div key={i} className="aspect-square overflow-hidden rounded bg-bone-dark">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" className="h-full w-full object-cover" />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="lg:pt-6">
        <h1 className="font-display text-3xl leading-tight tracking-tight sm:text-4xl">
          {listing.title}
        </h1>
        <p className="mt-4 text-2xl">{formatAmount(listing.priceAmount, listing.currency)}</p>

        {listing.description && (
          <div className="mt-8 space-y-4 leading-relaxed text-ink-soft">
            {listing.description
              .split('\n')
              .filter(Boolean)
              .map((para, i) => (
                <p key={i}>{para}</p>
              ))}
          </div>
        )}

        <AddToCart listingId={listing.id} />

        <p className="mt-6 text-xs text-muted">
          Printed to order. Ships worldwide, typically within 3–8 business days.
        </p>
      </div>
    </div>
  );
}
