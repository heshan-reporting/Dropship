# Setting up Muttward

Four stages, in order. Each one leaves you with something that works, so you can
stop at any point and come back.

| Stage | Time | You get |
|---|---|---|
| 1. Run it | 2 min | The whole site on your machine, with a demo catalogue |
| 2. Real products | 10 min | Printify catalogue in the research tool, real listings |
| 3. Take payments | 15 min | Working checkout with Stripe test cards |
| 4. Go live | 20 min | A public URL that takes real money |

---

## Stage 1 — Run it locally

```bash
cd ~/Claude/Dropship
npm install
```

Create `.env` with two lines:

```
ADMIN_PASSWORD=pick-something-long
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

Then:

```bash
npm run seed
npm run dev
```

Open http://localhost:3000. Admin is at `/login`.

**No database needed.** With `DATABASE_URL` unset in development, the app runs on
PGlite — real Postgres compiled to WASM, stored in `.pglite/`. Delete that folder
to start over.

To run the production build locally instead:

```bash
npm run build
npm run start:local
```

`start:local` sets `USE_EMBEDDED_DB=true`. A plain `npm start` refuses to run
without a real `DATABASE_URL`, deliberately — a deployed store on an ephemeral
database would lose every order on the next cold start.

---

## Stage 2 — Real products

### Get a Printify token

1. Sign up at [printify.com](https://printify.com) — free, no card.
2. Create a shop. Choose **API** as the sales channel, not Etsy or Shopify.
3. Go to **Account → Connections → Personal access tokens** and generate one.

Find your shop id:

```bash
curl -s https://api.printify.com/v1/shops.json \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Add both to `.env`:

```
PRINTIFY_API_TOKEN=your_token
PRINTIFY_SHOP_ID=12345678
```

Restart the dev server. **Research** now shows Printify as configured, and
searching returns its catalogue scored on your unit economics.

### Publishing a product

1. Search in **Research** — try "hoodie" or "mug".
2. Read the score. Anything with a red `✗` cannot make money as priced; the flag
   tells you the retail price that would fix it.
3. **Publish as draft** — retail is set from the break-even calculation, not a
   blunt cost multiple.
4. In **Listings**, add the Printify **variant id**, then switch status to
   **Active**.

> A Printify listing without a variant id cannot be fulfilled. The listings table
> blocks activation until you add one, because the alternative is discovering it
> after a customer has paid.

Find variant ids for a blueprint:

```bash
curl -s "https://api.printify.com/v1/catalog/blueprints/BLUEPRINT_ID/print_providers/PROVIDER_ID/variants.json" \
  -H "Authorization: Bearer YOUR_TOKEN"
```

### Other suppliers (optional)

`CJ_EMAIL` / `CJ_API_KEY` from [CJ Dropshipping](https://cjdropshipping.com) —
free, instant, and a much wider general catalogue. CJ products are **manual
fulfilment**: orders queue in the admin for you to place by hand.

---

## Stage 3 — Take payments

### Stripe keys

1. Sign up at [stripe.com](https://stripe.com). You do **not** need to complete
   business verification to use test mode.
2. Leave the dashboard in **Test mode** (toggle, top right).
3. **Developers → API keys**, copy the **Secret key** (`sk_test_…`).

```
STRIPE_SECRET_KEY=sk_test_...
```

### Webhook forwarding

The webhook is the only place an order becomes paid — the browser's return from
checkout is a redirect the customer controls, so it is treated as cosmetic. On
localhost Stripe cannot reach you, so forward events:

```bash
stripe login
```

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

It prints a signing secret (`whsec_…`). Put it in `.env` and restart:

```
STRIPE_WEBHOOK_SECRET=whsec_...
```

Leave `stripe listen` running in its own terminal while you test.

### Test the whole path

Add something to the cart, check out, and pay with Stripe's test card:

| Field | Value |
|---|---|
| Card | `4242 4242 4242 4242` |
| Expiry | Any future date |
| CVC | Any 3 digits |
| Postcode | Any |

Then check, in order:

1. The `stripe listen` terminal shows `checkout.session.completed`.
2. You land on the order confirmation page with an `MW-` reference.
3. **Admin → Orders** shows the order as `fulfilling`, with a fulfilment row.

Useful test cards: `4000 0000 0000 9995` declines, `4000 0025 0000 3155` requires
3-D Secure.

---

## Stage 4 — Go live

### Database

Create a free Postgres at [neon.tech](https://neon.tech), copy the pooled
connection string, then:

```bash
DATABASE_URL="postgresql://..." npm run db:push
```

### Deploy

```bash
npx vercel
```

Set every variable from `.env.example` in the Vercel project settings.
`NEXT_PUBLIC_SITE_URL` must be your real domain.

### Production webhook

In the Stripe dashboard: **Developers → Webhooks → Add endpoint**

- URL: `https://your-domain/api/webhooks/stripe`
- Event: `checkout.session.completed`

Copy that endpoint's signing secret into Vercel as `STRIPE_WEBHOOK_SECRET`. It is
**different** from the `stripe listen` one.

### Before taking real money

- [ ] Switch Stripe out of test mode and swap in live keys
- [ ] `ADMIN_PASSWORD` is long and not the local one
- [ ] Place one real order and confirm it reaches Printify
- [ ] **Replace the CAC assumption.** `AdCostModel` in
      `src/engine/scoring/economics.ts` defaults to industry rules of thumb
      ($12 base + 22% of retail). Every score depends on it. Until you put your
      real cost-per-acquisition in, treat rankings as directional only.

---

## Daily use

| Task | Where |
|---|---|
| Find products worth selling | **Research** |
| Publish and price | **Research** → **Listings** |
| Watch margins erode | **Overview** |
| Place manual orders, add tracking | **Orders** |

Manual fulfilment: the order shows what to buy and where. Place it with the
supplier, paste the tracking number into the fulfilment row, mark it shipped.

Printify orders go automatically. **Check status** on a fulfilment row asks
Printify where the parcel actually is.

---

## When something breaks

**"Admin is locked"** — `ADMIN_PASSWORD` is unset or empty in `.env`. Note that
`.env.example` ships with empty values; copying it wholesale leaves everything
blank.

**"No sources configured"** — no supplier credentials. Printify is the fastest to
add.

**"Payments are not configured yet"** — `STRIPE_SECRET_KEY` is missing.

**Checkout works but no order appears** — the webhook is not arriving. Is
`stripe listen` still running, and does `STRIPE_WEBHOOK_SECRET` match what it
printed? The server logs signature failures.

**Fulfilment row says `failed`** — expand the order to read the provider error.
Usually a missing or wrong variant id. Fix the listing, then **Check status**.

**Changed `.env` and nothing happened** — Next.js reads it at boot. Restart.

---

## Tests

```bash
npm test        # 57 tests
npm run typecheck
```

The order tests run against real Postgres via PGlite, applying the generated
migration. They cover the three rules the money paths hold to: the browser never
sets a price, prices freeze before payment, and a replayed webhook cannot place a
second supplier order.
