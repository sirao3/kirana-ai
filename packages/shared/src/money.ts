/** Money is integer paise everywhere except Beckn payloads (rupee strings) and the UI. */
export type Paise = number;

export function assertPaise(n: number): Paise {
  if (!Number.isSafeInteger(n)) throw new Error(`not integer paise: ${n}`);
  return n;
}

/** "123.45" | "123" | "123.5" → 12345. Rejects more than 2 decimals. */
export function rupeesToPaise(rupees: string): Paise {
  const m = /^(-)?(\d+)(?:\.(\d{1,2}))?$/.exec(rupees.trim());
  if (!m) throw new Error(`bad rupee amount: ${rupees}`);
  const paise = Number(m[2]) * 100 + Number((m[3] ?? "").padEnd(2, "0"));
  return m[1] ? -paise : paise;
}

/** 12345 → "123.45" (Beckn/ONDC price.value format). */
export function paiseToRupees(paise: Paise): string {
  assertPaise(paise);
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(paise);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** 12345 → "₹123.45"; whole rupees drop the decimals: 47000 → "₹470". */
export function formatINR(paise: Paise): string {
  const abs = Math.abs(paise);
  const whole = Math.floor(abs / 100).toLocaleString("en-IN");
  const frac = abs % 100 ? `.${String(abs % 100).padStart(2, "0")}` : "";
  return `${paise < 0 ? "-" : ""}₹${whole}${frac}`;
}
