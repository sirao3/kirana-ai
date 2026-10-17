# Orbi / KiranaAI — hackathon build

Agentic commerce for kirana stores on Beckn/ONDC. 24–48 h hackathon, hosted on Google Cloud for judges.

## Source of truth
- `artifacts/PRD.md` — requirements v2.1 (architecture, state machines, dispatch rules, demo script, decisions).
- `artifacts/TASKS.md` — sequential tasks T01–T18 with "Done when" checks, a 24 h cut list, and 3 parallel lanes (A seller / B buyer / C agent+UI) after T03.
- `artifacts/LANES.md` — lane ownership, rules and the BPP⇄BAP / merchant / admin contracts. BAP HTTP API types: `packages/shared/src/api.ts`.
Read both before starting a task. If code and PRD disagree, raise it; don't silently diverge.

## Current status (18 Oct 2026)
- GCP project `orbi-kirana-hack`, billing `018805-3BD3A8-EA2BBE` (INR). Budget alert `kiranaai-hack` ₹1,000/month on this project.
- **Hosting changed (PRD §0.1):** Postgres 16 on Always Free e2-micro VM `kiranaai-db` (us-central1-a, internal IP only); Cloud Run `kiranaai` in **us-central1**, min 0 / max 1, request-based CPU, Direct VPC egress. No Cloud SQL.
- `deploy/gcp-setup.sh` (idempotent) created secrets `db-password`, `admin-passcode`, `gemini-api-key`, service account `kiranaai-run`, firewall `kiranaai-allow-pg`, the VM and the budget. `deploy/gcp-deploy.sh` deploys.
- Background jobs must register with `app.ctx.ticker` (runs on boot, every 1 s, and from an onRequest hook) — never a bare setInterval.
- Local: `docker compose up -d postgres` (port 5433, user/pass/db `kiranaai`); tests use it.
- Done: T01–T03 (hosted round-trip works). URL: https://kiranaai-769889659635.us-central1.run.app. Admin API is `/admin/api/*` (`/admin` is the web page).
- The agent calls the BAP over loopback HTTP with an allowlist (no approve/pay), not in-process functions.
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
