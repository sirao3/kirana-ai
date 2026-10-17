/**
 * End-to-end demo script (T16): the PRD §14 scenario against any base URL, over HTTP only.
 *
 *   pnpm e2e --url https://kiranaai-….run.app --passcode <admin passcode> [--agent] [--window 5]
 *
 * reset → offer window 5 s → plan_basket + basket API (or the agent with --agent) → quote → approve → pay →
 * store 1 (Sharma) accepts, store 3 (Lakshmi) rejects, store 2 (Gupta) is left to expire → assert reassignment to
 * the backups (Balaji, Annapurna) → backups accept → advance everything to DELIVERED → assert ledger numbers and
 * SETTLED → assert repeat pay and repeat accept are no-ops.
 *
 * Only uses the contracts in artifacts/LANES.md (merchant + admin APIs) and packages/shared/src/api.ts (BAP API).
 * Exits 0 on success, 1 on the first failed assertion. It resets the deployment's data: do not run it against a
 * demo that is in use.
 */
import { randomUUID } from "node:crypto";
import type {
  AgentReply, ApproveResponse, BasketView, OrderView, PayResponse, PlanResult, QuoteResponse, SubOrderView,
} from "../packages/shared/src/api.js";

// ---------- args ----------

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0) {
    const v = process.argv[i + 1];
    return v && !v.startsWith("--") ? v : "true";
  }
  return fallback;
}

const BASE = (arg("url", process.env.E2E_URL) ?? "").replace(/\/$/, "");
const PASSCODE = arg("passcode", process.env.ADMIN_PASSCODE);
const USE_AGENT = arg("agent") === "true";
const WINDOW_S = Number(arg("window", "5"));
const CUSTOMER = arg("customer", "cust_priya")!;

if (!BASE || !PASSCODE) {
  console.error("usage: pnpm e2e --url <base url> --passcode <admin passcode> [--agent] [--window <offer window seconds, default 5>]");
  process.exit(2);
}

// ---------- tiny harness ----------

const t0 = Date.now();
const stamp = () => `${((Date.now() - t0) / 1000).toFixed(1).padStart(5)}s`;
let stepNo = 0;
const step = (title: string) => console.log(`\n[${stamp()}] ${++stepNo}. ${title}`);
const info = (msg: string) => console.log(`        ${msg}`);

class AssertionFailed extends Error {}
function check(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new AssertionFailed(msg);
  info(`ok  ${msg}`);
}
/** JSON with object keys sorted, so key order never matters. */
const canon = (v: unknown): string =>
  JSON.stringify(v, (_k, x) => (x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a.localeCompare(b))) : x));
function equal<T>(actual: T, expected: T, msg: string): void {
  if (canon(actual) !== canon(expected)) {
    throw new AssertionFailed(`${msg}: expected ${canon(expected)}, got ${canon(actual)}`);
  }
  info(`ok  ${msg} = ${canon(actual)}`);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

async function http<T = unknown>(method: string, path: string, o: { token?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<{ status: number; body: T }> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(o.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
      ...o.headers,
    },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined,
    signal: AbortSignal.timeout(60_000),
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep text
  }
  return { status: res.status, body: body as T };
}

async function ok<T>(p: Promise<{ status: number; body: T }>, what: string): Promise<T> {
  const r = await p;
  if (r.status < 200 || r.status >= 300) throw new AssertionFailed(`${what} → HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 300)}`);
  return r.body;
}

async function waitFor<T>(what: string, fn: () => Promise<T | null | false>, timeoutMs: number, everyMs = 500): Promise<T> {
  const started = Date.now();
  let last: unknown;
  for (;;) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    if (Date.now() - started > timeoutMs) throw new AssertionFailed(`timed out after ${timeoutMs / 1000}s waiting for ${what}${last ? ` (${String(last)})` : ""}`);
    await sleep(everyMs);
  }
}

// ---------- scenario data (seed: PRD §14) ----------

const STORES = {
  sharma: "store_sharma", gupta: "store_gupta", lakshmi: "store_lakshmi", balaji: "store_balaji", annapurna: "store_annapurna",
} as const;
const NEEDS = [
  { query: "atta", qty: 1 },
  { query: "toor dal", qty: 2 },
  { query: "tea", qty: 1 },
  { query: "milk", qty: 8 },
];
const PROMPT = "Weekly groceries for 4, under 1500 rupees: atta, toor dal, milk, tea.";

