import { GoogleGenAI, Modality, type FunctionCall, type FunctionDeclaration, type FunctionResponse, type LiveServerMessage, type Session } from "@google/genai";
import { VOICE_MIME_TYPE } from "@kiranaai/shared";
import type { Content, Llm } from "./llm.js";

/** Voice input (UX-12): raw 16-bit little-endian PCM, 16 kHz mono, base64. The browser records it in this format. */
export const VOICE_MIME = VOICE_MIME_TYPE;
export const VOICE_BYTES_PER_SECOND = 32_000;

export interface VoiceAudio {
  mimeType: string;
  data: string;
}

/**
 * One voice turn on a Gemini Live model: history + recorded audio in, tool calls out (answered by the caller with the
 * same allowlisted tools as the text agent), transcripts back. Live models only emit audio, so the reply text is the
 * model's output transcription; the audio itself is dropped.
 */
export interface LiveAgent {
  run(req: {
    history: Content[];
    audio: VoiceAudio;
    signal: AbortSignal;
    /** Called as the input transcription grows, before any tool call that follows it. */
    onTranscript?: (soFar: string) => void;
    onToolCalls: (calls: FunctionCall[]) => Promise<FunctionResponse[]>;
  }): Promise<{ transcript: string; text: string }>;
}

const VOICE_ADDENDUM = `

The customer is speaking to you; your words are transcribed and shown on screen, not played. Keep replies to two or three short sentences. Amounts in rupees as digits (₹1,400). If the customer speaks Hindi or Hinglish, reply in Hinglish written in Roman (Latin) letters, the way they would type it, not in Devanagari. Go straight through the steps (plan, set the basket, quote, request approval) without asking for permission in between; the customer reviews everything on the approval card.`;

/** Silence from the model this long (while not waiting on our tools) counts as a stalled session. */
const STALL_MS = 12_000;

class LiveStallError extends Error {
  constructor(readonly toolsRan: boolean) {
    super("gemini live stalled");
  }
}

const HISTORY_TURNS = 12;
const CHUNK_BYTES = 64_000;

