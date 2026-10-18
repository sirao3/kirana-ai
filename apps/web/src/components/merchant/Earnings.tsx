import { useState } from "react";
import type { MerchantLedger } from "@kiranaai/shared";
import { api } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { useLive } from "../../lib/live";
import { Button, Card, CircularProgress, EmptyState, Icon, InlineMessage, SectionHeader, SegmentedButton, StatusLabel } from "../m3";

type Money = "grossPaise" | "commissionPaise" | "netPayablePaise" | "platformSubsidyPaise";
const KPIS: { key: Money; label: string; icon: string }[] = [
  { key: "grossPaise", label: "Gross", icon: "payments" },
  { key: "commissionPaise", label: "Commission", icon: "percent" },
  { key: "netPayablePaise", label: "Net payable", icon: "account_balance" },
  { key: "platformSubsidyPaise", label: "Platform subsidy", icon: "volunteer_activism" },
];

const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

/** Merchant Earnings (UX-11): stat tiles + one row per delivered order, from this store's ledger. */
export function Earnings({ storeId, token }: { storeId: string; token: string }) {
  const q = useLive<MerchantLedger>(["merchant-ledger", storeId], () => api(`/bpp/merchant/${storeId}/ledger`, { token }));
  const [range, setRange] = useState<"today" | "all">("today");

  if (q.isError && !q.data) {
    return (
      <InlineMessage tone="error" action={<Button variant="text" onClick={() => void q.refetch()}>Retry</Button>}>
        Could not load earnings ({(q.error as Error).message}).
      </InlineMessage>
    );
  }
  if (!q.data) return <div className="flex items-center gap-3 py-8 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading earnings…</div>;

  const entries = range === "today" ? q.data.entries.filter((e) => sameDay(e.createdAt)) : q.data.entries;
  const sum = (k: Money) => entries.reduce((s, e) => s + e[k], 0);

  return (
    <div className="max-w-3xl space-y-4">
      <SegmentedButton
        label="Period"
        value={range}
        onChange={setRange}
        options={[{ value: "today", label: "Today" }, { value: "all", label: "All time" }]}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Card key={k.key} variant="filled" className="p-4">
            <p className="flex items-center gap-2 type-label-large text-on-surface-variant"><Icon name={k.icon} size={18} />{k.label}</p>
            <p className="mt-1 type-headline-small tabular-nums text-on-surface">{formatINR(sum(k.key))}</p>
          </Card>
        ))}
      </div>
      {entries.length === 0 ? (
        <Card variant="outlined">
          <EmptyState icon="account_balance_wallet" title={range === "today" ? "No deliveries settled today" : "No deliveries settled yet"}>
            Each delivered order appears here with your commission and net payout.
          </EmptyState>
        </Card>
      ) : (
        <Card variant="outlined" className="overflow-hidden">
          <SectionHeader className="p-4" title="Delivered orders" subtitle={`${entries.length} ${entries.length === 1 ? "order" : "orders"}`} />
          <ul>
            {entries.map((e) => (
              <li key={e.id} className="flex items-center gap-4 border-t border-outline-variant px-4 py-3">
                <Icon name="receipt_long" className="text-on-surface-variant" />
                <div className="min-w-0 flex-1">
                  <p className="type-body-large text-on-surface">Order {e.subOrderId.slice(-6)} <span className="type-body-small text-on-surface-variant">· {timeOf(e.createdAt)}</span></p>
                  <p className="type-body-medium text-on-surface-variant">
                    Gross {formatINR(e.grossPaise)}{e.commissionPaise ? ` − commission ${formatINR(e.commissionPaise)}` : ""}
                  </p>
                  {e.platformSubsidyPaise > 0 && <StatusLabel tone="success" icon="volunteer_activism" className="mt-1">Includes {formatINR(e.platformSubsidyPaise)} platform credit</StatusLabel>}
                </div>
                <span className="type-title-medium tabular-nums text-on-surface">{formatINR(e.netPayablePaise)}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
