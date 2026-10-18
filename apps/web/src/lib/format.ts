export { formatINR } from "@kiranaai/shared";

/** Seconds left until an ISO time (never negative). */
export function secondsUntil(iso: string | null | undefined, now = Date.now()): number {
  if (!iso) return 0;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - now) / 1000));
}

/** "+91 98450 •••01" until the merchant accepts (PRD §13 Privacy). */
export function maskPhone(phone: string): string {
  return phone.length <= 4 ? "••••" : `${phone.slice(0, -5).replace(/\d(?=\d{2})/g, "•")}${phone.slice(-2)}`;
}

/** "1 item" / "3 items". */
export const itemsLabel = (n: number) => `${n} item${n === 1 ? "" : "s"}`;
