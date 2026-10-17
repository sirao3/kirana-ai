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
      const res = await ai.models.generateContent({
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
      });
      const content = res.candidates?.[0]?.content;
      if (!content) throw new Error(`gemini returned no content (${res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? "unknown"})`);
      return content;
    },
  };
}
