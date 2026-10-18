import { describe, expect, it } from "vitest";
import { concat, downsample, level, pcm16Base64 } from "./voice";

const int16s = (b64: string) => {
  const bin = atob(b64);
  const view = new DataView(new Uint8Array([...bin].map((c) => c.charCodeAt(0))).buffer);
  return Array.from({ length: bin.length / 2 }, (_, i) => view.getInt16(i * 2, true));
};

describe("voice PCM helpers (UX-12)", () => {
  it("downsamples 48 kHz to 16 kHz by averaging each window", () => {
    const input = Float32Array.from([0, 0.3, 0.6, 0.9, 0.9, 0.9, -1, -1, -1]);
    const out = downsample(input, 48_000);
    expect(out.length).toBe(3);
    expect(Array.from(out).map((x) => +x.toFixed(2))).toEqual([0.3, 0.9, -1]);
    expect(downsample(input, 16_000)).toBe(input);
    expect(downsample(new Float32Array(44_100), 44_100).length).toBe(16_000);
  });

  it("encodes little-endian Int16, clamping out-of-range samples", () => {
    expect(int16s(pcm16Base64(Float32Array.from([0, 1, -1, 0.5, 2, -2])))).toEqual([0, 32767, -32768, 16383, 32767, -32768]);
    // 1 s at 16 kHz = 32,000 bytes, the size the server's 0.3–30 s check is based on.
    expect(atob(pcm16Base64(new Float32Array(16_000))).length).toBe(32_000);
  });

  it("concatenates chunks and maps loudness to 0..1", () => {
    expect(Array.from(concat([Float32Array.from([1, 2]), Float32Array.from([3])]))).toEqual([1, 2, 3]);
    expect(level(new Float32Array(128))).toBe(0);
    expect(level(new Float32Array(128).fill(0.05))).toBeGreaterThan(0.4);
    expect(level(new Float32Array(128).fill(1))).toBe(1);
  });
});
