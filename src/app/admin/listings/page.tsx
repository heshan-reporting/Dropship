import { allListings } from '@/lib/queries';
import ListingsClient from './listings-client';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Listings' };

export default async function ListingsPage() {
  const rows = await allListings();

  return (
    <ListingsClient
      listings={rows.map((l) => ({
        id: l.id,
        slug: l.slug,
        title: l.title,
        image: ((l.images as string[]) ?? [])[0] ?? null,
        costAmount: l.costAmount,
        priceAmount: l.priceAmount,
        currency: l.currency,
        status: l.status,
        fulfilmentProvider: l.fulfilmentProvider,
        providerVariantId: l.providerVariantId,
      }))}
    />
  );
}
