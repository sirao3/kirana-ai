import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp } from "./helpers.js";

describe("health", () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  beforeAll(async () => {
    t = await startTestApp();
  });
  afterAll(() => t.close());

  it("reports db ok", async () => {
    const res = await fetch(`${t.url}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok", db: "ok" });
  });

  it("returns JSON 404 for unknown API routes", async () => {
    const res = await fetch(`${t.url}/bap/nope`);
    expect(res.status).toBe(404);
  });
});

describe("SPA routes vs API prefixes", () => {
  it("serves the web app for /admin and /wall but JSON for /admin/api", async () => {
    const t = await startTestApp({ WEB_DIST: new URL("../../web/dist", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1") });
    try {
      for (const p of ["/admin", "/wall", "/shop/orders/bsk_1"]) {
        const r = await fetch(`${t.url}${p}`);
        expect(r.headers.get("content-type")).toContain("text/html");
      }
      expect((await fetch(`${t.url}/admin/api/whoami`)).status).toBe(401);
    } finally {
      await t.close();
    }
  });
});
