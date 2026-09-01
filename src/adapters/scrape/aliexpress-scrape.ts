import { ScrapeAdapter, findArrayByKeys } from './base.js';
import { absoluteUrl, cleanTitle, money, parsePriceRange } from '../../core/normalize.js';
import type { AdapterContext, NormalizedProduct, SearchQuery } from '../../core/types.js';

/**
 * AliExpress scraping fallback.
 *
 * Runs only when `aliexpress-api` is unconfigured or failing — the registry
 * orders API before scrape and the orchestrator walks that chain. Keep it that
 * way: this path costs Bright Data credits per search and is inherently more
 * fragile than the signed API.
 */
export class AliExpressScrapeAdapter extends ScrapeAdapter {
  readonly id = 'aliexpress-scrape';
  readonly label = 'AliExpress (scrape fallback)';
  readonly marketplace = 'aliexpress' as const;

  protected searchUrl(query: SearchQuery): string {
    const params = new URLSearchParams({ SearchText: query.term });
    return `https://www.aliexpress.com/wholesale?${params}`;
  }

  protected parse(html: string, query: SearchQuery, ctx: AdapterContext): NormalizedProduct[] {
    // AliExpress hydrates its results grid from an inline state blob. These key
    // names have outlived several frontend rewrites; the CSS class names have not.
    const state = this.extractJsonState(html, [
      'window._dida_config_._init_data_=',
      '_init_data_=',
      'window.__AER_DATA__=',
      'window.runParams=',
    ]);

    if (!state) {
      ctx.log('no embedded state found; page shape may have changed');
      return [];
    }

    const items = findArrayByKeys(state, ['productId']) ?? findArrayByKeys(state, ['product_id']);
    if (!items) {
      ctx.log('embedded state present but no product array matched');
      return [];
    }

    ctx.log(`extracted ${items.length} products from embedded state`);
    const limit = query.limit ?? 20;

    return items
      .slice(0, limit)
      .map((item) => this.toProduct(item, query.includeRaw))
      .filter((p): p is NormalizedProduct => p !== null);
  }

  private toProduct(item: any, includeRaw?: boolean): NormalizedProduct | null {
    const id = String(item.productId ?? item.product_id ?? '');
    if (!id) return null;

    const title = cleanTitle(String(item.title?.displayTitle ?? item.productTitle ?? item.title ?? ''));
    if (!title) return null;

    // Price appears variously as a formatted string or a nested object.
    const priceText =
      item.prices?.salePrice?.formattedPrice ??
      item.prices?.sellingPrice?.formattedPrice ??
      item.salePrice?.formattedPrice ??
      (typeof item.salePrice === 'string' ? item.salePrice : undefined);

    const parsed = priceText ? parsePriceRange(String(priceText)) : null;
    const price = parsed?.price ?? money(Number.parseFloat(String(item.salePrice?.minPrice ?? 0)));

    const rating = Number.parseFloat(String(item.evaluation?.starRating ?? item.averageStarRate ?? ''));
    const soldText = String(item.trade?.tradeDesc ?? item.tradeDesc ?? '');
    const soldMatch = soldText.match(/([\d,]+)\+?\s*sold/i);

    return {
      id: `aliexpress-scrape:${id}`,
      source: this.id,
      marketplace: this.marketplace,
      sourceId: id,
      url: absoluteUrl(item.productDetailUrl ?? `//www.aliexpress.com/item/${id}.html`),
      title,
      images: [item.image?.imgUrl ?? item.imageUrl]
        .filter((u): u is string => Boolean(u))
        .map((u) => absoluteUrl(u)),
      price,
      priceMax: parsed?.priceMax,
      moq: 1,
      signals: {
        rating: Number.isFinite(rating) ? rating : undefined,
        unitsSold: soldMatch ? Number.parseInt(soldMatch[1].replace(/,/g, ''), 10) : undefined,
        inStock: true,
      },
      fetchedAt: new Date().toISOString(),
      raw: includeRaw ? item : undefined,
    };
  }
}
