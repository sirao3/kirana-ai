import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type pg from "pg";

const here = path.dirname(fileURLToPath(import.meta.url));

/** apps/server/drizzle (from src/db in dev, from dist in the bundle). */
export function migrationsDir(): string | null {
  const candidates = [process.env.MIGRATIONS_DIR, path.resolve(here, "../../drizzle"), path.resolve(here, "../drizzle")];
  return candidates.find((d) => d && existsSync(d) && readdirSync(d).some((f) => f.endsWith(".sql"))) ?? null;
}

/**
 * Applies drizzle/*.sql in filename order, once each, recorded in public.schema_migrations.
 * Plain files (no drizzle journal) so parallel branches can each add a migration without
 * conflicting. A session advisory lock serialises concurrent boots and test runs.
 */
export async function runMigrations(pool: pg.Pool): Promise<string[]> {
  const dir = migrationsDir();
  if (!dir) return [];
  const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(
      "CREATE TABLE IF NOT EXISTS public.schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
    );
    const done = new Set((await client.query<{ name: string }>("SELECT name FROM public.schema_migrations")).rows.map((r) => r.name));
    for (const f of files) {
      if (done.has(f)) continue;
      const sql = readFileSync(path.join(dir, f), "utf8").replaceAll("--> statement-breakpoint", "");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query("INSERT INTO public.schema_migrations (name) VALUES ($1)", [f]);
        await client.query("COMMIT");
        applied.push(f);
      } catch (err) {
        await client.query("ROLLBACK");
        throw new Error(`migration ${f} failed: ${(err as Error).message}`);
      }
    }
  } finally {
    await client.query("SELECT pg_advisory_unlock(727001)").catch(() => {});
    client.release();
  }
  return applied;
}
