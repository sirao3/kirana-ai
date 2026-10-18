# KiranaAI — Test and deploy runbook

Hosted URL: https://kiranaai-769889659635.us-central1.run.app
GCP project `orbi-kirana-hack`, region `us-central1`. Commands assume the repo root
`C:\Users\sreer\google-hack\orbi`; Git Bash unless marked PowerShell.

## 1. Test as a user (browser)

Works the same on the hosted URL or a local server (section 3).

1. **Reset.** Open `/admin`, enter the admin passcode, click **Reset & reseed** and confirm.
   This restores the demo data and the 45 s offer window. Do this after every `pnpm e2e` run,
   because the script leaves the window at 5 s.
2. **Start.** Open `/` and click **Start demo**. You are signed in as customer Priya on `/shop`,
   and the demo wall (`/wall`, all 5 stores) opens in a new tab. On the wall, click
   **All stores online** (this also enables the offer sound).
3. **Build the basket.**
   - Chat: *"Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea."*
   - Or the **Manual** tab: list atta ×1, toor dal ×2, tea ×1, milk ×8 → **Optimise**.
     Expect Sharma + Gupta + Lakshmi, about ₹1,400, one reason per item.
4. **Checkout.** The quote shows ₹1,400 split by store, with a validity countdown.
   **Approve**, then **Pay**. You land on the tracker with three orders "Offered to …".
   Optional: tick **simulate failure** before paying to see a failed payment and retry.
5. **Act as the stores** (wall tab):
   - Sharma: **Accept**.
   - Lakshmi: **Reject** with a reason. Within ~2 s it is offered to Annapurna; accept there.
   - Gupta: do nothing. After 45 s it expires and moves to Balaji; accept there.
   - **Advance** each order until Delivered.
6. **Check.** The tracker shows each timeline and a SETTLED banner. In `/admin`, the ledger shows
   Balaji's ₹40 subsidy (net ₹1,440 in total) and the audit viewer shows the Beckn messages.
   Each merchant sees their own share under **Earnings** (Balaji: net ₹420 plus the ₹40 platform credit; Today / All time).

Also try:
- Search "gehun ka aata" (should find atta) and "250 g jeera" (declined, 100 g pack offered).
- Tap "Delivering to Indiranagar, Bengaluru" under the Shop title, pick "CV Raman Nagar": Lakshmi and Balaji show "Doesn't deliver to you", search "atta" no longer lists them and the planner skips them. Pick Indiranagar again (or Admin > Reset) to restore the default.
- Chat "just pay for me" (only the approval card appears) and "where is my order?".
- `/merchant` as one store: catalogue tab, add a product (then search for it), CSV import.

If the chat says the assistant is unavailable, Gemini failed or hit its quota (see section 5);
manual mode still works.

### UI walkthrough (screenshots)

`pnpm ui` drives the real UI in your installed Chrome or Edge (playwright-core, no browser download)
and saves screenshots to `.ui-shots/` (git-ignored). It never uses the agent chat, so it costs no Gemini quota.

```bash
pnpm build                       # then (re)start the server: it indexes apps/web/dist at boot
pnpm ui --url http://127.0.0.1:8095 --passcode demo
# flags: --widths 412,1440  --themes light,dark  --out .ui-shots  --browser <chrome.exe|msedge.exe>  --no-reset
```

- Per width x theme (default 4 runs, 16-17 shots each): landing, shop (Assistant, Search & plan, add Sharma atta,
  basket sheet below 840 px), verified-quote dialog, approve, pay, tracker, merchant Sharma (offer, Reject...,
  Accept, Start preparing), wall, admin gate, Controls, Ledger, Audit.
- It **resets the data** at the start of each run (it needs a clean seed); `--no-reset` skips that.
  Do not point it at a demo in use. After a rebuild without a server restart the new assets are served as
  `index.html` (MIME error): restart the server. Use your own port and database for isolated runs.
- Exit code 1 on any page error, console error or failed step; the problems are printed. Look at the images.
- Default browser: `C:/Program Files/Google/Chrome/Application/chrome.exe`; on Edge pass
  `--browser "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"`.

**Before presenting:** open `/admin` > Controls. The **Demo readiness** card lists the offer window (should be 45 s),
fail-next-payment, store faults, stores online and leftover runs, each with a one-click fix; the top bar shows
a warning label while anything is off. `pnpm e2e` leaves the window at 5 s: use the card or the 5 / 45 / 120 s chips.

## 2. Automated tests

```bash
docker compose up -d postgres   # local Postgres on 5433 (user/pass/db kiranaai)
pnpm install
pnpm typecheck
pnpm build                      # needed before tests: one test serves apps/web/dist
pnpm test
```