/** Text-only copy of the recent history: Live sessions take it as client content (no tool calls or thought signatures). */
export function textHistory(history: Content[], maxTurns = HISTORY_TURNS): Content[] {
  const out: Content[] = [];
  for (const c of history) {
    const text = (c.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
    if (text) out.push({ role: c.role === "model" ? "model" : "user", parts: [{ text }] });
  }
  return out.slice(-maxTurns);
}

export function createGeminiLive(opts: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  declarations: FunctionDeclaration[];
  stallMs?: number;
  /** LIVE_DEBUG=1: log the server message sequence to stderr. */
  debug?: boolean;
}): LiveAgent {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  const stallMs = opts.stallMs ?? STALL_MS;
  const log = (...a: unknown[]) => opts.debug && console.error("[live]", ...a);

  /** One Live session. Rejects with LiveStallError if the model goes quiet; resolves with a partial result if it stalls after tools ran. */
  async function once({ history, audio, signal, onTranscript, onToolCalls }: Parameters<LiveAgent["run"]>[0]): Promise<{ transcript: string; text: string }> {
    const t0 = Date.now();
    let transcript = "";
    const said: string[] = [""];
    let toolThisTurn = false;
    let toolsRan = false;
    let toolsRunning = 0;
    let lastActivity = Date.now();
    let session: Session | undefined;
    let settle!: { ok: () => void; fail: (e: Error) => void };
    const finished = new Promise<void>((ok, fail) => (settle = { ok, fail }));
    let ready!: () => void;
    const setup = new Promise<void>((r) => (ready = r));
    let over = false;
    const end = (e?: Error) => {
      if (over) return;
      over = true;
      if (e) settle.fail(e);
      else settle.ok();
    };
    const result = () => ({ transcript: transcript.trim(), text: said.map((s) => s.trim()).filter(Boolean).join("\n") });

    const onmessage = (m: LiveServerMessage) => {
      lastActivity = Date.now();
      const sc = m.serverContent;
      if (opts.debug) {
        const kinds = [m.setupComplete && "setup", sc?.inputTranscription?.text && "in", sc?.outputTranscription?.text && "out", sc?.modelTurn && "modelTurn", m.toolCall && `toolCall(${m.toolCall.functionCalls?.map((c) => c.name).join(",")})`, m.toolCallCancellation && "toolCancel", sc?.generationComplete && "genComplete", sc?.turnComplete && "turnComplete", sc?.interrupted && "interrupted", m.goAway && "goAway"].filter(Boolean);
        if (kinds.some((k) => k !== "in" && k !== "out" && k !== "modelTurn")) log(((Date.now() - t0) / 1000).toFixed(2), kinds.join(" "), `said=${said.at(-1)!.length + (sc?.outputTranscription?.text?.length ?? 0)}`);
      }
      if (m.setupComplete) ready();
      if (sc?.inputTranscription?.text) {
        transcript += sc.inputTranscription.text;
        onTranscript?.(transcript.trim());
      }
      if (sc?.outputTranscription?.text) said[said.length - 1] += sc.outputTranscription.text;
      if (m.toolCall?.functionCalls?.length) {
        toolThisTurn = true;
        toolsRan = true;
        toolsRunning++;
        onToolCalls(m.toolCall.functionCalls).then(
          (functionResponses) => {
            toolsRunning--;
            lastActivity = Date.now();
            if (!over) session?.sendToolResponse({ functionResponses });
          },
          (e: unknown) => end(e instanceof Error ? e : new Error(String(e))),
        );
      }
      // The reply text is complete at generationComplete; turnComplete only follows once the spoken audio has streamed
      // (~10 s for a 3-sentence reply, measured 18 Oct). We drop the audio, so finish early (grace for late transcript pieces).
      if (sc?.generationComplete && !toolThisTurn && !m.toolCall) setTimeout(() => end(), 300);
      if (sc?.turnComplete) {
        said.push("");
        // A turn that ended in a tool call continues once the tool response is sent.
        if (toolThisTurn) toolThisTurn = false;
        else end();
      }
    };

    const onAbort = () => end(new Error("aborted"));
    signal.addEventListener("abort", onAbort, { once: true });
    const watchdog = setInterval(() => {
      if (toolsRunning > 0 || Date.now() - lastActivity < stallMs) return;
      log("stalled", { toolsRan, transcript: transcript.trim() });
      // Tools already changed the basket: hand back what we have rather than failing the whole turn.
      if (toolsRan) end();
      else end(new LiveStallError(false));
    }, 500);
    try {
      session = await ai.live.connect({
        model: opts.model,
        config: {
          responseModalities: [Modality.AUDIO],
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: opts.systemInstruction + VOICE_ADDENDUM,
          tools: [{ functionDeclarations: opts.declarations }],
          // We send the whole recording at once, so mark the speech boundaries ourselves instead of waiting for silence detection.
          realtimeInputConfig: { automaticActivityDetection: { disabled: true } },
        },
        callbacks: {
          onmessage,
          onerror: (e) => end(new Error(`gemini live error: ${e.message ?? "unknown"}`)),
          onclose: (e) => end(new Error(`gemini live closed (${e.code}${e.reason ? `: ${e.reason}` : ""})`)),
        },
      });
      if (signal.aborted) throw new Error("aborted");
      await Promise.race([setup, finished]);

      const turns = textHistory(history);
      if (turns.length) session.sendClientContent({ turns, turnComplete: false });
      const pcm = Buffer.from(audio.data, "base64");
      session.sendRealtimeInput({ activityStart: {} });
      for (let i = 0; i < pcm.length; i += CHUNK_BYTES) {
        session.sendRealtimeInput({ audio: { data: pcm.subarray(i, i + CHUNK_BYTES).toString("base64"), mimeType: audio.mimeType } });
      }
      session.sendRealtimeInput({ activityEnd: {} });
      lastActivity = Date.now();
      log("audio sent", { bytes: pcm.length, history: turns.length });

      await finished;
      log("done", ((Date.now() - t0) / 1000).toFixed(2));
      return result();
    } finally {
      over = true; // ignore the close event we cause below
      clearInterval(watchdog);
      signal.removeEventListener("abort", onAbort);
      session?.close();
    }
  }

  return {
    async run(req) {
      try {
        return await once(req);
      } catch (e) {
        // Nothing ran yet, so a fresh session is safe; one retry only (the turn has a 40 s budget).
        if (!(e instanceof LiveStallError) || e.toolsRan || req.signal.aborted) throw e;
        log("retrying after stall");
        return await once(req);
      }
    },
  };
}

/**
 * AGENT_FAKE / tests: runs a text model as if it were the Live agent, with a fixed transcript standing in for speech
 * recognition. Uses the same tool round-trips, so the voice route can be tested without audio or Gemini.
 */
export function createLiveFromLlm(llm: Llm, transcript: string): LiveAgent {
  return {
    async run({ history, signal, onTranscript, onToolCalls }) {
      onTranscript?.(transcript);
      const contents: Content[] = [...textHistory(history), { role: "user", parts: [{ text: transcript }] }];
      for (let round = 0; round < 12; round++) {
        const c = await llm.generate({ contents, allowTools: true, signal });
        contents.push(c);
        const calls = (c.parts ?? []).flatMap((p) => (p.functionCall ? [p.functionCall] : []));
        if (!calls.length) {
          const text = (c.parts ?? []).filter((p) => !p.thought && typeof p.text === "string").map((p) => p.text).join("").trim();
          return { transcript, text };
        }
        const responses = await onToolCalls(calls);
        contents.push({ role: "user", parts: responses.map((r) => ({ functionResponse: r })) });
      }
      return { transcript, text: "" };
    },
  };
}
