import { callbackContext, type BecknError, type CallbackAction, type Envelope, type MessageFor, type RequestAction } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { becknSend } from "../beckn/send.js";
import { bppIdentity } from "./identity.js";

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
