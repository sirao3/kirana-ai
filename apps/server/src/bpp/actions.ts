import { nack, type Envelope, type Order, type RequestAction } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import type { BecknHandlers } from "../beckn/receiver.js";
import { DOMAIN_ERROR } from "./common.js";
import { onConfirm, onStatus } from "./confirm.js";
import { quoteStore, toBecknQuote } from "./quote.js";
import { reply } from "./reply.js";
import { readIntent, searchCatalog } from "./search.js";

/** select / init: re-read price and stock, check serviceability, reply with the quote (init adds ttl + payment terms). */
async function onQuote(env: Envelope<"select" | "init">, ctx: AppContext): Promise<void> {
  const isInit = env.context.action === "init";
  const action = isInit ? "on_init" : "on_select";
  const order = env.message.order;
  const q = await quoteStore(ctx.pool, { order });
  if ("missingStore" in q) {
    await reply(ctx, env, action, { order }, {
      error: { type: DOMAIN_ERROR, code: "30001", message: `unknown store ${order.provider.id}` },
    });
    return;
  }
  const out: Order = {
    ...order,
    provider: { ...order.provider, locations: [{ id: `${q.store.id}_loc` }] },
    quote: toBecknQuote(q, isInit ? "PT10M" : undefined),
    ...(isInit ? { payment: { type: "ON-ORDER", collected_by: "BAP", status: "NOT-PAID" as const } } : {}),
  };
  await reply(ctx, env, action, { order: out }, { error: q.error, storeId: q.store.id });
}

/**
 * BPP Beckn request handlers (one BPP hosting all 5 stores as providers).
 * Each handler does its work and sends the on_* callback to env.context.bap_uri with
 * becknSend(...) before returning; the receiver then ACKs. Unset actions NACK
 * "not implemented".
 *
 * T04: search, select, init. T05: confirm, status, cancel.
 */
export const bppActionHandlers: BecknHandlers<RequestAction> = {
  search: async (env, ctx) => {
    const { providers, catalogTags } = await searchCatalog(ctx.pool, readIntent(env.message.intent));
    await reply(ctx, env, "on_search", {
      catalog: {
        "bpp/descriptor": { name: "KiranaAI BPP" },
        "bpp/providers": providers,
        ...(catalogTags.length ? { tags: catalogTags } : {}),
      },
    });
  },
  select: onQuote,
  init: onQuote,
  confirm: onConfirm,
  status: onStatus,
  // Post-acceptance cancellation is out of scope (PRD ORD-07); customer cancel while dispatching is P1.
  cancel: async () => nack("30000", "cancel is not supported by this BPP"),
};
