# Orbi / KiranaAI — hackathon build

Agentic commerce for kirana stores on Beckn/ONDC. 24–48 h hackathon, hosted on Google Cloud for judges.

## Source of truth
- `artifacts/PRD.md` — requirements v2.1 (architecture, state machines, dispatch rules, demo script, decisions).
- `artifacts/TASKS.md` — sequential tasks T01–T18 with "Done when" checks, a 24 h cut list, and 3 parallel lanes (A seller / B buyer / C agent+UI) after T03.
- `artifacts/LANES.md` — lane ownership, rules and the BPP⇄BAP / merchant / admin contracts. BAP HTTP API types: `packages/shared/src/api.ts`.
- `artifacts/RUNBOOK.md` — how to test (browser, tests, e2e), run locally, deploy, and rotate the Gemini key.
- `docs/ONDC_DEVIATIONS.md` — every Beckn/ONDC deviation and kiranaai tag; update it when you add one.
- `artifacts/UX_PLAN.md` — UX improvement backlog UX-00…UX-16 (gaps, principles, lanes W/S, per-task spec and "Done when"). Pick tasks from it for UI work.
Read them before starting a task. If code and PRD disagree, raise it; don't silently diverge.

## Current status (18 Oct 2026)
- GCP project `orbi-kirana-hack`, billing `018805-3BD3A8-EA2BBE` (INR). Budget alert `kiranaai-hack` ₹1,000/month on this project.
- **Hosting changed (PRD §0.1):** Postgres 16 on Always Free e2-micro VM `kiranaai-db` (us-central1-a, internal IP only); Cloud Run `kiranaai` in **us-central1**, min 0 / max 1, request-based CPU, Direct VPC egress. No Cloud SQL.
- `deploy/gcp-setup.sh` (idempotent) created secrets `db-password`, `admin-passcode`, `gemini-api-key`, service account `kiranaai-run`, firewall `kiranaai-allow-pg`, the VM and the budget. `deploy/gcp-deploy.sh` deploys.
- Background jobs must register with `app.ctx.ticker` (runs on boot, every 1 s, and from an onRequest hook) — never a bare setInterval.
- Local: `docker compose up -d postgres` (port 5433, user/pass/db `kiranaai`); tests use it.
- URL: https://kiranaai-769889659635.us-central1.run.app — merged app deployed 18 Oct; `pnpm e2e` passed twice on it (reject → next offer ~1.9 s), then reset (offer window 45 s). Hosted admin passcode: `gcloud secrets versions access latest --secret=admin-passcode`. `pnpm e2e` leaves the offer window at 5 s — reset afterwards.
- **Done on `main`:** T01–T17 except T18. T01–T03 built directly; T04–T17 built in parallel lanes A/B/C (worktree branches `worktree-agent-*`, merged) plus an integration commit.
- **Verified locally:** 148 tests passed after the merge (shared 10, web 10, server 128; run `pnpm build` before `pnpm test` — one test serves `web/dist`). The live Gemini smoke test (`test/agent.test.ts`) fails while the free-tier quota is exhausted (429), so `pnpm test` is red until it resets. `pnpm e2e --url http://127.0.0.1:8090 --passcode demo` passed twice in a row against the real BPP+BAP: ₹1,400 paid, reject → Annapurna in ~1 s, expiry → Balaji, ledger net ₹1,440 / subsidy ₹40, SETTLED, repeat pay/accept no-ops.
- **Agent e2e passed (18 Oct) on `gemini-3.5-flash-lite`:** `pnpm e2e --url http://127.0.0.1:8091 --passcode demo --agent`. One agent turn (~10 s: plan → set basket → quote) built the 3-store basket, then ₹1,400 paid, reject → Annapurna ~1.2 s, expiry → Balaji, ₹40 subsidy, SETTLED.
- **Not yet verified:** any page in a real (non-headless) browser (Shop, Tracker, Merchant, Wall, Admin, Picker).
- **Gemini quota:** the AI Studio key is on the free tier. `gemini-3.5-flash` (20 generate requests/day) was exhausted on 18 Oct, so the default model is now **`gemini-3.5-flash-lite`** (separate per-model quota). An agent turn uses several requests; a billed key/project is still the safe choice before judging. On 429 the agent returns 503 and the UI points to manual mode. `AGENT_FAKE=1` swaps in a scripted model for UI work without quota.
- **UI redesigned in Material Design 3 (18 Oct):** tokens (leaf-green seed, light + dark) in `apps/web/src/index.css`; component kit in `apps/web/src/components/m3/` (use it, not raw Tailwind colours). Customer has Shop / Orders destinations (`/shop/orders` list-detail replaces the old Tracker); merchant has Live / Delivered / Catalogue; admin has Controls / Ledger / Audit. Material Symbols load as a **subset**: when you use a new icon name, add it (sorted) to `icon_names=` in `apps/web/index.html` or it renders as text. Walked through headless at 412 px and 1440 px, light and dark: quote → approve → pay → tracker, merchant accept/reject, wall, admin. **Deployed 18 Oct** (revision `kiranaai-00005-kb8`); hosted smoke test passed (landing interactive ~3 s, search "gehun ka aata", wall, no page errors).
- **UX wave 1 merged and deployed (18 Oct, revision `kiranaai-00007-npm`, `gemini-3.5-flash-lite`):** UX-00 (`pnpm ui` walkthrough), UX-01 (live agent steps, `GET /bap/agent/turns/:turnId`), UX-02 (reasons on basket lines; migration `0301`), UX-03 (suggested quantities + `POST /bap/basket/confirm-qty`), UX-04/05/10 (price protection, handoff strip, receipt), UX-06 (`/demo` cockpit; Start demo goes there on ≥840 px), UX-07 (lazy routes, skeleton, waking-server message), UX-08 (Demo readiness card; `/admin/api/faults` has `isOnline`), UX-09 (compact offer takeover, title/favicon/vibrate, audio banner, A/R keys). Built by 4 Sonnet subagents in worktrees, merged on `main`. Checks: shared 10, web 30, server 134+4 tests pass (incl. live Gemini on Flash Lite); `pnpm e2e --agent` passed; `pnpm ui` 66 screenshots, 0 errors; hosted smoke OK (landing ~2.6 s, `/demo`, agent chat).
- **UX wave 2 merged and deployed (18 Oct, revision `kiranaai-00008-4zq`):** UX-11 (merchant **Earnings** tab, `GET /bpp/merchant/:storeId/ledger`, merchant-token scoped, reads `bap.ledger_entry`), UX-13 (search combobox + `GET /bap/suggest`, effective price "₹450 + ₹20 delivery = ₹470", Add to list, "Optimise this basket" nudge via `POST /bap/plan` `current` → `baseline`; ₹1,400 basket in 3 interactions), UX-14 (address sheet + SVG radius map, `GET/PATCH /bap/profile/address`, 4 presets — no Places key; helper `GET /bpp/serviceability`; reset restores Indiranagar), UX-15 (axe in `pnpm ui`, `--no-axe`/`--zoom 2`; dialog/sheet focus return, min-heights, phone catalogue cards, live regions; `docs/A11Y.md` NVDA checklist **not yet run by a human**). 4 Sonnet subagents in worktrees, merged on `main` plus an integration fix (suggestions reopen on focus). Checks: shared 10, web 42, server 148 pass; `pnpm ui` 90 shots, axe 0 serious/critical, 0 errors; hosted `pnpm e2e` passed (Balaji earnings ₹420 net incl. ₹40 subsidy), then reset. Skipped: UX-12 (voice) and UX-16 (photo-to-catalogue) need live Gemini. Known: at 200 % zoom merchant app-bar titles truncate and the offer takeover may overflow 412 px.
- **Gemini 503 "high demand":** Flash Lite sometimes returns 503 UNAVAILABLE; `llm.ts` retries 503/500 twice (0.8 s, 1.6 s), never 429. Hosted status questions took 11–14 s on 18 Oct under load. A billed key does not remove 503s; keep manual mode as the fallback in the demo.
- Server gotcha for UI work: the server indexes `web/dist` at boot, so after `pnpm build` restart it or new hashed assets are served as `index.html` (MIME error). For isolated UI runs use port 8091 + `kiranaai_c`, then `POST /admin/api/reset` once.
- Next: real-browser walk-through of `/demo` (hosted data was reset after wave 2), a human NVDA pass (`docs/A11Y.md`), then T18 (rehearse, record video).
- Admin API is `/admin/api/*` (`/admin` is the web page). Local test admin passcode is `demo`; hosted passcode is in Secret Manager `admin-passcode`.
- The agent calls the BAP over loopback HTTP with an allowlist (no approve/pay), not in-process functions.
- Dispatch concurrency: no advisory lock across HTTP; the next attempt is claimed in a short `SELECT … FOR UPDATE` + unique `(sub_order_id, attempt_no)`. Reassignment runs inside the `on_cancel` handler before ACK; reconciler (5 s) is the backstop.
- Optimiser tie-break: cheapest → fewer stores → smaller total distance (PRD §12). Seed prices are tuned for C1–C3; `seed.test.ts` guards them — rerun it if you touch prices.
- Test DBs: `kiranaai` (integrator), `kiranaai_a/_b/_c` (lanes) on local docker Postgres; tests read `TEST_DATABASE_URL`.
- Env knobs: `PAYMENT_SETTLE_MS`, `BAP_SEARCH_WINDOW_MS` (1500), `BAP_REASSIGN_WINDOW_MS` (800), `AGENT_DAILY_CAP` (500).
- `gcloud` CLI is installed and signed in; on Git Bash, pass Windows paths (`cygpath -w`) to gcloud file flags.

