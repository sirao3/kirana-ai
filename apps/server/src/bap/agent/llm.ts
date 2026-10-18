import { FunctionCallingConfigMode, GoogleGenAI, type Content, type FunctionDeclaration } from "@google/genai";

export type { Content };

/** One model call. Returns the model's Content exactly as received (thoughtSignature and all). */
export interface Llm {
  generate(req: { contents: Content[]; allowTools: boolean; signal: AbortSignal }): Promise<Content>;
}

export function createGeminiLlm(opts: {
  apiKey: string;
  model: string;
  systemInstruction: string;
  declarations: FunctionDeclaration[];
}): Llm {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  return {
    async generate({ contents, allowTools, signal }) {
      const res = await withRetry(signal, () => ai.models.generateContent({
        model: opts.model,
        contents,
        config: {
          systemInstruction: opts.systemInstruction,
          abortSignal: signal,
          ...(allowTools
            ? {
                tools: [{ functionDeclarations: opts.declarations }],
                toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.AUTO } },
                automaticFunctionCalling: { disable: true },
              }
            : {}),
        },
      }));
      const content = res.candidates?.[0]?.content;
      if (!content) throw new Error(`gemini returned no content (${res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "unknown"})`);
      return content;
    },
  };
}

/** Gemini "high demand" spikes (503 UNAVAILABLE, or 500) are usually gone within a second or two. 429 (quota) is not retried. */
export function isTransientGeminiError(e: unknown): boolean {
  const status = (e as { status?: number })?.status;
  return status === 503 || status === 500 || /UNAVAILABLE|high demand/i.test(String((e as Error)?.message ?? ""));
}

/** Up to 2 retries with 0.8 s / 1.6 s backoff on transient errors; stops at once if the turn is aborted (20 s agent timeout). */
export async function withRetry<T>(signal: AbortSignal, fn: () => Promise<T>, delaysMs = [800, 1600]): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (attempt >= delaysMs.length || signal.aborted || !isTransientGeminiError(e)) throw e;
      await new Promise((r) => setTimeout(r, delaysMs[attempt]));
      if (signal.aborted) throw e;
    }
  }
}
