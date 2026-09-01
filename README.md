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

The engine scores one question: **would selling this make money?**

The obvious approach — cheap product, high rating, lots of sales — reliably ranks
money-losers first. A $4.20 dog bowl at a 3x markup yields about $4 of gross
margin and costs roughly $13 to advertise. It looks like a winner on every
surface metric and loses $8 an order.

So unit economics carry the most weight, and things that make a product
unsellable act as vetoes rather than a few points off.

| Factor | Weight | Judged on |
|---|---|---|
| Economics | 35% | Contribution margin per order, after freight, fees, refunds and estimated CAC |
| Demand | 20% | Units sold, log-scaled — early traction counts most |
| Competition | 15% | How many distinct suppliers carry the same item |
| Quality | 15% | Rating, shrunk toward a prior when review counts are thin |
| Logistics | 10% | Delivery days and shipping weight |
| Supplier | 5% | Verified badge, years trading |

### Blockers cap, they do not subtract

"Cannot be advertised on Meta" is not worth ten points off — it disqualifies the
product. Blockers therefore impose a ceiling on the total, so a fat margin cannot
hide one:

```
  25 (capped from 95)  Rechargeable Vape Pen Kit
       $42.00 → $126.00 retail · CAC $39.72 → +$32.79/order
       ✗ Cannot be advertised on Meta or TikTok (matched "vape")
```

Best margins in the set, ranked last. Current blockers: negative contribution,
delivery beyond 21 days, and prohibited ad categories.

### Where the numbers come from

- **Unit economics** (`scoring/economics.ts`) — retail anchors on *product* cost,
  then freight, payment fees, a refund allowance and estimated CAC are subtracted.
  Retail deliberately does not track freight: the market prices a blanket on what
  a blanket is worth, and marking up landed cost would hide the exact margin
  problem heavy items cause. Unprofitable products report the retail price that
  would fix them.
- **CAC is a model, not a measurement.** `AdCostModel` defaults to industry rules
  of thumb for cold paid social. Replace them with your real numbers the moment
  you have campaign data — every score downstream depends on this.
- **Competition falls out of the merge.** When `dedupe` finds the same item from
  four suppliers, that is four competitors, and it is free data. Duplicates are
  counted rather than discarded, and the survivor is priced at the cheapest
  supplier found.
- **Ratings are shrunk toward a prior.** 4.9★ from three reviews should not
  outrank 4.6★ from twelve hundred; a Bayesian adjustment pulls thin counts back.
- **Confidence is reported separately.** A 70 built on six known factors is a
  different claim from a 70 built on two. `score.confidence` says which you have.

Deliberately not an LLM call: every number above can be inspected, tuned, and
argued with, costs nothing, and returns the same answer twice. Judgements a model
genuinely makes better — creative angle, market saturation beyond supplier count,
brand risk — belong in a layer on top of this, not in place of it.

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
