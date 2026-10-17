import type { FastifyPluginAsync } from "fastify";
import { REQUEST_ACTIONS } from "@kiranaai/shared";
import { registerBecknActions } from "../beckn/receiver.js";
import { bppActionHandlers } from "./actions.js";

export const BPP_ID = "kiranaai-bpp";

/** BPP module (/bpp): Beckn endpoints; merchant API (T05) and catalogue (T14) mount here too. */
export const bppRoutes: FastifyPluginAsync = async (app) => {
  registerBecknActions(app, { actor: "bpp", actions: REQUEST_ACTIONS, verify: "bap", handlers: bppActionHandlers });
};

/** This BPP's identity for callback contexts. */
export function bppIdentity(selfBaseUrl: string) {
  return { bppId: BPP_ID, bppUri: `${selfBaseUrl.replace(/\/$/, "")}/bpp` };
}
