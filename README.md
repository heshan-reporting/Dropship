# Muttward

A dropshipping platform: find products worth selling, list them, sell them, and
route the orders to a supplier. One codebase, two surfaces — a private admin for
running the business and a public storefront for buying from it.

```
  RESEARCH                LISTINGS              STOREFRONT           FULFILMENT
  ────────                ────────              ──────────           ──────────
  sourcing engine   →   publish + price   →   cart + Stripe    →   Printify (auto)
  scores products       against real           hosted checkout      manual queue
  on unit economics     break-even                                  (everything else)
                                                     │
                                                     ▼
                                            webhook → order → dispatch
```

## The stack

TypeScript end to end, so `NormalizedProduct` is a single contract from the
supplier API through to the order line. Next.js 15 (App Router) on Vercel,
Postgres via Drizzle, Stripe-hosted checkout.

**Card details never touch this application.** Checkout redirects to Stripe, so
PCI scope, 3-D Secure and fraud handling stay on their side. What is kept here
are session and payment-intent references.

## Setup

```bash
npm install
cp .env.example .env      # fill in DATABASE_URL and ADMIN_PASSWORD at minimum
npm run db:push           # create the tables
npm run dev
```

`DATABASE_URL` takes any Postgres URL — [Neon](https://neon.tech) and Supabase
both have free tiers that work with Vercel out of the box.

The admin area refuses to open until `ADMIN_PASSWORD` is set. That is deliberate:
an unset password must never mean an open admin.

### Taking real payments

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Put the printed signing secret in `STRIPE_WEBHOOK_SECRET`. In production, add the
endpoint at `https://your-domain/api/webhooks/stripe` in the Stripe dashboard.

The webhook is the only place an order becomes paid — the browser's return from
checkout is a redirect the customer controls, so it is treated as cosmetic.

## How it fits together

### Sourcing engine (`src/engine`)

Queries several marketplaces in parallel. Within each marketplace, adapters form
a chain ordered API-first, scrape-second, and the orchestrator stops at the first
success — so a failing or unapproved API falls through to a scraper rather than
losing the source.

| Adapter | Kind | Cost |
|---|---|---|
| `printify-api` | API | Free, instant |
| `cj-api` | API | Free, instant |
| `aliexpress-api` | API | Free, needs approval |
| `aliexpress-scrape` | Scrape | Paid per request, fallback only |

Scraping reads the JSON state embedded in the page rather than CSS selectors,
because generated class names rotate on every frontend deploy.

### Scoring (`src/engine/scoring`)

Scores one question: **would selling this make money?** A $4.20 product at 3×
markup yields ~$4 of gross margin and costs ~$13 to advertise — it looks like a
winner on every surface metric and loses money on every order. So unit economics
carry the most weight, and anything that makes a product unsellable is a veto
rather than a few points off.

| Factor | Weight |
|---|---|
| Economics — contribution per order after freight, fees, refunds, CAC | 35% |
| Demand — units sold, log-scaled | 20% |
| Competition — how many suppliers carry the same item | 15% |
| Quality — rating, shrunk toward a prior on thin review counts | 15% |
| Logistics — delivery days and weight | 10% |
| Supplier — verified, years trading | 5% |

Blockers cap the total rather than being averaged in, so a product with excellent
margins that cannot be advertised ranks last instead of first.

> **`AdCostModel` is a model, not a measurement.** It defaults to industry rules
> of thumb for cold paid social. Replace them with your real CPA in
> `src/engine/scoring/economics.ts` the moment you have campaign data — every
> score depends on it.

### Fulfilment (`src/lib/fulfilment`)

Same adapter shape as the engine, for the same reason: the order pipeline should
not know which supplier ships a line item.

- **Printify** — placed automatically. Order creation and send-to-production are
  separate calls, because production is the irreversible step that spends money.
- **Manual** — anything else. The order is recorded and queued for a human to
  place, then paste tracking back. Not a stub: a CJ or AliExpress product
  genuinely has to be bought by hand, and pretending otherwise would mean
  accepting orders the system cannot ship.

A provider failing never fails the webhook — the customer has already paid, so
the error lands on the fulfilment row where the admin queue can retry it.

## Money handling

Every amount is an integer in minor units with an ISO currency code. No floats
touch a price, anywhere, from supplier API to order line.

Three rules the code holds to:

1. **The browser never sets a price.** The cart holds listing ids and quantities;
   every price is re-read from the database at checkout.
2. **Prices freeze before payment.** The order is written before the Stripe
   redirect. Re-pricing on the webhook would record a figure Stripe never
   charged.
3. **Payment is recognised exactly once.** The webhook is idempotent — Stripe
   retries on any non-2xx, and a replay must not place a second supplier order.

All three are covered by tests.

## Tests

```bash
npm test        # 57 tests
npm run typecheck
```

| Suite | Covers |
|---|---|
| `normalize` | Money arithmetic in minor units, price parsing, cross-source dedupe |
| `score` | Unit economics, policy vetoes, saturation, rating shrinkage |
| `search` | Adapter chain ordering and every orchestrator branch |
| `orders` | The full order pipeline against a real Postgres |

The order tests run against **PGlite** — actual Postgres compiled to WASM, with
the same types, constraints and foreign keys, applying the generated migration
rather than a hand-written copy. Mocking the database would only prove the mocks
agree with themselves, and this is the code where a bug costs real money.

## Layout

```
src/
  engine/          sourcing + scoring (standalone, has its own CLI)
    core/          adapter contracts, orchestrator, normalisation
    adapters/      api/ and scrape/ per marketplace
    scoring/       economics, ad-policy screening, ranking
  app/
    (store)/       storefront: catalogue, product, cart, order confirmation
    admin/         overview, research, listings, orders
    api/           cart, checkout, research, listings, fulfilment, stripe webhook
  db/              Drizzle schema and lazy client
  lib/             store config, money, cart, auth, orders, fulfilment
```

The engine still runs standalone:

```bash
npm run search -- "dog hoodie" --verbose
```

## Deploying

Push to a Vercel project, set the environment variables from `.env.example`, and
add the Stripe webhook endpoint. `npm run db:push` against the production
`DATABASE_URL` creates the schema.

## Prior art

The multi-source sourcing idea came from
[nadinev6/dropship](https://github.com/nadinev6/dropship), which wires Alibaba
and AliExpress scraping through n8n + Bright Data + Gemini. This is an
independent implementation — that repository carries no license, so none of its
code is used here.
