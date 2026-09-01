import { requestJson } from '../../engine/core/http.js';
import type {
  FulfilmentProvider,
  FulfilmentRequest,
  FulfilmentResult,
  FulfilmentStatus,
} from './types.js';

const BASE = 'https://api.printify.com/v1';

/**
 * Printify fulfilment.
 *
 * Orders are created and then explicitly sent to production as a second call.
 * Those are deliberately separate here too: creation failing is recoverable and
 * retryable, whereas production is the irreversible step that spends money, so
 * it should not be buried inside a single opaque "submit".
 */
export class PrintifyFulfilment implements FulfilmentProvider {
  readonly id = 'printify';
  readonly label = 'Printify';
  readonly automatic = true;

  constructor(
    private readonly token = process.env.PRINTIFY_API_TOKEN,
    private readonly shopId = process.env.PRINTIFY_SHOP_ID,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.token && this.shopId);
  }

  async submit(request: FulfilmentRequest): Promise<FulfilmentResult> {
    const lineItems = request.lines
      .filter((l) => l.providerProductId && l.providerVariantId)
      .map((l) => ({
        product_id: l.providerProductId,
        variant_id: Number(l.providerVariantId),
        quantity: l.quantity,
      }));

    if (lineItems.length === 0) {
      return { status: 'failed', message: 'No Printify-backed line items on this order' };
    }

    const a = request.address;
    const created = await requestJson<{ id: string }>(`${BASE}/shops/${this.shopId}/orders.json`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        // Our order id, so a retry cannot create a duplicate on Printify's side.
        external_id: request.orderId,
        label: request.orderNumber,
        line_items: lineItems,
        shipping_method: 1,
        send_shipping_notification: false,
        address_to: {
          first_name: a.firstName,
          last_name: a.lastName,
          email: a.email,
          phone: a.phone ?? '',
          country: a.country,
          region: a.region ?? '',
          address1: a.address1,
          address2: a.address2 ?? '',
          city: a.city,
          zip: a.postcode,
        },
      }),
    });

    await requestJson(`${BASE}/shops/${this.shopId}/orders/${created.id}/send_to_production.json`, {
      method: 'POST',
      headers: this.headers(),
      // Production is the step that spends money; never retry it blindly.
      retries: 0,
    });

    return { status: 'submitted', externalId: created.id };
  }

  async check(externalId: string): Promise<FulfilmentStatus> {
    const order = await requestJson<PrintifyOrder>(
      `${BASE}/shops/${this.shopId}/orders/${externalId}.json`,
      { headers: this.headers() },
    );

    const shipment = order.shipments?.[0];
    if (shipment) {
      return {
        status: 'shipped',
        trackingNumber: shipment.number,
        trackingUrl: shipment.url,
      };
    }

    const failed = ['canceled', 'cancelled'].includes(order.status ?? '');
    return { status: failed ? 'cancelled' : 'submitted', message: order.status };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.token}`,
      'Content-Type': 'application/json',
    };
  }
}

interface PrintifyOrder {
  id: string;
  status?: string;
  shipments?: { number: string; url: string; carrier?: string }[];
}
