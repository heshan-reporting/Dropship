import Stripe from 'stripe';

/**
 * Stripe client.
 *
 * Card details never touch this application — checkout redirects to Stripe's
 * hosted page, so PCI scope, 3-D Secure and fraud handling stay on their side.
 * All we hold are session and payment-intent references.
 */
let client: Stripe | null = null;

export function stripe(): Stripe {
  if (client) return client;
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error('STRIPE_SECRET_KEY is not set. Add it to .env to take payments.');
  }
  client = new Stripe(key);
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

/** Absolute base URL for Stripe redirect targets. */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  // Vercel injects this per deployment, which covers previews too.
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return 'http://localhost:3000';
}
