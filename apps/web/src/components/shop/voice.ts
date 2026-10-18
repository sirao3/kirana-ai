import { useCallback, useEffect, useRef, useState } from "react";
import { MAX_VOICE_SECONDS, VOICE_MIME_TYPE, type AgentVoiceAudio } from "@kiranaai/shared";

/** Gemini Live takes 16 kHz mono 16-bit PCM; we record at the device rate and convert in the browser (no server decoding). */
export const VOICE_RATE = 16_000;
/** Shorter recordings are dropped as accidental taps (the server needs ~0.3 s). */
export const MIN_VOICE_SECONDS = 0.5;

/** Averages each output sample's window (a cheap low-pass) while decimating from `inRate` to 16 kHz. */
export function downsample(input: Float32Array, inRate: number, outRate = VOICE_RATE): Float32Array {
  if (inRate === outRate) return input;
  const ratio = inRate / outRate;
  const out = new Float32Array(Math.floor(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const from = Math.floor(i * ratio);
    const to = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = from; j < to; j++) sum += input[j]!;
    out[i] = to > from ? sum / (to - from) : 0;
  }
  return out;
}

/** Float [-1, 1] → little-endian Int16 → base64. */
export function pcm16Base64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function concat(chunks: Float32Array[]): Float32Array {
  const out = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

/** RMS of a chunk mapped to 0..1 for the level meter (speech sits around 0.02–0.2 RMS). */
export function level(chunk: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < chunk.length; i++) sum += chunk[i]! * chunk[i]!;
  const rms = Math.sqrt(sum / Math.max(1, chunk.length));
  return Math.min(1, Math.sqrt(rms * 6));
}

export function voiceSupported(): boolean {
  return typeof window !== "undefined" && window.isSecureContext && !!navigator.mediaDevices?.getUserMedia && typeof AudioWorkletNode !== "undefined";
}

// Copies each 128-sample input block to the main thread.
const WORKLET = `class Capture extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0] && inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
}
registerProcessor("kiranaai-capture", Capture);`;

export type VoiceState = "idle" | "starting" | "recording" | "denied" | "error";

/**
 * Tap-to-toggle recorder. `stop()` resolves with the recording as 16 kHz PCM (null if too short or cancelled).
 * Stops by itself at MAX_VOICE_SECONDS and calls `onAutoStop` with the audio.
 */
export function useVoiceRecorder(onAutoStop: (audio: AgentVoiceAudio, seconds: number) => void) {
  const [state, setState] = useState<VoiceState>("idle");
  const [lvl, setLvl] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const rec = useRef<{ ctx: AudioContext; stream: MediaStream; chunks: Float32Array[]; samples: number; rate: number } | null>(null);
  const autoStop = useRef(onAutoStop);
  autoStop.current = onAutoStop;

  const teardown = useCallback(() => {
    const r = rec.current;
    rec.current = null;
    if (!r) return null;
    r.stream.getTracks().forEach((t) => t.stop());
    void r.ctx.close().catch(() => undefined);
    return r;
  }, []);

  const finish = useCallback((): { audio: AgentVoiceAudio; seconds: number } | null => {
    const r = teardown();
    setLvl(0);
    setSeconds(0);
    setState("idle");
    if (!r) return null;
    const secs = r.samples / r.rate;
    if (secs < MIN_VOICE_SECONDS) return null;
    const pcm = downsample(concat(r.chunks), r.rate).subarray(0, MAX_VOICE_SECONDS * VOICE_RATE);
    return { audio: { mimeType: VOICE_MIME_TYPE, data: pcm16Base64(pcm) }, seconds: Math.min(MAX_VOICE_SECONDS, secs) };
  }, [teardown]);

  const start = useCallback(async () => {
    if (rec.current) return;
    setState("starting");
    let stream: MediaStream | undefined;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const ctx = new AudioContext();
      const url = URL.createObjectURL(new Blob([WORKLET], { type: "text/javascript" }));
      try {
        await ctx.audioWorklet.addModule(url);
      } finally {
        URL.revokeObjectURL(url);
      }
      const src = ctx.createMediaStreamSource(stream);
      const node = new AudioWorkletNode(ctx, "kiranaai-capture");
      const r = { ctx, stream, chunks: [] as Float32Array[], samples: 0, rate: ctx.sampleRate };
      let lastUi = 0;
      node.port.onmessage = (e: MessageEvent<Float32Array>) => {
        if (rec.current !== r) return;
        r.chunks.push(e.data);
        r.samples += e.data.length;
        const now = performance.now();
        if (now - lastUi > 80) {
          lastUi = now;
          setLvl(level(e.data));
          setSeconds(r.samples / r.rate);
        }
        if (r.samples / r.rate >= MAX_VOICE_SECONDS) {
          const out = finish();
          if (out) autoStop.current(out.audio, out.seconds);
        }
      };
      src.connect(node);
      // Keep the graph pulling without playing the mic back: route through a muted gain.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      node.connect(mute).connect(ctx.destination);
      rec.current = r;
      setState("recording");
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      const name = (e as { name?: string })?.name;
      setState(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "error");
    }
  }, [finish]);

  const cancel = useCallback(() => {
    teardown();
    setLvl(0);
    setSeconds(0);
    setState("idle");
  }, [teardown]);

  const dismiss = useCallback(() => setState((s) => (s === "denied" || s === "error" ? "idle" : s)), []);

  useEffect(() => () => void teardown(), [teardown]);

  return { state, level: lvl, seconds, start, stop: finish, cancel, dismiss };
}