## Gemini
- Gemini API with an AI Studio key in `.env` (`GEMINI_API_KEY`), model `GEMINI_MODEL=gemini-3.5-flash-lite` (default since 18 Oct; ~1.5 s per tool call). `gemini-3.5-flash` still works via the env var when it has quota.
- Live API models (`gemini-3.8-live`, `gemini-3.1-flash-live-preview`) are WebSocket-only (`bidiGenerateContent`) and reject TEXT output; with AUDIO output + `outputAudioTranscription` they do function calling (~1–2 s, probed 18 Oct). Using them needs a separate Live client behind the `Llm` interface in `apps/server/src/bap/agent/llm.ts`, not a model-name swap. Candidate for voice input (UX-12).
- Measured: ~2 s simple reply, ~3 s for a turn with parallel tool calls. Do **not** use `gemini-3.8-flash` (80–100+ s per reply); `gemini-2.5-flash` is retired.
- Gemini 3 parts carry `thoughtSignature`: append the model's returned content unchanged to history.

## Stack (decided — see PRD §4.2)
TypeScript, pnpm workspaces (`apps/server`, `apps/web`, `packages/shared`), Fastify + zod, Postgres 16 + Drizzle (`pg_trgm`), Vite + React + Tailwind + TanStack Query (1 s polling, no SSE), `@google/genai`, Vitest. One container on Cloud Run (min 0 / max 1, us-central1) serving API + web; Postgres on a free VM; Secret Manager. Modules talk Beckn over HTTP to `SELF_BASE_URL=http://127.0.0.1:$PORT`.

## Rules
- Never commit `.env` or print the API key. Production secrets go in Secret Manager.
- Money is integer paise; quantities are integer pack counts.
- The agent must never be able to pay or confirm (approval token only from the UI button).
- Each task ends with tests passing, local run working, and a commit. Redeploy after each task once T01 is done.
- Windows machine: PowerShell is the primary shell; Git Bash is also available.
