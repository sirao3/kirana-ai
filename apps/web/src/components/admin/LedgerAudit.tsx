import { useState } from "react";
import { api } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { useLive } from "../../lib/live";
import { Badge, Card } from "../kit";

interface Ledger {
  entries: { id: string; basketId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number; createdAt: string }[];
  byStore: { storeId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number }[];
}

/** Ledger: per-merchant totals and every entry (one per delivered sub-order). */
export function LedgerPanel() {
  const q = useLive<Ledger>(["admin-ledger"], () => api("/admin/api/ledger"));
  const th = "py-1 pr-3 text-right";
  const sum = (k: "grossPaise" | "commissionPaise" | "netPayablePaise" | "platformSubsidyPaise") => (q.data?.byStore ?? []).reduce((s, r) => s + r[k], 0);
  return (
    <Card title="Ledger">
      {!q.data?.entries.length ? (
        <p className="text-sm text-stone-500">No deliveries settled yet. Entries appear when a sub-order is delivered.</p>
      ) : (
        <div className="space-y-4 overflow-x-auto text-sm">
          <table className="w-full">
            <thead><tr className="border-b border-stone-200 text-xs uppercase text-stone-500"><th className="py-1 pr-3 text-left">Merchant</th><th className={th}>Gross</th><th className={th}>Commission</th><th className={th}>Net payable</th><th className={th}>Platform subsidy</th></tr></thead>
            <tbody>
              {q.data.byStore.map((r) => (
                <tr key={r.storeId} className="border-b border-stone-100">
                  <td className="py-1 pr-3">{r.storeName}</td>
                  <td className={th}>{formatINR(r.grossPaise)}</td><td className={th}>{formatINR(r.commissionPaise)}</td>
                  <td className={th}>{formatINR(r.netPayablePaise)}</td><td className={th}>{formatINR(r.platformSubsidyPaise)}</td>
                </tr>
              ))}
              <tr className="font-semibold">
                <td className="py-1 pr-3">Total</td>
                <td className={th}>{formatINR(sum("grossPaise"))}</td><td className={th}>{formatINR(sum("commissionPaise"))}</td>
                <td className={th}>{formatINR(sum("netPayablePaise"))}</td><td className={th}>{formatINR(sum("platformSubsidyPaise"))}</td>
              </tr>
            </tbody>
          </table>
          <table className="w-full text-xs">
            <thead><tr className="border-b border-stone-200 uppercase text-stone-500"><th className="py-1 pr-3 text-left">Entry</th><th className="pr-3 text-left">Merchant</th><th className={th}>Gross</th><th className={th}>Net</th><th className={th}>Subsidy</th></tr></thead>
            <tbody>
              {q.data.entries.map((e) => (
                <tr key={e.id} className="border-b border-stone-100">
                  <td className="py-1 pr-3 font-mono">{e.id}</td><td className="pr-3">{e.storeName}</td>
                  <td className={th}>{formatINR(e.grossPaise)}</td><td className={th}>{formatINR(e.netPayablePaise)}</td><td className={th}>{formatINR(e.platformSubsidyPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
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

/** Audit viewer: pick a transaction (or paste an id) and read its Beckn messages and state changes in order. */
export function AuditViewer() {
  const [txn, setTxn] = useState("");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const txns = useLive<{ transactions: { transactionId: string; lastAt: string; messages: number }[] }>(["admin-txns"], () => api("/admin/api/transactions"));
  const rows = useLive<AuditRow[]>(["admin-audit", txn], () => api(`/admin/api/audit?transactionId=${encodeURIComponent(txn)}`), { enabled: txn.length > 0 });
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  return (
    <Card title="Audit viewer">
      <div className="mb-3 flex flex-wrap gap-2">
        <select aria-label="Transaction" value={txn} onChange={(e) => setTxn(e.target.value)} className="min-w-0 flex-1 rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm">
          <option value="">Pick a recent transaction…</option>
          {txns.data?.transactions.map((t) => <option key={t.transactionId} value={t.transactionId}>{t.transactionId} ({t.messages} rows, {new Date(t.lastAt).toLocaleTimeString()})</option>)}
        </select>
        <input aria-label="Transaction id" placeholder="…or paste a transaction id" value={txn} onChange={(e) => setTxn(e.target.value.trim())} className="min-w-0 flex-1 rounded-lg border border-stone-300 px-2 py-1.5 text-sm" />
      </div>
      {txn && rows.data?.length === 0 && <p className="text-sm text-stone-500">No audit rows for this transaction.</p>}
      <ol className="space-y-1">
        {rows.data?.map((r) => (
          <li key={r.id} className="rounded-lg border border-stone-200 text-sm">
            <button className="flex w-full flex-wrap items-center gap-2 px-2 py-1.5 text-left" onClick={() => toggle(r.id)} aria-expanded={open.has(r.id)}>
              <span className="font-mono text-xs text-stone-500">{new Date(r.at).toLocaleTimeString()}</span>
              <Badge tone={r.kind === "beckn" ? "info" : "neutral"}>{r.kind}</Badge>
              <span className="font-medium">{r.action}</span>
              {r.direction && <span className="text-xs text-stone-500">{r.direction === "out" ? "→ sent" : "← received"} by {r.actor}</span>}
              {r.storeId && <span className="text-xs text-stone-500">{r.storeId}</span>}
              <span className="ml-auto text-xs text-stone-400">{open.has(r.id) ? "hide" : "show JSON"}</span>
            </button>
            {open.has(r.id) && <pre className="max-h-96 overflow-auto border-t border-stone-200 bg-stone-50 p-2 text-xs">{JSON.stringify(r.payload ?? {}, null, 2)}</pre>}
          </li>
        ))}
      </ol>
    </Card>
  );
}
