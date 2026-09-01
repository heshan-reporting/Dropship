/**
 * Fulfilment provider contract.
 *
 * Same shape as the sourcing engine's adapter pattern, for the same reason: the
 * order pipeline should not know or care which supplier ships a line item. A
 * provider either places orders automatically or it queues them for a human,
 * and `automatic` is how the rest of the system tells the difference.
 */

export interface ShippingAddress {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  /** ISO 3166-1 alpha-2. */
  country: string;
  region?: string;
  address1: string;
  address2?: string;
  city: string;
  postcode: string;
}

export interface FulfilmentLine {
  /** Provider-side product identifier, from the listing. */
  providerProductId: string | null;
  providerVariantId: string | null;
  quantity: number;
  title: string;
  /** Where the operator should buy it, for manual fulfilment. */
  sourceUrl?: string;
}

export interface FulfilmentRequest {
  orderId: string;
  orderNumber: string;
  address: ShippingAddress;
  lines: FulfilmentLine[];
}

export interface FulfilmentResult {
  /** queued when a human must act; submitted when the provider accepted it. */
  status: 'queued' | 'submitted' | 'failed';
  externalId?: string;
  message?: string;
}

export interface FulfilmentStatus {
  status: 'queued' | 'submitted' | 'shipped' | 'failed' | 'cancelled';
  trackingNumber?: string;
  trackingUrl?: string;
  message?: string;
}

export interface FulfilmentProvider {
  readonly id: string;
  readonly label: string;
  /** False means orders land in the manual queue rather than being placed. */
  readonly automatic: boolean;
  isConfigured(): boolean;
  submit(request: FulfilmentRequest): Promise<FulfilmentResult>;
  check(externalId: string): Promise<FulfilmentStatus>;
}
