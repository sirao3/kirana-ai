import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startHarness, type BapHarness } from "./fixtures/harness.js";
import { startShim } from "./fixtures/shim-server.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * Runs scripts/e2e-demo.ts (T16) for real, over HTTP, against this branch's BAP + the fake BPP. Lane A's merchant/admin
 * APIs are replaced by a test shim that implements their LANES.md contracts; the integrator runs the script against
 * the merged app (`pnpm e2e --url … --passcode …`).
 */
describe("scripts/e2e-demo.ts against the fake BPP (T16)", () => {
  let h: BapHarness;
  let shim: Awaited<ReturnType<typeof startShim>>;
  beforeAll(async () => {
    process.env.PAYMENT_SETTLE_MS = "50";
    h = await startHarness();
    shim = await startShim(h);
  });
  afterAll(async () => {
    await shim.close();
    await h.close();
  });

  const run = () =>
    new Promise<{ code: number | null; out: string }>((resolve) => {
      const p = spawn(process.execPath, ["--import", "tsx", "scripts/e2e-demo.ts", "--url", shim.url, "--passcode", "demo", "--window", "4"], { cwd: repoRoot });
      let out = "";
      p.stdout.on("data", (d) => (out += d));
      p.stderr.on("data", (d) => (out += d));
      p.on("close", (code) => resolve({ code, out }));
    });

  it("passes, twice in a row", async () => {
    for (let i = 0; i < 2; i++) {
      const r = await run();
      if (r.code !== 0) console.error(r.out);
      expect(r.code).toBe(0);
      expect(r.out).toContain("PASS: PRD §14 scenario reproduced");
    }
  }, 120_000);
});
