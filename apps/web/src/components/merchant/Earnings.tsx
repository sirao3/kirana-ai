import { useState } from "react";
import type { MerchantLedger } from "@kiranaai/shared";
import { api } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { useLive } from "../../lib/live";
import { Button, C, EmptyState, Group, LargeTitle, Money, Notice, Row, Segmented, Skeleton, cardShadow } from "../ui";

type Range = "today" | "all";
const sameDay = (iso: string) => new Date(iso).toDateString() === new Date().toDateString();
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
const dateOf = (iso: string) => (sameDay(iso) ? timeOf(iso) : new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) + ", " + timeOf(iso));

/** Merchant Earnings (UX-11): one summary line of numbers, then the ledger, from this store's ledger (merchant token). */
export function Earnings({ storeId, token }: { storeId: string; token: string }) {
  const q = useLive<MerchantLedger>(["merchant-ledger", storeId], () => api(`/bpp/merchant/${storeId}/ledger`, { token }));
  const [range, setRange] = useState<Range>("today");

  const entries = q.data ? (range === "today" ? q.data.entries.filter((e) => sameDay(e.createdAt)) : q.data.entries) : [];
  const sum = (k: "grossPaise" | "commissionPaise" | "netPayablePaise" | "platformSubsidyPaise") => entries.reduce((s, e) => s + e[k], 0);

  return (
    <div className="space-y-6">
      <LargeTitle title="Earnings" subtitle="Paid out for every delivered order"
        actions={<Segmented label="Period" value={range} onChange={setRange} options={[{ value: "today", label: "Today" }, { value: "all", label: "All time" }]} />} />

      {q.isError && !q.data ? (
        <Notice tone="bad" title="Could not load earnings" action={<Button variant="plain" size="sm" onClick={() => void q.refetch()}>Retry</Button>}>
          {(q.error as Error).message}
        </Notice>
      ) : !q.data ? (
        <Skeleton className="h-[112px] w-full" style={{ borderRadius: 20 }} />
      ) : (
        <>
          <section aria-label="Summary" className="grid grid-cols-2 gap-y-5 rounded-[20px] bg-white p-5 sm:grid-cols-[1.4fr_1fr_1fr_1fr] sm:gap-y-0 sm:p-6" style={{ boxShadow: cardShadow }}>
            <div className="col-span-2 sm:col-span-1">
              <p className="text-[13px] font-medium" style={{ color: C.secondary }}>Net payable</p>
              <Money value={sum("netPayablePaise")} className="mt-1 block text-[34px] font-bold leading-none tracking-[-0.03em]" style={{ color: C.label }} />
              <p className="mt-1.5 text-[13px]" style={{ color: C.secondary }}>{entries.length} {entries.length === 1 ? "order" : "orders"}</p>
            </div>
            <Stat label="Gross" value={sum("grossPaise")} />
            <Stat label="Commission" value={sum("commissionPaise")} minus />
            <Stat label="Platform subsidy" value={sum("platformSubsidyPaise")} tone={sum("platformSubsidyPaise") > 0 ? C.green : undefined} />
          </section>

          {entries.length === 0 ? (
            <EmptyState title={range === "today" ? "Nothing settled today" : "Nothing settled yet"}>Each delivered order appears here with your commission and payout.</EmptyState>
          ) : (
            <Group title="Delivered orders">
              {entries.map((e) => (
                <Row key={e.id}
                  title={<>Order {e.subOrderId.slice(-6).toUpperCase()} <span style={{ color: C.secondary }}>· {dateOf(e.createdAt)}</span></>}
                  subtitle={<>
                    Gross {formatINR(e.grossPaise)}{e.commissionPaise ? ` − commission ${formatINR(e.commissionPaise)}` : ""}
                    {e.platformSubsidyPaise > 0 && <span style={{ color: C.green }}> · includes {formatINR(e.platformSubsidyPaise)} platform credit</span>}
                  </>}
                  detail={<span className="font-semibold" style={{ color: C.label }}>{formatINR(e.netPayablePaise)}</span>} />
              ))}
            </Group>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, minus, tone }: { label: string; value: number; minus?: boolean; tone?: string }) {
  return (
    <div className="sm:border-l-[0.5px] sm:pl-5" style={{ borderColor: C.sep }}>
      <p className="text-[13px] font-medium" style={{ color: C.secondary }}>{label}</p>
      <p className="mt-1.5 text-[20px] font-semibold tracking-[-0.01em]" style={{ color: tone ?? C.label, fontVariantNumeric: "tabular-nums" }}>
        {minus && value > 0 ? "− " : ""}{formatINR(value)}
      </p>
    </div>
  );
}
