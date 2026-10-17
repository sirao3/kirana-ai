/**
 * Fake BPP for lane B tests. Speaks the Beckn contract in artifacts/LANES.md (on_search / on_select / on_init /
 * on_confirm, error codes 40002/30009/30001, unsolicited on_status / on_cancel) and is data-driven from the demo
 * seed (stores, listings, prices, delivery rules). It replaces `kiranaai-bpp` in registry.participant for a test.
 *
 * Tests drive the merchant side by hand: fake.accept(attId), fake.reject(attId), fake.expire(attId), fake.advance(attId).
 */
import Fastify, { type FastifyInstance } from "fastify";
import {
  callbackContext, deliveryChargePaise, DeliveryRule, getTag, haversineM, KTAG, nack, newMessageId, paiseOf, parseGps,
  priceOf, REQUEST_ACTIONS, tag, type BecknError, type Context, type Envelope, type Order, type RequestAction,
} from "@kiranaai/shared";
import { clearRegistryCache } from "../../src/beckn/registry.js";
import { registerBecknActions, type BecknHandlers } from "../../src/beckn/receiver.js";
import { becknSend } from "../../src/beckn/send.js";
import type { AppContext } from "../../src/app.js";
import { listingId, SEED } from "../../src/db/seed/seed.js";

export const FAKE_BPP_ID = "kiranaai-bpp";

type Fulfilment = "PENDING" | "ACCEPTED" | "PREPARING" | "READY" | "OUT_FOR_DELIVERY" | "DELIVERED";
export interface FakeOrder {
  id: string;
  storeId: string;
  items: { listingId: string; qty: number }[];
  totalPaise: number;
  state: "OFFERED" | "ACCEPTED" | "REJECTED" | "EXPIRED";
  fulfilment: Fulfilment;
  context: Context;
  order: Order;
  windowSeconds: number;
  expiresAt: Date;
  confirms: number;
}

interface FakeListing {
  listingId: string;
  storeId: string;
  productId: string;
  price: number;
  stock: number;
  mrp: number;
}

const stores = SEED.stores.map((s) => ({ ...s, rule: DeliveryRule.parse(s.delivery_rule), online: true }));
const products = SEED.products;

const synonyms = new Map(Object.entries(SEED.synonyms).map(([k, v]) => [k.toLowerCase(), v as string]));
const looseTerms = Object.keys(SEED.loose_terms);

function norm(q: string): string[] {
  let text = q.toLowerCase().trim().replace(/\s+/g, " ");
  const phrase = synonyms.get(text);
  if (phrase) text = phrase;
  return text.split(" ").map((t) => synonyms.get(t) ?? t).join(" ").split(" ").filter(Boolean);
}

function packBase(size: number, unit: string): number {
  return unit === "kg" || unit === "l" ? size * 1000 : size;
}

export interface FakeBpp {
  url: string;
  orders: Map<string, FakeOrder>;
  /** Everything received, by action (e.g. to assert "no confirms were sent"). */
  received: Record<string, number>;
  /** Make the next confirm(s) for a store fail with this Beckn error code (until cleared). */
  confirmError: Map<string, string>;
  /** Make select/init for a store fail with this Beckn error code even though its catalogue looked fine. */
  quoteError: Map<string, string>;
  /** Swallow unsolicited on_cancel/on_status (to test the reconciler). */
  silent: boolean;
  setPrice(storeId: string, productId: string, pricePaise: number): void;
  setStock(storeId: string, productId: string, stock: number): void;
  setOnline(storeId: string, online: boolean): void;
  /** Send the current state of an order again as a new unsolicited message (BPP retry / duplicate). */
  resend(attId: string, action: "status" | "cancel"): Promise<void>;
  accept(attId: string): Promise<void>;
  reject(attId: string, reason?: string): Promise<void>;
  expire(attId: string): Promise<void>;
  advance(attId: string): Promise<Fulfilment>;
  /** Latest order created for a store. */
  latestFor(storeId: string): FakeOrder | undefined;
  /** Registers this fake as `kiranaai-bpp` in the registry (call again after every reset). */
  register(): Promise<void>;
  /** Back to the seed: prices, stock, online flags, orders, counters, faults. */
  reset(): void;
  close(): Promise<void>;
}

