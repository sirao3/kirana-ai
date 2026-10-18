import type { OrderView, SubOrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { priceProtection } from "./handoff";

export interface ReceiptRow {
  id: string;
  /** Store the customer approved. */
  approvedStore: string;
  /** Store that actually fulfilled it, when different (reassigned). */
  finalStore: string | null;
  approvedPaise: number;
  status: "Delivered" | "Refunded" | "In progress";
  refundPaise: number;
  /** Difference KiranaAI covered; matches the ledger subsidy once delivered. */
  coveredPaise: number;
}

export interface Receipt {
  rows: ReceiptRow[];
  paidPaise: number;
  refundedPaise: number;
  netPaise: number;
  coveredPaise: number;
}

function row(s: SubOrderView): ReceiptRow {
  const final = s.currentStoreName && s.currentStoreName !== s.approvedStoreName ? s.currentStoreName : null;
  const status = s.status === "DELIVERED" ? "Delivered" : s.status === "FAILED_NO_FULFILMENT" ? "Refunded" : "In progress";
  return {
    id: s.id,
    approvedStore: s.approvedStoreName,
    finalStore: final,
    approvedPaise: s.approvedAmountPaise,
    status,
    refundPaise: s.refundPaise ?? 0,
    coveredPaise: s.status === "DELIVERED" ? (priceProtection(s)?.coveredPaise ?? 0) : 0,
  };
}

export function buildReceipt(o: OrderView): Receipt {
  const rows = o.subOrders.map(row);
  return {
    rows,
    paidPaise: o.grandTotalPaise,
    refundedPaise: o.refundedPaise,
    netPaise: o.grandTotalPaise - o.refundedPaise,
    coveredPaise: rows.reduce((n, r) => n + r.coveredPaise, 0),
  };
}

/** Plain-text receipt for Share / clipboard. */
export function receiptText(o: OrderView): string {
  const r = buildReceipt(o);
  const lines = ["KiranaAI receipt", `Order ${o.basketId}`, ""];
  for (const x of r.rows) {
    const via = x.finalStore ? ` (fulfilled by ${x.finalStore})` : "";
    lines.push(`${x.approvedStore}${via}: ${formatINR(x.approvedPaise)}, ${x.status.toLowerCase()}${x.refundPaise ? `, ${formatINR(x.refundPaise)} refunded` : ""}`);
  }
  lines.push("");
  if (r.refundedPaise) lines.push(`Refunded: ${formatINR(r.refundedPaise)}`);
  if (r.coveredPaise) lines.push(`Price difference covered by KiranaAI: ${formatINR(r.coveredPaise)}`);
  lines.push(`Total paid: ${formatINR(r.netPaise)}`);
  return lines.join("\n");
}
