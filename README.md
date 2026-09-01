# Dropship

A product sourcing engine for dropshipping: query several marketplaces at once,
collapse the results into one product schema, and rank them on the criteria that
actually predict a winner.

## Design

The engine is built around one idea — **every source is an adapter, and every
adapter emits the same shape**. A source can be a first-class API or a scraper
standing in for one; nothing downstream can tell the difference.

```
                    ┌─────────────────────────────┐
   search(term) ──► │        Orchestrator         │
                    │  fan out across marketplaces │
                    └──────────────┬──────────────┘
                                   │
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
   marketplace: cj          marketplace: aliexpress    marketplace: printify
        │                          │                          │
   ┌────▼────┐               ┌─────▼─────┐              ┌─────▼─────┐
   │ cj-api  │               │ ae-api    │  API first   │ printify  │
   └─────────┘               ├───────────┤              └───────────┘
                             │ ae-scrape │  ◄── fallback
                             └───────────┘
        │                          │                          │
        └──────────────────────────┼──────────────────────────┘
                                   ▼
                        NormalizedProduct[]  → dedupe → rank
```

Within a marketplace, adapters form a **chain**: APIs before scrapers,
configured before unconfigured. The orchestrator walks the chain and stops at
the first success. A dead API falls through to the scraper instead of losing the
source; a dead marketplace never fails the whole search.

### Why API-first

Scraping is the fallback, not the mechanism, because selector-based scrapers rot.
They key off generated class names (`lh_kt`, `tp-offer-product-new`) that change
on every frontend deploy, and you find out when your product feed silently
returns nothing.

Where scraping is unavoidable, `ScrapeAdapter` reads the **JSON state embedded
in the page** — the same payload the marketplace's own frontend hydrates from —
and treats CSS selectors as a last resort. Those object keys have outlived
several frontend rewrites; the class names have not.

## Sources

| Adapter | Kind | Cost | Gives you |
|---|---|---|---|
| `cj-api` | API | Free | MOQ, warehouses, sales volume, fulfilment |
| `aliexpress-api` | API | Free (approval needed) | Ratings, order counts, affiliate commission |
| `printify-api` | API | Free | POD catalogue, domestic fulfilment, no inventory risk |
| `aliexpress-scrape` | Scrape | Paid per request | Fallback only, when the API is down or unapproved |

Every source is optional. Adapters without credentials report
`isConfigured() === false` and are skipped, so the engine runs on whatever
subset you have signed up for.

## Setup

```bash
npm install
cp .env.example .env   # add at least one credential
```

Start with **Printify** or **CJ** — both are free and instant. AliExpress
Open Platform needs app approval, which takes a few days.

## Use

```bash
npm run search -- "collapsible dog bowl"
npm run search -- "phone stand" --limit 10 --marketplace cj --verbose
```

`--verbose` shows the adapter chain resolving and the per-factor score breakdown.

```ts
import { createEngine, rankProducts } from './src/index.js';

const engine = createEngine();
const result = await engine.search({ term: 'collapsible dog bowl', limit: 20 });

for (const p of rankProducts(result.products)) {
  console.log(p.score.total, p.title, p.url);
}

// Partial failure is normal and surfaced, never thrown:
result.errors;          // which sources failed, and whether a fallback covered it
result.sourcesSkipped;  // which lacked credentials
```

## Scoring

`scoreProduct` weighs five factors and returns a 0–100 total **with its
reasoning attached**:

| Factor | Weight | Judged on |
|---|---|---|
| Margin | 30% | Cost × target markup against an impulse-buy ceiling |
| Demand | 25% | Units sold, log-scaled — early traction counts most |
| Quality | 20% | Rating, with sub-3.5★ treated as disqualifying |
| Shipping | 15% | Worst-case delivery days |
| Supplier | 10% | Verified badge, years trading |

Two deliberate choices:

- **Not an LLM call.** A number you can audit beats a model asserting "8/10"
  with no way to check it. Factors an LLM genuinely judges better — creative
  angle, market saturation, ad-policy risk — belong in a layer *on top* of this.
- **Re-weighted across known factors.** A source that omits sales data is not
  silently punished against one that reports it; the unjudged factors are listed
  in `score.unknowns` instead.

## Adding a source

Implement `SourceAdapter`, map to `NormalizedProduct`, register it. Set
`marketplace` to an existing value to slot into that marketplace's fallback
chain, or a new one to add a lane.

```ts
class MySourceAdapter implements SourceAdapter {
  readonly id = 'mysource-api';
  readonly marketplace = 'temu';
  readonly kind = 'api';
  isConfigured() { return Boolean(this.token); }
  async search(query, ctx) { /* → NormalizedProduct[] */ }
}
```

For a scraper, extend `ScrapeAdapter` and implement `searchUrl` and `parse` —
the Bright Data fetch, caching, and the "extracted 0 products" alarm come with it.

## Layout

```
src/
  core/
    types.ts       NormalizedProduct, SourceAdapter — the contracts
    registry.ts    adapter registration, chain ordering
    search.ts      orchestrator: fan-out, fallback, timeouts, partial failure
    normalize.ts   money, price parsing, cross-source dedupe
    http.ts        fetch with retry, abort, credential redaction
  adapters/
    api/           cj-dropshipping, aliexpress-ds, printify
    scrape/        bright-data client, ScrapeAdapter base, aliexpress fallback
  scoring/score.ts factor-based ranking
  cli.ts
```

## Tests

```bash
npm test        # 33 tests
npm run typecheck
```

Coverage focuses on the parts that are easy to get subtly wrong: money
arithmetic in minor units, cross-source dedupe, chain ordering, and every
orchestrator branch (API succeeds, API throws, API returns empty, both fail,
timeout, unconfigured, marketplace filter).

## Notes on data sources

Marketplace terms of service vary on automated access, and several of these
platforms offer official APIs precisely so you do not have to scrape them —
which is why the engine reaches for those first. If you extend the scrape side,
keep request volume modest and check the terms for the marketplace you are
adding.

## Prior art

The multi-source + AI-ranking approach was prompted by
[nadinev6/dropship](https://github.com/nadinev6/dropship), which wires Alibaba
and AliExpress scraping through n8n + Bright Data + Gemini. This engine is an
independent implementation — that repository carries no license, so none of its
code is used here.
