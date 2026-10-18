import { useEffect, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { api } from "../../lib/api";
import { formatINR } from "../../lib/format";
import { useLive } from "../../lib/live";
import { EXPANDED, useMedia } from "../../lib/useMedia";
import { Button, C, EmptyState, Group, IBack, IChevron, Row, SearchField, SectionLabel, Segmented, Skeleton, Tag, cx, ease, soft } from "../ui";

interface Ledger {
  entries: { id: string; basketId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number; createdAt: string }[];
  byStore: { storeId: string; storeName: string; grossPaise: number; commissionPaise: number; netPayablePaise: number; platformSubsidyPaise: number }[];
}

type Money = "grossPaise" | "commissionPaise" | "netPayablePaise" | "platformSubsidyPaise";
const COLS: { key: Money; label: string }[] = [
  { key: "grossPaise", label: "Gross" },
  { key: "commissionPaise", label: "Commission" },
  { key: "netPayablePaise", label: "Net payable" },
  { key: "platformSubsidyPaise", label: "Subsidy" },
];
const NUM = { fontVariantNumeric: "tabular-nums" } as const;
const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });

/** White rounded container that matches Group, for tables. */
function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("overflow-hidden rounded-[14px] bg-white", className)} style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)" }}>{children}</div>;
}

const TH = "h-9 px-4 text-[12px] font-medium";
const TD = "h-11 px-4 text-[15px]";

