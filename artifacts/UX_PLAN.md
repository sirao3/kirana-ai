# KiranaAI — UX Improvement Plan

Companion to [PRD.md](PRD.md) v2.1 and [TASKS.md](TASKS.md). Written 18 Oct 2026, after the Material Design 3 redesign (commit `9ce0173`). Each task below is self-contained, so an agent can pick it up cold and finish it.

**Who this is for:** agents (or people) running these tasks one at a time or in parallel lanes. Read §1–§3 once, then take a task from §4.

---

## 1. What the product has to prove, and where the UX falls short

The judged story (PRD §1.1, §14) has five moments:

1. **"Say what you need"**: one sentence becomes a 3-store basket, with a reason per item.
2. **"One verified total"**: fresh quotes, price changes highlighted, approve and pay once.
3. **"Stores answer like ride-hailing"**: three timed offers ring on three dashboards.
4. **"Nothing falls through"**: a reject and a timeout are reassigned in under 2 s, and the customer still pays the approved price.
5. **"Everyone gets paid"**: delivered → settled, a per-merchant ledger, and the Beckn audit trail.

The redesign made every screen coherent, but it still mostly *shows state*. It does not yet *tell the story*. Gaps seen in the walkthrough (412 px and 1440 px, light and dark):

| # | Gap | Evidence | Story moment |
|---|---|---|---|
| G1 | An agent turn is a 3–10 s black box ("Checking stores…") and then a wall of text. The tool steps only appear after the turn ends. | `ChatPanel` gets `steps` only in the final reply | 1 |
| G2 | The **reason per item** (MVP criterion 1, AGT-06) appears only in the agent's prose. The basket lines have none. | `BasketItemView` has no reason field | 1 |
| G3 | Inferred quantities are not shown as **editable proposals** (AGT-02, P0). The basket silently gets "2 × atta". | no "proposed" state in UI | 1 |
| G4 | Price protection is invisible. When Balaji replaces Gupta at a higher price, the customer is never told "you still pay ₹380; we cover ₹40". | `AttemptView.quotedTotalPaise` exists but is unused | 4 |
| G5 | Reassignment is a list of timeline rows. The handoff (Lakshmi ✕ → Annapurna ✓) is not a *moment*. | `OrderDetail` timeline | 4 |
| G6 | The presenter juggles two tabs, a pop-up blocker, and an audio unlock nobody can see. Nothing guides a cold judge through §14. | `Picker.startDemo`, `alert.ts` | all |
| G7 | Scale-to-zero cold start (min 0 instances) gives a blank first load of several seconds, against the "first load < 3 s" criterion. | Cloud Run min 0, 410 kB single JS bundle | all |
| G8 | Admin hazards are silent. `pnpm e2e` leaves the offer window at 5 s, and nothing in the UI warns you before a live demo. | CLAUDE.md note; `ConfigPanel` | 3 |
| G9 | Merchant offer arrival relies on sound plus a ring. On a phone or background tab it is easy to miss, and audio is locked until a click. | `OfferCard`, `alert.ts` | 3 |
| G10 | Settlement ends on a banner. There is no receipt (per-store paid, refunds, subsidy), and the ledger lives only in admin. | `OrderDetail`, `LedgerPanel` | 5 |
| G11 | Open accessibility items from the M3 audit: no screen-reader pass, no 200 % text check, tracker transitions not announced, catalogue table scrolls sideways on phones. | redesign self-audit | — |

---

## 2. Principles for every task

