/**
 * Seed the store with a demo catalogue.
 *
 *   npm run seed
 *
 * Useful before supplier credentials exist, so the storefront and admin have
 * something real to render. Costs and prices are realistic print-on-demand
 * figures, chosen so the range spans products that clear their advertising costs
 * and products that do not — which is what makes the margin column worth reading.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db, listings } from '../src/db/index.js';
import { newId, slugify } from '../src/lib/money.js';

interface Seed {
  title: string;
  description: string;
  cost: number;
  price: number;
  provider: 'printify' | 'manual';
  variantId?: string;
  palette: [string, string];
  motif: 'hoodie' | 'print' | 'mug' | 'sweatshirt' | 'tote' | 'blanket';
}

const CATALOGUE: Seed[] = [
  {
    title: 'Good Boy Heavyweight Hoodie',
    description:
      'A proper hoodie — 400gsm brushed fleece, boxy cut, ribbed cuffs that keep their shape.\nPrinted to order in the warehouse closest to you.',
    cost: 2240,
    price: 6800,
    provider: 'printify',
    variantId: '12874',
    palette: ['#2f2a26', '#d8cec0'],
    motif: 'hoodie',
  },
  {
    title: 'Breed Portrait — Giclée Print',
    description:
      'Hand-drawn breed portraits on 200gsm archival matte stock.\nSized for a standard frame, so you are not hunting for custom mounts.',
    cost: 820,
    price: 4200,
    provider: 'printify',
    variantId: '33901',
    palette: ['#b4531f', '#f6ede2'],
    motif: 'print',
  },
  {
    title: 'Dog Person Enamel Mug',
    description:
      'Speckled enamel, rolled steel rim, genuinely camp-fire safe.\nHolds 350ml, which is one proper coffee rather than a polite one.',
    cost: 690,
    price: 2600,
    provider: 'printify',
    variantId: '20155',
    palette: ['#3f5f52', '#eee6d8'],
    motif: 'mug',
  },
  {
    title: 'Personalised Pet Portrait Sweatshirt',
    description:
      'Send a photo, get your own dog on a heavyweight crewneck.\nDrawn by hand, not traced by a filter — turnaround is about four days.',
    cost: 2380,
    price: 7400,
    provider: 'printify',
    variantId: '18220',
    palette: ['#6b4c8a', '#efe7f2'],
    motif: 'sweatshirt',
  },
  {
    title: 'Muddy Paws Canvas Tote',
    description:
      'Heavy 340gsm cotton canvas with a boxed base, so it stands up on its own.\nLong enough handles to go over a shoulder in a coat.',
    cost: 940,
    price: 3200,
    provider: 'printify',
    variantId: '41067',
    palette: ['#8a6d3b', '#f4ecdd'],
    motif: 'tote',
  },
  {
    title: 'Adventure Dog Sherpa Blanket',
    description:
      'Sherpa-backed and heavy enough to stay put on a sofa.\nThe one the dog will claim within a day.',
    cost: 2050,
    price: 5900,
    provider: 'printify',
    variantId: '29388',
    palette: ['#2c4a5e', '#e7eef2'],
    motif: 'blanket',
  },
  {
    title: 'Collapsible Silicone Travel Bowl',
    description:
      'Food-grade silicone, folds flat, clips to a lead.\nSourced outside Printify, so orders for it land in the manual queue.',
    cost: 420,
    price: 1400,
    provider: 'manual',
    palette: ['#a8a29e', '#f2ece2'],
    motif: 'mug',
  },
];

/** Simple product-shot stand-ins, so the catalogue reads as a catalogue. */
function productSvg({ palette, motif, title }: Seed): string {
  const [ink, bg] = palette;
  const shapes: Record<Seed['motif'], string> = {
    hoodie:
      '<path d="M300 250 L360 215 Q400 200 400 250 L420 340 L370 360 L370 560 L230 560 L230 360 L180 340 L200 250 Q200 200 240 215 Z" /><path d="M270 215 Q300 265 330 215" fill="none" stroke-width="9" />',
    print:
      '<rect x="205" y="180" width="190" height="250" rx="4" /><circle cx="300" cy="290" r="52" fill="' +
      bg +
      '" /><path d="M262 350 Q300 305 338 350 Z" fill="' + bg + '" />',
    mug: '<path d="M215 235 h150 v170 q0 40 -40 40 h-70 q-40 0 -40 -40 Z" /><path d="M370 275 q55 0 55 45 t-55 45" fill="none" stroke-width="20" />',
    sweatshirt:
      '<path d="M300 245 L365 215 Q405 205 405 250 L425 335 L372 355 L372 555 L228 555 L228 355 L175 335 L195 250 Q195 205 235 215 Z" /><circle cx="300" cy="410" r="46" fill="' +
      bg +
      '" />',
    tote: '<path d="M205 275 h190 l16 265 h-222 Z" /><path d="M252 275 q0 -70 48 -70 t48 70" fill="none" stroke-width="14" />',
    blanket:
      '<path d="M180 250 q120 -35 240 0 v250 q-120 35 -240 0 Z" /><path d="M180 330 q120 -35 240 0 M180 410 q120 -35 240 0" fill="none" stroke-width="10" stroke="' +
      bg +
      '" />',
  };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 600" width="600" height="600" role="img" aria-label="${title}">
  <rect width="600" height="600" fill="${bg}"/>
  <g fill="${ink}" stroke="${ink}" stroke-linejoin="round" stroke-linecap="round">${shapes[motif]}</g>
  <circle cx="300" cy="600" r="150" fill="${ink}" opacity="0.06"/>
</svg>`;
}

async function main() {
  const dir = join(process.cwd(), 'public', 'seed');
  mkdirSync(dir, { recursive: true });

  const existing = await db.select({ id: listings.id }).from(listings);
  if (existing.length > 0) {
    console.log(`Catalogue already has ${existing.length} listings — nothing to do.`);
    console.log('Delete them from /admin/listings first if you want a clean seed.');
    return;
  }

  for (const item of CATALOGUE) {
    const slug = slugify(item.title);
    writeFileSync(join(dir, `${slug}.svg`), productSvg(item));

    await db.insert(listings).values({
      id: newId('lst'),
      slug,
      title: item.title,
      description: item.description,
      images: [`/seed/${slug}.svg`],
      sourceKey: `printify-api:demo-${slug}`,
      marketplace: item.provider === 'printify' ? 'printify' : 'cj',
      costAmount: item.cost,
      priceAmount: item.price,
      currency: 'USD',
      fulfilmentProvider: item.provider,
      providerProductId: item.provider === 'printify' ? `demo-${slug}` : null,
      providerVariantId: item.variantId ?? null,
      status: 'active',
    });

    console.log(`  ${item.title} — $${(item.cost / 100).toFixed(2)} → $${(item.price / 100).toFixed(2)}`);
  }

  console.log(`\nSeeded ${CATALOGUE.length} listings. Open http://localhost:3000`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
