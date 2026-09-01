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

const BASE = 'https://developers.cjdropshipping.com/api2.0/v1';

/**
 * CJ Dropshipping — the most dropship-native of the API sources: real MOQs,
 * warehouse locations, and fulfilment through the same integration.
 *
 * Note CJ rate-limits token minting to roughly one call per five minutes, so
 * the access token is cached in-process and reused until shortly before expiry.
 * Minting on every search will get you locked out.
 */
export class CjDropshippingAdapter implements SourceAdapter {
  readonly id = 'cj-api';
  readonly label = 'CJ Dropshipping';
  readonly marketplace = 'cj' as const;
  readonly kind = 'api' as const;
  readonly capabilities: AdapterCapabilities = {
    supplierDetail: false,
    moq: true,
    salesVolume: true,
    fulfilment: true,
  };

  private token?: { value: string; expiresAt: number };

  constructor(private readonly config: EngineConfig['cj']) {}

  isConfigured(): boolean {
    return Boolean(this.config.email && this.config.apiKey);
  }

  async search(query: SearchQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const token = await this.accessToken(ctx);
    const params = new URLSearchParams({
      pageNum: '1',
      pageSize: String(Math.min(query.limit ?? 20, 200)),
      productNameEn: query.term,
    });

    const body = await requestJson<CjListResponse>(`${BASE}/product/list?${params}`, {
      headers: { 'CJ-Access-Token': token },
      signal: ctx.signal,
    });

    if (!body.result || !body.data) {
      throw new Error(`CJ search failed: ${body.message ?? 'unknown error'}`);
    }

    ctx.log(`matched ${body.data.total} products`);
    return body.data.list.map((item) => this.toProduct(item, query.includeRaw));
  }

  /** Mint or reuse an access token. */
  private async accessToken(ctx: AdapterContext): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;

    const body = await requestJson<CjAuthResponse>(`${BASE}/authentication/getAccessToken`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.config.email, password: this.config.apiKey }),
      signal: ctx.signal,
      // Re-minting after a 429 would compound the lockout.
      retries: 0,
    });

    if (!body.result || !body.data?.accessToken) {
      throw new Error(`CJ auth failed: ${body.message ?? 'no token returned'}`);
    }

    const expiry = body.data.accessTokenExpiryDate
      ? Date.parse(body.data.accessTokenExpiryDate)
      : Date.now() + 60 * 60 * 1000;

    // Refresh five minutes early to avoid racing the expiry.
    this.token = { value: body.data.accessToken, expiresAt: expiry - 5 * 60 * 1000 };
    ctx.log('minted access token');
    return this.token.value;
  }

  private toProduct(item: CjProduct, includeRaw?: boolean): NormalizedProduct {
    const images = parseImages(item.productImage);
    const [low, high] = parseSellPrice(item.sellPrice);

    return {
      id: `cj-api:${item.pid}`,
      source: this.id,
      marketplace: this.marketplace,
      sourceId: item.pid,
      url: `https://www.cjdropshipping.com/product/-p-${item.pid}.html`,
      title: cleanTitle(item.productNameEn ?? ''),
      images,
      category: item.categoryName,
      price: money(low),
      priceMax: high !== undefined ? money(high) : undefined,
      moq: 1, // CJ sells single units — that is the point of the platform.
      signals: {
        unitsSold: item.listedNum,
        inStock: true,
        // CJ quotes per-warehouse; the country list is the useful part here.
        shipsFrom: item.sourceFrom ? [item.sourceFrom] : undefined,
      },
      fetchedAt: new Date().toISOString(),
      raw: includeRaw ? item : undefined,
    };
  }
}

/** CJ returns images as a JSON-encoded array inside a string field. */
function parseImages(raw?: string): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((u) => absoluteUrl(String(u)));
  } catch {
    // Single URL rather than an encoded array.
  }
  return [absoluteUrl(raw)];
}

/** `sellPrice` arrives as "2.55" or as a "2.55-4.10" range. */
function parseSellPrice(raw?: string | number): [number, number | undefined] {
  if (raw === undefined || raw === null) return [0, undefined];
  if (typeof raw === 'number') return [raw, undefined];
  const parts = raw.split('-').map((p) => Number.parseFloat(p.trim())).filter(Number.isFinite);
  if (parts.length === 0) return [0, undefined];
  if (parts.length === 1) return [parts[0], undefined];
  return [Math.min(...parts), Math.max(...parts)];
}

interface CjAuthResponse {
  result: boolean;
  message?: string;
  data?: { accessToken: string; accessTokenExpiryDate?: string };
}

interface CjListResponse {
  result: boolean;
  message?: string;
  data?: { total: number; list: CjProduct[] };
}

interface CjProduct {
  pid: string;
  productNameEn?: string;
  productImage?: string;
  sellPrice?: string | number;
  categoryName?: string;
  listedNum?: number;
  sourceFrom?: string;
}
