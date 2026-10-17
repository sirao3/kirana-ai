// `pnpm seed`: migrate, then wipe and reload the demo seed into DATABASE_URL / DB_*.
import { loadConfig } from "../config.js";
import { createDb } from "./client.js";
import { runMigrations } from "./migrate.js";
import { resetAndSeed } from "./seed/seed.js";

const config = loadConfig();
const { pool, close } = createDb(config.databaseUrl);
try {
  await runMigrations(pool);
  await resetAndSeed(pool, { selfBaseUrl: config.selfBaseUrl, offerWindowSeconds: config.OFFER_WINDOW_SECONDS });
  console.log("seeded");
} finally {
  await close();
}
