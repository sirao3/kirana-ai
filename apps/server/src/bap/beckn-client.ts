import {
  makeContext, newMessageId, type CallbackAction, type Envelope, type MessageFor, type RequestAction, type SearchMessage,
} from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { listParticipants } from "../beckn/registry.js";
import { becknSend } from "../beckn/send.js";

export const BAP_ID = "kiranaai-bap";

export function bapIdentity(ctx: AppContext) {
  return { bapId: BAP_ID, bapUri: `${ctx.config.selfBaseUrl.replace(/\/$/, "")}/bap` };
}

async function gatewayUrl(ctx: AppContext): Promise<string> {
  const [gw] = await listParticipants(ctx.pool, { type: "BG" });
  return gw?.subscriber_url ?? `${ctx.config.selfBaseUrl.replace(/\/$/, "")}/gw`;
}

/**
 * search via the gateway; collects on_search callbacks for windowMs (PRD §11: 1.5 s).
 * Each envelope's context carries bpp_id/bpp_uri to use for select/init/confirm.
 */
export async function searchViaGateway(
  ctx: AppContext,
  o: { transactionId: string; message: SearchMessage; windowMs?: number },
): Promise<Envelope<"on_search">[]> {
  const context = makeContext({ action: "search", transactionId: o.transactionId, messageId: newMessageId(), ...bapIdentity(ctx) });
  const replies = ctx.waiters.collect(context.message_id, "on_search", o.windowMs ?? 1500);
  await becknSend(ctx, { url: await gatewayUrl(ctx), action: "search", context, message: o.message, actor: "bap" });
  return replies;
}

/**
 * Synchronous wrapper (PRD §11): send select/init/confirm/status/cancel to one BPP and await
 * its on_* reply (default 5 s). The reply may carry `error`; check it. Throws BecknSendError
 * on NACK and BecknTimeoutError on timeout.
 */
export async function becknCall<A extends RequestAction>(
  ctx: AppContext,
  o: { action: A; bppId: string; bppUri: string; transactionId: string; message: MessageFor<A>; timeoutMs?: number; storeId?: string },
): Promise<Envelope<`on_${A}` & CallbackAction>> {
  const context = makeContext({ action: o.action, transactionId: o.transactionId, bppId: o.bppId, bppUri: o.bppUri, ...bapIdentity(ctx) });
  const reply = ctx.waiters.waitFor(context.message_id, `on_${o.action}` as `on_${A}` & CallbackAction, o.timeoutMs ?? 5000);
  reply.catch(() => {}); // avoid an unhandled rejection if the send itself throws
  await becknSend(ctx, { url: o.bppUri, action: o.action, context, message: o.message, actor: "bap", storeId: o.storeId });
  return reply;
}
