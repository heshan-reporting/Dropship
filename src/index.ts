/**
 * Public surface of the sourcing engine.
 *
 *   const engine = createEngine();
 *   const result = await engine.search({ term: 'collapsible dog bowl' });
 *   const ranked = rankProducts(result.products);
 */

import { loadConfig, type EngineConfig } from './config.js';
import { AdapterRegistry } from './core/registry.js';
import { searchProducts, type SearchOptions } from './core/search.js';
import { CjDropshippingAdapter } from './adapters/api/cj-dropshipping.js';
import { AliExpressDsAdapter } from './adapters/api/aliexpress-ds.js';
import { PrintifyAdapter } from './adapters/api/printify.js';
import { BrightDataClient } from './adapters/scrape/bright-data.js';
import { AliExpressScrapeAdapter } from './adapters/scrape/aliexpress-scrape.js';
import type { SearchQuery, SearchResult, SourceAdapter } from './core/types.js';

export * from './core/types.js';
export { AdapterRegistry } from './core/registry.js';
export { searchProducts } from './core/search.js';
export { ScrapeAdapter, findArrayByKeys } from './adapters/scrape/base.js';
export { BrightDataClient } from './adapters/scrape/bright-data.js';
export {
  scoreProduct,
  rankProducts,
  DEFAULT_SCORING,
  type ProductScore,
  type ScoredProduct,
  type ScoringConfig,
} from './scoring/score.js';
export { money, minor, formatMoney, toDecimal, parsePriceRange, dedupe } from './core/normalize.js';
export { loadConfig, type EngineConfig } from './config.js';

export interface Engine {
  registry: AdapterRegistry;
  search(query: SearchQuery, options?: SearchOptions): Promise<SearchResult>;
  /** Which adapters have credentials, grouped for display. */
  status(): { id: string; label: string; kind: string; configured: boolean }[];
}

/** Build the default engine: every adapter, API-first with scrape fallback. */
export function createEngine(config: EngineConfig = loadConfig()): Engine {
  const brightData = new BrightDataClient(config.brightData);

  const adapters: SourceAdapter[] = [
    new CjDropshippingAdapter(config.cj),
    new AliExpressDsAdapter(config.aliexpress),
    new PrintifyAdapter(config.printify),
    new AliExpressScrapeAdapter(brightData),
  ];

  const registry = new AdapterRegistry().registerAll(adapters);

  return {
    registry,
    search: (query, options) => searchProducts(registry, query, options),
    status: () =>
      registry.all().map((a) => ({
        id: a.id,
        label: a.label,
        kind: a.kind,
        configured: a.isConfigured(),
      })),
  };
}
