import type { CallbackAction } from "@kiranaai/shared";
import type { BecknHandlers } from "../beckn/receiver.js";

/**
 * Extra BAP handling for callbacks, run AFTER the envelope is delivered to any waiter.
 * Solicited replies (on_search/on_select/on_init/on_confirm) are usually consumed by the
 * waiter alone; unsolicited ones drive dispatch:
 *
 * T08: on_status (attempt ACCEPTED, fulfilment mirroring), on_cancel (REJECTED/EXPIRED →
 * next attempt), on_confirm (attempt OFFERED with expires_at).
 */
export const bapCallbackHandlers: BecknHandlers<CallbackAction> = {};
