import type pg from "pg";

/** Thrown by BAP services; the API error handler turns it into `{ error, message, details }`. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message?: string,
    readonly details?: unknown,
  ) {
    super(message ?? code);
  }
}

/** Runs fn in a transaction. Keep it short: never do HTTP (becknSend/becknCall) inside. */
export async function withTx<T>(pool: pg.Pool, fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === "23505" && (!constraint || e.constraint === constraint);
}

export interface CustomerRow {
  id: string;
  name: string;
  phone: string;
  address: string;
  lat: number;
  lng: number;
}

export async function loadCustomer(pool: pg.Pool, id: string): Promise<CustomerRow> {
  const { rows } = await pool.query<CustomerRow>("SELECT id, name, phone, address, lat, lng FROM bap.customer WHERE id = $1", [id]);
  if (!rows[0]) throw new ApiError(404, "unknown_customer");
  return rows[0];
}

export interface BapConfigRow {
  offerWindowSeconds: number;
  platformFeePaise: number;
  commissionBps: number;
  failNextPayment: boolean;
}

export async function loadBapConfig(db: pg.Pool | pg.PoolClient): Promise<BapConfigRow> {
  const { rows } = await db.query<{ offer_window_seconds: number; platform_fee_paise: number; commission_bps: number; fail_next_payment: boolean }>(
    "SELECT offer_window_seconds, platform_fee_paise, commission_bps, fail_next_payment FROM bap.config WHERE id = 1",
  );
  const r = rows[0];
  return {
    offerWindowSeconds: r?.offer_window_seconds ?? 45,
    platformFeePaise: r?.platform_fee_paise ?? 0,
    commissionBps: r?.commission_bps ?? 0,
    failNextPayment: r?.fail_next_payment ?? false,
  };
}
