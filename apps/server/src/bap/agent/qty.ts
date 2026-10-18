/**
 * Deterministic check (no LLM): did the customer's own message state this quantity for this need?
 * Used to mark plan choices `qtyInferred` so the UI can ask the customer to confirm guessed numbers.
 */

const WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12, dozen: 12,
  ek: 1, teen: 3, char: 4, chaar: 4, paanch: 5, panch: 5, chhe: 6, saat: 7, aath: 8, nau: 9, das: 10,
};

const STOP = new Set(["the", "and", "for", "of", "kg", "ltr", "litre", "liter", "pack", "packs", "packet", "packets"]);

function numbersIn(clause: string): number[] {
  const out: number[] = [];
  for (const m of clause.matchAll(/\d+(?:\.\d+)?|[a-z]+/g)) {
    const t = m[0];
    const n = /^\d/.test(t) ? Number(t) : WORDS[t];
    if (n !== undefined && Number.isFinite(n)) out.push(n);
  }
  return out;
}

/** Clauses of the message that mention any significant word of the need's query. */
function clausesFor(message: string, query: string): string[] {
  const words = query.toLowerCase().split(/[^a-zऀ-ॿ]+/).filter((w) => w.length >= 3 && !STOP.has(w));
  if (!words.length) return [];
  const clauses = message.toLowerCase().split(/[,;.\n&+]|\band\b|\baur\b|\bwith\b|\bplus\b/);
  return clauses.filter((c) => words.some((w) => c.includes(w)));
}

/** True when `qty` appears as a number in the part of the message that talks about this need. */
export function qtyStatedByCustomer(message: string, query: string, qty: number): boolean {
  return clausesFor(message, query).some((c) => numbersIn(c).includes(qty));
}
