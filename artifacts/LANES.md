# Parallel lanes (after T03)

Three lanes run in parallel on separate branches, then merge into `main`. This file fixes
who owns what and the contracts between lanes, so the branches meet cleanly. Read
`CLAUDE.md`, `artifacts/PRD.md`, `artifacts/TASKS.md` and this file before starting.

| Lane | Tasks (in order) | Owns |
|---|---|---|
| **A — Seller** | T04 → T05 → T14 → T15 | `apps/server/src/bpp/**`, `apps/server/src/admin/**`, `apps/web/src/pages/{Merchant,Wall,Admin}.tsx`, `apps/web/src/components/merchant/**`, `apps/web/src/components/admin/**`, migrations `01xx_*` |
| **B — Buyer** | T06 → T07 → T08 → T09 → T16 | `apps/server/src/bap/**` except `bap/agent/**`, `scripts/**`, migrations `02xx_*` |
| **C — Agent + customer UI** | T11 → T10 → T12 → T13 → T17 | `apps/server/src/bap/agent/**`, `apps/web/src/pages/{Picker,Shop,Tracker}.tsx`, `apps/web/src/components/shop/**`, `README.md`, `docs/DEMO.md`, migrations `03xx_*` |

Shared seams (edit only additively, and list every change in your final report):
`packages/shared/src/**` (esp. `api.ts`), `apps/server/src/db/schema/*.ts`,
`apps/web/src/{App.tsx,lib/**,components/kit.tsx}`, `apps/server/src/{app.ts,config.ts}`.
Never edit: `deploy/**`, `Dockerfile`, `.env*`, `artifacts/**`, `docs/ONDC_DEVIATIONS.md`
(report deviations instead; they are merged into that doc at merge time).

