import type { OrderView } from "@kiranaai/shared";
import { formatINR } from "../../lib/format";
import { Button, Card, Divider, Icon, StatusLabel, useSnackbar } from "../m3";
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
      if ((e as Error).name === "AbortError") return; // user closed the share sheet
      snack("Could not share the receipt. Try Print instead.");
    }
  };

  return (
    <Card variant="outlined" className="print-area p-5" aria-labelledby="receipt-title">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="receipt-title" className="flex items-center gap-2 type-title-large text-on-surface">
          <Icon name="receipt_long" className="text-primary" /> Receipt
        </h2>
        <div className="no-print flex gap-2">
          <Button variant="tonal" icon="share" onClick={() => void share()}>Share</Button>
          <Button variant="outlined" icon="print" onClick={() => window.print()}>Print</Button>
        </div>
      </div>
      <p className="mt-1 break-all type-body-small text-on-surface-variant">Order {o.basketId}</p>

      <ul className="mt-3 divide-y divide-outline-variant" aria-label="Stores">
        {r.rows.map((x) => (
          <li key={x.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3">
            <div className="min-w-0 flex-1">
              <p className="type-body-large text-on-surface">{x.finalStore ?? x.approvedStore}</p>
              {x.finalStore && <p className="type-body-small text-on-surface-variant">Reassigned from {x.approvedStore}</p>}
              {x.coveredPaise > 0 && <p className="type-body-small text-success">KiranaAI covered {formatINR(x.coveredPaise)} of the price difference</p>}
            </div>
            <span className="type-body-large tabular-nums text-on-surface">{formatINR(x.approvedPaise)}</span>
            <StatusLabel tone={x.status === "Delivered" ? "success" : x.status === "Refunded" ? "warning" : "neutral"} icon={x.status === "Delivered" ? "check_circle" : x.status === "Refunded" ? "currency_exchange" : "hourglass_top"}>
              {x.status}
            </StatusLabel>
          </li>
        ))}
      </ul>

      <Divider />
      <dl className="mt-3 space-y-1 type-body-medium">
        {r.refundedPaise > 0 && (
          <div className="flex justify-between text-on-surface-variant">
            <dt>Refunded</dt>
            <dd className="tabular-nums">−{formatINR(r.refundedPaise)}</dd>
          </div>
        )}
        {r.coveredPaise > 0 && (
          <div className="flex justify-between text-success">
            <dt>Covered by KiranaAI (not charged to you)</dt>
            <dd className="tabular-nums">{formatINR(r.coveredPaise)}</dd>
          </div>
        )}
        <div className="flex items-baseline justify-between pt-1 text-on-surface">
          <dt className="type-title-medium">Total paid</dt>
          <dd className="type-headline-small tabular-nums">{formatINR(r.netPaise)}</dd>
        </div>
      </dl>
    </Card>
  );
}