- **Use the M3 kit.** Build with `apps/web/src/components/m3/` (Button, Card, StatusLabel, InlineMessage, Dialog, BottomSheet, Snackbar, Tabs, Switch…). Use semantic colour utilities (`bg-surface-container`, `text-on-surface-variant`, `bg-primary-container`…), never raw Tailwind palette colours. Type comes from `type-*` utilities.
- **Icons are a subset.** Any new Material Symbol name must be added, in sorted order, to `icon_names=` in `apps/web/index.html`, or it renders as text.
- **Numbers come from the API.** Totals, prices, statuses and reasons shown to the user come from API data, never from agent text (PRD §12).
- **The agent can never pay or approve.** Do not add any UI path where an agent event triggers approve or pay. An agent event may only *open* the approval dialog.
- **Expression stays scarce.** The approved expressive moments are: hero Start demo, the payment total, offer Accept, Order settled, and (new, UX-05) the reassignment handoff. Keep everything else calm.
- **Every state is designed.** Each new surface needs loading, empty, error (with a recovery action) and success states, plus non-colour status (icon + text), 48 px targets and visible focus.
- **API contract changes.** Changes to `packages/shared/src/api.ts` follow [LANES.md](LANES.md): additive, optional fields only. Note the change in the task's PR/commit, and update `docs/ONDC_DEVIATIONS.md` if a Beckn payload or tag changes.
- **Definition of done (all tasks):**
  1. `pnpm typecheck` and `pnpm build`, then `pnpm test` pass. The Gemini live smoke test may 429; say so if it does.
  2. Run the walkthrough script (UX-00) at 412 px and 1440 px, light and dark. Look at the screenshots.
  3. One commit per task, then redeploy (`bash deploy/gcp-deploy.sh`) and smoke-test the hosted URL.
  4. Update the CLAUDE.md "Current status" line for the task.

---

## 3. Priorities and lanes

- **P0-demo:** do before judging / before recording the T18 video. Highest story value per hour.
- **P1:** strong polish, or PRD P1 items, if time remains.
- **P2:** after the hackathon.

| Lane | Scope | Tasks |
|---|---|---|
| **W (web only)** | No server changes. Safe to run in parallel. | UX-00, 01, 05, 06, 07, 08, 09, 10, 13, 15, 16 |
| **S (server + web)** | Touches `apps/server` and `packages/shared` | UX-02, 03, 04, 11, 12, 14 |

Suggested order for one agent: UX-00 → UX-01 → UX-05 → UX-06 → UX-02 → UX-03 → UX-08 → UX-07 → UX-09 → UX-10, then P1.

---

## 4. Tasks

Each task lists: **Why** (the gap), **What** (spec), **Where** (files), **API** (contract changes, if any), **Done when** (checkable), **Estimate**.

### UX-00 · Commit a UI walkthrough script — P0-demo, lane W, 1 h
- **Why:** UX work needs eyes on real pages at two widths and two themes. The script used for the redesign lived in a scratch folder.
- **What:**
  - Add `scripts/ui-walkthrough.ts` (tsx), using `playwright-core` with the local Chrome/Edge (`--browser=<path>`; default `C:/Program Files/Google/Chrome/Application/chrome.exe`). No browser download.
  - Flow:
    1. Landing.
    2. Sign in as `cust_priya` through `POST /auth/persona` + `sessionStorage["kiranaai.session"]`.
    3. Shop → Search tab → "atta" → add "Whole Wheat Atta from Sharma" → open basket (sheet below 840 px) → Get verified quote → screenshot the dialog → Approve → Pay → tracker.
    4. Merchant `store_sharma`: screenshot the offer → Reject… → Back → Accept → Start preparing.
    5. Wall.
    6. Admin (passcode flag) → Controls, Ledger, Audit.
  - Flags: `--url`, `--passcode`, `--widths 412,1440`, `--themes light,dark`, `--out <dir>` (default `.ui-shots/`, git-ignored). Print page errors and console errors; exit non-zero on any.
- **Where:** `scripts/`, root `package.json` (`"ui": "tsx scripts/ui-walkthrough.ts"`), `.gitignore`, RUNBOOK §1.
- **Gotcha:** the server indexes `web/dist` at boot. After `pnpm build`, restart the server or new assets are served as `index.html` (MIME error). For an isolated run, use port 8091 with `DATABASE_URL=…/kiranaai_c`, then `POST /admin/api/reset` once so registry URLs point at 8091.
- **Done when:** `pnpm ui --url http://127.0.0.1:8091 --passcode demo` writes 4 × ~16 screenshots and exits 0. RUNBOOK documents it.

