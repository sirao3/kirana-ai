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
