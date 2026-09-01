import type { Marketplace, SourceAdapter, SourceId } from './types.js';

/**
 * Holds the adapters the engine knows about and answers the one question the
 * orchestrator cares about: for a given marketplace, what do I try first and
 * what do I fall back to?
 */
export class AdapterRegistry {
  private readonly adapters = new Map<SourceId, SourceAdapter>();

  register(adapter: SourceAdapter): this {
    if (this.adapters.has(adapter.id)) {
      throw new Error(`Duplicate adapter id: ${adapter.id}`);
    }
    this.adapters.set(adapter.id, adapter);
    return this;
  }

  registerAll(adapters: SourceAdapter[]): this {
    for (const a of adapters) this.register(a);
    return this;
  }

  get(id: SourceId): SourceAdapter | undefined {
    return this.adapters.get(id);
  }

  all(): SourceAdapter[] {
    return [...this.adapters.values()];
  }

  marketplaces(): Marketplace[] {
    return [...new Set(this.all().map((a) => a.marketplace))];
  }

  /**
   * Adapters for one marketplace, ordered by preference: APIs before scrapers,
   * and configured before unconfigured. The orchestrator walks this list and
   * stops at the first success — that is the whole fallback mechanism.
   */
  chainFor(marketplace: Marketplace): SourceAdapter[] {
    return this.all()
      .filter((a) => a.marketplace === marketplace)
      .sort((a, b) => rank(a) - rank(b));
  }
}

function rank(a: SourceAdapter): number {
  const kindRank = a.kind === 'api' ? 0 : 10;
  const configRank = a.isConfigured() ? 0 : 100;
  return kindRank + configRank;
}
