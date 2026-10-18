# KiranaAI

Agentic commerce for neighbourhood kirana stores, built on Beckn/ONDC concepts.

A customer tells an AI agent what they need ("Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea").
The agent searches nearby stores through a Beckn gateway, builds one basket across stores with a reason for each choice,
and gets verified quotes. The customer approves and pays once. Each store then gets a timed offer, ride-hailing style; if a
store rejects or stays silent, the order moves to the next-best store automatically (up to 3 attempts), with refunds if
nobody can fulfil it.

- Hosted demo: https://kiranaai-769889659635.us-central1.run.app (open `/`, click **Start demo**)
- Click-by-click walkthrough: [docs/DEMO.md](docs/DEMO.md)
- Requirements and design: [artifacts/PRD.md](artifacts/PRD.md); protocol deviations: [docs/ONDC_DEVIATIONS.md](docs/ONDC_DEVIATIONS.md)

## What is in it

| Piece | Where |
|---|---|
| Buyer app (BAP): search, basket, quote, approve, pay, dispatch, refunds, ledger | `apps/server/src/bap` |
| Gemini shopping agent (cannot pay or approve: no tool or route exists for it) | `apps/server/src/bap/agent` |
| Seller side (BPP): catalogue, offers, merchant API | `apps/server/src/bpp` |
| Beckn gateway and registry | `apps/server/src/gateway`, `apps/server/src/beckn` |
| Admin: reset, config, faults, ledger, audit | `apps/server/src/admin` |
| Web app: customer shop and tracker, merchant dashboard, store wall, admin console | `apps/web` |
| Shared types and money helpers | `packages/shared` |

Stack: TypeScript, pnpm workspaces, Fastify + zod, Postgres 16 + Drizzle, Vite + React + Tailwind + TanStack Query
(1 s polling), `@google/genai` (Gemini), Vitest. One container serves the API and the web app.

## Personas (no passwords)

Everything is a demo persona picked on `/`:

- **Customers**: Priya (lives inside every store's delivery radius; used by the demo) and Rahul (outside most radii).
- **Stores**: five kirana stores, each opens its own dashboard at `/merchant`.
- **Store wall** `/wall`: all five store dashboards on one screen, for running a demo alone.
- **Admin** `/admin`: passcode-protected (local default `demo`; the hosted passcode is in Secret Manager `admin-passcode`).

## Run locally

Requirements: Node 22+, pnpm 9, Docker.

```bash
pnpm install
cp .env.example .env            # add GEMINI_API_KEY to use the AI agent (manual shopping works without it)
docker compose up -d postgres   # Postgres 16 on localhost:5433
pnpm dev                        # API on http://127.0.0.1:8080 (migrates and seeds on boot)
pnpm dev:web                    # web app on http://localhost:5173, proxies API calls to :8080
```

Open http://localhost:5173 and click **Start demo**. `pnpm seed` reseeds; the admin console can also reset the demo.

Useful environment variables (see `.env.example`): `GEMINI_API_KEY`, or `GEMINI_VERTEX=1` + `GOOGLE_CLOUD_PROJECT` for
Vertex AI (see `artifacts/RUNBOOK.md` §5), `GEMINI_MODEL` (default `gemini-3.5-flash-lite`),
`ADMIN_PASSCODE`, `OFFER_WINDOW_SECONDS` (default 45), `AGENT_DAILY_CAP` (default 500 agent turns per day).

## Tests

```bash
docker compose up -d postgres
export TEST_DATABASE_URL=postgres://kiranaai:kiranaai@127.0.0.1:5433/kiranaai_test   # any scratch database
pnpm typecheck && pnpm build && pnpm test
```

Server tests run against a real Postgres. The agent tests mock Gemini and the loopback tool client; one live Gemini smoke
test runs only when `GEMINI_API_KEY` (or `GEMINI_VERTEX=1`) is set (in the environment or the root `.env`).

## Deploy

Google Cloud (Cloud Run + a free-tier Postgres VM + Secret Manager). Scripts live in `deploy/`:

```bash
bash deploy/gcp-setup.sh     # one-time, idempotent: APIs, secrets, service account, DB VM, budget alert
bash deploy/gcp-deploy.sh    # builds from source and deploys the Cloud Run service
```

## How the agent stays safe

- The agent calls the buyer API over loopback HTTP with the customer's token and an explicit allowlist of routes.
  Approve and pay are not on it. Paying needs a single-use approval token that only the **Approve** button in the UI obtains.
- Totals on screen always come from the quote API, never from the agent's text. Order status comes only from the order API.
- Packaged goods only: loose requests such as "250 g jeera" are declined with a packaged alternative.
- Limits: at most 8 tool calls per turn, 20 s per turn (then the UI says so and manual mode still works),
  20 turns per IP per 10 minutes, and a daily cap.