export async function startFakeBpp(ctx: AppContext): Promise<FakeBpp> {
  const listings = new Map<string, FakeListing>();
  const loadListings = () => {
    listings.clear();
    for (const s of stores) s.online = true;
    for (const p of products) {
      for (const [key, [price, stock]] of Object.entries(p.listings) as [string, [number, number]][]) {
        const s = stores.find((x) => x.key === key)!;
        const id = listingId(key, p.id);
        listings.set(id, { listingId: id, storeId: s.id, productId: p.id, price, stock, mrp: p.mrp_paise });
      }
    }
  };
  loadListings();
  const productById = new Map(products.map((p) => [p.id, p]));
  const orders = new Map<string, FakeOrder>();
  const received: Record<string, number> = {};
  const confirmError = new Map<string, string>();
  const quoteError = new Map<string, string>();

  let baseUrl = "";
  const identity = () => ({ bppId: FAKE_BPP_ID, bppUri: baseUrl });
  const storeOf = (id: string) => stores.find((s) => s.id === id);

  const send = (action: "on_search" | "on_select" | "on_init" | "on_confirm" | "on_status" | "on_cancel", context: Context, message: unknown, error?: BecknError) =>
    becknSend(ctx, { url: context.bap_uri, action, context, message, error, actor: "bpp" });

  // ---------- search ----------
  function providersFor(gps: string, filter: (p: (typeof products)[number]) => boolean) {
    const cust = parseGps(gps);
    return stores
      .filter((s) => s.online)
      .map((s) => {
        const distanceM = haversineM(cust, s);
        const charge = deliveryChargePaise(s.rule, distanceM, 0);
        if (distanceM > s.delivery_radius_m || charge === null) return null;
        const items = [...listings.values()]
          .filter((l) => l.storeId === s.id && l.stock > 0)
          .map((l) => ({ l, p: productById.get(l.productId)! }))
          .filter(({ p }) => filter(p))
          .map(({ l, p }) => ({
            id: l.listingId,
            descriptor: { name: `${p.brand} ${p.name} ${p.pack_size} ${p.unit}` },
            price: { ...priceOf(l.price), maximum_value: priceOf(l.mrp).value },
            quantity: { available: { count: String(l.stock) }, unitized: { measure: { unit: p.unit, value: String(p.pack_size) } } },
            category_id: p.category,
            location_id: `${s.id}_loc`,
            tags: [tag(KTAG.group, { canonical_id: p.id, brand: p.brand, product_name: `${p.brand} ${p.name}`, pack_label: `${p.pack_size} ${p.unit}` })],
          }));
        if (!items.length) return null;
        return {
          id: s.id,
          descriptor: { name: s.name },
          locations: [{ id: `${s.id}_loc`, gps: `${s.lat},${s.lng}` }],
          tags: [tag(KTAG.group, { distance_m: String(distanceM), delivery_charge: priceOf(charge).value, [KTAG.deliveryRule]: JSON.stringify(s.rule) })],
          items,
        };
      })
      .filter((x) => x !== null);
  }

  const handlers: BecknHandlers<RequestAction> = {
    search: async (env) => {
      received.search = (received.search ?? 0) + 1;
      const intent = env.message.intent;
      const gps = intent.fulfillment?.end?.location.gps ?? "12.9719,77.6412";
      const ids = getTag(intent.tags, KTAG.group, KTAG.canonicalIds)?.split(",").filter(Boolean);
      const query = intent.item?.descriptor?.name ?? "";
      let filter: (p: (typeof products)[number]) => boolean = () => false;
      let catalogTags: ReturnType<typeof tag>[] | undefined;
      if (ids?.length) {
        filter = (p) => ids.includes(p.id);
      } else if (query.trim()) {
        const amount = /(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i.exec(query);
        const tokens = norm(query.replace(/(\d+(?:\.\d+)?)\s*(kg|g|ml|l)\b/i, " "));
        const byName = (p: (typeof products)[number]) => {
          const hay = `${p.brand} ${p.name} ${p.variant ?? ""} ${p.category} ${p.keywords}`.toLowerCase();
          return tokens.length > 0 && tokens.every((t) => hay.includes(t));
        };
        const wanted = amount ? packBase(Number(amount[1]), amount[2]!.toLowerCase()) : null;
        const isLoose = looseTerms.some((t) => query.toLowerCase().includes(t));
        const named = products.filter(byName);
        if (wanted !== null && named.length && !named.some((p) => packBase(p.pack_size, p.unit) === wanted)) {
          const alt = [...named].sort((a, b) => Math.abs(packBase(a.pack_size, a.unit) - wanted) - Math.abs(packBase(b.pack_size, b.unit) - wanted))[0]!;
          catalogTags = [tag(KTAG.group, { [KTAG.looseDeclined]: "true", [KTAG.reason]: `We only sell sealed packs: ${query.trim()} is not a pack size.`, alternative_canonical_id: alt.id })];
          filter = (p) => p.id === alt.id;
        } else if (isLoose && named.length) {
          catalogTags = [tag(KTAG.group, { [KTAG.looseDeclined]: "true", [KTAG.reason]: "Loose items are not sold.", alternative_canonical_id: named[0]!.id })];
          filter = (p) => p.id === named[0]!.id;
        } else {
          filter = (p) => byName(p) && (wanted === null || packBase(p.pack_size, p.unit) === wanted);
        }
      }
      await send("on_search", callbackContext(env.context, identity()), {
        catalog: { "bpp/descriptor": { name: "Fake BPP" }, "bpp/providers": providersFor(gps, filter), ...(catalogTags ? { tags: catalogTags } : {}) },
      });
    },

    select: (env) => answerQuote("select", env),
    init: (env) => answerQuote("init", env),

    confirm: async (env) => {
      received.confirm = (received.confirm ?? 0) + 1;
      const order = env.message.order;
      const attId = order.id!;
      const cb = callbackContext(env.context, identity());
      const existing = orders.get(attId);
      if (existing) {
        existing.confirms++;
        await send("on_confirm", cb, { order: onConfirmOrder(existing) });
        return;
      }
      const s = storeOf(order.provider.id)!;
      const echo = { ...order, state: undefined };
      const forced = confirmError.get(s.id);
      const bad = forced ?? (!s.online ? "30001" : order.items.some((i) => (listings.get(i.id)?.stock ?? 0) < i.quantity.count) ? "40002" : null);
      if (bad) {
        await send("on_confirm", cb, { order: echo }, { type: "DOMAIN-ERROR", code: bad, message: bad === "40002" ? "out of stock" : "store cannot take the order" });
        return;
      }
      const windowSeconds = Number(getTag(order.tags, KTAG.group, KTAG.offerWindowSeconds) ?? 45);
      const fo: FakeOrder = {
        id: attId, storeId: s.id, state: "OFFERED", fulfilment: "PENDING", context: env.context, order,
        items: order.items.map((i) => ({ listingId: i.id, qty: i.quantity.count })),
        totalPaise: order.quote ? paiseOf(order.quote.price) : 0, windowSeconds, expiresAt: new Date(Date.now() + windowSeconds * 1000), confirms: 1,
      };
      orders.set(attId, fo);
      await send("on_confirm", cb, { order: onConfirmOrder(fo) });
    },

    status: async (env) => {
      received.status = (received.status ?? 0) + 1;
      const fo = orders.get(env.message.order_id);
      const cb = callbackContext(env.context, identity());
      if (!fo) {
        await send("on_status", cb, undefined, { type: "DOMAIN-ERROR", code: "40000", message: "unknown order" });
        return;
      }
      await send("on_status", cb, { order: statusOrder(fo) });
    },

    cancel: async () => {
      return nack("30000", "cancel not supported");
    },
  };

  function onConfirmOrder(fo: FakeOrder): Order {
    return {
      id: fo.id, state: "Created", provider: fo.order.provider, items: fo.order.items, quote: fo.order.quote,
      fulfillments: fo.order.fulfillments,
      tags: [tag(KTAG.group, { expires_at: fo.expiresAt.toISOString() })],
    };
  }

  function statusOrder(fo: FakeOrder): Order {
    const code = { PENDING: "Pending", ACCEPTED: "Pending", PREPARING: "Pending", READY: "Packed", OUT_FOR_DELIVERY: "Out-for-delivery", DELIVERED: "Order-delivered" }[fo.fulfilment];
    const state: Order["state"] =
      fo.state === "REJECTED" || fo.state === "EXPIRED" ? "Cancelled"
        : fo.state === "OFFERED" ? "Created"
          : fo.fulfilment === "ACCEPTED" ? "Accepted"
            : fo.fulfilment === "DELIVERED" ? "Completed"
              : "In-progress";
    return {
      id: fo.id, state, provider: fo.order.provider, items: fo.order.items,
      fulfillments: [{ id: "f1", state: { descriptor: { code } } }],
      ...(state === "Cancelled"
        ? { cancellation: { cancelled_by: FAKE_BPP_ID, reason: { id: fo.state === "EXPIRED" ? "OFFER_EXPIRED" : "MERCHANT_REJECTED", descriptor: { name: fo.state === "EXPIRED" ? "Offer expired" : "Rejected" } } } }
        : {}),
    };
  }

  async function answerQuote(action: "select" | "init", env: Envelope<"select" | "init">) {
    received[action] = (received[action] ?? 0) + 1;
    const order = env.message.order;
    const cb = callbackContext(env.context, identity());
    const onAction = action === "select" ? "on_select" : "on_init";
    const s = storeOf(order.provider.id);
    const echo = { provider: order.provider, items: order.items, fulfillments: order.fulfillments, ...(order.billing ? { billing: order.billing } : {}) };
    if (!s || !s.online) {
      await send(onAction, cb, { order: echo }, { type: "DOMAIN-ERROR", code: "30001", message: "store is closed" });
      return;
    }
    const forcedError = quoteError.get(s.id);
    if (forcedError) {
      await send(onAction, cb, { order: echo }, { type: "DOMAIN-ERROR", code: forcedError, message: forcedError === "40002" ? order.items.map((i) => i.id).join(",") : "forced error" });
      return;
    }
    const gps = order.fulfillments?.[0]?.end?.location.gps ?? "12.9719,77.6412";
    const dist = haversineM(parseGps(gps), s);
    if (dist > s.delivery_radius_m) {
      await send(onAction, cb, { order: echo }, { type: "DOMAIN-ERROR", code: "30009", message: "outside delivery radius" });
      return;
    }
    const rows: NonNullable<Order["quote"]>["breakup"] = [];
    const short: string[] = [];
    let subtotal = 0;
    for (const it of order.items) {
      const l = listings.get(it.id);
      if (!l || l.storeId !== s.id || l.stock < it.quantity.count) {
        short.push(it.id);
        continue;
      }
      const p = productById.get(l.productId)!;
      const line = l.price * it.quantity.count;
      subtotal += line;
      const seen = getTag(it.tags, KTAG.group, "seen_price");
      rows.push({
        "@ondc/org/item_id": l.listingId,
        "@ondc/org/item_quantity": { count: it.quantity.count },
        "@ondc/org/title_type": "item",
        title: `${p.brand} ${p.name}`,
        price: priceOf(line),
        item: {
          price: priceOf(l.price),
          quantity: { available: { count: String(l.stock) } },
          tags: [tag(KTAG.group, seen && paiseOf({ value: seen }) !== l.price ? { price_changed: "true", previous_price: seen } : {})],
        },
      });
    }
    const delivery = deliveryChargePaise(s.rule, dist, subtotal);
    if (delivery === null) {
      await send(onAction, cb, { order: echo }, { type: "DOMAIN-ERROR", code: "30009", message: "outside delivery bands" });
      return;
    }
    rows.push({ "@ondc/org/item_id": "f1", "@ondc/org/title_type": "delivery", title: "Delivery charges", price: priceOf(delivery) });
    const quote = { price: priceOf(subtotal + delivery), breakup: rows, ...(action === "init" ? { ttl: "PT10M" } : {}) };
    await send(
      onAction,
      cb,
      { order: { ...echo, quote, ...(action === "init" ? { payment: { type: "ON-ORDER", collected_by: "BAP", status: "NOT-PAID" as const } } : {}) } },
      short.length ? { type: "DOMAIN-ERROR", code: "40002", message: short.join(",") } : undefined,
    );
  }

  // ---------- unsolicited callbacks ----------
  const unsolicited = (fo: FakeOrder, action: "status" | "cancel") =>
    callbackContext({ ...fo.context, action, message_id: newMessageId(), timestamp: new Date().toISOString() }, identity());

  const emit = async (fo: FakeOrder, action: "status" | "cancel") => {
    if (fake.silent) return;
    await send(action === "status" ? "on_status" : "on_cancel", unsolicited(fo, action), { order: statusOrder(fo) });
  };
  const need = (attId: string) => {
    const fo = orders.get(attId);
    if (!fo) throw new Error(`fake BPP has no order ${attId}`);
    return fo;
  };
  const NEXT: Record<string, Fulfilment | undefined> = { ACCEPTED: "PREPARING", PREPARING: "READY", READY: "OUT_FOR_DELIVERY", OUT_FOR_DELIVERY: "DELIVERED" };

  const app: FastifyInstance = Fastify({ logger: false });
  app.decorate("ctx", ctx);
  registerBecknActions(app, { actor: "bpp", actions: REQUEST_ACTIONS, verify: "bap", handlers });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  baseUrl = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;

  const fake: FakeBpp = {
    url: baseUrl, orders, received, confirmError, quoteError, silent: false,
    setPrice(storeId, productId, price) {
      const l = [...listings.values()].find((x) => x.storeId === storeId && x.productId === productId);
      if (!l) throw new Error("no such listing");
      l.price = price;
    },
    setStock(storeId, productId, stock) {
      const l = [...listings.values()].find((x) => x.storeId === storeId && x.productId === productId);
      if (!l) throw new Error("no such listing");
      l.stock = stock;
    },
    setOnline(storeId, online) {
      const s = storeOf(storeId);
      if (s) s.online = online;
    },
    async resend(attId, action) {
      await emit(need(attId), action);
    },
    async accept(attId) {
      const fo = need(attId);
      if (fo.state !== "OFFERED") throw new Error(`order ${attId} is ${fo.state}`);
      fo.state = "ACCEPTED";
      fo.fulfilment = "ACCEPTED";
      await emit(fo, "status");
    },
    async reject(attId) {
      const fo = need(attId);
      if (fo.state !== "OFFERED") throw new Error(`order ${attId} is ${fo.state}`);
      fo.state = "REJECTED";
      await emit(fo, "cancel");
    },
    async expire(attId) {
      const fo = need(attId);
      if (fo.state !== "OFFERED") throw new Error(`order ${attId} is ${fo.state}`);
      fo.state = "EXPIRED";
      await emit(fo, "cancel");
    },
    async advance(attId) {
      const fo = need(attId);
      const next = NEXT[fo.fulfilment];
      if (fo.state !== "ACCEPTED" || !next) throw new Error(`order ${attId} cannot advance from ${fo.fulfilment}`);
      fo.fulfilment = next;
      await emit(fo, "status");
      return next;
    },
    latestFor(storeId) {
      return [...orders.values()].filter((o) => o.storeId === storeId).at(-1);
    },
    reset() {
      loadListings();
      orders.clear();
      confirmError.clear();
      quoteError.clear();
      for (const k of Object.keys(received)) delete received[k];
      fake.silent = false;
    },
    async register() {
      await ctx.pool.query("UPDATE registry.participant SET subscriber_url = $1, status = 'SUBSCRIBED' WHERE subscriber_id = $2", [baseUrl, FAKE_BPP_ID]);
      clearRegistryCache();
    },
    async close() {
      await app.close();
    },
  };
  return fake;
}
