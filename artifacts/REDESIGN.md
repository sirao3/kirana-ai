# Redesign — "Neighbourhood" demo cockpit (18 Oct 2026)

Picked from two flow mockups (A "Focus", B "Neighbourhood"; recordings `focus-demo.mp4`, `neighbourhood-demo.mp4` in the repo root, not committed). **B is now the real `/demo` cockpit**, wired to the live APIs. Approach: `ios-design-agent` skill — structure, continuity and motion, not a restyle.

## What the cockpit is now

- **Map as the stage** (`components/demo/hood/HoodMap.tsx`). Home in the middle; the five stores placed by their real coordinates from `GET /bap/profile/address` (equirectangular around home, 133 px/km); 3 km radius ring; schematic Apple-Maps-style streets.
  - Pins follow each store's live dashboard (`useStore(storeId, token)`, one merchant token per store): idle, new offer (orange + one ripple), busy (green + stage text), delivered (drawn check), declined/missed (grey ×, from the order's attempts), offline.
  - **Offer callouts** on the pins: items, payout, distance, countdown ring from `offeredAt → expiresAt`, Accept, Decline → reason chips (`REJECT_REASONS`) → Decline. "Never answer" fault shows a note instead of buttons. Callouts are placed by a small cost search (12 positions) so they never cover each other, the cards or the pill.
  - **Next-step pill** under a busy pin (Start packing → Mark ready → Out for delivery → Mark delivered) calls `/orders/:id/advance`.
  - **Routes** from the live order: dashed grey before payment (basket stores), blue per attempt after payment, a declined/expired route retracts in red, accepted is solid, delivered fades green. A courier dot travels home on `OUT_FOR_DELIVERY`.
- **Customer card** (`CustomerCard.tsx`), one continuous flow: hero → message → live agent tool steps (`GET /bap/agent/turns/:id`) → basket card with reasons and "suggested" quantities → one CTA ("Quantities look right" → "Get verified total") → **pay sheet** (approve + pay in one button that contracts into a spinner, then a check; simulated-failure toggle; expired quote → fresh total) → the order tracker (5-segment progress per store; reassignment slides the store name and explains "Lakshmi declined (out of stock) · moved to Annapurna · your price stays ₹550 · KiranaAI covers ₹40"; refunds; settled). Voice input via the existing recorder. If the assistant is down (429/503) a one-click fallback plans the §14 basket with `POST /bap/plan`.
- **Script pill** (`Island.tsx`): `deriveSteps` as a progress ring + current step + hint, offer-sound toggle, and a menu (All stores online, Arm demo faults…, Open admin ledger, Reset demo data…). Reset also clears the chat and remounts the card.
- **Activity** feed: each new fact from the order (offer, accept, decline, timeout, out for delivery, delivered, settled) logged once with a relative time, plus customer actions.

Motion: `motion` library; springs for layout and sheets, 180–300 ms fades for content swaps, transform/opacity only, `MotionConfig reducedMotion="user"`.

Unchanged rules: the total is always the API quote; only the Pay button approves and pays; suggested quantities are confirmed before quoting; each role keeps its own token.

## Verified (18 Oct, local, fake agent)

`node scripts/cockpit-walk.mjs` (resets data): ask → basket → pay ₹1,400 → Sharma accepts, Lakshmi declined → Annapurna accepts, Gupta times out → Balaji accepts (₹40 covered) → all delivered → settled; no page errors. Screens in `.ui-shots/hood/`. Typecheck, shared 10, web 45, server 152 (+2 skipped live-Gemini) pass; `pnpm build` OK.

## Landing page (same language)

`pages/Picker.tsx`: the neighbourhood map is the stage (pinned to the viewport), introduced once — the map settles, the 3 km ring grows, the five pins drop in (real coordinates from the public `GET /bpp/serviceability`), and the §14 plan draws its routes with a "₹1,400 · 3 stores · ₹100 under budget" caption. A glass card carries the headline, one black **Start the live demo** button, three plain how-it-works rows and the roles as grouped rows; hovering a store row lights its pin. Phones: map above, the card scrolls over it. The boot skeleton in `index.html` and the route fallback match it, and the landing page is now a lazy chunk (entry 301 kB). Checked headless at 412, 1440 and 1920 px; Start the live demo → `/demo`.

## Not done

- Not yet seen in a real (non-headless) browser or with real Gemini; not deployed.
- Desktop only (the cockpit redirects below 840 px, as before); light only; no axe/NVDA pass on the new cockpit.
- The rest of the app (`/shop`, merchant, wall, admin) still uses the Material 3 kit; the landing page is light-only.
