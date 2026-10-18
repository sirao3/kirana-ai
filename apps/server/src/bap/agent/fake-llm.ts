import type { Content, Llm } from "./llm.js";

type Part = NonNullable<Content["parts"]>[number];

/**
 * Dev-only scripted model (AGENT_FAKE=1): runs the demo flow search -> plan -> set -> quote -> approval
 * with a short pause per model call, so the live step list can be seen without calling Gemini.
 */
export function createFakeLlm(delayMs = 900): Llm {
  const call = (name: string, args: Record<string, unknown> = {}): Content => ({ role: "model", parts: [{ functionCall: { name, args } }] });
  return {
    async generate({ contents, signal }) {
      await new Promise((r) => setTimeout(r, delayMs));
      if (signal.aborted) throw new Error("aborted");
      // Tool responses of the current turn = everything after the last user text message.
      let start = 0;
      contents.forEach((c, i) => {
        if (c.role === "user" && c.parts?.some((p) => typeof p.text === "string")) start = i;
      });
      const responses: Part[] = contents.slice(start).flatMap((c) => (c.parts ?? []).filter((p) => p.functionResponse));
      const outputOf = (name: string) =>
        (responses.find((p) => p.functionResponse?.name === name)?.functionResponse?.response as { output?: Record<string, unknown> } | undefined)?.output;
      const step = responses.length;
      switch (step) {
        case 0:
          return call("search_products", { query: "atta" });
        case 1:
          return call("plan_basket", {
            needs: [{ query: "atta", qty: 1 }, { query: "toor dal", qty: 2 }, { query: "milk", qty: 4 }, { query: "tea", qty: 1 }],
          });
        case 2: {
          const choices = (outputOf("plan_basket")?.choices ?? []) as { listing_id: string; qty: number }[];
          return call("set_basket", { items: choices.map((c) => ({ listing_id: c.listing_id, qty: c.qty })) });
        }
        case 3:
          return call("get_quote");
        case 4:
          return call("request_approval");
        default:
          return { role: "model", parts: [{ text: "I picked the stores for your list and quoted it. Review the total and press Approve, then Pay. (scripted dev agent)" }] };
      }
    },
  };
}