interface Dashboard {
  store: { id: string; isOnline: boolean };
  offers: { id: string; status: string }[];
  orders: { id: string; fulfilmentStatus?: string }[];
}

async function main() {
  console.log(`KiranaAI end-to-end demo against ${BASE}`);

  // ---- 1. reset + config
  step("Reset and configure");
  const admin = (await ok(http<{ token: string }>("POST", "/auth/persona", { body: { role: "admin", passcode: PASSCODE } }), "admin login")).token;
  await ok(http("POST", "/admin/api/reset", { token: admin }), "reset");
  await ok(http("PATCH", "/admin/api/config", { token: admin, body: { offerWindowSeconds: WINDOW_S, failNextPayment: false } }), "set offer window");
  const cfg = await ok(http<{ offerWindowSeconds: number }>("GET", "/admin/api/config", { token: admin }), "read config");
  equal(cfg.offerWindowSeconds, WINDOW_S, `offer window is ${WINDOW_S} s`);

  const merchant: Record<string, string> = {};
  for (const id of Object.values(STORES)) {
    merchant[id] = (await ok(http<{ token: string }>("POST", "/auth/persona", { body: { role: "merchant", id } }), `merchant login ${id}`)).token;
    await ok(http("PATCH", `/bpp/merchant/${id}/store`, { token: merchant[id], body: { isOnline: true } }), `${id} online`);
  }
  const customer = (await ok(http<{ token: string }>("POST", "/auth/persona", { body: { role: "customer", id: CUSTOMER } }), "customer login")).token;
  const api = <T>(method: string, path: string, body?: unknown, headers?: Record<string, string>) => http<T>(method, path, { token: customer, body, headers });

  // ---- 2. basket
  step(USE_AGENT ? "Ask the agent for the weekly groceries" : "plan_basket + basket API");
  let basket: BasketView;
  if (USE_AGENT) {
    const r = await api<AgentReply | { error: string }>("POST", "/bap/agent/chat", { message: PROMPT });
    check(r.status === 200, `agent replied (HTTP ${r.status})`);
    info(`agent: ${(r.body as AgentReply).text?.slice(0, 160)}`);
    basket = await ok(api<BasketView>("GET", "/bap/basket"), "basket");
  } else {
    const plan = await ok(api<PlanResult>("POST", "/bap/plan", { needs: NEEDS, budgetPaise: 150000 }), "plan_basket");
    equal([...plan.stores.map((s) => s.storeId)].sort(), [STORES.gupta, STORES.lakshmi, STORES.sharma], "plan uses exactly Sharma, Gupta, Lakshmi");
    check(plan.estimatedTotalPaise < 150000 && plan.withinBudget === true, `plan estimate ${rupees(plan.estimatedTotalPaise)} is within budget`);
    check(plan.choices.every((c) => c.reason), "every choice has a reason");
    basket = await ok(api<BasketView>("PUT", "/bap/basket", { items: plan.choices.map((c) => ({ listingId: c.offer.listingId, qty: c.qty })) }), "set basket");
  }
  equal(basket.stores.map((s) => s.storeId).sort(), [STORES.gupta, STORES.lakshmi, STORES.sharma], "basket spans the 3 demo stores");
  const basketId = basket.id;

  // ---- 3. quote, approve, pay
  step("Quote");
  const q = await ok(api<QuoteResponse>("POST", "/bap/basket/quote"), "quote");
  equal(q.errors, [], "no store errors");
  check(q.quote, "quote returned");
  equal(q.quote.grandTotalPaise, 140000, "grand total is ₹1,400");
  equal(Object.fromEntries(q.quote.stores.map((s) => [s.storeId, s.totalPaise])), { [STORES.sharma]: 47000, [STORES.gupta]: 38000, [STORES.lakshmi]: 55000 }, "per-store totals ₹470 / ₹380 / ₹550");

  step("Approve and pay");
  const apv = await ok(api<ApproveResponse>("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: q.quote.quoteHash }), "approve");
  const idemKey = randomUUID();
  const pay = await ok(api<PayResponse>("POST", `/bap/baskets/${basketId}/pay`, { approvalToken: apv.approvalToken }, { "idempotency-key": idemKey }), "pay");
  equal(pay.status, "PAID", "payment PAID");

  // ---- 4. offers reach the stores
  step("Three offers go out");
  const offered = await waitFor("3 sub-orders with an OFFERED attempt", async () => {
    const v = await ok(api<OrderView>("GET", `/bap/baskets/${basketId}`), "order");
    return v.subOrders.length === 3 && v.subOrders.every((s) => s.attempts.some((a) => a.status === "OFFERED")) ? v : null;
  }, 20_000);
  equal(offered.paymentStatus, "PAID", "payment status is its own field (PAID) while stores are being offered");
  const att1 = (storeId: string) => offered.subOrders.find((s) => s.approvedStoreId === storeId)!.attempts[0]!.id;
  for (const storeId of [STORES.sharma, STORES.gupta, STORES.lakshmi]) {
    const dash = await ok(http<Dashboard>("GET", `/bpp/merchant/${storeId}/dashboard`, { token: merchant[storeId] }), `${storeId} dashboard`);
    check(dash.offers.some((o) => o.id === att1(storeId)), `${storeId} dashboard shows the offer`);
  }

  // ---- 5. merchants act
  step("Sharma accepts, Lakshmi rejects, Gupta is left to expire");
  const offerStart = Date.now();
  await ok(http("POST", `/bpp/merchant/${STORES.sharma}/offers/${att1(STORES.sharma)}/accept`, { token: merchant[STORES.sharma] }), "Sharma accepts");
  await ok(http("POST", `/bpp/merchant/${STORES.lakshmi}/offers/${att1(STORES.lakshmi)}/reject`, { token: merchant[STORES.lakshmi], body: { reason: "out of stock" } }), "Lakshmi rejects");
  const sub = async (storeId: string): Promise<SubOrderView> =>
    (await ok(api<OrderView>("GET", `/bap/baskets/${basketId}`), "order")).subOrders.find((s) => s.approvedStoreId === storeId)!;

  step("Lakshmi's order is re-offered to Annapurna");
  const lakshmi = await waitFor("attempt 2 OFFERED for the milk sub-order", async () => {
    const s = await sub(STORES.lakshmi);
    return s.attempts.some((a) => a.attemptNo === 2 && a.status === "OFFERED") ? s : null;
  }, 10_000, 250);
  const reassignMs = Date.now() - offerStart;
  equal(lakshmi.attempts.map((a) => [a.attemptNo, a.storeId, a.status]), [[1, STORES.lakshmi, "REJECTED"], [2, STORES.annapurna, "OFFERED"]], "milk: Lakshmi rejected → Annapurna offered (attempt 2/3)");
  equal(lakshmi.attempts[1]!.quotedTotalPaise, 55000, "Annapurna's quote is ₹540 + ₹10");
  info(`reject → next offer visible after ~${(reassignMs / 1000).toFixed(1)} s (target < 2 s plus polling)`);

  // Accept the backup straight away: with a short demo window it would otherwise lapse while we wait for Gupta.
  step("Annapurna accepts the re-offered milk order");
  const annapurnaAtt = lakshmi.attempts[1]!.id;
  await ok(http("POST", `/bpp/merchant/${STORES.annapurna}/offers/${annapurnaAtt}/accept`, { token: merchant[STORES.annapurna] }), "Annapurna accepts");

  step(`Gupta's offer expires (${WINDOW_S} s window) and moves to Balaji`);
  const gupta = await waitFor("attempt 2 OFFERED for the dal + tea sub-order", async () => {
    const s = await sub(STORES.gupta);
    return s.attempts.some((a) => a.attemptNo === 2 && a.status === "OFFERED") ? s : null;
  }, (WINDOW_S + 25) * 1000);
  equal(gupta.attempts.map((a) => [a.attemptNo, a.storeId, a.status]), [[1, STORES.gupta, "EXPIRED"], [2, STORES.balaji, "OFFERED"]], "dal + tea: Gupta timed out → Balaji offered (attempt 2/3)");
  equal(gupta.attempts[1]!.quotedTotalPaise, 42000, "Balaji's quote is ₹395 + ₹25");

  // ---- 6. backups accept, everything is delivered
  step("Balaji accepts");
  const balajiAtt = gupta.attempts[1]!.id;
  await ok(http("POST", `/bpp/merchant/${STORES.balaji}/offers/${balajiAtt}/accept`, { token: merchant[STORES.balaji] }), "Balaji accepts");
  await waitFor("all sub-orders ACCEPTED", async () => (await ok(api<OrderView>("GET", `/bap/baskets/${basketId}`), "order")).subOrders.every((s) => s.status === "ACCEPTED"), 10_000);
  info("all three sub-orders ACCEPTED");

  step("Advance every order to DELIVERED");
  const deliveries: [string, string][] = [[STORES.sharma, att1(STORES.sharma)], [STORES.balaji, balajiAtt], [STORES.annapurna, annapurnaAtt]];
  for (const [storeId, attId] of deliveries) {
    const seen: string[] = [];
    for (let i = 0; i < 6 && seen.at(-1) !== "DELIVERED"; i++) {
      const r = await ok(http<{ fulfilmentStatus: string }>("POST", `/bpp/merchant/${storeId}/orders/${attId}/advance`, { token: merchant[storeId] }), `${storeId} advance`);
      seen.push(r.fulfilmentStatus);
    }
    equal(seen.at(-1), "DELIVERED", `${storeId} delivered (${seen.join(" → ")})`);
  }

  // ---- 7. settlement
  step("Settled, ledger correct");
  const final = await waitFor("basket SETTLED", async () => {
    const v = await ok(api<OrderView>("GET", `/bap/baskets/${basketId}`), "order");
    return v.basketStatus === "SETTLED" ? v : null;
  }, 15_000);
  check(final.settled && final.subOrders.every((s) => s.status === "DELIVERED"), "SETTLED, all sub-orders DELIVERED");
  equal([final.paymentStatus, final.grandTotalPaise, final.refundedPaise], ["PAID", 140000, 0], "payment PAID ₹1,400, nothing refunded");

  const ledger = await ok(
    http<{ byStore: { storeId: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number }[] }>("GET", "/admin/api/ledger", { token: admin }),
    "ledger",
  );
  const by = Object.fromEntries(ledger.byStore.map((s) => [s.storeId, s]));
  equal(by[STORES.sharma]?.netPayablePaise, 47000, "Sharma net ₹470");
  equal(by[STORES.balaji]?.netPayablePaise, 42000, "Balaji net ₹420");
  equal(by[STORES.annapurna]?.netPayablePaise, 55000, "Annapurna net ₹550");
  equal(by[STORES.balaji]?.platformSubsidyPaise, 4000, "Balaji subsidy ₹40");
  equal([by[STORES.sharma]?.platformSubsidyPaise, by[STORES.annapurna]?.platformSubsidyPaise], [0, 0], "no other subsidy");
  equal(ledger.byStore.reduce((a, s) => a + s.netPayablePaise, 0), 144000, "total net payable ₹1,440");
  equal(ledger.byStore.reduce((a, s) => a + s.platformSubsidyPaise, 0), 4000, "total subsidy ₹40");

  // ---- 8. idempotency
  step("Repeat pay and repeat accept are no-ops");
  const again = await api<PayResponse>("POST", `/bap/baskets/${basketId}/pay`, { approvalToken: apv.approvalToken }, { "idempotency-key": idemKey });
  check(again.status === 200 && again.body.paymentId === pay.paymentId && again.body.status === "PAID", "same Idempotency-Key returns the same payment");
  const other = await api("POST", `/bap/baskets/${basketId}/pay`, { approvalToken: apv.approvalToken }, { "idempotency-key": randomUUID() });
  check(other.status === 403 || other.status === 409, `pay again with a new key and the spent token is refused (HTTP ${other.status})`);
  const dup = await http<{ error?: string }>("POST", `/bpp/merchant/${STORES.sharma}/offers/${att1(STORES.sharma)}/accept`, { token: merchant[STORES.sharma] });
  check(dup.status === 409, `accepting again is refused (HTTP ${dup.status} ${dup.body?.error ?? ""})`);
  const after = await ok(api<OrderView>("GET", `/bap/baskets/${basketId}`), "order");
  equal([after.subOrders.length, after.basketStatus, after.grandTotalPaise, after.refundedPaise], [3, "SETTLED", 140000, 0], "order unchanged");
  const ledger2 = await ok(http<{ byStore: { netPayablePaise: number }[] }>("GET", "/admin/api/ledger", { token: admin }), "ledger");
  equal(ledger2.byStore.reduce((a, s) => a + s.netPayablePaise, 0), 144000, "ledger unchanged");

  console.log(`\n[${stamp()}] PASS: PRD §14 scenario reproduced (${rupees(140000)} paid, ${rupees(144000)} net to merchants, ${rupees(4000)} subsidy).`);
}

main().catch((err) => {
  if (err instanceof AssertionFailed) console.error(`\n[${stamp()}] FAIL: ${err.message}`);
  else console.error(`\n[${stamp()}] ERROR:`, err);
  process.exit(1);
});