### UX-01 · Live agent progress (stream the tool steps) — P0-demo, lane S, 3 h
- **Why:** G1. The demo's first impression is 5–10 s of "Checking stores…". PRD §12 already calls polled steps P1.
- **What:**
  - Server:
    - `POST /bap/agent/chat` accepts an optional `turnId` (client-generated ULID).
    - The agent loop appends `{tool, ok, startedAt, endedAt, summary}` to an in-memory map keyed by `customerId:turnId` as each tool finishes.
    - New `GET /bap/agent/turns/:turnId` returns `{ steps, done }`. Keep 5 min TTL; scope to the caller's customer.
    - `summary` is a short, data-derived string, e.g. `"5 stores · 14 offers"` for search, `"3 stores · est ₹1,380"` for plan_basket, `"₹1,400 verified"` for get_quote.
  - Web:
    - While `thinking`, poll every 1 s (PRD: 1 s polling, no SSE).
    - Render a vertical step list in the pending model bubble: icon per tool (`search`, `route`, `shopping_basket`, `verified`, `lock`), human label (reuse `TOOL_LABEL`), summary, and a spinner on the running step.
    - Steps collapse into the existing "n tool calls" disclosure when the reply arrives.
- **Where:** `apps/server/src/bap/agent/*` (find the loop that builds `AgentReply.steps`), `packages/shared/src/api.ts` (`AgentTurnProgress`), `apps/web/src/components/shop/ChatPanel.tsx`, `bap.ts`.
- **API:** additive `turnId` on the chat request; new GET route; new `AgentTurnProgress` type.
- **Done when:** during the demo prompt, at least 3 steps appear one by one before the reply (with a fake agent in tests). The poll stops after `done`. Another customer's turnId returns 404. Unit test for the progress store.

### UX-02 · Reasons on basket lines (and in the approval dialog) — P0-demo, lane S, 2.5 h
- **Why:** G2. MVP criterion 1 is "a reason for each choice". Today it exists only in agent prose and the manual "Plan a whole list" result.
- **What:**
  - Persist the optimiser's per-choice `reason` (and the basket-level `reasons`) on the basket when it is set from a plan. Add an optional `reason?: string | null` to `BasketItemView`, plus `planReasons?: string[]` on `BasketView`.
  - Manual adds clear the reason for that line.
  - Web:
    - `BasketPanel` shows the reason as a third line under the item (`type-body-small`, `lightbulb` icon, `text-on-surface-variant`).
    - Basket-level reasons show once under the store groups ("Adding Lakshmi saves ₹38 even after ₹30 delivery").
    - `ApprovalDialog` lists them collapsed under the breakdown ("Why these stores").
- **Where:** `apps/server/src/bap/basket*`, plan → `set_basket` path (agent tool and `/bap/basket` PUT), `packages/shared/src/api.ts`, `BasketPanel.tsx`, `ManualPanel.tsx` (pass reasons through `bap.replace`).
- **API:** `PUT /bap/basket` accepts optional `reasons` per item and `planReasons`. The agent's `set_basket` passes them from the last `plan_basket` result (server-side, not from LLM text, per AGT-03/06).
- **Done when:** after the demo prompt (or manual Optimise), every basket line shows a reason that matches `plan_basket` output. Editing a quantity keeps the reason; adding a different item manually shows none. Test covers the persistence.

### UX-03 · Proposed quantities the customer confirms — P0-demo (AGT-02), lane S, 2 h
- **Why:** G3. The PRD requires inferred quantities shown as **editable proposals**. The first agent run picked milk × 2 without saying so.
- **What:**
  - When the agent infers a quantity the user didn't state, the plan choice carries `qtyInferred: true`. The agent prompt must say which needs had no explicit quantity; the server marks them by comparing against the user message's numbers.
  - The basket line shows a tonal **"Suggested qty"** label.
  - Before quoting, if any line is still "suggested", `Get verified quote` opens an inline confirm row: "We guessed 3 quantities. Check them above." with buttons **Looks right** / **Edit**.
  - Changing the stepper clears the flag.