/** Ledger: four totals, per-merchant totals, and every entry (one per delivered sub-order). */
export function LedgerPanel() {
  const wide = useMedia(EXPANDED);
  const q = useLive<Ledger>(["admin-ledger"], () => api("/admin/api/ledger"));
  const sum = (k: Money) => (q.data?.byStore ?? []).reduce((s, r) => s + r[k], 0);

  return (
    <div className="space-y-8">
      <Panel className="grid grid-cols-2 lg:grid-cols-4">
        {COLS.map((k, i) => (
          <div key={k.key} className={cx("px-5 py-4", i % 2 === 1 && "border-l-[0.5px]", i >= 2 && "border-t-[0.5px] lg:border-t-0", i === 2 && "lg:border-l-[0.5px]")} style={{ borderColor: C.sep }}>
            <p className="text-[13px]" style={{ color: C.secondary }}>{k.label === "Subsidy" ? "Platform subsidy" : k.label}</p>
            {q.data ? (
              <p className="mt-1 text-[24px] font-semibold tracking-[-0.02em] sm:text-[28px]" style={{ ...NUM, color: k.key === "platformSubsidyPaise" && sum(k.key) > 0 ? C.orange : C.label }}>{formatINR(sum(k.key))}</p>
            ) : (
              <Skeleton className="mt-2 h-7 w-24" />
            )}
          </div>
        ))}
      </Panel>

      {q.data && !q.data.entries.length ? (
        <Panel><EmptyState title="No deliveries settled yet">An entry appears each time a store's part of an order is delivered.</EmptyState></Panel>
      ) : q.data ? (
        <>
          <section>
            <SectionLabel>By merchant</SectionLabel>
            {wide ? (
              <Panel>
                <table className="w-full">
                  <thead style={{ color: C.secondary }}>
                    <tr><th scope="col" className={cx(TH, "text-left")}>Merchant</th>{COLS.map((c) => <th key={c.key} scope="col" className={cx(TH, "text-right")}>{c.label}</th>)}</tr>
                  </thead>
                  <tbody>
                    {q.data.byStore.map((r) => (
                      <tr key={r.storeId} className="border-t-[0.5px]" style={{ borderColor: C.sep }}>
                        <th scope="row" className={cx(TD, "text-left font-normal")}>{r.storeName}</th>
                        {COLS.map((c) => <td key={c.key} className={cx(TD, "text-right")} style={{ ...NUM, color: r[c.key] === 0 ? C.tertiary : C.label }}>{formatINR(r[c.key])}</td>)}
                      </tr>
                    ))}
                    <tr className="border-t-[0.5px]" style={{ borderColor: C.sep, background: "#FAFAFC" }}>
                      <th scope="row" className={cx(TD, "text-left font-semibold")}>Total</th>
                      {COLS.map((c) => <td key={c.key} className={cx(TD, "text-right font-semibold")} style={NUM}>{formatINR(sum(c.key))}</td>)}
                    </tr>
                  </tbody>
                </table>
              </Panel>
            ) : (
              <Group>
                {q.data.byStore.map((r) => (
                  <Row key={r.storeId} title={r.storeName}
                    subtitle={<span style={NUM}>Gross {formatINR(r.grossPaise)} · commission {formatINR(r.commissionPaise)}{r.platformSubsidyPaise ? ` · subsidy ${formatINR(r.platformSubsidyPaise)}` : ""}</span>}
                    detail={<span style={{ color: C.label }}><span className="sr-only">Net payable </span>{formatINR(r.netPayablePaise)}</span>} />
                ))}
              </Group>
            )}
          </section>

          <section>
            <SectionLabel action={<span className="text-[12px]" style={{ color: C.secondary }}>{q.data.entries.length} {q.data.entries.length === 1 ? "entry" : "entries"}</span>}>Entries</SectionLabel>
            {wide ? (
              <Panel>
                <table className="w-full">
                  <thead style={{ color: C.secondary }}>
                    <tr>
                      <th scope="col" className={cx(TH, "text-left")}>Time</th><th scope="col" className={cx(TH, "text-left")}>Merchant</th><th scope="col" className={cx(TH, "text-left")}>Entry</th>
                      <th scope="col" className={cx(TH, "text-right")}>Gross</th><th scope="col" className={cx(TH, "text-right")}>Net payable</th><th scope="col" className={cx(TH, "text-right")}>Subsidy</th>
                    </tr>
                  </thead>
                  <tbody>
                    {q.data.entries.map((e) => (
                      <tr key={e.id} className="border-t-[0.5px]" style={{ borderColor: C.sep }}>
                        <td className={cx(TD, "text-[14px]")} style={{ ...NUM, color: C.secondary }}>{time(e.createdAt)}</td>
                        <td className={TD}>{e.storeName}</td>
                        <td className={cx(TD, "font-mono text-[12px]")} style={{ color: C.secondary }}>{e.id}</td>
                        <td className={cx(TD, "text-right")} style={NUM}>{formatINR(e.grossPaise)}</td>
                        <td className={cx(TD, "text-right")} style={NUM}>{formatINR(e.netPayablePaise)}</td>
                        <td className={cx(TD, "text-right")} style={{ ...NUM, color: e.platformSubsidyPaise ? C.label : C.tertiary }}>{formatINR(e.platformSubsidyPaise)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            ) : (
              <Group>
                {q.data.entries.map((e) => (
                  <Row key={e.id} title={e.storeName}
                    subtitle={<span style={NUM}>{time(e.createdAt)} · gross {formatINR(e.grossPaise)}{e.platformSubsidyPaise ? ` · subsidy ${formatINR(e.platformSubsidyPaise)}` : ""}</span>}
                    detail={<span style={{ color: C.label }}><span className="sr-only">Net payable </span>{formatINR(e.netPayablePaise)}</span>} />
                ))}
              </Group>
            )}
          </section>
        </>
      ) : null}
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
interface Txn { transactionId: string; lastAt: string; messages: number }
type Kind = "all" | "beckn" | "state";

/** Transactions, newest first. A search filters them; a pasted ID that isn't listed can still be opened. */
function TxnList({ list, loaded, selected, onSelect }: { list: Txn[]; loaded: boolean; selected: string; onSelect: (id: string) => void }) {
  const [query, setQuery] = useState("");
  const qx = query.trim();
  const shown = qx ? list.filter((t) => t.transactionId.toLowerCase().includes(qx.toLowerCase())) : list;
  return (
    <div className="space-y-3">
      <SearchField label="Filter transactions or paste an ID" placeholder="Filter or paste an ID" value={query} onValueChange={setQuery}
        onKeyDown={(e) => { if (e.key === "Enter" && qx) onSelect(shown[0]?.transactionId ?? qx); }} />
      {!loaded ? (
        <Group>{[0, 1, 2].map((i) => <li key={i} className="flex h-14 flex-col justify-center gap-1.5 px-4"><Skeleton className="h-3.5 w-48" /><Skeleton className="h-3 w-24" /></li>)}</Group>
      ) : !list.length && !qx ? (
        <p className="px-1 text-[14px]" style={{ color: C.secondary }}>No transactions yet. Run an order and its Beckn messages appear here.</p>
      ) : (
        <Group title="Recent transactions">
          {qx && !shown.some((t) => t.transactionId === qx) && <Row title={<>Open <span className="font-mono text-[13px]">{qx}</span></>} onClick={() => onSelect(qx)} />}
          {shown.map((t) => {
            const sel = t.transactionId === selected;
            return (
              <motion.li key={t.transactionId} layout="position" transition={soft} className="[&+li]:border-t-[0.5px]" style={{ borderColor: C.sep }}>
                <button type="button" aria-current={sel || undefined} onClick={() => onSelect(t.transactionId)}
                  className="flex min-h-14 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-black/[0.025]"
                  style={sel ? { background: "rgba(31,138,62,0.09)" } : undefined}>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-mono text-[13px]" style={{ color: C.label }}>{t.transactionId}</span>
                    <span className="block text-[12px]" style={{ ...NUM, color: C.secondary }}>{t.messages} rows · {time(t.lastAt)}</span>
                  </span>
                  <span style={{ color: C.tertiary }}><IChevron size={14} /></span>
                </button>
              </motion.li>
            );
          })}
        </Group>
      )}
    </div>
  );
}

const DIR: Record<string, { glyph: string; text: string }> = { out: { glyph: "↗", text: "sent" }, in: { glyph: "↙", text: "received" } };

/** One transaction's Beckn messages and state changes, in the order they happened (new rows append, nothing jumps). */
function TxnLog({ txn }: { txn: string }) {
  const [kind, setKind] = useState<Kind>("all");
  const [open, setOpen] = useState<Set<number>>(new Set());
  const rows = useLive<AuditRow[]>(["admin-audit", txn], () => api(`/admin/api/audit?transactionId=${encodeURIComponent(txn)}`));
  const toggle = (id: number) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const all = rows.data ?? [];
  const shown = kind === "all" ? all : all.filter((r) => r.kind === kind);

  return (
    <section aria-label={`Audit log for ${txn}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.tertiary }}>Transaction</p>
          <p className="truncate font-mono text-[14px]" style={{ color: C.label }}>{txn}</p>
        </div>
        <Segmented<Kind> size="sm" label="Show rows" value={kind} onChange={setKind}
          options={[{ value: "all", label: "All" }, { value: "beckn", label: "Beckn" }, { value: "state", label: "State" }]} />
      </div>
      {!rows.data ? (
        <Group>{[0, 1, 2, 3, 4].map((i) => <li key={i} className="flex h-11 items-center gap-3 px-4"><Skeleton className="h-3.5 w-16" /><Skeleton className="h-3.5 w-40" /></li>)}</Group>
      ) : !shown.length ? (
        <Panel><EmptyState title="No audit rows">{all.length ? "Nothing of this kind in the transaction." : "Nothing was recorded for this transaction ID."}</EmptyState></Panel>
      ) : (
        <Panel>
          <ol>
            {shown.map((r) => {
              const isOpen = open.has(r.id);
              const d = r.direction ? DIR[r.direction] : null;
              return (
                <li key={r.id} className="[&+li]:border-t-[0.5px]" style={{ borderColor: C.sep }}>
                  <button type="button" onClick={() => toggle(r.id)} aria-expanded={isOpen}
                    className="flex min-h-11 w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-black/[0.025]">
                    <span className="w-[68px] shrink-0 font-mono text-[12px]" style={{ ...NUM, color: C.secondary }}>{time(r.at)}</span>
                    <span className="w-4 shrink-0 text-center text-[14px]" style={{ color: d ? C.blue : C.tertiary }} aria-hidden>{d?.glyph ?? "•"}</span>
                    <span className="min-w-0 flex-1">
                      <span className="mr-2 text-[15px] font-medium" style={{ color: C.label }}>{r.action}</span>
                      <span className="text-[13px]" style={{ color: C.secondary }}>
                        {d ? `${d.text} by ${r.actor}` : r.actor}{r.storeId ? ` · ${r.storeId}` : ""}
                      </span>
                    </span>
                    {r.kind === "state" && <Tag>state</Tag>}
                    <motion.span animate={{ rotate: isOpen ? 90 : 0 }} transition={soft} style={{ color: C.tertiary }}><IChevron size={14} /></motion.span>
                    <span className="sr-only">{isOpen ? "Hide JSON" : "Show JSON"}</span>
                  </button>
                  <AnimatePresence initial={false}>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={ease} className="overflow-hidden">
                        <pre className="mx-4 mb-3 max-h-96 overflow-auto rounded-[10px] px-3 py-2.5 font-mono text-[12px] leading-[1.5]" style={{ background: C.fill, color: C.label }} tabIndex={0} aria-label={`${r.action} payload`}>
                          {JSON.stringify(r.payload ?? {}, null, 2)}
                        </pre>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </li>
              );
            })}
          </ol>
        </Panel>
      )}
    </section>
  );
}

/** Audit viewer, list-detail: transactions beside the log from 840 px; below, the list pushes to the log with a back button. */
export function AuditViewer() {
  const wide = useMedia(EXPANDED);
  const [txn, setTxn] = useState("");
  const txns = useLive<{ transactions: Txn[] }>(["admin-txns"], () => api("/admin/api/transactions"));
  const list = txns.data?.transactions ?? [];
  // Wide windows open on the most recent transaction rather than an empty pane.
  useEffect(() => { if (wide && !txn && list[0]) setTxn(list[0].transactionId); }, [wide, txn, list]);

  if (!wide) {
    return (
      <AnimatePresence mode="wait" initial={false}>
        {txn ? (
          <motion.div key="log" initial={{ opacity: 0, x: 24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 24 }} transition={soft}>
            <Button variant="plain" size="sm" icon={<IBack size={16} />} className="-ml-2 mb-2" onClick={() => setTxn("")}>Transactions</Button>
            <TxnLog txn={txn} />
          </motion.div>
        ) : (
          <motion.div key="list" initial={{ opacity: 0, x: -24 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -24 }} transition={soft}>
            <TxnList list={list} loaded={!!txns.data} selected={txn} onSelect={setTxn} />
          </motion.div>
        )}
      </AnimatePresence>
    );
  }
  return (
    <div className="flex items-start gap-6">
      <div className="sticky top-8 max-h-[calc(100dvh-64px)] w-[320px] shrink-0 overflow-y-auto pb-2">
        <TxnList list={list} loaded={!!txns.data} selected={txn} onSelect={setTxn} />
      </div>
      <div className="min-w-0 flex-1">
        {txn ? <TxnLog key={txn} txn={txn} /> : (
          <Panel><EmptyState title="No transaction selected">Each Beckn message and state change for a transaction appears here in order.</EmptyState></Panel>
        )}
      </div>
    </div>
  );
}
