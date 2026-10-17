# Orbi / KiranaAI — hackathon build

Agentic commerce for kirana stores on Beckn/ONDC. 24–48 h hackathon, hosted on Google Cloud for judges.

## Source of truth
- `artifacts/PRD.md` — requirements v2.1 (architecture, state machines, dispatch rules, demo script, decisions).
- `artifacts/TASKS.md` — sequential tasks T01–T18 with "Done when" checks, a 24 h cut list, and 3 parallel lanes (A seller / B buyer / C agent+UI) after T03.
- `artifacts/LANES.md` — lane ownership, rules and the BPP⇄BAP / merchant / admin contracts. BAP HTTP API types: `packages/shared/src/api.ts`.
- `artifacts/RUNBOOK.md` — how to test (browser, tests, e2e), run locally, deploy, and rotate the Gemini key.
- `docs/ONDC_DEVIATIONS.md` — every Beckn/ONDC deviation and kiranaai tag; update it when you add one.
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
- **Not yet verified:** `pnpm e2e --agent` (first run: agent proposed milk ×2 so the plan was Gupta-only; prompt now has a weekly-quantity guide, re-run blocked by Gemini quota); any page in a real browser (Shop, Tracker, Merchant, Wall, Admin, Picker).
- **Gemini quota:** the AI Studio key is on the free tier — 20 generate requests/day, exhausted on 18 Oct. An agent turn uses several requests, so the hosted demo needs a billed key/project before judging. On 429 the agent returns 503 and the UI points to manual mode.
- Next: browser walk-through, agent e2e once Gemini quota allows, then T18 (rehearse, record video).
- Admin API is `/admin/api/*` (`/admin` is the web page). Local test admin passcode is `demo`; hosted passcode is in Secret Manager `admin-passcode`.
- The agent calls the BAP over loopback HTTP with an allowlist (no approve/pay), not in-process functions.
- Dispatch concurrency: no advisory lock across HTTP; the next attempt is claimed in a short `SELECT … FOR UPDATE` + unique `(sub_order_id, attempt_no)`. Reassignment runs inside the `on_cancel` handler before ACK; reconciler (5 s) is the backstop.
- Optimiser tie-break: cheapest → fewer stores → smaller total distance (PRD §12). Seed prices are tuned for C1–C3; `seed.test.ts` guards them — rerun it if you touch prices.
- Test DBs: `kiranaai` (integrator), `kiranaai_a/_b/_c` (lanes) on local docker Postgres; tests read `TEST_DATABASE_URL`.
- Env knobs: `PAYMENT_SETTLE_MS`, `BAP_SEARCH_WINDOW_MS` (1500), `BAP_REASSIGN_WINDOW_MS` (800), `AGENT_DAILY_CAP` (500).
- `gcloud` CLI is installed and signed in; on Git Bash, pass Windows paths (`cygpath -w`) to gcloud file flags.

## Gemini
- Gemini API with an AI Studio key in `.env` (`GEMINI_API_KEY`), model `GEMINI_MODEL=gemini-3.5-flash`.
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
