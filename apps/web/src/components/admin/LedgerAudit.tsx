import { useState } from "react";
import { api } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { useLive } from "../../lib/live";
import { EXPANDED, useMedia } from "../../lib/useMedia";
import { Card, cx, EmptyState, Icon, SectionHeader, SelectField, StatusLabel, TextField } from "../m3";

interface Ledger {
  entries: { id: string; basketId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number; createdAt: string }[];
  byStore: { storeId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number }[];
}

type Money = "grossPaise" | "commissionPaise" | "netPayablePaise" | "platformSubsidyPaise";
const KPIS: { key: Money; label: string; icon: string }[] = [
  { key: "grossPaise", label: "Gross", icon: "payments" },
  { key: "commissionPaise", label: "Commission", icon: "percent" },
  { key: "netPayablePaise", label: "Net payable", icon: "account_balance" },
  { key: "platformSubsidyPaise", label: "Platform subsidy", icon: "volunteer_activism" },
];

/** Ledger: totals as stat tiles, per-merchant totals, and every entry (one per delivered sub-order). */
export function LedgerPanel() {
  const q = useLive<Ledger>(["admin-ledger"], () => api("/admin/api/ledger"));
  const sum = (k: Money) => (q.data?.byStore ?? []).reduce((s, r) => s + r[k], 0);
  const th = "px-3 py-3 text-right";
  const td = "px-3 py-2 text-right tabular-nums";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {KPIS.map((k) => (
          <Card key={k.key} variant="filled" className="p-4">
            <p className="flex items-center gap-2 type-label-large text-on-surface-variant"><Icon name={k.icon} size={18} />{k.label}</p>
            <p className="mt-1 type-headline-small tabular-nums text-on-surface">{formatINR(sum(k.key))}</p>
          </Card>
        ))}
      </div>
      {!q.data?.entries.length ? (
        <Card variant="outlined">
          <EmptyState icon="account_balance_wallet" title="No deliveries settled yet">Entries appear when a sub-order is delivered.</EmptyState>
        </Card>
      ) : (
        <>
          <Card variant="outlined" className="overflow-hidden">
            <SectionHeader className="p-4" title="By merchant" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] type-body-medium">
                <thead className="bg-surface-container type-title-small text-on-surface-variant">
                  <tr><th scope="col" className="px-4 py-3 text-left">Merchant</th><th scope="col" className={th}>Gross</th><th scope="col" className={th}>Commission</th><th scope="col" className={th}>Net payable</th><th scope="col" className="px-4 py-3 text-right">Subsidy</th></tr>
                </thead>
                <tbody>
                  {q.data.byStore.map((r) => (
                    <tr key={r.storeId} className="border-t border-outline-variant text-on-surface">
                      <th scope="row" className="px-4 py-2 text-left font-normal">{r.storeName}</th>
                      <td className={td}>{formatINR(r.grossPaise)}</td><td className={td}>{formatINR(r.commissionPaise)}</td>
                      <td className={td}>{formatINR(r.netPayablePaise)}</td><td className={cx(td, "px-4")}>{formatINR(r.platformSubsidyPaise)}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-outline type-title-small text-on-surface">
                    <th scope="row" className="px-4 py-3 text-left">Total</th>
                    <td className={td}>{formatINR(sum("grossPaise"))}</td><td className={td}>{formatINR(sum("commissionPaise"))}</td>
                    <td className={td}>{formatINR(sum("netPayablePaise"))}</td><td className={cx(td, "px-4")}>{formatINR(sum("platformSubsidyPaise"))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </Card>
          <Card variant="outlined" className="overflow-hidden">
            <SectionHeader className="p-4" title="Entries" subtitle={`${q.data.entries.length} ledger rows`} />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] type-body-small">
                <thead className="bg-surface-container type-label-large text-on-surface-variant">
                  <tr><th scope="col" className="px-4 py-3 text-left">Entry</th><th scope="col" className="px-3 py-3 text-left">Merchant</th><th scope="col" className={th}>Gross</th><th scope="col" className={th}>Net</th><th scope="col" className="px-4 py-3 text-right">Subsidy</th></tr>
                </thead>
                <tbody>
                  {q.data.entries.map((e) => (
                    <tr key={e.id} className="border-t border-outline-variant text-on-surface">
                      <td className="px-4 py-2 font-mono">{e.id}</td><td className="px-3 py-2">{e.storeName}</td>
                      <td className={td}>{formatINR(e.grossPaise)}</td><td className={td}>{formatINR(e.netPayablePaise)}</td><td className={cx(td, "px-4")}>{formatINR(e.platformSubsidyPaise)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

interface AuditRow {
  id: number;
  at: string;
  messageId: string | null;
  kind: "beckn" | "state";
  action: string;
  direction: "in" | "out" | null;
  actor: string;
  storeId: string | null;
  entityId: string | null;
  payload: unknown;
}

/** Audit viewer, list-detail: recent transactions on the left (≥840 px), their Beckn messages and state changes on the right. */
export function AuditViewer() {
  const wide = useMedia(EXPANDED);
  const [txn, setTxn] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const txns = useLive<{ transactions: { transactionId: string; lastAt: string; messages: number }[] }>(["admin-txns"], () => api("/admin/api/transactions"));
  const rows = useLive<AuditRow[]>(["admin-audit", txn], () => api(`/admin/api/audit?transactionId=${encodeURIComponent(txn)}`), { enabled: txn.length > 0 });
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const list = txns.data?.transactions ?? [];

  return (
    <div className={wide ? "flex items-start gap-6" : "space-y-4"}>
      {wide ? (
        <Card variant="outlined" className="sticky top-16 max-h-[calc(100dvh-96px)] w-[340px] shrink-0 overflow-y-auto py-2">
          <p className="px-4 pb-1 pt-2 type-title-small text-on-surface-variant">Recent transactions</p>
          {list.length === 0 && <p className="px-4 py-3 type-body-medium text-on-surface-variant">No transactions yet.</p>}
          <ul>
            {list.map((t) => {
              const sel = t.transactionId === txn;
              return (
                <li key={t.transactionId}>
                  <button
                    aria-current={sel || undefined}
                    onClick={() => setTxn(t.transactionId)}
                    className={cx("state-layer flex min-h-14 w-full cursor-pointer flex-col justify-center px-4 py-2 text-left", sel ? "bg-secondary-container text-on-secondary-container" : "text-on-surface")}
                  >
                    <span className="block w-full truncate font-mono type-body-medium">{t.transactionId}</span>
                    <span className="type-body-small text-on-surface-variant">{t.messages} rows · {new Date(t.lastAt).toLocaleTimeString()}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : (
        <SelectField label="Transaction" value={txn} onChange={(e) => setTxn(e.target.value)}>
          <option value="">Pick a recent transaction…</option>
          {list.map((t) => <option key={t.transactionId} value={t.transactionId}>{t.transactionId} ({t.messages} rows, {new Date(t.lastAt).toLocaleTimeString()})</option>)}
        </SelectField>
      )}

      <div className="min-w-0 flex-1 space-y-3">
        <TextField label="Transaction ID" leadingIcon="tag" value={txn} onValueChange={(v) => setTxn(v.trim())} supportingText="Pick one from the list, or paste an ID" />
        {!txn ? (
          <Card variant="outlined"><EmptyState icon="manage_search" title="No transaction selected">Each Beckn message and state change for the transaction appears here in order.</EmptyState></Card>
        ) : rows.data?.length === 0 ? (
          <Card variant="outlined"><EmptyState icon="search_off" title="No audit rows">Nothing was recorded for this transaction ID.</EmptyState></Card>
        ) : (
          <Card variant="outlined" className="overflow-hidden">
            <ol>
              {rows.data?.map((r, i) => (
                <li key={r.id} className={i > 0 ? "border-t border-outline-variant" : undefined}>
                  <button className="state-layer flex min-h-12 w-full cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-left" onClick={() => toggle(r.id)} aria-expanded={open.has(r.id)}>
                    <span className="font-mono type-body-small text-on-surface-variant">{new Date(r.at).toLocaleTimeString()}</span>
                    <StatusLabel tone={r.kind === "beckn" ? "info" : "neutral"} icon={r.kind === "beckn" ? "swap_horiz" : "sync_alt"}>{r.kind}</StatusLabel>
                    <span className="type-title-small text-on-surface">{r.action}</span>
                    {r.direction && (
                      <span className="flex items-center gap-1 type-body-small text-on-surface-variant">
                        <Icon name={r.direction === "out" ? "north_east" : "south_west"} size={14} />
                        {r.direction === "out" ? "sent" : "received"} by {r.actor}
                      </span>
                    )}
                    {r.storeId && <span className="type-body-small text-on-surface-variant">{r.storeId}</span>}
                    <Icon name="expand_more" size={20} className={cx("ml-auto text-on-surface-variant transition-transform", open.has(r.id) && "rotate-180")} />
                    <span className="sr-only">{open.has(r.id) ? "Hide JSON" : "Show JSON"}</span>
                  </button>
                  {open.has(r.id) && <pre className="max-h-96 overflow-auto bg-surface-container px-4 py-3 font-mono type-body-small text-on-surface">{JSON.stringify(r.payload ?? {}, null, 2)}</pre>}
                </li>
              ))}
            </ol>
          </Card>
        )}
      </div>
    </div>
  );
}