- **Where:** agent tool schema for `plan_basket`/`set_basket`, `BasketItemView.qtyInferred?`, `BasketPanel.tsx`.
- **Done when:** demo prompt → atta/dal/milk/tea lines show "Suggested qty". Confirming once proceeds to quote; editing one line clears only that line's label.

### UX-04 · Price-protection message on reassignment — P0-demo, lane W (data exists) + small S, 1.5 h
- **Why:** G4. DSP-05 is a headline promise ("you pay what you approved"), and it is invisible.
- **What:**
  - In `SubOrderCard`, when the accepted attempt's `quotedTotalPaise` > `approvedAmountPaise`, show an `InlineMessage` (tone `success`, icon `shield`): **"Balaji Mart charges ₹420. You still pay ₹380. KiranaAI covers the ₹40 difference."**
  - When lower, show neutral copy: "Balaji Mart is ₹10 cheaper; the difference is kept by the platform" (PRD §9: negative subsidy = platform gain). Copy needs a product decision; default to not showing the lower case.
  - Same message in the order-list row as a `StatusLabel` ("Price protected").
- **Where:** `apps/web/src/components/shop/OrderDetail.tsx`, `pages/Orders.tsx`. Server change only if `quotedTotalPaise` turns out to exclude delivery; check against PRD §9 worked example (Balaji ₹395 + ₹25 = ₹420 vs approved ₹380).
- **Done when:** in the e2e scenario (Gupta expires → Balaji) the tracker shows the ₹40 message, matching the admin ledger subsidy exactly.

### UX-05 · Make reassignment a moment (handoff strip + announcements) — P0-demo, lane W, 3 h
- **Why:** G5. Story moment 4 is the product's differentiator; today it reads like a log.
- **What:**
  - At the top of each `SubOrderCard`, add a horizontal **handoff strip**: one chip per attempt (store avatar + name), joined by arrows.
    - Rejected: error tone, `close` icon, reason as a tooltip/subtitle.
    - Expired: warning tone, `timer_off`.
    - Live offer: tertiary tone with a mini countdown ring (reuse `CountdownRing` from merchant, size 32).
    - Accepted: primary, `check`.
    - Empty slots up to `maxAttempts` as outlined placeholders ("attempt 2/3").
  - When a new attempt appears, the new chip uses `animate-scale-in` (reduced motion: no animation).
  - A polite live region announces transitions: "Lakshmi Stores declined (out of stock). Offered to Annapurna Provisions, attempt 2 of 3." Derive by diffing previous/next `attempts` in a hook (`useAttemptAnnouncements`).
  - Also fire a snackbar for each handoff while the tracker is open (one at a time; the latest wins).
  - Keep the vertical timeline below for detail, collapsed by default on compact widths ("Show all steps").
- **Where:** `OrderDetail.tsx`, new `components/shop/HandoffStrip.tsx`, move `CountdownRing` to `components/m3` or a shared file.
- **Done when:**
  - With fault injection (Lakshmi auto-reject, Gupta never-answer, 10 s window), the strip shows ✕ → live → ✓ in order.
  - VoiceOver/NVDA reads each handoff once.
  - Unit test for the diff → announcement function.

