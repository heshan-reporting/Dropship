import { request } from '../../core/http.js';
import type { EngineConfig } from '../../config.js';

const UNLOCKER_ENDPOINT = 'https://api.brightdata.com/request';

/**
 * Bright Data Web Unlocker client.
 *
 * Every call costs money, so this is deliberately thin and the adapters above
 * it are expected to reach for an API first. Results are cached in-process for
 * a short window because a user refining a search re-issues the same term
 * constantly and there is no reason to pay twice.
 */
export class BrightDataClient {
  private readonly cache = new Map<string, { at: number; html: string }>();

  constructor(
    private readonly config: EngineConfig['brightData'],
    private readonly cacheTtlMs = 10 * 60 * 1000,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.config.apiKey);
  }

  async fetchHtml(url: string, signal: AbortSignal, country = 'us'): Promise<string> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.at < this.cacheTtlMs) return cached.html;

    const response = await request(UNLOCKER_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        zone: this.config.unlockerZone,
        url,
        format: 'raw',
        country,
      }),
      signal,
      // Unlocker requests are billed; do not hammer on failure.
      retries: 1,
      backoffMs: 1500,
    });

    const html = await response.text();
    this.cache.set(url, { at: Date.now(), html });
    return html;
  }
}
