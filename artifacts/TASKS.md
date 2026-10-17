# KiranaAI — Hackathon Task Plan (24–48 h)

Companion to [PRD.md](PRD.md) v2.1. Tasks are in execution order; each depends only on tasks above it and ends in something you can run and check.

- **Estimates** are focused hours for one person.
- **Rule:** deploy from hour ~2 onward and redeploy after every task, so hosting never becomes a last-minute problem.
- **48 h plan:** T01–T18 (~38 h of work) plus buffer and sleep.
- **24 h plan:** do the tasks marked ✂ in their reduced form (see "24 h cut" at the bottom).
- **Team of 2–3:** after T03, split into lanes (see bottom). Order within each lane stays the same.

## Repo layout

```
kiranaai/
  Dockerfile               # builds web, then server; server serves web/dist
  docker-compose.yml       # server + postgres (local fallback)
  apps/
    server/src/
      gateway/             # registry, lookup, search fan-out
      bpp/                 # beckn handlers, merchant API, sweeper, csv
      bap/                 # beckn client+callbacks, basket, quote, pay, dispatch, ledger, agent
      admin/               # reset, config, faults, audit
      db/                  # drizzle schema (bap, bpp, registry), migrations, seed
    web/src/pages/         # Picker, Shop, Tracker, Merchant, Wall, Admin
  packages/shared/         # beckn zod schemas, money, ids, api types
  scripts/e2e-demo.ts
  deploy/
    gcp-setup.sh           # one-time: APIs, Cloud SQL, secrets, service account (idempotent)
    gcp-deploy.sh          # gcloud run deploy --source . with all flags
  docs/                    # PRD, TASKS, ONDC_DEVIATIONS, DEMO
```

---

## Phase 0 — Walking skeleton (hours 0–6)

### T01 · Scaffold and first deploy to Google Cloud — 2.5 h
- **Start Cloud SQL first:** instance creation takes ~10 min, so run `deploy/gcp-setup.sh` before writing any code.
- `deploy/gcp-setup.sh` (idempotent): set project and region `asia-south1`; enable Cloud Run, Cloud SQL Admin, Cloud Build, Artifact Registry, Secret Manager and Generative Language APIs; create Cloud SQL Postgres 16 (smallest shared-core tier), database `kiranaai` and user; create secrets `db-password`, `admin-passcode` and `gemini-api-key`; create service account `kiranaai-run` with `roles/cloudsql.client` and `roles/secretmanager.secretAccessor`; set a budget alert.
- Gemini key: create it in Google AI Studio (Get API key → choose this GCP project); optionally restrict it to the Generative Language API in Cloud Console → Credentials; store it in Secret Manager and in local `.env`. `GEMINI_MODEL=gemini-3.5-flash` (already verified: key works, function calling works, ~3 s per tool turn).
- pnpm workspace; TypeScript strict; Fastify server listening on `$PORT` with `/health`; Vite React + Tailwind app; server serves the built web app and falls back to `index.html` for SPA routes.
- Multi-stage `Dockerfile`; `docker-compose.yml` (server + postgres:16) for local.
- DB connection: Unix socket `/cloudsql/$INSTANCE_CONNECTION_NAME` on Cloud Run, TCP locally.
- `deploy/gcp-deploy.sh`: `gcloud run deploy kiranaai --source . --region asia-south1 --service-account kiranaai-run@… --add-cloudsql-instances $INSTANCE_CONNECTION_NAME --min-instances 1 --max-instances 1 --no-cpu-throttling --allow-unauthenticated --set-secrets DB_PASSWORD=db-password:latest,ADMIN_PASSCODE=admin-passcode:latest,GEMINI_API_KEY=gemini-api-key:latest --set-env-vars …`
- Env vars: `INSTANCE_CONNECTION_NAME`, `DB_NAME`, `DB_USER`, `SELF_BASE_URL=http://127.0.0.1:8080`, `GEMINI_MODEL`, `OFFER_WINDOW_SECONDS=45`.

**Done when:** the Cloud Run URL shows the web page and `/health` returns `{db: "ok"}` from Cloud SQL.

