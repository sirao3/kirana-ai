import type { FastifyPluginAsync } from "fastify";
import { CALLBACK_ACTIONS, type CallbackAction } from "@kiranaai/shared";
import { registerBecknActions, type BecknHandler, type BecknHandlers } from "../beckn/receiver.js";
import { bapCallbackHandlers } from "./callbacks.js";
import { bapApiRoutes } from "./api/index.js";
import { agentRoutes } from "./agent/index.js";
import { settleStalePayments } from "./checkout.js";
import { reconcileDispatch } from "./dispatch.js";

/** BAP module (/bap): Beckn callbacks; customer APIs (T06+) and the agent (T10) mount here too. */
export const bapRoutes: FastifyPluginAsync = async (app) => {
  // Every callback goes to its waiter first, then to the module handler (if any).
  const handlers: BecknHandlers<CallbackAction> = {};
  for (const action of CALLBACK_ACTIONS) {
    (handlers as Record<CallbackAction, BecknHandler<CallbackAction>>)[action] = async (env, ctx) => {
      ctx.waiters.deliver(env);
      const extra = bapCallbackHandlers[action] as BecknHandler<CallbackAction> | undefined;
      if (extra) return extra(env, ctx);
    };
  }
  registerBecknActions(app, { actor: "bap", actions: CALLBACK_ACTIONS, verify: "bpp", handlers });
  await app.register(bapApiRoutes);
  await app.register(agentRoutes, { prefix: "/agent" });
  // Lane B: background jobs (always via the ticker, never a bare timer).
  app.ctx.ticker.add({ name: "bap.payments", everyMs: 1000, run: () => settleStalePayments(app.ctx) });
  app.ctx.ticker.add({ name: "bap.reconciler", everyMs: 5000, run: () => reconcileDispatch(app.ctx) });
};
