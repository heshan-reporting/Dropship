import { AdapterRegistry } from './registry.js';
import { dedupe } from './normalize.js';
import type {
  Marketplace,
  NormalizedProduct,
  SearchQuery,
  SearchResult,
  SourceAdapter,
  SourceError,
  SourceId,
} from './types.js';

export interface SearchOptions {
  /** Per-adapter budget. One slow marketplace must not stall the rest. */
  timeoutMs?: number;
  /** Emit progress; defaults to silent. */
  log?: (msg: string, meta?: Record<string, unknown>) => void;
}

const DEFAULT_TIMEOUT_MS = 20_000;

/**
 * Fans out across marketplaces in parallel and, within each marketplace, walks
 * its adapter chain until one succeeds — so a dead API quietly falls through to
 * the scraper instead of losing the source.
 *
 * A failing marketplace never fails the search. Errors are collected and
 * returned alongside whatever did come back.
 */
export async function searchProducts(
  registry: AdapterRegistry,
  query: SearchQuery,
  options: SearchOptions = {},
): Promise<SearchResult> {
  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const log = options.log ?? (() => {});

  const targets: Marketplace[] = query.marketplaces?.length
    ? query.marketplaces
    : registry.marketplaces();

  const errors: SourceError[] = [];
  const sourcesQueried: SourceId[] = [];
  const sourcesSkipped: SourceId[] = [];

  const perMarketplace = await Promise.all(
    targets.map((mp) =>
      runChain(registry.chainFor(mp), mp, query, {
        timeoutMs,
        log,
        errors,
        sourcesQueried,
        sourcesSkipped,
      }),
    ),
  );

  const merged = dedupe(perMarketplace.flat());
  const limit = query.limit ?? 50;

  return {
    products: merged.slice(0, limit),
    errors,
    sourcesQueried,
    sourcesSkipped,
    elapsedMs: Date.now() - started,
  };
}

interface ChainState {
  timeoutMs: number;
  log: NonNullable<SearchOptions['log']>;
  errors: SourceError[];
  sourcesQueried: SourceId[];
  sourcesSkipped: SourceId[];
}

/** Try each adapter for a marketplace in order; first success wins. */
async function runChain(
  chain: SourceAdapter[],
  marketplace: Marketplace,
  query: SearchQuery,
  state: ChainState,
): Promise<NormalizedProduct[]> {
  const usable = chain.filter((a) => {
    if (a.isConfigured()) return true;
    state.sourcesSkipped.push(a.id);
    state.log(`skip ${a.id}: not configured`);
    return false;
  });

  for (const [index, adapter] of usable.entries()) {
    const isLast = index === usable.length - 1;
    try {
      const products = await withTimeout(adapter, query, state);
      state.sourcesQueried.push(adapter.id);

      // An empty result is a legitimate answer from a healthy adapter, but if a
      // fallback exists it is worth asking before giving up on the marketplace.
      if (products.length === 0 && !isLast) {
        state.log(`${adapter.id} returned nothing, trying fallback`);
        continue;
      }

      state.log(`${adapter.id} returned ${products.length}`, { marketplace });
      return products.map((p) => ({
        ...p,
        kindWeight: adapter.kind === 'api' ? 5 : 0,
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      state.errors.push({
        source: adapter.id,
        marketplace,
        kind: adapter.kind,
        message,
        recovered: !isLast,
      });
      state.log(`${adapter.id} failed: ${message}`, { willFallBack: !isLast });
    }
  }

  return [];
}

async function withTimeout(
  adapter: SourceAdapter,
  query: SearchQuery,
  state: ChainState,
): Promise<NormalizedProduct[]> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error(`${adapter.id} exceeded ${state.timeoutMs}ms`)),
    state.timeoutMs,
  );
  try {
    return await adapter.search(query, {
      signal: controller.signal,
      log: (msg, meta) => state.log(`[${adapter.id}] ${msg}`, meta),
    });
  } finally {
    clearTimeout(timer);
  }
}
