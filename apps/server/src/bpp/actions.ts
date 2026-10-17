import {
  callbackContext, type BecknError, type CallbackAction, type Envelope, type MessageFor, type Order, type RequestAction,
} from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import type { BecknHandlers } from "../beckn/receiver.js";
import { becknSend } from "../beckn/send.js";
import { DOMAIN_ERROR } from "./common.js";
import { bppIdentity } from "./identity.js";
import { quoteStore, toBecknQuote } from "./quote.js";
import { readIntent, searchCatalog } from "./search.js";

/** Sends the on_* reply for a request to its bap_uri (the receiver ACKs after we return). */
export async function reply<A extends CallbackAction>(
  ctx: AppContext,
  env: Envelope<RequestAction>,
  action: A,
  message: MessageFor<A> | undefined,
  o: { error?: BecknError; storeId?: string } = {},
): Promise<void> {
  const context = { ...callbackContext(env.context, bppIdentity(ctx.config.selfBaseUrl)), action };
  await becknSend(ctx, { url: env.context.bap_uri, action, context, message, error: o.error, actor: "bpp", storeId: o.storeId });
}

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
};
