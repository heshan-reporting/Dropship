import { createHmac } from 'node:crypto';
import { requestJson } from '../../core/http.js';
import { absoluteUrl, cleanTitle, money } from '../../core/normalize.js';
import type {
  AdapterCapabilities,
  AdapterContext,
  NormalizedProduct,
  SearchQuery,
  SourceAdapter,
} from '../../core/types.js';
import type { EngineConfig } from '../../config.js';

const GATEWAY = 'https://api-sg.aliexpress.com/sync';
const API_VERSION = '2.0';
const SEARCH_METHOD = 'aliexpress.ds.text.search';

/**
 * AliExpress via the official Open Platform (dropshipping / DS API).
 *
 * This is the legitimate route to the same catalogue the scraper in
 * `adapters/scrape` reaches by force: stable field names, no selector rot, and
 * affiliate commission on orders. It needs an approved app key from
 * openservice.aliexpress.com.
 *
 * The gateway signs requests rather than using a bearer token — see `sign()`.
 * Response envelopes on this platform are versioned and have shifted shape
 * before, so `extractProducts` deliberately probes several known paths instead
 * of assuming one.
 */
export class AliExpressDsAdapter implements SourceAdapter {
  readonly id = 'aliexpress-api';
  readonly label = 'AliExpress (Open Platform)';
  readonly marketplace = 'aliexpress' as const;
  readonly kind = 'api' as const;
  readonly capabilities: AdapterCapabilities = {
    supplierDetail: false,
    moq: false,
    salesVolume: true,
    fulfilment: true,
  };

  constructor(private readonly config: EngineConfig['aliexpress']) {}

  isConfigured(): boolean {
    return Boolean(this.config.appKey && this.config.appSecret);
  }

  async search(query: SearchQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const params: Record<string, string> = {
      app_key: this.config.appKey!,
      method: SEARCH_METHOD,
      format: 'json',
      v: API_VERSION,
      sign_method: 'sha256',
      timestamp: String(Date.now()),
      keyWord: query.term,
      pageSize: String(Math.min(query.limit ?? 20, 50)),
      pageIndex: '1',
      local: 'en_US',
      countryCode: 'US',
      currency: 'USD',
    };
    if (this.config.trackingId) params.trackingId = this.config.trackingId;

    params.sign = this.sign(params);

    const body = await requestJson<unknown>(`${GATEWAY}?${new URLSearchParams(params)}`, {
      signal: ctx.signal,
    });

    const error = extractError(body);
    if (error) throw new Error(`AliExpress API: ${error}`);

    const items = extractProducts(body);
    ctx.log(`matched ${items.length} products`);
    return items.map((item) => this.toProduct(item, query.includeRaw));
  }

  /**
   * TOP-gateway signature: sort params by key, concatenate `key+value` with no
   * separators, HMAC-SHA256 under the app secret, uppercase hex. The `sign`
   * field itself is excluded from the input.
   */
  private sign(params: Record<string, string>): string {
    const payload = Object.keys(params)
      .filter((k) => k !== 'sign')
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');

    return createHmac('sha256', this.config.appSecret!)
      .update(payload, 'utf8')
      .digest('hex')
      .toUpperCase();
  }

  private toProduct(item: AeProduct, includeRaw?: boolean): NormalizedProduct {
    const id = String(item.product_id ?? item.itemId ?? '');
    const priceRaw =
      item.target_sale_price ?? item.sale_price ?? item.app_sale_price ?? item.targetSalePrice;
    const price = Number.parseFloat(String(priceRaw ?? '0'));

    const images = [item.product_main_image_url ?? item.image ?? item.imageUrl]
      .filter((u): u is string => Boolean(u))
      .map((u) => absoluteUrl(u));

    const rating = toNumber(item.evaluate_rate ?? item.averageStarRate);
    const sold = toNumber(item.lastest_volume ?? item.orders ?? item.trade_count);

    return {
      id: `aliexpress-api:${id}`,
      source: this.id,
      marketplace: this.marketplace,
      sourceId: id,
      url:
        item.product_detail_url ??
        item.promotion_link ??
        `https://www.aliexpress.com/item/${id}.html`,
      title: cleanTitle(String(item.product_title ?? item.title ?? '')),
      images,
      category: item.second_level_category_name ?? item.first_level_category_name,
      price: money(Number.isFinite(price) ? price : 0, item.target_sale_price_currency ?? 'USD'),
      moq: 1,
      signals: {
        // AliExpress reports evaluation as a percentage, not stars.
        rating: rating !== undefined ? clampStars(rating) : undefined,
        unitsSold: sold,
        shipsFrom: item.ship_to_country ? [item.ship_to_country] : undefined,
        inStock: true,
      },
      fetchedAt: new Date().toISOString(),
      raw: includeRaw ? item : undefined,
    };
  }
}

/** "94.5%" or 94.5 → 4.7 stars; a value already on a 0–5 scale passes through. */
function clampStars(value: number): number {
  const stars = value > 5 ? (value / 100) * 5 : value;
  return Math.round(Math.min(5, Math.max(0, stars)) * 10) / 10;
}

function toNumber(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const n = Number.parseFloat(String(value).replace(/[^\d.]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}

function extractError(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, any>;
  if (b.error_response) {
    return b.error_response.msg ?? b.error_response.sub_msg ?? 'gateway error';
  }
  return undefined;
}

/**
 * Walk the response for the product array. The gateway wraps results in a
 * method-derived envelope whose inner keys have changed across API versions, so
 * probe the known shapes and fall back to a structural search.
 */
function extractProducts(body: unknown): AeProduct[] {
  if (!body || typeof body !== 'object') return [];
  const root = body as Record<string, any>;

  const envelope =
    root[`${SEARCH_METHOD.replace(/\./g, '_')}_response`] ??
    root.aliexpress_ds_text_search_response ??
    root.resp_result ??
    root;

  const candidates = [
    envelope?.data?.products?.selection_search_product,
    envelope?.data?.products?.product,
    envelope?.data?.products,
    envelope?.result?.products?.product,
    envelope?.result?.products,
    envelope?.products,
  ];

  for (const c of candidates) {
    if (Array.isArray(c)) return c as AeProduct[];
  }

  // Last resort: first array of objects that looks like products.
  return findProductArray(envelope) ?? [];
}

function findProductArray(node: unknown, depth = 0): AeProduct[] | null {
  if (depth > 5 || !node || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    const looksRight = node.some(
      (item) =>
        item &&
        typeof item === 'object' &&
        ('product_id' in item || 'itemId' in item || 'product_title' in item),
    );
    return looksRight ? (node as AeProduct[]) : null;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findProductArray(value, depth + 1);
    if (found) return found;
  }
  return null;
}

interface AeProduct {
  product_id?: string | number;
  itemId?: string | number;
  product_title?: string;
  title?: string;
  product_detail_url?: string;
  promotion_link?: string;
  product_main_image_url?: string;
  image?: string;
  imageUrl?: string;
  target_sale_price?: string | number;
  targetSalePrice?: string | number;
  sale_price?: string | number;
  app_sale_price?: string | number;
  target_sale_price_currency?: string;
  evaluate_rate?: string | number;
  averageStarRate?: string | number;
  lastest_volume?: number;
  orders?: number;
  trade_count?: number;
  ship_to_country?: string;
  first_level_category_name?: string;
  second_level_category_name?: string;
}
