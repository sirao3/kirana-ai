import { listingId, resetAndSeed } from "../../src/db/seed/seed.js";
import { startTestApp, tokenFor } from "../helpers.js";
import { startFakeBpp, type FakeBpp } from "./fake-bpp.js";

export type TestApp = Awaited<ReturnType<typeof startTestApp>>;

export interface BapHarness {
  t: TestApp;
  fake: FakeBpp;
  /** Customer token (Priya by default). */
  token: string;
  call<T = any>(method: string, path: string, body?: unknown, opts?: { token?: string; headers?: Record<string, string> }): Promise<{ status: number; body: T }>;
  /** Reset DB + fake BPP to the seed and point the registry at the fake. */
  reset(opts?: { offerWindowSeconds?: number }): Promise<void>;
  close(): Promise<void>;
}

/** App on a random port + fake BPP registered as `kiranaai-bpp` + customer API client. */
export async function startHarness(env: Record<string, string> = {}): Promise<BapHarness> {
  process.env.BAP_SEARCH_WINDOW_MS ??= "250"; // production default is 1500 (PRD §11)
  const t = await startTestApp(env);
  const fake = await startFakeBpp(t.app.ctx);
  const h: BapHarness = {
    t,
    fake,
    token: "",
    async call(method, path, body, opts) {
      const res = await fetch(`${t.url}${path}`, {
        method,
        headers: {
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
          authorization: `Bearer ${opts?.token ?? h.token}`,
          ...opts?.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await res.text();
      return { status: res.status, body: text ? JSON.parse(text) : null };
    },
    async reset(opts) {
      await resetAndSeed(t.pool, { selfBaseUrl: t.url, offerWindowSeconds: opts?.offerWindowSeconds });
      fake.reset();
      await fake.register();
      h.token = await tokenFor(t.url, { role: "customer", id: "cust_priya" });
    },
    async close() {
      await fake.close();
      await t.close();
    },
  };
  await h.reset();
  return h;
}

/** Listing ids of the PRD §9 demo basket. */
export const L = {
  atta: listingId("sharma", "cp_atta_aashirvaad_10kg"),
  toor: listingId("gupta", "cp_toor_tata_1kg"),
  tea: listingId("gupta", "cp_tea_tata_premium_250g"),
  milk: listingId("lakshmi", "cp_milk_amul_taaza_1l"),
};

/** Searches for the demo needs (so the BAP has seen the offers), then sets the 3-store demo basket by hand. */
export async function buildDemoBasket(h: BapHarness) {
  await Promise.all(["atta", "toor dal", "tea", "milk"].map(async (q) => {
    const r = await h.call("GET", `/bap/search?q=${encodeURIComponent(q)}`);
    if (r.status !== 200) throw new Error(`search ${q} → ${r.status}`);
  }));
  return h.call("PUT", "/bap/basket", {
    items: [{ listingId: L.atta, qty: 1 }, { listingId: L.toor, qty: 2 }, { listingId: L.tea, qty: 1 }, { listingId: L.milk, qty: 8 }],
  });
}

/** Quote, approve and pay the demo basket. Returns the basket id and the attempt-1 id per store. */
export async function payDemoBasket(h: BapHarness, opts: { key?: string } = {}) {
  await buildDemoBasket(h);
  const q = await h.call("POST", "/bap/basket/quote");
  const basketId = q.body.basket.id as string;
  const a = await h.call("POST", `/bap/baskets/${basketId}/approve`, { quoteHash: q.body.quote.quoteHash });
  if (a.status !== 200) throw new Error(`approve → ${a.status} ${JSON.stringify(a.body)}`);
  const p = await h.call("POST", `/bap/baskets/${basketId}/pay`, { approvalToken: a.body.approvalToken }, { headers: { "idempotency-key": opts.key ?? `k-${basketId}` } });
  if (p.body?.status !== "PAID") throw new Error(`pay → ${p.status} ${JSON.stringify(p.body)}`);
  const view = (await h.call("GET", `/bap/baskets/${basketId}`)).body;
  const att = (store: string): string => view.subOrders.find((s: any) => s.approvedStoreId === store).attempts[0].id;
  return { basketId, sharma: att("store_sharma"), gupta: att("store_gupta"), lakshmi: att("store_lakshmi") };
}

/** Polls GET /bap/baskets/:id until `ok(view)`, up to timeoutMs. */
export async function waitForOrder(h: BapHarness, basketId: string, ok: (v: any) => boolean, timeoutMs = 5000) {
  const started = Date.now();
  for (;;) {
    const v = (await h.call("GET", `/bap/baskets/${basketId}`)).body;
    if (ok(v)) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting; last view: ${JSON.stringify(v, null, 1)}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}
