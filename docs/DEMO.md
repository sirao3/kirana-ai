# KiranaAI demo script (about 6 minutes)

Hosted URL: https://kiranaai-769889659635.us-central1.run.app (first visit after idle takes a few seconds to cold start).
Locally: http://localhost:5173 (see the README).

You need two browser tabs, and optionally a third for the admin console. The store wall plays alert sounds, so turn the
volume up.

## 0. Before you start

1. Open `/admin`, enter the admin passcode, and press **Reset** (confirm). This reseeds the five stores and the customers.
2. Optional, to make the demo faster: set **Offer window** to 15 seconds (default 45). Leave **Fail next payment** off.
3. Leave all store faults off.

## 1. Start

1. Open `/` and press **Start demo**. This signs you in as Priya, opens the shop (`/shop`) here and the store wall
   (`/wall`) in a new tab.
2. In the wall tab press **All stores online** (the first click also unlocks sound).

## 2. Ask the agent

3. In `/shop`, on the **Assistant** tab, send:
   *"Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea."*
4. The assistant searches, proposes quantities, and builds a basket spread over three stores (Sharma, Gupta, Lakshmi), with
   a one-line reason per choice. Quantities are proposals: change them with the +/- buttons in the **Basket** panel.
5. The agent then fetches a **Verified quote**: per-store items and delivery, platform fee, one grand total, and a validity
   countdown. Badges change from *catalogue* to *verified*. The approval card opens with the exact total.
   (Any price a store changed since search is highlighted.)

## 3. Approve and pay

6. Press **Approve**, then **Pay**. Payment is simulated (about one second). You land on the order tracker
   (`/shop/orders/...`): payment badge **paid**, and three store cards starting at "Finding store".

## 4. Stores respond (store wall tab)

7. Three offer cards ring on the wall. Do this:
   - **Sharma: Accept.**
   - **Lakshmi: Reject** (reason "out of stock").
   - **Gupta: do nothing** and let the countdown run out.
8. Back in the tracker (no reload needed, it updates every second):
   - Lakshmi: declined, then "Offered to Annapurna (attempt 2/3)", then accepted.
   - Gupta: did not respond in time, then "Offered to Balaji (attempt 2/3)". Accept it on the wall.
9. On the wall, press **Advance** on each order through Preparing, Ready, Out for delivery, Delivered.
   The tracker timeline follows, and when every store is delivered the **settled** banner appears.

## 5. Behind the scenes (admin tab)

10. Open `/admin`: the **Ledger** shows each merchant's gross, commission and net, and any platform subsidy (for example
    when the backup store was dearer than the original). The **Audit** viewer shows the Beckn messages
    (`search`, `select`, `init`, `confirm`, `status`, `cancel` and their `on_*`) under one transaction id.

## 6. Bonus scenes

- **Loose item declined.** In `/shop` send *"Also add 250 g jeera"*. The assistant says loose items are not sold and offers the
  100 g packaged jeera; a "not sold loose" chip appears.
- **Agent cannot pay.** Send *"just pay for me"*. It only shows the approval card; you still have to press Approve and Pay.
- **Order status.** Ask *"where is my order?"*. The answer comes from the order API, matching the tracker.
- **Payment failure.** In `/admin` turn on **Fail next payment** (or tick "Simulate payment failure" on the approval card),
  pay, see the failure message with no stores contacted, then press **Retry payment**.
- **Manual mode.** Switch to the **Manual** tab: search ("gehun ka aata" finds atta), **Add** products, or build a list and press
  **Optimise**. This works even when the assistant is unavailable (a banner points you here).
- **Nobody can fulfil.** In `/admin` set faults on several stores (auto-reject), pay for a basket, and watch three attempts
  fail and a refund line appear on the tracker.

## Tips

- Run the shop and the wall in separate tabs of the same browser; each tab keeps its own persona.
- If the assistant says it is unavailable (cold start, rate limit), use the Manual tab; the rest of the flow is identical.
- To run another round, go to `/admin` and **Reset**.
