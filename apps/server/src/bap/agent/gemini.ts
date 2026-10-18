import { GoogleGenAI, type GoogleGenAIOptions } from "@google/genai";
import type { Config } from "../../config.js";

/** Where the Gemini clients authenticate: Vertex AI (service account / ADC, billed to the GCP project) or an AI Studio key. */
export type GeminiBackend =
  | { kind: "vertex"; project: string; location: string; liveLocation: string; googleAuthOptions?: GoogleGenAIOptions["googleAuthOptions"] }
  | { kind: "key"; apiKey: string };

/** Vertex when GEMINI_VERTEX=1 (needs GOOGLE_CLOUD_PROJECT), else the API key; null means the agent is off (manual mode). */
export function geminiBackend(config: Pick<Config, "GEMINI_VERTEX" | "GOOGLE_CLOUD_PROJECT" | "GEMINI_LOCATION" | "GEMINI_LIVE_LOCATION" | "GEMINI_API_KEY">): GeminiBackend | null {
  if (config.GEMINI_VERTEX === "1") {
    if (!config.GOOGLE_CLOUD_PROJECT) return null;
    return { kind: "vertex", project: config.GOOGLE_CLOUD_PROJECT, location: config.GEMINI_LOCATION, liveLocation: config.GEMINI_LIVE_LOCATION };
  }
  return config.GEMINI_API_KEY ? { kind: "key", apiKey: config.GEMINI_API_KEY } : null;
}

/**
 * Vertex locations differ per model (probed 18 Oct): Gemini 3.5 text models and `gemini-3.5-transcribe-live-preview`
 * are served only from `global`, `gemini-3.8-live` only from a region (us-central1). "live" gets the regional endpoint.
 */
export function genAiClient(backend: GeminiBackend, use: "text" | "transcribe" | "live"): GoogleGenAI {
  if (backend.kind === "key") return new GoogleGenAI({ apiKey: backend.apiKey });
  return new GoogleGenAI({
    vertexai: true,
    project: backend.project,
    location: use === "live" ? backend.liveLocation : backend.location,
    ...(backend.googleAuthOptions ? { googleAuthOptions: backend.googleAuthOptions } : {}),
  });
}
