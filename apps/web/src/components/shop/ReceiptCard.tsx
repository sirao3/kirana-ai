import type { OrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Button, C, IPrint, IUpload, cardShadow } from "../ui";
import { useSnackbar } from "../ui/toast";
import { buildReceipt, receiptText } from "./receipt";

/** Settled-order receipt: per store, refunds, platform-covered difference, total. Share + Print (see `.print-area` in index.css). */
export function ReceiptCard({ order: o }: { order: OrderView }) {
  const r = buildReceipt(o);
  const snack = useSnackbar();

  const share = async () => {
    const text = receiptText(o);
    try {
      if (typeof navigator.share === "function") {
        await navigator.share({ title: "KiranaAI receipt", text });
        return;
      }
      await navigator.clipboard.writeText(text);
      snack("Receipt copied to clipboard");
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // closed the share sheet
      snack("Could not share the receipt. Try Print instead.");
    }
  };

  return (
    <section aria-labelledby="receipt-title" className="print-area bg-white" style={{ borderRadius: 22, padding: 18, boxShadow: cardShadow }}>
      <div className="flex items-center justify-between gap-3">
        <h2 id="receipt-title" className="text-[17px] font-semibold" style={{ color: C.label }}>Receipt</h2>
        <div className="no-print flex gap-1.5">
          <Button size="sm" variant="secondary" icon={<IUpload size={15} />} onClick={() => void share()}>Share</Button>
          <Button size="sm" variant="secondary" icon={<IPrint size={15} />} onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <p className="mt-0.5 break-all text-[12px]" style={{ color: C.secondary }}>Order {o.basketId}</p>
      <ul className="mt-3" aria-label="Stores">
        {r.rows.map((x) => (
          <li key={x.id} className="flex items-start justify-between gap-3 py-2.5" style={{ borderTop: `0.5px solid ${C.sep}` }}>
            <div className="min-w-0">
              <p className="text-[15px]" style={{ color: C.label }}>{x.finalStore ?? x.approvedStore}</p>
              <p className="text-[12px]" style={{ color: C.secondary }}>
                {x.status}{x.finalStore ? ` · reassigned from ${x.approvedStore}` : ""}
              </p>
              {x.coveredPaise > 0 && <p className="text-[12px]" style={{ color: C.green }}>KiranaAI covered {formatINR(x.coveredPaise)} of the price difference</p>}
            </div>
            <span className="text-[15px]" style={{ color: C.label, fontVariantNumeric: "tabular-nums" }}>{formatINR(x.approvedPaise)}</span>
          </li>
        ))}
      </ul>
      <dl className="space-y-1 pt-2.5 text-[14px]" style={{ borderTop: `0.5px solid ${C.sep}` }}>
        {r.refundedPaise > 0 && (
          <div className="flex justify-between" style={{ color: C.secondary }}><dt>Refunded</dt><dd style={{ fontVariantNumeric: "tabular-nums" }}>−{formatINR(r.refundedPaise)}</dd></div>
        )}
        {r.coveredPaise > 0 && (
          <div className="flex justify-between" style={{ color: C.green }}><dt>Covered by KiranaAI (not charged to you)</dt><dd style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(r.coveredPaise)}</dd></div>
        )}
        <div className="flex items-baseline justify-between pt-1" style={{ color: C.label }}>
          <dt className="text-[15px] font-semibold">Total paid</dt>
          <dd className="text-[22px] font-bold tracking-[-0.02em]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatINR(r.netPaise)}</dd>
        </div>
      </dl>
    </section>
  );
}
