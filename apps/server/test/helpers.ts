import { buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createDb } from "../src/db/client.js";
import { runMigrations } from "../src/db/migrate.js";

/** Local test database (docker compose `postgres`, port 5433). Override with TEST_DATABASE_URL. */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://kiranaai:kiranaai@127.0.0.1:5433/kiranaai";

/** App on a random port so modules can make real HTTP calls to themselves. */
export async function startTestApp(env: Record<string, string> = {}) {
  const dbHandle = createDb(TEST_DATABASE_URL);
  await runMigrations(dbHandle.db);
  const base = loadConfig({ ...process.env, DATABASE_URL: TEST_DATABASE_URL, PORT: "0", LOG_LEVEL: "warn", ...env });
  const app = await buildApp({ config: base, dbHandle, logger: false });
  await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  // SELF_BASE_URL must point at the ephemeral port.
  app.ctx.config.PORT = port;
  app.ctx.config.selfBaseUrl = env.SELF_BASE_URL ?? `http://127.0.0.1:${port}`;
  return {
    app,
    url: app.ctx.config.selfBaseUrl,
    db: dbHandle.db,
    pool: dbHandle.pool,
    async close() {
      await app.ctx.ticker.stop();
      await app.close();
      await dbHandle.close();
    },
  };
}
