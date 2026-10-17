import pg from "pg";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";

export type Db = NodePgDatabase<Record<string, never>>;

export interface DbHandle {
  pool: pg.Pool;
  db: Db;
  close(): Promise<void>;
}

export function createDb(databaseUrl: string): DbHandle {
  // e2-micro Postgres allows 40 connections; one Cloud Run instance keeps a small pool.
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, connectionTimeoutMillis: 5_000 });
  pool.on("error", () => {}); // idle-client errors are surfaced on the next query
  const db = drizzle(pool) as Db;
  return { pool, db, close: () => pool.end() };
}

export async function pingDb(pool: pg.Pool): Promise<boolean> {
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  }
}
