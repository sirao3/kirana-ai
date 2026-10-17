import type { FastifyPluginAsync } from "fastify";
import { REQUEST_ACTIONS } from "@kiranaai/shared";
import { registerBecknActions } from "../beckn/receiver.js";
import { bppActionHandlers } from "./actions.js";
import { merchantRoutes } from "./merchant/index.js";
import { BPP_ID, bppIdentity } from "./identity.js";

export { BPP_ID, bppIdentity };

/** BPP module (/bpp): Beckn endpoints; merchant API (T05) and catalogue (T14) mount here too. */
export const bppRoutes: FastifyPluginAsync = async (app) => {
  registerBecknActions(app, { actor: "bpp", actions: REQUEST_ACTIONS, verify: "bap", handlers: bppActionHandlers });
  await app.register(merchantRoutes, { prefix: "/merchant" });
  // Lane A: register the offer sweeper here with app.ctx.ticker.add({ name: "bpp.sweeper", everyMs: 1000, run }).
};
