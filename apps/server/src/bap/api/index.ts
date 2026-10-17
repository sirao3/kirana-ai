import type { FastifyPluginAsync } from "fastify";

/** Customer BAP API (/bap/*), lane B: search, basket, quote (T06), approve/pay (T07), orders (T08), plan (T09). Contract: packages/shared/src/api.ts */
export const bapApiRoutes: FastifyPluginAsync = async () => {};