### UX-06 · Presenter mode: one-screen demo cockpit + guided script — P0-demo, lane W, 4 h
- **Why:** G6. The §14 demo needs two tabs, a pop-up and an invisible audio unlock. Judges opening the URL cold have no guide. The T18 video needs one recordable screen.
- **What:**
  - New route `/demo` (expanded and up; below 840 px redirect to `/`):
    - Left pane: the customer Shop/Orders experience (reuse components; customer session).
    - Right pane: the 5 wall tiles in a compact 2-column grid (each with its own merchant token, as `/wall` does).
    - A thin top **script rail** with the §14 steps as a stepper: Reset → Ask → Approve & pay → Stores answer → Delivered → Settled → Ledger.
  - Each step **auto-ticks from live state**: basket QUOTED, payment PAID, any attempt REJECTED/EXPIRED, all sub-orders DELIVERED, settled. Each step has a one-line hint ("Reject Lakshmi's offer with 'Out of stock'; leave Gupta to time out").
  - A visible **"Enable offer sounds"** chip when the `AudioContext` is not running (expose `isAudioUnlocked()` + subscribe from `alert.ts`). Clicking it unlocks; the chip turns into "Sounds on".
  - Landing: **Start demo** goes to `/demo` on expanded windows (no pop-up). On compact windows keep the current behaviour, but detect a blocked pop-up (`window.open` returned null) and show an `InlineMessage` with an "Open store wall" link.
  - Admin shortcut in the cockpit overflow menu: **"Arm demo faults"** (Lakshmi auto-reject off, Gupta never-answer on, window 45 s), behind a confirm dialog.
- **Where:** new `pages/Demo.tsx`, `components/demo/ScriptRail.tsx`, `components/merchant/alert.ts`, `pages/Picker.tsx`, `App.tsx`.
- **Done when:** the whole §14 script runs on one 1440 × 900 screen with no tab switches, every step ticks itself, and the sound chip reflects the real audio state.

### UX-07 · Cold-start and first-load experience — P0-demo, lane W (+1 line deploy), 2 h
- **Why:** G7. Scale-to-zero means the first judge request may wait several seconds; the success criterion says first load < 3 s.
- **What:**
  - Split routes with `React.lazy` (`/shop`, `/shop/orders`, `/merchant`, `/wall`, `/admin`, `/demo`) so the landing chunk stays small. Target landing JS < 150 kB gz.
  - Add an inline critical-path skeleton in `index.html` (app bar + hero block in surface colours, light/dark aware) so something meaningful paints before JS.
  - On landing, call `/health` with a 1.5 s timer. If slow, show a calm `InlineMessage` (info, `hourglass_top`): "Waking the demo server… this takes a few seconds the first time." It clears itself when `/health` answers.
  - Keep font links; confirm `display=swap` for Roboto Flex. Consider self-hosting the icon subset if Google Fonts is slow from judges' network (measure first).
- **Where:** `App.tsx`, `index.html`, `pages/Picker.tsx`, `vite.config.ts` (manualChunks if needed).
- **Done when:** a Lighthouse mobile run on the hosted URL shows FCP < 1.8 s with a warm instance. The cold-start message appears on a cold instance and clears.

### UX-08 · Admin guardrails: demo-readiness check — P0-demo, lane W, 1.5 h
- **Why:** G8. A 5 s offer window left by `pnpm e2e`, an armed fail-next-payment, or a stray fault silently ruins the live demo.
- **What:**
  - At the top of Admin → Controls, add a **"Demo readiness"** card with checklist rows, each with a one-click fix:
    - Offer window = 45 s (warn below 15 s; **Set to 45 s**).
    - Fail next payment off.
    - No unintended faults.
    - All stores online.
    - No open baskets/orders from earlier runs (suggest Reset).
  - Show a warning `StatusLabel` in the admin top bar while anything is off.
  - Offer-window field: add filter chips **5 s · 45 s · 120 s** for one-tap presets.
- **Where:** `components/admin/ControlPanels.tsx`, `pages/Admin.tsx`. Uses existing `/admin/api/config`, `/admin/api/faults` and the merchant dashboards' online state (or add `isOnline` to the faults response; small S change).
- **Done when:** after `pnpm e2e` the card shows "Offer window is 5 s" with a fix button that sets 45 s and turns the row green.

