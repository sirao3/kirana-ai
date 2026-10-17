/**
 * Test-only stand-in for lane A's merchant + admin APIs (LANES.md contracts), backed by the fake BPP, in front of
 * the real app: a tiny HTTP proxy that answers /bpp/merchant/* and a few /admin/api/* routes itself and forwards
 * everything else to the app. Lets scripts/e2e-demo.ts run end to end on lane B's branch. Not used after merge.
 */
import http from "node:http";
import { resetAndSeed } from "../../src/db/seed/seed.js";
import type { BapHarness } from "./harness.js";

export async function startShim(h: BapHarness): Promise<{ url: string; close(): Promise<void> }> {
  const { fake, t } = h;
  // Emulates the BPP's offer sweeper: expire overdue offers.
  const sweeper = setInterval(() => {
    for (const o of fake.orders.values()) {
      if (o.state === "OFFERED" && o.expiresAt.getTime() <= Date.now()) void fake.expire(o.id).catch(() => {});
    }
  }, 300);

  const json = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", async () => {
      const raw = Buffer.concat(chunks);
      const url = new URL(req.url ?? "/", "http://shim");
      const path = url.pathname;
      const body = raw.length ? JSON.parse(raw.toString()) : {};
      try {
        let m: RegExpExecArray | null;
        if (req.method === "POST" && path === "/admin/api/reset") {
          await resetAndSeed(t.pool, { selfBaseUrl: t.url });
          fake.reset();
          await fake.register();
          return json(res, 200, { ok: true });
        }
        if (path === "/admin/api/config") {
          if (req.method === "PATCH") {
            if (body.offerWindowSeconds !== undefined) await t.pool.query("UPDATE bap.config SET offer_window_seconds = $1", [body.offerWindowSeconds]);
            if (body.failNextPayment !== undefined) await t.pool.query("UPDATE bap.config SET fail_next_payment = $1", [body.failNextPayment]);
          }
          const c = (await t.pool.query("SELECT offer_window_seconds, fail_next_payment, platform_fee_paise, commission_bps FROM bap.config")).rows[0];
          return json(res, 200, { offerWindowSeconds: c.offer_window_seconds, failNextPayment: c.fail_next_payment, platformFeePaise: c.platform_fee_paise, commissionBps: c.commission_bps });
        }
        if (req.method === "GET" && path === "/admin/api/ledger") {
          const rows = (await t.pool.query(
            `SELECT store_id, sum(gross_paise)::int g, sum(commission_paise)::int c, sum(net_payable_paise)::int n, sum(platform_subsidy_paise)::int s
             FROM bap.ledger_entry GROUP BY store_id ORDER BY store_id`,
          )).rows;
          return json(res, 200, {
            entries: [],
            byStore: rows.map((r) => ({ storeId: r.store_id, storeName: r.store_id, grossPaise: r.g, commissionPaise: r.c, netPayablePaise: r.n, platformSubsidyPaise: r.s })),
          });
        }
        if ((m = /^\/bpp\/merchant\/([^/]+)\/dashboard$/.exec(path)) && req.method === "GET") {
          const orders = [...fake.orders.values()].filter((o) => o.storeId === m![1]);
          return json(res, 200, {
            store: { id: m[1], isOnline: true, faults: { autoReject: false, neverAnswer: false } },
            offers: orders.filter((o) => o.state === "OFFERED").map((o) => ({ id: o.id, status: "OFFERED" })),
            orders: orders.filter((o) => o.state === "ACCEPTED").map((o) => ({ id: o.id, fulfilmentStatus: o.fulfilment })),
          });
        }
        if ((m = /^\/bpp\/merchant\/([^/]+)\/offers\/([^/]+)\/(accept|reject)$/.exec(path)) && req.method === "POST") {
          const o = fake.orders.get(m[2]!);
          if (!o || o.storeId !== m[1] || o.state !== "OFFERED" || o.expiresAt.getTime() <= Date.now()) return json(res, 409, { error: "OFFER_NOT_AVAILABLE" });
          if (m[3] === "accept") await fake.accept(o.id);
          else await fake.reject(o.id, body.reason);
          return json(res, 200, { ok: true });
        }
        if ((m = /^\/bpp\/merchant\/([^/]+)\/orders\/([^/]+)\/advance$/.exec(path)) && req.method === "POST") {
          const o = fake.orders.get(m[2]!);
          if (!o || o.storeId !== m[1]) return json(res, 404, { error: "not_found" });
          try {
            return json(res, 200, { fulfilmentStatus: await fake.advance(o.id) });
          } catch {
            return json(res, 409, { error: "INVALID_TRANSITION" });
          }
        }
        if ((m = /^\/bpp\/merchant\/([^/]+)\/store$/.exec(path)) && req.method === "PATCH") {
          fake.setOnline(m[1]!, body.isOnline !== false);
          return json(res, 200, { isOnline: body.isOnline !== false });
        }

        // everything else → the real app
        const upstream = await fetch(`${t.url}${req.url}`, {
          method: req.method,
          headers: Object.fromEntries(Object.entries(req.headers).filter(([k]) => !["host", "connection", "content-length"].includes(k)) as [string, string][]),
          body: raw.length ? raw : undefined,
        });
        res.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") ?? "application/json" });
        res.end(Buffer.from(await upstream.arrayBuffer()));
      } catch (err) {
        json(res, 500, { error: String(err) });
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}`,
    close: async () => {
      clearInterval(sweeper);
      server.closeAllConnections();
      await new Promise<void>((r) => server.close(() => r()));
    },
  };
}
