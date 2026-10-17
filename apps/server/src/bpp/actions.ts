import type { RequestAction } from "@kiranaai/shared";
import type { BecknHandlers } from "../beckn/receiver.js";

/**
 * BPP Beckn request handlers (one BPP hosting all 5 stores as providers).
 * Each handler does its work and sends the on_* callback to env.context.bap_uri with
 * becknSend(...) before returning; the receiver then ACKs. Unset actions NACK
 * "not implemented".
 *
 * T04: search, select, init. T05: confirm, status, cancel.
 */
export const bppActionHandlers: BecknHandlers<RequestAction> = {};