### UX-09 · Unmissable offers for merchants — P0-demo, lane W, 2.5 h
- **Why:** G9 / MER-07: "loud timely offers".
- **What:**
  - **Compact (< 600 px) full-screen takeover:** when an offer arrives and the merchant is on any destination, show a modal bottom sheet (or full-screen dialog). Contents: the countdown ring at 120 px, total in `type-display-small`, items, distance, and **Accept** (filled, large, expressive) / **Reject…**. Like a ride-hailing request.
  - **Background tab:** flash the document title (`(1) New offer ₹470 — KiranaAI`) and set a badge favicon. Call `navigator.vibrate([200,100,200])` where supported.
  - **Audio locked:** a persistent banner in the merchant top area, "Tap to turn on offer sounds", until unlocked.
  - **Wall/cockpit only:** keyboard shortcuts when a tile has focus (`A` accept, `R` reject menu); show a hint in the tile footer.
  - **Too-late feedback:** a snackbar "Too late — offer moved to another store" in addition to the card state.
- **Where:** `components/merchant/OfferCard.tsx`, `StoreDashboard.tsx`, `pages/Merchant.tsx`, `alert.ts`.
- **Done when:** on a 412 px merchant page, a new offer opens the takeover within 1 s of `confirm`. Title flashing stops when no offers are pending. Shortcuts work on the wall.

### UX-10 · Order receipt and settlement summary — P1, lane W, 2 h
- **Why:** G10. Story moment 5 ends on a banner; the money story is only in admin.
- **What:**
  - When `settled`, the order detail shows a **Receipt** card under the settled banner:
    - Per store: approved amount, final store (if reassigned), status (delivered / refunded).
    - Refunds total and platform-covered difference (from UX-04 data).
    - Grand total paid.
  - Actions: **Share** (Web Share API, fallback copy-to-clipboard of a text receipt) and **Print** (print stylesheet that hides nav).
- **Where:** `OrderDetail.tsx`, `index.css` (`@media print`).
- **Done when:** the e2e scenario's receipt reads ₹1,400 paid, three stores delivered, ₹40 covered by KiranaAI, matching the ledger.

### UX-11 · Merchant earnings view (MER-12) — P1, lane S, 2.5 h
- **Why:** merchant value ("payouts" in PRD §2) is only visible to the admin.
- **What:**
  - New merchant destination **Earnings**: today's delivered orders, gross, commission and net payable.
  - Per-order rows include the subsidy credit when the store was a reassignment pick.
  - Stat tiles reuse the admin `LedgerPanel` style.
- **API:** `GET /bpp/merchant/:storeId/ledger` (merchant-token scoped) returning that store's ledger rows. Check LANES.md for where the ledger lives (BAP) and whether the BPP must proxy it. If crossing BAP→BPP is awkward, expose it as `/bap/merchant-ledger/:storeId` with merchant-token auth and note the deviation.
- **Done when:** after the e2e scenario Balaji's Earnings shows ₹420 net, matching admin.

### UX-12 · Voice input for the assistant (AGT-13) — P1, lane S, 3 h — **done 18 Oct** (Gemini Live `gemini-3.8-live`, browser records 16 kHz PCM; see CLAUDE.md)
- **Why:** kirana customers speak Hinglish; voice is the most natural input and a strong demo beat.
- **What:**
  - Mic icon button in the composer: hold-to-record or tap-to-toggle, recording via `MediaRecorder` (webm/opus).
  - While recording, show an expressive level meter and a timer.
  - Send to `POST /bap/agent/chat` as `audio` (base64, ≤ 30 s). The server passes it to Gemini as inline audio, and the transcript returns in the reply so the user bubble shows what was understood.
  - Errors: mic permission denied shows an `InlineMessage` with how to allow it; on unsupported browsers the button is hidden.
- **API:** additive `audio?: { mimeType, data }` on the chat request; `transcript?: string` on `AgentReply`.
- **Done when:** saying "chaar logon ke liye hafte ka saaman, 1500 ke andar: atta, toor dal, doodh, chai" produces the same basket as the typed prompt.