## Rules
1. **No deploys, no gcloud.** Only the integrator deploys after merging.
2. **Your own test database.** `export TEST_DATABASE_URL=postgres://kiranaai:kiranaai@127.0.0.1:5433/kiranaai_<a|b|c>`
   (local docker Postgres, already running). Never run tests against `kiranaai` (the integrator's DB).
   For a local server use `PORT=808<1|2|3>` and `DATABASE_URL` = your lane DB.
3. **Setup in a fresh worktree:** `pnpm install`. Lane C: copy `C:\Users\sreer\google-hack\orbi\.env` into the
   worktree root (git-ignored) for `GEMINI_API_KEY`; never print or commit the key.
4. **Each task ends** with `pnpm typecheck`, `pnpm test` (with your TEST_DATABASE_URL) and `pnpm build` passing,
   then one commit `T0X: <summary>` ending with the line
   `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`. Never commit `.env`.
5. **Module boundaries (PRD §4):** BPP code touches only `bpp.*`; BAP code only `bap.*`; the admin module may
   touch both; everyone may write `audit_log` (use `audit`/`auditState` from `beckn/audit.ts`).
6. **Money** integer paise, **quantities** integer packs. Beckn payloads carry rupee strings: use `priceOf`/`paiseOf`.
7. **Never hold a DB transaction or advisory lock across an HTTP call** (`becknSend`, `becknCall`): receivers
   process before they ACK, so the other side may need the same rows to reply.
8. **Background jobs** only via `app.ctx.ticker.add({ name, everyMs, run })` (runs on boot, every 1 s and on
   requests; Cloud Run has request-based CPU). No bare `setInterval`/`setTimeout` loops.
9. **Migrations:** new SQL file in your number range (`apps/server/drizzle/README.md`); update the Drizzle schema too.
10. **The agent can never pay or confirm** (PRD AGT-07): no tool or HTTP route for approve/pay is reachable from it.
11. Tests that need the other side of a Beckn exchange use a fake participant you register in `registry.participant`
    for the test (see `apps/server/src/testing/index.ts` for the pattern). Integrated flows are verified after merge.
12. If the PRD and this file disagree, or a contract below can't work, say so in your report; don't silently diverge.

## Beckn message contract (BPP ⇄ BAP)

Use `makeContext`/`callbackContext` and `KTAG` from `@kiranaai/shared`. BAP calls with `searchViaGateway` /
`becknCall` (`bap/beckn-client.ts`). BPP handlers live in `bpp/actions.ts`; each does its work, sends its
`on_*` with `becknSend` to `env.context.bap_uri` using `callbackContext(env.context, bppIdentity(selfBaseUrl))`,
then returns. BAP extra callback logic lives in `bap/callbacks.ts` (runs after the waiter gets the envelope).
Kiranaai tags are `{ code: "kiranaai", list: [{ code, value }] }` (build with `tag()`, read with `getTag()`).

**search** — `intent.item.descriptor.name` = query text (may be empty when filtering by ids);
`intent.fulfillment.end.location.gps` = customer `"lat,lng"` (the BPP can't read `bap.customer`);
optional `intent.tags` kiranaai `canonical_ids` = `"cp_a,cp_b"` (reassignment: only these products, text ignored).

**on_search** — `catalog["bpp/providers"]`: one provider per matching, serviceable, online, open store:
```
{ id: storeId, descriptor: { name: storeName }, locations: [{ id: `${storeId}_loc`, gps }],
  tags: [kiranaai { distance_m: "812", delivery_charge: "20.00" }],   // charge for an items subtotal of 0
  items: [{ id: listingId, descriptor: { name: "Aashirvaad Whole Wheat Atta 10 kg" },
            price: { currency: "INR", value: "450.00", maximum_value: "499.00" /* MRP */ },
            quantity: { available: { count: "40" }, unitized: { measure: { unit: "kg", value: "10" } } },
            category_id: "Atta & Flours", location_id: `${storeId}_loc`,
            tags: [kiranaai { canonical_id, brand, product_name, pack_label: "10 kg" }] }] }
```
Loose request declined (DIS-06): `catalog.tags = [kiranaai { loose_declined: "true", reason, alternative_canonical_id? }]`;
the packaged alternative's listings are still returned as normal items. Nothing found → empty providers, no error.

**select** — `order.provider.id = storeId`, `order.items = [{ id: listingId, quantity: { count }, tags?: [kiranaai { seen_price: "450.00" }] }]`,
`order.fulfillments = [{ id: "f1", type: "Delivery", end: { location: { gps } } }]`.
**on_select** — `order` echoes provider/items/fulfillments plus `quote`: `price` = grand total for this store;
`breakup` = one `title_type: "item"` row per item (`@ondc/org/item_id` = listingId, `@ondc/org/item_quantity.count`,
`price` = line total, `item.price` = unit price, `item.quantity.available.count` = stock, `item.tags` kiranaai
`{ price_changed: "true", previous_price }` when it differs from `seen_price`) and one `title_type: "delivery"` row
(`@ondc/org/item_id: "f1"`). Problems → still reply with what you can and set `error`:
`40002` item unavailable / insufficient stock (`message` = comma-separated listingIds), `30009` customer outside
radius, `30001` store offline or closed.

**init** — select payload + `order.billing { name, phone, address }` and fulfillment `end.contact.phone`,
`end.person.name`, `end.location.address`. **on_init** — same quote with `quote.ttl = "PT10M"`,
`payment { type: "ON-ORDER", collected_by: "BAP", status: "NOT-PAID" }`. Same error codes.

**confirm** — `order.id` = attempt id `att_…` (idempotency key), provider, items, billing, fulfillments (as init),
`quote` (the store's totals), `payment { type: "ON-ORDER", status: "PAID", params: { amount, currency: "INR" } }`,
`order.tags` kiranaai `{ offer_window_seconds: "45" }`. BPP re-checks stock, creates `attempt_order` OFFERED with
`expires_at = now + window`. **on_confirm** — `order { id, state: "Created", provider, items, quote, fulfillments,
tags: [kiranaai { expires_at: ISO }] }`; or `error` (40002/30001/30009) if it can't take the order — the BAP then
counts that attempt as REJECTED with that reason. A repeat confirm for the same `order.id` returns the same result.

**Unsolicited (BPP → BAP), new message_id each, same transaction_id, retried 3× with backoff:**
- accept → `on_status` `order { id, state: "Accepted", fulfillments: [{ id: "f1", state: { descriptor: { code: "Pending" } } }] }`
- advance → `on_status` with `state: "In-progress"` and fulfilment code `Pending` (PREPARING) / `Packed` (READY) /
  `Out-for-delivery` (OUT_FOR_DELIVERY); DELIVERED → `state: "Completed"`, code `Order-delivered`.
- reject / expire → `on_cancel` `order { id, state: "Cancelled", cancellation: { cancelled_by: "kiranaai-bpp",
  reason: { id: "MERCHANT_REJECTED" | "OFFER_EXPIRED", descriptor: { name: <reason text> } } } }`.
- **status** `{ order_id }` → `on_status` with current state (used by the reconciler). **cancel** may NACK `30000` (P1).

## Merchant API (lane A implements; lane B's e2e script and the wall use it)
Token: the store's merchant token (`POST /auth/persona {role:"merchant", id}`; no passcode, demo personas).
`:storeId` must equal the token's store. All JSON; errors `{ error }`.
- `GET  /bpp/merchant/:storeId/dashboard` → `{ store: { id, name, isOnline, faults: { autoReject, neverAnswer } },
  offers: Offer[] /* status OFFERED, newest first */, orders: Order[] /* accepted, not yet delivered + recent delivered */ }`
  where `Offer = { id, status, offeredAt, expiresAt, totalPaise, itemsTotalPaise, deliveryPaise, distanceM,
  buyerName, buyerPhone /* masked until accepted */, items: [{ name, qty, unitPricePaise }] }` and `Order` = Offer + `fulfilmentStatus`.
- `POST /bpp/merchant/:storeId/offers/:id/accept` → `200 { ok: true }` | `409 { error: "OFFER_NOT_AVAILABLE" }`
- `POST /bpp/merchant/:storeId/offers/:id/reject { reason }` → `200` | `409 { error: "OFFER_NOT_AVAILABLE" }`
- `POST /bpp/merchant/:storeId/orders/:id/advance` → `200 { fulfilmentStatus }` | `409 { error: "INVALID_TRANSITION" }`
- `PATCH /bpp/merchant/:storeId/store { isOnline }` → `200 { isOnline }`
- Catalogue (T14): lane A's choice under `/bpp/merchant/:storeId/catalogue…`.
The wall gets one merchant token per store (no admin passcode needed, so judges can open it cold).

## Admin API (lane A implements; admin token = `POST /auth/persona {role:"admin", passcode}`)
- `POST  /admin/api/reset` → reset & reseed (uses `resetAndSeed` with `config.selfBaseUrl`)
- `GET/PATCH /admin/api/config` `{ offerWindowSeconds, failNextPayment, platformFeePaise, commissionBps }` (row `bap.config`)
- `GET/PATCH /admin/api/faults/:storeId` `{ autoReject, neverAnswer }` (row `bpp.fault`)
- `GET  /admin/api/ledger` → `{ entries: [...bap.ledger_entry + storeName], byStore: [{ storeId, storeName, grossPaise, commissionPaise, netPayablePaise, platformSubsidyPaise }] }`
- `GET  /admin/api/audit?transactionId=` → audit rows in order
Lane B reads `bap.config` (offer window → confirm tag; `failNextPayment` → fail once and clear; platform fee; commission).

## BAP API (lane B implements, lane C consumes)
Exactly as typed in `packages/shared/src/api.ts`. Lane C's agent calls it over loopback HTTP
(`ctx.config.selfBaseUrl`) with the customer's token and an allowlist that excludes approve and pay.

## Lane notes
- **A:** wall = 5 compact dashboards, "All stores online" button (5 PATCH calls; first click unlocks audio).
  `never_answer` hides Accept/Reject in the UI; `auto_reject` rejects ~3 s after the offer (ticker job).
- **B:** keep the offers you have seen in `on_search` (e.g. table `bap.seen_offer`, migration `0201_…`) so
  `PUT /bap/basket/items {listingId, qty}` can resolve store, bpp and price. `plan_basket` uses the PRD §12
  rule with the tie-break fewer stores → smaller total distance; a need's candidates are the offers of its
  best-matching canonical products only. T16: write `scripts/e2e-demo.ts` against the merchant/admin API
  above; it is run for real after merge.
- **C:** T11 = persona picker on `/` (judge-friendly: two lines + "Start demo" opening `/shop` as Priya and
  `/wall`), session handling, polling helper, kit polish. Build UI against `api.ts` types; anything needing the
  real API is verified after merge. Agent tests mock Gemini and the HTTP tool client; one live smoke test
  skips when `GEMINI_API_KEY` is unset. 20 s timeout → `503 { error: "agent_unavailable" }`; rate limit
  20 turns / IP / 10 min plus a daily cap.

## Final report (each lane)
Tasks done with commit hashes; Done-when checks and how each was verified (or why not yet); every change to a
shared seam; migrations added; deviations from the PRD/contract; anything the integrator must check after merge.
