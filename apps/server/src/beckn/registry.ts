import type pg from "pg";

export interface Participant {
  subscriber_id: string;
  type: "BAP" | "BPP" | "BG";
  subscriber_url: string;
  domain: string;
  city: string;
  status: string;
}

const COLS = "subscriber_id, type, subscriber_url, domain, city, status";

// Positive lookups are cached briefly: every inbound Beckn message verifies its sender.
const cache = new Map<string, { p: Participant; at: number }>();
const TTL_MS = 5_000;

export async function findParticipant(pool: pg.Pool, subscriberId: string): Promise<Participant | null> {
  const hit = cache.get(subscriberId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const { rows } = await pool.query<Participant>(
    `SELECT ${COLS} FROM registry.participant WHERE subscriber_id = $1 AND status = 'SUBSCRIBED'`,
    [subscriberId],
  );
  const p = rows[0] ?? null;
  if (p) cache.set(subscriberId, { p, at: Date.now() });
  else cache.delete(subscriberId);
  return p;
}

export async function listParticipants(pool: pg.Pool, filter: { type?: Participant["type"]; subscriberId?: string } = {}): Promise<Participant[]> {
  const { rows } = await pool.query<Participant>(
    `SELECT ${COLS} FROM registry.participant
     WHERE status = 'SUBSCRIBED' AND ($1::text IS NULL OR type = $1) AND ($2::text IS NULL OR subscriber_id = $2)
     ORDER BY subscriber_id`,
    [filter.type ?? null, filter.subscriberId ?? null],
  );
  return rows;
}

export function clearRegistryCache(): void {
  cache.clear();
}
