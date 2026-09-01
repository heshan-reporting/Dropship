import type {
  AdapterCapabilities,
  AdapterContext,
  Marketplace,
  NormalizedProduct,
  SearchQuery,
  SourceAdapter,
} from '../../core/types.js';
import type { BrightDataClient } from './bright-data.js';

/**
 * Base for scraping adapters.
 *
 * The important design choice lives in `extractJsonState`. Marketplaces ship
 * their listing data as JSON embedded in the page — the same payload their own
 * frontend hydrates from — and those object keys are far more stable than the
 * generated CSS class names (`lh_kt`, `tp-offer-product-new`) that most scrapers
 * key off and that rotate on every frontend deploy.
 *
 * So: read the embedded state first, and treat CSS selectors as the fallback
 * rather than the mechanism. Subclasses implement `parse` and decide.
 */
export abstract class ScrapeAdapter implements SourceAdapter {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly marketplace: Marketplace;
  readonly kind = 'scrape' as const;

  readonly capabilities: AdapterCapabilities = {
    supplierDetail: false,
    moq: false,
    salesVolume: true,
    fulfilment: false,
  };

  constructor(protected readonly client: BrightDataClient) {}

  isConfigured(): boolean {
    return this.client.isConfigured();
  }

  /** Build the marketplace search URL for a term. */
  protected abstract searchUrl(query: SearchQuery): string;

  /** Turn fetched HTML into normalized products. */
  protected abstract parse(html: string, query: SearchQuery, ctx: AdapterContext): NormalizedProduct[];

  async search(query: SearchQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const url = this.searchUrl(query);
    ctx.log(`fetching ${url}`);

    const html = await this.client.fetchHtml(url, ctx.signal);
    if (!html || html.length < 500) {
      throw new Error('Unlocker returned an empty or truncated page');
    }

    const products = this.parse(html, query, ctx);
    if (products.length === 0) {
      // Distinguish "no results" from "our extraction broke" — the second is
      // the failure mode that quietly rots and it deserves a loud message.
      throw new Error(
        `Fetched ${html.length} bytes but extracted 0 products — the page shape has likely changed`,
      );
    }
    return products;
  }

  /**
   * Pull an embedded JSON object out of a page by variable name, e.g.
   * `window._dida_config_ = {...}` or `<script>window.__DATA__ = {...}</script>`.
   *
   * Brace-matches rather than regexing the whole object so nested braces and
   * braces inside strings do not truncate the payload.
   */
  protected extractJsonState(html: string, variableNames: string[]): unknown | null {
    for (const name of variableNames) {
      const marker = html.indexOf(name);
      if (marker === -1) continue;

      const start = html.indexOf('{', marker);
      if (start === -1) continue;

      const json = sliceBalancedObject(html, start);
      if (!json) continue;

      try {
        return JSON.parse(json);
      } catch {
        // Try the next candidate name rather than failing outright.
      }
    }
    return null;
  }
}

/** Return the substring from `start` through its matching close brace. */
function sliceBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  let quote = '';
  let escaped = false;

  for (let i = start; i < source.length; i++) {
    const char = source[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === '\\') {
      escaped = true;
      continue;
    }
    if (inString) {
      if (char === quote) inString = false;
      continue;
    }
    if (char === '"' || char === "'") {
      inString = true;
      quote = char;
      continue;
    }
    if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** Depth-first search for the first array whose members carry all `keys`. */
export function findArrayByKeys(node: unknown, keys: string[], depth = 0): any[] | null {
  if (depth > 8 || node === null || typeof node !== 'object') return null;

  if (Array.isArray(node)) {
    const looksRight =
      node.length > 0 &&
      node.some(
        (item) =>
          item && typeof item === 'object' && keys.every((k) => k in (item as object)),
      );
    if (looksRight) return node;
    for (const item of node) {
      const found = findArrayByKeys(item, keys, depth + 1);
      if (found) return found;
    }
    return null;
  }

  for (const value of Object.values(node as Record<string, unknown>)) {
    const found = findArrayByKeys(value, keys, depth + 1);
    if (found) return found;
  }
  return null;
}
