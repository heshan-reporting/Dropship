import { requestJson } from '../../core/http.js';
import { cleanTitle, minor } from '../../core/normalize.js';
import type {
  AdapterCapabilities,
  AdapterContext,
  NormalizedProduct,
  SearchQuery,
  SourceAdapter,
} from '../../core/types.js';
import type { EngineConfig } from '../../config.js';

const BASE = 'https://api.printify.com/v1';

/**
 * Printify — print-on-demand, included because POD sidesteps the two problems
 * that sink most dropshipping stores: inventory risk and month-long shipping
 * from overseas warehouses.
 *
 * The catalogue has no server-side text search, so this fetches blueprints and
 * filters locally, then resolves real costs for the top matches only — pricing
 * lives behind a per-blueprint print-provider call and fetching it for the
 * whole catalogue would be hundreds of requests.
 */
export class PrintifyAdapter implements SourceAdapter {
  readonly id = 'printify-api';
  readonly label = 'Printify (POD)';
  readonly marketplace = 'printify' as const;
  readonly kind = 'api' as const;
  readonly capabilities: AdapterCapabilities = {
    supplierDetail: true,
    moq: true,
    salesVolume: false,
    fulfilment: true,
  };

  private blueprintCache?: { at: number; data: Blueprint[] };

  constructor(private readonly config: EngineConfig['printify']) {}

  isConfigured(): boolean {
    return Boolean(this.config.token);
  }

  async search(query: SearchQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    const blueprints = await this.blueprints(ctx);
    const limit = Math.min(query.limit ?? 20, 25);

    const terms = query.term.toLowerCase().split(/\s+/).filter(Boolean);
    const matches = blueprints
      .map((b) => ({ blueprint: b, score: matchScore(b, terms) }))
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((m) => m.blueprint);

    ctx.log(`matched ${matches.length} blueprints of ${blueprints.length}`);

    // Cost resolution is one request per blueprint — bound the concurrency so a
    // broad search does not open 25 sockets at once.
    const resolved = await mapWithConcurrency(matches, 4, async (blueprint) => {
      const cost = await this.lowestCost(blueprint.id, ctx).catch((err) => {
        ctx.log(`cost lookup failed for blueprint ${blueprint.id}: ${err.message}`);
        return undefined;
      });
      return this.toProduct(blueprint, cost, query.includeRaw);
    });

    return resolved;
  }

  /** The blueprint catalogue is large and near-static; cache it for the process. */
  private async blueprints(ctx: AdapterContext): Promise<Blueprint[]> {
    const ONE_HOUR = 60 * 60 * 1000;
    if (this.blueprintCache && Date.now() - this.blueprintCache.at < ONE_HOUR) {
      return this.blueprintCache.data;
    }

    const data = await requestJson<Blueprint[]>(`${BASE}/catalog/blueprints.json`, {
      headers: this.headers(),
      signal: ctx.signal,
    });

    this.blueprintCache = { at: Date.now(), data };
    return data;
  }

  /** Cheapest variant across print providers, in minor units. */
  private async lowestCost(
    blueprintId: number,
    ctx: AdapterContext,
  ): Promise<{ amount: number; provider: string } | undefined> {
    const providers = await requestJson<PrintProvider[]>(
      `${BASE}/catalog/blueprints/${blueprintId}/print_providers.json`,
      { headers: this.headers(), signal: ctx.signal },
    );
    if (providers.length === 0) return undefined;

    // The first provider is Printify's default; querying all of them would
    // multiply request count for a marginal pricing difference.
    const provider = providers[0];
    const detail = await requestJson<{ variants: Variant[] }>(
      `${BASE}/catalog/blueprints/${blueprintId}/print_providers/${provider.id}/variants.json`,
      { headers: this.headers(), signal: ctx.signal },
    );

    const costs = (detail.variants ?? [])
      .map((v) => v.cost ?? v.price)
      .filter((c): c is number => typeof c === 'number' && c > 0);

    if (costs.length === 0) return undefined;
    return { amount: Math.min(...costs), provider: provider.title };
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.config.token}`,
      'Content-Type': 'application/json',
    };
  }

  private toProduct(
    blueprint: Blueprint,
    cost: { amount: number; provider: string } | undefined,
    includeRaw?: boolean,
  ): NormalizedProduct {
    return {
      id: `printify-api:${blueprint.id}`,
      source: this.id,
      marketplace: this.marketplace,
      sourceId: String(blueprint.id),
      url: `https://printify.com/app/product-catalog/${blueprint.id}`,
      title: cleanTitle(blueprint.title),
      description: blueprint.description,
      images: blueprint.images ?? [],
      category: blueprint.brand,
      tags: [blueprint.brand, blueprint.model].filter((t): t is string => Boolean(t)),
      // Printify quotes costs in minor units already.
      price: minor(cost?.amount ?? 0),
      moq: 1,
      supplier: cost ? { name: cost.provider } : undefined,
      signals: {
        inStock: true,
        // POD is printed on demand domestically — the core reason to use it.
        shippingDays: { min: 3, max: 8 },
        verifiedSupplier: true,
      },
      fetchedAt: new Date().toISOString(),
      raw: includeRaw ? blueprint : undefined,
    };
  }
}

/** Score a blueprint against search terms; title hits count double. */
function matchScore(blueprint: Blueprint, terms: string[]): number {
  const title = blueprint.title.toLowerCase();
  const haystack = `${title} ${blueprint.brand ?? ''} ${blueprint.model ?? ''}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    if (title.includes(term)) score += 2;
    else if (haystack.includes(term)) score += 1;
  }
  return score;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });

  await Promise.all(workers);
  return results;
}

interface Blueprint {
  id: number;
  title: string;
  description?: string;
  brand?: string;
  model?: string;
  images?: string[];
}

interface PrintProvider {
  id: number;
  title: string;
}

interface Variant {
  id: number;
  cost?: number;
  price?: number;
}
