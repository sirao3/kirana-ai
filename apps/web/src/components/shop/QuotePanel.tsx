import type { BasketView, StoreQuoteError } from "@kiranaai/shared";
import { Badge, Card, Countdown } from "../kit";
import { formatINR } from "../../lib/format";
import { useState } from "react";

/** Verified per-store breakdown, platform fee, grand total and validity countdown. All numbers come from the quote API. */
export function QuotePanel({ basket, errors }: { basket: BasketView; errors: StoreQuoteError[] }) {
  const [expiredNow, setExpiredNow] = useState(false);
  const q = basket.quote;
  const expired = !!q && (q.expired || expiredNow || basket.status === "EXPIRED");

  if (errors.length) {
    return (
      <Card title="Could not quote">
        <ul className="space-y-1 text-sm text-rose-800">
          {errors.map((e) => (
            <li key={`${e.storeId}-${e.code}`}>
              <b>{e.storeName}</b>: {e.message || e.code}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-xs text-stone-500">Fix the basket (remove or change the affected items) and request the quote again.</p>
      </Card>
    );
  }
  if (!q || (basket.status !== "QUOTED" && basket.status !== "EXPIRED")) return null;

  return (
    <Card
      title="Verified quote"
      actions={
        expired ? (
          <Badge tone="bad">expired</Badge>
        ) : (
          <span className="text-xs text-stone-600">
            valid for <Countdown until={q.validUntil} onDone={() => setExpiredNow(true)} />
          </span>
        )
      }
    >
      <div className="space-y-3">
        {q.stores.map((s) => (
          <div key={s.storeId} className="text-sm">
            <div className="flex justify-between font-medium">
              <span>{s.storeName}</span>
              <span className="tabular-nums">{formatINR(s.totalPaise)}</span>
            </div>
            <ul className="mt-1 space-y-0.5 text-stone-600">
              {s.lines.map((l) => (
                <li key={l.listingId} className="flex justify-between gap-2">
                  <span className={l.available ? "" : "text-rose-700 line-through"}>
                    {l.qty} × {l.name}
                    {l.priceChanged && (
                      <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-900">
                        price changed {formatINR(l.seenPricePaise)} → {formatINR(l.unitPricePaise)}
                      </span>
                    )}
                    {!l.available && <span className="ml-2 text-xs">unavailable</span>}
                  </span>
                  <span className="tabular-nums">{formatINR(l.lineTotalPaise)}</span>
                </li>
              ))}
              <li className="flex justify-between">
                <span>Delivery</span>
                <span className="tabular-nums">{s.deliveryPaise ? formatINR(s.deliveryPaise) : "free"}</span>
              </li>
            </ul>
          </div>
        ))}
        <div className="space-y-0.5 border-t border-stone-200 pt-2 text-sm">
          <Row label="Items" value={formatINR(q.itemsTotalPaise)} />
          <Row label="Delivery" value={formatINR(q.deliveryTotalPaise)} />
          <Row label="Platform fee" value={formatINR(q.platformFeePaise)} />
          <div className="flex justify-between pt-1 text-lg font-semibold">
            <span>Total</span>
            <span className="tabular-nums">{formatINR(q.grandTotalPaise)}</span>
          </div>
        </div>
      </div>
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-stone-600">
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </div>
  );
}
