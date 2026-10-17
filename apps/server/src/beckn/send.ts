import { AckResponse, type BecknAction, type BecknError, type Context } from "@kiranaai/shared";
import type { AppContext } from "../app.js";
import { audit, type AuditRow } from "./audit.js";

export class BecknSendError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly action: string,
    readonly error?: BecknError,
  ) {
    super(message);
  }
}

export interface SendOptions {
  /** Participant base URL, e.g. http://127.0.0.1:8080/bpp; the action is appended. */
  url: string;
  action: BecknAction;
  context: Context;
  message?: unknown;
  error?: BecknError;
  actor: AuditRow["actor"];
  storeId?: string;
  timeoutMs?: number;
}

/**
 * POST {context, message} to `${url}/${action}`, audit it, and require an ACK.
 * Throws BecknSendError on network failure, non-2xx, or NACK (error attached).
 *
 * Never call this while holding a DB transaction or advisory lock: receivers process
 * before they ACK, so the other side may need the same rows to reply.
 */
export async function becknSend(ctx: AppContext, o: SendOptions): Promise<AckResponse> {
  const target = `${o.url.replace(/\/$/, "")}/${o.action}`;
  const body = { context: { ...o.context, action: o.action }, ...(o.message !== undefined ? { message: o.message } : {}), ...(o.error ? { error: o.error } : {}) };
  const base = { kind: "beckn" as const, action: o.action, actor: o.actor, direction: "out" as const, transactionId: o.context.transaction_id, messageId: o.context.message_id, storeId: o.storeId };

  let res: Response;
  try {
    res = await fetch(target, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(o.timeoutMs ?? 5_000),
    });
  } catch (err) {
    await audit(ctx.pool, { ...base, payload: { url: target, body, failed: String(err) } });
    throw new BecknSendError(`${o.action} to ${target} failed: ${String(err)}`, target, o.action);
  }

  const json = await res.json().catch(() => null);
  const parsed = AckResponse.safeParse(json);
  const status = parsed.success ? parsed.data.message.ack.status : `HTTP ${res.status}`;
  await audit(ctx.pool, { ...base, payload: { url: target, body, ack: status, error: parsed.success ? parsed.data.error : undefined } });

  if (!parsed.success) throw new BecknSendError(`${o.action} to ${target}: HTTP ${res.status}, no ACK`, target, o.action);
  if (parsed.data.message.ack.status !== "ACK") {
    throw new BecknSendError(`${o.action} to ${target}: NACK ${parsed.data.error?.code ?? ""} ${parsed.data.error?.message ?? ""}`.trim(), target, o.action, parsed.data.error);
  }
  return parsed.data;
}