### UX-13 · Smarter manual search and basket nudges — P1, lane W (+ optional S), 3 h
- **Why:** manual mode is the fallback when Gemini is out of quota (it is right now on the free tier), so it must feel first-class.
- **What:**
  - **Search suggestions:** typing shows a suggestion list from canonical product names and synonyms (cache `/bap/search` results per query; or add `GET /bap/suggest?q=` in S). Include recent searches.
  - **Effective price:** each offer row shows "₹450 + ₹20 delivery = ₹470 if bought alone". The **Cheapest** label uses the effective price, with a footnote that delivery is per store, not per item.
  - **Add to list:** a secondary action on each product group ("Add to list") puts it in the planner with qty 1, so search and plan connect.
  - **Basket nudge:** when the basket spans more than one store, show an assist chip **"Optimise this basket"**. It runs `plan` on current items and shows the delta ("Save ₹30 by moving tea to Sharma") with Apply / Dismiss.
- **Where:** `ManualPanel.tsx`, `BasketPanel.tsx`.
- **Done when:** with the agent disabled (`GEMINI_API_KEY` unset), a user reaches the same 3-store ₹1,400 basket through search + plan in ≤ 6 interactions.

### UX-14 · Delivery address and serviceability context — P1 (DIS-09), lane S, 3 h
- **Why:** the customer never sees *where* things are delivered, yet distance and serviceability drive store choice.
- **What:**
  - Top app bar subtitle becomes "Delivering to Indiranagar, Bengaluru", opening an address sheet.
  - The sheet shows the saved address. Optionally add Google Places Autocomplete (browser key restricted to the Cloud Run domain, per PRD §13.1) to change it. Show a small static map with the 5 stores and their radii (Maps Static API or an SVG approximation).
  - Search rows that are out of radius show "Doesn't deliver to you".
- **API:** `GET/PATCH /bap/profile/address`; serviceability already uses lat/lng.
- **Done when:** changing the address to one outside two stores' radius removes them from search and the planner, and the UI explains why.

### UX-15 · Accessibility pass (close the M3 audit) — P1, lane W, 3 h
- **Why:** G11. Accessibility is a release requirement in the M3 rules; the redesign scored 1/2 on it.
- **What:**
  - **Screen readers:** NVDA + Chrome on Windows over the walkthrough. Check names/roles for Switch, the tabs' roving focus, Dialog focus return to the trigger on close (store `document.activeElement` on open), Menu, BottomSheet.
  - **Large text:** browser zoom 200 % and OS text scale at 412 px. Nothing clips; fix fixed heights (`h-7` StatusLabel → `min-h-7`, chat composer).
  - **Catalogue on phones:** below 600 px render a list (one row per product with price/stock fields stacked) instead of the horizontal-scroll table.
  - **Live announcements:** tracker payment and status changes (see UX-05); basket total changes after quote.
  - **Contrast:** run axe (`@axe-core/playwright` in the UX-00 script) and fix all serious/critical findings.
- **Done when:** axe reports 0 serious/critical issues on all walkthrough pages in both themes, and a short NVDA checklist is recorded in `docs/A11Y.md`.

### UX-16 · Catalogue productivity — P2 (MER-09/10 is P1), lane W + S, 4 h
- **What:**
  - Filter chips (Low stock < 5, Inactive, by category).
  - Undo snackbar for deactivate.
  - Bulk select → set active / adjust price by %.
  - **Photo-to-catalogue (MER-09/10):** upload an invoice/shelf photo → Gemini vision → review grid (editable rows, per-row confidence, reject) → publish. Needs the S lane for the vision call and quota.
- **Done when:** a photo of a printed invoice with 5 lines yields 5 editable rows; publishing makes them searchable.

---

## 5. Out of scope here
Hindi/regional-language UI (PRD §15), real auth, real payments, maps navigation for delivery, push notifications (needs a service worker plus a backend push channel; MER-11 is P2).

## 6. Tracking
When a task is done, add a line under "Current status" in `CLAUDE.md`: task ID, one-line result, and whether it is deployed. If a task changes a decision in the PRD, raise it rather than silently diverging (CLAUDE.md rule).
