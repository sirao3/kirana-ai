import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Db } from "./client.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** drizzle-kit output: apps/server/drizzle (from src/db in dev, from dist in the bundle). */
export function migrationsDir(): string | null {
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")];
  return candidates.find((d) => d && existsSync(path.join(d, "meta", "_journal.json"))) ?? null;
}

export async function runMigrations(db: Db): Promise<boolean> {
  const dir = migrationsDir();
  if (!dir) return false;
  await migrate(db, { migrationsFolder: dir });
  return true;
}