- Tests use `TEST_DATABASE_URL` (default: the local `kiranaai` database).
- The live Gemini smoke test in `apps/server/test/agent.test.ts` skips without `GEMINI_API_KEY`
  and fails if the key is out of quota.

**End-to-end demo script** (PRD §14 scenario over HTTP; passes on the hosted URL):

```bash
pnpm e2e --url <base-url> --passcode <admin-passcode>           # plan + basket API
pnpm e2e --url <base-url> --passcode <admin-passcode> --agent   # through the Gemini agent
```

It resets the data, sets a 5 s offer window, and runs pay → accept / reject / expire →
reassignment → delivered → ledger → idempotency checks. Run it twice; it should pass both
times. Reset in `/admin` afterwards.

## 3. Run locally

```bash
docker compose up -d postgres
pnpm build
DATABASE_URL=postgres://kiranaai:kiranaai@127.0.0.1:5433/kiranaai PORT=8090 \
  SELF_BASE_URL=http://127.0.0.1:8090 ADMIN_PASSCODE=demo \
  node --env-file=.env apps/server/dist/index.cjs
```

Open http://127.0.0.1:8090 (local admin passcode `demo`). If the database was seeded for a
different port, click **Reset & reseed** in `/admin` once: the registry stores absolute URLs.
For UI work with hot reload, use `pnpm dev` (server) and `pnpm dev:web` (Vite on 5173).

## 4. Deploy to Google Cloud

Prerequisites: `gcloud` signed in with project `orbi-kirana-hack`. The one-time setup
(`bash deploy/gcp-setup.sh`) is already done and is idempotent.

```bash
pnpm build && pnpm test                        # check first
bash deploy/gcp-deploy.sh                      # ~4-5 min
```

- The script builds from your **local working copy** with Cloud Build, so uncommitted changes ship
  too (`.env` is excluded by `.gcloudignore`).
- It deploys Cloud Run `kiranaai` (min 0 / max 1, VPC egress to the Postgres VM, secrets from
  Secret Manager) and prints the URL and `/health`. Expect `{"status":"ok","db":"ok"}`.
- Migrations run on boot. A fresh database is seeded automatically.
- After deploying: run `pnpm e2e` against the URL, then **Reset & reseed** in `/admin`.

Hosted admin passcode:
```bash
gcloud secrets versions access latest --secret=admin-passcode
```

Logs:
```bash
gcloud logging read 'resource.labels.service_name="kiranaai" AND severity>=WARNING' --limit 20 --freshness=30m
```

## 5. Update the Gemini API key

You don't need a new key to lift the free-tier limit (20 requests/day): enable billing for the
key's project in Google AI Studio, then do step 3 below.

1. Add a new secret version (PowerShell; the key is not echoed or saved in history):
   ```powershell
   $k = Read-Host "New Gemini key" -AsSecureString
   [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($k)) | Out-File -NoNewline -Encoding ascii key.tmp
   gcloud secrets versions add gemini-api-key --data-file=key.tmp
   Remove-Item key.tmp
   ```
2. Update `GEMINI_API_KEY=` in the local `.env` (git-ignored; never commit it).
3. Make Cloud Run pick it up (secrets are read when an instance starts):
   ```bash
   gcloud run services update kiranaai --region us-central1 --update-secrets GEMINI_API_KEY=gemini-api-key:latest
   ```
   or run the full `bash deploy/gcp-deploy.sh`.
4. Optional: disable the old version once the new key works:
   ```bash
   gcloud secrets versions list gemini-api-key
   gcloud secrets versions disable <old-version> --secret=gemini-api-key
   ```
5. Check: send the demo prompt in `/shop`. If it still fails, the logs show `429 RESOURCE_EXHAUSTED`
   when quota is the cause.

Model: `GEMINI_MODEL=gemini-3.5-flash-lite` (set by the deploy script; switched 18 Oct because the free-tier
`gemini-3.5-flash` quota of 20 requests/day was exhausted; Flash Lite passed `pnpm e2e --agent`). `gemini-3.5-flash`
still works by setting the variable. Don't use `gemini-3.8-flash` (80–100 s per reply). The Live models
(`gemini-3.8-live`, `gemini-3.1-flash-live-preview`) only do WebSocket sessions with audio output, so they need a
different client; see CLAUDE.md.

## 6. Cost and cleanup

- **Postgres VM:** an Always Free e2-micro. **Cloud Run:** scales to zero.
- **Budget alert:** `kiranaai-hack`, ₹1,000/month.
- **After judging:** delete the Cloud Run service and the VM, or the whole project:
  `gcloud run services delete kiranaai --region us-central1` and
  `gcloud compute instances delete kiranaai-db --zone us-central1-a`.
