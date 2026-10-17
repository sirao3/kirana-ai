import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";
import type { Config } from "./config.js";
import { pingDb, type DbHandle } from "./db/client.js";
import { Ticker } from "./lib/ticker.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Shared services every module receives. */
export interface AppContext {
  config: Config;
  db: DbHandle["db"];
  pool: DbHandle["pool"];
  ticker: Ticker;
}

declare module "fastify" {
  interface FastifyInstance {
    ctx: AppContext;
  }
}

/** Route prefixes owned by the API; everything else may fall back to the SPA. */
export const API_PREFIXES = ["/bap", "/bpp", "/gw", "/admin", "/health", "/test"];

// Cloud Logging reads `severity`; keep pino JSON otherwise.
const SEVERITY: Record<string, string> = {
  trace: "DEBUG", debug: "DEBUG", info: "INFO", warn: "WARNING", error: "ERROR", fatal: "CRITICAL",
};

export async function buildApp(opts: { config: Config; dbHandle: DbHandle; logger?: boolean }): Promise<FastifyInstance> {
  const { config, dbHandle } = opts;
  const app = Fastify({
    logger:
      opts.logger === false
        ? false
        : {
            level: config.LOG_LEVEL,
            messageKey: "message",
            formatters: { level: (label) => ({ severity: SEVERITY[label] ?? "DEFAULT" }) },
          },
  });

  const ticker = new Ticker((job, err) => app.log.error({ err, job }, "tick job failed"));
  app.decorate("ctx", { config, db: dbHandle.db, pool: dbHandle.pool, ticker });

  // See lib/ticker.ts: requests are what give us CPU on Cloud Run. Fire and forget —
  // awaiting here would deadlock jobs that call this server over HTTP.
  app.addHook("onRequest", async () => {
    void ticker.tick();
  });

  app.get("/health", async (_req, reply) => {
    const ok = await pingDb(dbHandle.pool);
    return reply.code(ok ? 200 : 503).send({ status: ok ? "ok" : "degraded", db: ok ? "ok" : "error" });
  });

  // Modules register here (each as a Fastify plugin under its own prefix).
  // e.g. await app.register(gatewayRoutes, { prefix: "/gw" });

  const webDist = config.WEB_DIST ?? path.resolve(here, "../../web/dist");
  const hasWeb = existsSync(path.join(webDist, "index.html"));
  if (hasWeb) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
  }
  app.setNotFoundHandler((req, reply) => {
    const isApi = API_PREFIXES.some((p) => req.url === p || req.url.startsWith(p + "/") || req.url.startsWith(p + "?"));
    if (hasWeb && req.method === "GET" && !isApi) return reply.sendFile("index.html");
    return reply.code(404).send({ error: "not_found" });
  });

  return app;
}
