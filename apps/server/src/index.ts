import { buildApp } from "./app.js";
import { loadConfig } from "./config.js";
import { createDb } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { seedIfEmpty } from "./db/seed/seed.js";

async function main() {
  const config = loadConfig();
  const dbHandle = createDb(config.databaseUrl);
  const app = await buildApp({ config, dbHandle });

  const migrated = await runMigrations(dbHandle.pool);
  const seeded = await seedIfEmpty(dbHandle.pool, {
    selfBaseUrl: config.selfBaseUrl,
    offerWindowSeconds: config.OFFER_WINDOW_SECONDS,
  });
  app.log.info({ migrated, seeded }, "database ready");

  await app.listen({ host: "0.0.0.0", port: config.PORT });
  await app.ctx.ticker.tick(); // boot pass (expire overdue offers, reconcile)
  app.ctx.ticker.start();

  const shutdown = async () => {
    await app.ctx.ticker.stop();
    await app.close();
    await dbHandle.close();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
