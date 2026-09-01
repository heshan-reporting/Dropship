import { describe, expect, it } from 'vitest';
import { AdapterRegistry } from '../src/engine/core/registry.js';
import { searchProducts } from '../src/engine/core/search.js';
import { money } from '../src/engine/core/normalize.js';
import type {
  AdapterContext,
  AdapterKind,
  Marketplace,
  NormalizedProduct,
  SearchQuery,
  SourceAdapter,
} from '../src/engine/core/types.js';

/** Configurable stand-in so we can drive the orchestrator's branches directly. */
class FakeAdapter implements SourceAdapter {
  readonly capabilities = {
    supplierDetail: false,
    moq: false,
    salesVolume: false,
    fulfilment: false,
  };
  calls = 0;

  constructor(
    readonly id: string,
    readonly marketplace: Marketplace,
    readonly kind: AdapterKind,
    private readonly behaviour: {
      configured?: boolean;
      results?: number;
      throws?: string;
      delayMs?: number;
    } = {},
  ) {}

  get label(): string {
    return this.id;
  }

  isConfigured(): boolean {
    return this.behaviour.configured ?? true;
  }

  async search(query: SearchQuery, ctx: AdapterContext): Promise<NormalizedProduct[]> {
    this.calls++;
    if (this.behaviour.delayMs) {
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, this.behaviour.delayMs);
        ctx.signal.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new Error('aborted'));
        });
      });
    }
    if (this.behaviour.throws) throw new Error(this.behaviour.throws);

    // Distinct nouns and well-separated prices: these are meant to be different
    // products, not the same listing seen twice, so dedupe must leave them alone.
    const nouns = ['kettle', 'lantern', 'harness', 'trowel', 'decanter', 'stapler'];
    return Array.from({ length: this.behaviour.results ?? 1 }, (_, i) => ({
      id: `${this.id}:${i}`,
      source: this.id,
      marketplace: this.marketplace,
      sourceId: String(i),
      url: `https://example.com/${this.id}/${i}`,
      title: `${this.id} ${nouns[i % nouns.length]} ${i}`,
      images: [],
      price: money(10 * (i + 1)),
      signals: {},
      fetchedAt: new Date().toISOString(),
    }));
  }
}

describe('adapter chain ordering', () => {
  it('puts APIs before scrapers and configured before unconfigured', () => {
    const registry = new AdapterRegistry().registerAll([
      new FakeAdapter('scrape', 'aliexpress', 'scrape'),
      new FakeAdapter('api-off', 'aliexpress', 'api', { configured: false }),
      new FakeAdapter('api-on', 'aliexpress', 'api'),
    ]);

    expect(registry.chainFor('aliexpress').map((a) => a.id)).toEqual([
      'api-on',
      'scrape',
      'api-off',
    ]);
  });

  it('rejects duplicate adapter ids', () => {
    const registry = new AdapterRegistry().register(new FakeAdapter('dup', 'cj', 'api'));
    expect(() => registry.register(new FakeAdapter('dup', 'cj', 'api'))).toThrow(/Duplicate/);
  });
});

describe('searchProducts', () => {
  it('does not call the scraper when the API succeeds', async () => {
    const api = new FakeAdapter('api', 'aliexpress', 'api', { results: 3 });
    const scrape = new FakeAdapter('scrape', 'aliexpress', 'scrape', { results: 3 });
    const registry = new AdapterRegistry().registerAll([api, scrape]);

    const result = await searchProducts(registry, { term: 'x' });

    expect(api.calls).toBe(1);
    expect(scrape.calls).toBe(0);
    expect(result.sourcesQueried).toEqual(['api']);
  });

  it('falls back to the scraper when the API throws', async () => {
    const api = new FakeAdapter('api', 'aliexpress', 'api', { throws: 'gateway 500' });
    const scrape = new FakeAdapter('scrape', 'aliexpress', 'scrape', { results: 2 });
    const registry = new AdapterRegistry().registerAll([api, scrape]);

    const result = await searchProducts(registry, { term: 'x' });

    expect(scrape.calls).toBe(1);
    expect(result.products).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({ source: 'api', recovered: true });
  });

  it('falls back when the API succeeds but returns nothing', async () => {
    const api = new FakeAdapter('api', 'aliexpress', 'api', { results: 0 });
    const scrape = new FakeAdapter('scrape', 'aliexpress', 'scrape', { results: 2 });
    const registry = new AdapterRegistry().registerAll([api, scrape]);

    const result = await searchProducts(registry, { term: 'x' });

    expect(scrape.calls).toBe(1);
    expect(result.products).toHaveLength(2);
  });

  it('records an unrecovered error when the last adapter also fails', async () => {
    const api = new FakeAdapter('api', 'aliexpress', 'api', { throws: 'boom' });
    const scrape = new FakeAdapter('scrape', 'aliexpress', 'scrape', { throws: 'also boom' });
    const registry = new AdapterRegistry().registerAll([api, scrape]);

    const result = await searchProducts(registry, { term: 'x' });

    expect(result.products).toHaveLength(0);
    expect(result.errors.map((e) => e.recovered)).toEqual([true, false]);
  });

  it('skips unconfigured adapters instead of failing', async () => {
    const registry = new AdapterRegistry().registerAll([
      new FakeAdapter('off', 'cj', 'api', { configured: false }),
      new FakeAdapter('on', 'printify', 'api', { results: 1 }),
    ]);

    const result = await searchProducts(registry, { term: 'x' });

    expect(result.sourcesSkipped).toEqual(['off']);
    expect(result.products).toHaveLength(1);
  });

  it('lets one marketplace fail without sinking the others', async () => {
    const registry = new AdapterRegistry().registerAll([
      new FakeAdapter('broken', 'aliexpress', 'api', { throws: 'down' }),
      new FakeAdapter('healthy', 'cj', 'api', { results: 4 }),
    ]);

    const result = await searchProducts(registry, { term: 'x' });

    expect(result.products).toHaveLength(4);
    expect(result.errors).toHaveLength(1);
  });

  it('times out a slow adapter and falls through', async () => {
    const slow = new FakeAdapter('slow', 'aliexpress', 'api', { delayMs: 5_000 });
    const scrape = new FakeAdapter('scrape', 'aliexpress', 'scrape', { results: 1 });
    const registry = new AdapterRegistry().registerAll([slow, scrape]);

    const result = await searchProducts(registry, { term: 'x' }, { timeoutMs: 50 });

    expect(result.products).toHaveLength(1);
    expect(result.errors[0].source).toBe('slow');
  });

  it('honours the marketplace filter and the limit', async () => {
    const registry = new AdapterRegistry().registerAll([
      new FakeAdapter('ae', 'aliexpress', 'api', { results: 5 }),
      new FakeAdapter('cj', 'cj', 'api', { results: 5 }),
    ]);

    const filtered = await searchProducts(registry, { term: 'x', marketplaces: ['cj'] });
    expect(filtered.sourcesQueried).toEqual(['cj']);

    const limited = await searchProducts(registry, { term: 'x', limit: 3 });
    expect(limited.products).toHaveLength(3);
  });
});