### T02 · Database schema and demo seed — 3 h
- Drizzle schema for `bpp`, `bap`, `registry` schemas and shared `audit_log`, `beckn_message` (PRD §5); enable `pg_trgm`; migrations run on boot.
- Seed JSON: 5 stores (geo within 3 km of the demo customer, varied delivery rules), ~30 canonical products, ~100 listings, synonyms (atta / gehun ka aata / आटा, toor / arhar / तूर दाल, chai patti / tea, doodh / milk, jeera / cumin…), loose terms, 2 customers (one inside all radii, one outside most), registry entries for BAP and BPP.
- `resetAndSeed()` function (used by admin later) + `pnpm seed`.
- Write the price table so PRD §14 constraints C1–C3 hold (you'll confirm C1 with the optimiser in T09).

**Done when:** a fresh deploy has seeded data; a SQL check shows backups exist for Gupta's and Lakshmi's demo items.

### T03 · Beckn layer and gateway — 2 h
- `packages/shared/beckn`: pin the ONDC Retail v1.2.x tag (`VERSION` file); zod schemas only for fields we use: `context`, ACK/NACK, catalog (provider, items, fulfillments), quote with breakup, order, cancel. Rupee-string ↔ paise helpers.
- `becknSend(url, action, context, message)` → POST, check ACK, write audit.
- Waiter registry: `await waitFor(message_id, action, timeoutMs)`; `collect(message_id, windowMs)` for multiple `on_search` replies.
- Gateway: `POST /gw/lookup`, `POST /gw/search` → ACK, then forward to every BPP in the registry.
- Callback dedupe via `beckn_message` unique `(message_id, action, sender)`.

**Done when:** a test route does `search` → gateway → stub BPP route → `on_search` → BAP waiter resolves, over real HTTP to `SELF_BASE_URL`, both locally and on Cloud Run.

---

## Phase 1 — Seller side, BPP (hours 6–12)

### T04 · BPP `search`, `select`, `init` — 3 h
- `search`: synonym expansion → full-text + trigram on `search_text`; optional canonical-ID filter tag (for reassignment); filter by serviceability (haversine), stock > 0, online + within hours; compute delivery charge per store for this customer; loose detection → `loose_declined` tag with the packaged alternative; reply `on_search` with one provider per store.
- `select`: re-read price/stock, check serviceability, return quote breakup (items + delivery) and per-item availability; flag price changes against the prices the BAP sends.
- `init`: final quote with `ttl: PT10M`, payment terms `ON-ORDER`.

**Done when:** tests pass: "atta" → ≥ 3 stores; "gehun ka aata" matches; out-of-radius store excluded; "250 g jeera" → `loose_declined` with the 100 g pack; changed price is flagged in `on_select`.

### T05 · BPP `confirm`, offers, claim, sweeper, fulfilment — 3 h
- `confirm`: idempotent on `order.id`; re-check stock; create `attempt_order` OFFERED with `expires_at`; reply `on_confirm` (`Created`).
- Merchant API (token scoped to store): `GET /bpp/merchant/offers`, `POST …/offers/:id/accept` (atomic conditional UPDATE → 409), `POST …/offers/:id/reject {reason}`, `GET …/orders`, `POST …/orders/:id/advance` (valid next state only; decrement stock on accept).
- Sweeper every 1 s (also on boot): expire overdue offers.
- Unsolicited callbacks to BAP: accept → `on_status` Accepted; reject/expire → `on_cancel` with reason; each advance → `on_status`. Retry 3× with backoff.
- Fault injection read from `bpp.fault`: `auto_reject` rejects after ~3 s; `never_answer` only affects the UI.

**Done when:** tests: 10 parallel accepts → exactly one 200; accept after expiry → 409; overdue offer at boot expires once and `on_cancel` is sent once.

---

## Phase 2 — Buyer side, BAP (hours 12–22)

### T06 · Discovery, basket and quote APIs — 3 h
- `GET /bap/search?q=` → gateway search, collect 1.5 s, return results grouped by canonical product with store, price, pack, distance, delivery charge, "catalogue" badge; pass through `loose_declined`.
- Basket: `GET /bap/basket`, `PUT /bap/basket/items` (listing + integer qty), `PATCH`/`DELETE` item; an edit after quoting moves the basket back to DRAFT.
- `POST /bap/basket/quote`: group by store → parallel `select` then `init` → save `quote` + `quote_store`, platform fee, grand total, `quote_hash` → QUOTED. Per-store errors returned so the UI or agent can fix them. Expiry checked on read.

**Done when:** API test builds the 3-store demo basket by hand and gets a correct quote; a merchant price change shows in the next quote.

### T07 · Approve, pay, create sub-orders, confirm — 2 h
- `POST /bap/baskets/:id/approve {quote_hash}` → APPROVED + single-use `approval_token` (5 min).
- `POST /bap/baskets/:id/pay {approval_token, simulate_failure?}` with `Idempotency-Key` → PAYMENT_INITIATED → after ~1 s PAID or PAYMENT_FAILED (also honours admin fail-next flag).
- On PAID: one `sub_order` per quoted store (locked items + approved amount), attempt 1 to the approved store, `confirm` sent to each.

**Done when:** tests: pay without approval → 403; same idempotency key twice → one payment; simulated failure → no confirms sent and retry works.

### T08 · Dispatch engine, refunds, ledger, settlement — 4 h
- `on_status` handler: attempt/sub-order → ACCEPTED, then mirror fulfilment states.
- `on_cancel` handler: attempt → REJECTED/EXPIRED; exclude store; `startNextAttempt`: cap 3 → else candidate `search` with canonical filter → rank → `select`/`init`/`confirm` to best candidate (fall through on mismatch) → none left → FAILED_NO_FULFILMENT.
- Advisory lock per sub-order; reconciler on boot and every 5 s for DISPATCHING sub-orders with no open attempt.
- Refund per failed sub-order (PRD §9 formula); basket → PARTIALLY_REFUNDED / REFUNDED.
- Ledger entry on DELIVERED (gross, commission, net, subsidy); basket → SETTLED when all sub-orders are terminal.
- `GET /bap/baskets/:id` returns payment status, sub-orders with attempts (store, n/3, `expires_at`), refunds — payment and fulfilment as separate fields.
- Log reject → next-offer latency.

**Done when:** integration tests: reject → attempt 2 at the backup store within 2 s; three failures → refund; the PRD §9 worked example is reproduced exactly in the ledger.

### T09 · Basket optimiser `plan_basket` — 1.5 h
- Pure function: needs (query → candidate offers, qty) + store delivery rules → exact search over store subsets → choices, estimated total, budget check, reason strings built from the numbers.
- `POST /bap/plan` wrapper (used by agent and the manual "Optimise" button).

**Done when:** unit tests cover the consolidation trade-off and budget overrun; seed constraint C1 passes using the real optimiser.

---

## Phase 3 — Agent (hours 22–25)

### T10 · Gemini agent with tools — 3 h
- `POST /bap/agent/chat {message}` → load history → Gemini API (`@google/genai` with `GEMINI_API_KEY`, `GEMINI_MODEL=gemini-3.5-flash`; append the model's returned content unchanged to history so `thoughtSignature` is preserved) with function declarations for the tools in PRD §12 → run tool calls against the BAP service functions in-process → loop (max 8 calls) → return `{text, events[]}` (`basket_updated`, `quote_ready`, `approval_requested`, `loose_declined`).
- System prompt: packaged-only, integer quantities, propose quantities for the customer to edit, totals only from `get_quote`, status only from `get_order_status`, never claim payment (use `request_approval`), one-line reasons from `plan_basket`, concise, Hinglish-friendly.
- 20 s timeout → `{error: "agent_unavailable"}`; rate limit per IP + daily cap.
- Save messages and tool calls to `agent_message` and audit.

**Done when:** via `curl` on the deployed URL: demo prompt → 3-store basket + quote + approval requested; "250 g jeera" → declined with alternative; "just pay for me" → approval card only, no payment; "where is my order?" → answer matches `get_order_status`.

---

## Phase 4 — Web app (hours 25–36)

### T11 · Web shell — 1 h
- Routes: `/` persona picker (customer, each store, wall, admin), `/shop`, `/shop/orders/:id`, `/merchant`, `/wall`, `/admin`.
- Token in sessionStorage; API client; TanStack Query with `refetchInterval: 1000` helper for live views; ₹ formatter; small kit: Button, Card, Badge, Countdown.

**Done when:** each persona lands on its page on the deployed URL.

### T12 · Customer shopping screen — 4 h
- Left: chat (messages, "thinking…" state, chips for events). Right: basket grouped by store with qty steppers, remove, delivery per store, "catalogue"/"verified" badges.
- Manual mode tab: search box → grouped results → "Add"; "Optimise" button.
- Quote panel: per-store breakdown, fee, grand total, changed-price highlights, validity countdown.
- Approval card (opened by agent event or "Checkout" button): exact total → Approve → Pay, with a "simulate failure" checkbox → redirect to tracker on PAID.
- Banner when the agent is unavailable, pointing to manual mode.

**Done when:** the demo prompt goes from chat to a paid basket in the browser; the same works through manual mode with `GEMINI_API_KEY` unset.

### T13 · Customer order tracker — 1.5 h
- Payment badge (separate). One card per sub-order with a timeline: Finding store → Offered to X (attempt n/3, countdown) → declined/timed out → Offered to Y → Accepted → Preparing → Ready → Out for delivery → Delivered; refund line on failure; SETTLED banner.

**Done when:** a manual run with one reject and one timeout reads correctly on the tracker.

### T14 · Merchant dashboard and demo wall — 3 h
- `StoreDashboard` component: header with Online toggle (first click plays a short sound to unlock audio); offer cards with items, amount, distance, countdown ring, looping alert, Accept / Reject (reason dropdown); "Too late" on 409; orders column with one-click Advance; customer phone masked until accepted.
- Catalogue tab: table with inline price/stock edit, add product form (pick canonical or new), deactivate. ✂
- CSV import: template download, upload → report of rejected rows. ✂
- `/merchant` = one dashboard for the logged-in store. `/wall` = grid of all 5 dashboards (compact mode, admin token) + "All stores online" button.

**Done when:** from `/wall` you can accept, reject, let one expire and deliver all orders; adding a product makes it searchable.

### T15 · Admin console — 1.5 h
- Passcode gate. Reset & reseed (with an in-page "are you sure" step). Offer window seconds. Fail next payment. Per-store fault toggles (auto-reject, never answer).
- Ledger table (gross, commission, net, subsidy per merchant). ✂
- Audit viewer: pick a basket → Beckn messages in order (action, direction, store, time, expandable JSON). ✂

**Done when:** each control visibly changes the next run.

---

## Phase 5 — Proof and polish (hours 36–42)

### T16 · End-to-end demo script — 2 h
- `scripts/e2e-demo.ts` against any base URL: reset → offer window 5 s → (agent if key present, else `plan_basket` + basket API) → quote → approve → pay → store 1 accepts, store 3 rejects, store 2 left to expire → assert reassignment to backups → advance all to DELIVERED → assert ledger numbers and SETTLED → assert repeat pay and repeat accept are no-ops.

**Done when:** `pnpm e2e --url <deployed>` passes twice in a row.

### T17 · Hosted hardening and docs — 2 h
- Cloud Run: confirm min/max 1 instance and always-on CPU, startup probe on `/health`, migrations on boot; agent rate limit and daily cap on; budget alert set; logs in Cloud Logging searchable by `transaction_id`.
- Optional: map a nicer URL (Firebase Hosting rewrite to the Cloud Run service gives `kiranaai.web.app`).
- `README.md` (URL, personas, local fallback), `docs/ONDC_DEVIATIONS.md` (canonical-ID search tag, `loose_declined` tag, no signing/subscribe/log verification/IGM/RSF, simplified payment), `docs/DEMO.md` (click-by-click script from PRD §14).
- Judge-friendly landing on `/`: two-line explanation + "Start demo" (opens `/shop` and `/wall`).

**Done when:** someone who hasn't seen the project completes the demo from the URL using only `/`.

### T18 · Rehearse and record backup — 2 h
- Two full rehearsals at 45 s offer window; fix rough edges.
- Record a ~3 minute screen video of the full flow as a fallback.

**Done when:** the demo fits in ~6 minutes and the video is saved.

---

## P1 if time remains (in order)
1. Second BPP base path `/bpp2` hosting Balaji and Annapurna, registered in the registry (shows real fan-out) — 1 h
2. Delivery OTP (ORD-06) — 1 h
3. Merchant ledger view (MER-12) — 0.5 h
4. Customer cancel while dispatching (DSP-09) — 1 h
5. Agent clarifying questions and substitutions (AGT-09/11, DIS-07) — 1.5 h
6. Browser notification for background offers — 0.5 h
7. **Google extras** (good for judging if Google is a sponsor):
   - Voice ordering: record audio in the browser, send it to Gemini as multimodal input (AGT-13) — 1.5 h
   - Places Autocomplete for the customer address + map pin on offer cards (DIS-09) — 1 h
   - Shelf/invoice photo → products with Gemini vision + review screen (MER-09/10) — 2 h

## 24 h cut
Keep T01–T13 and T16 as written. Reduce:
- **T14:** offers + orders + online toggle + wall only; catalogue becomes inline price/stock edit; skip CSV import (say it's "on the roadmap" in the demo).
- **T15:** reset, offer window and fault toggles only; show the ledger as JSON from `/bap/admin/ledger`; skip the audit viewer (show Cloud Logging filtered by `transaction_id` instead).
- **T17:** README + deviations doc only. **T18:** one rehearsal, record the video.
- Skip the advisory lock and 5 s reconciler in T08 (keep boot reconciliation).

That brings the total to ~24 h of focused work.

## Lanes for a team of 2–3 (after T03)
| Lane | Tasks |
|---|---|
| A — Seller | T04 → T05 → T14 → T15 |
| B — Buyer | T06 → T07 → T08 → T09 → T16 |
| C — Agent + customer UI (with mocked API until B lands) | T11 → T10 → T12 → T13 → T17 |

Merge points: hour ~14 (search/quote working end to end), hour ~24 (paid basket dispatching), hour ~34 (full demo on the hosted URL).

## P0 coverage
| Area | Tasks |
|---|---|
| MER-01…08, 13 | T02, T05, T14 |
| DIS-01…06 | T02, T04, T06, T12 |
| AGT-01…08, 10, 12 | T09, T10, T12 |
| CHK-01…07 | T06, T07, T12 |
| DSP-01…07 | T05, T08, T13, T15 |
| ORD-01…05 | T07, T08, T13, T15 |
| BKN-01…06 | T03, T04, T05, T06, T08, T17 |
| Hosting (§13.1) | T01, T10, T17 |
