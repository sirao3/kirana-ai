import { describe, expect, it } from "vitest";
import { isTransientGeminiError, withRetry } from "../src/bap/agent/llm.js";

const err = (status: number, message = "x") => Object.assign(new Error(message), { status });

describe("Gemini retry", () => {
  it("retries 503 high-demand errors, then succeeds", async () => {
    let calls = 0;
    const r = await withRetry(new AbortController().signal, async () => {
      if (++calls < 3) throw err(503, "This model is currently experiencing high demand.");
      return "ok";
    }, [1, 1]);
    expect(r).toBe("ok");
    expect(calls).toBe(3);
  });

  it("gives up after the retries and rethrows", async () => {
    let calls = 0;
    await expect(withRetry(new AbortController().signal, async () => { calls++; throw err(503); }, [1, 1])).rejects.toThrow();
    expect(calls).toBe(3);
  });

  it("does not retry quota (429) or client errors", async () => {
    let calls = 0;
    await expect(withRetry(new AbortController().signal, async () => { calls++; throw err(429, "RESOURCE_EXHAUSTED"); }, [1, 1])).rejects.toThrow();
    expect(calls).toBe(1);
    expect(isTransientGeminiError(err(400))).toBe(false);
  });

  it("stops when the turn is aborted", async () => {
    const ac = new AbortController();
    ac.abort();
    let calls = 0;
    await expect(withRetry(ac.signal, async () => { calls++; throw err(503); }, [1, 1])).rejects.toThrow();
    expect(calls).toBe(1);
  });
});
