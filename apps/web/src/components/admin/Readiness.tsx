import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { useSnackbar } from "../ui/toast";
import { Button, C, CheckDraw, Group, IWarning, Notice, Row, Skeleton, StatusText } from "../ui";
import { HIT, type AdminConfig } from "./ControlPanels";

interface Fault {
  storeId: string;
  storeName: string;
  autoReject: boolean;
  neverAnswer: boolean;
  isOnline?: boolean;
}
interface Txns {
  transactions: { transactionId: string }[];
}

export const DEMO_WINDOW_S = 45;
const WARN_BELOW_S = 15;

export interface ReadinessRow {
  key: string;
  ok: boolean;
  /** Short, always-visible state ("Offer window is 5 s"). */
  text: string;
  /** Optional one-click fix. */
  fix?: { label: string; run: () => Promise<void> };
}

/** Admin demo-readiness checks, polled. `rows` is empty until the first data arrives. */
export function useReadiness() {
  const qc = useQueryClient();
  const cfg = useQuery<AdminConfig>({ queryKey: ["admin-config"], queryFn: () => api("/admin/api/config"), refetchInterval: 3000 });
  const faults = useLive<{ faults: Fault[] }>(["admin-faults"], () => api("/admin/api/faults"));
  const txns = useQuery<Txns>({ queryKey: ["admin-transactions"], queryFn: () => api("/admin/api/transactions"), refetchInterval: 3000 });

  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["admin-config"] }),
      qc.invalidateQueries({ queryKey: ["admin-faults"] }),
      qc.invalidateQueries({ queryKey: ["admin-transactions"] }),
    ]);
  const patchConfig = async (body: Partial<AdminConfig>) => {
    qc.setQueryData(["admin-config"], await api<AdminConfig>("/admin/api/config", { method: "PATCH", json: body }));
  };
  const patchFaults = async (stores: Fault[], body: object) => {
    await Promise.all(stores.map((f) => api(`/admin/api/faults/${f.storeId}`, { method: "PATCH", json: body })));
    await refresh();
  };

  const rows: ReadinessRow[] = [];
  const c = cfg.data;
  const fl = faults.data?.faults;
  if (c) {
    const w = c.offerWindowSeconds;
    rows.push({
      key: "window",
      ok: w >= WARN_BELOW_S,
      text: w >= WARN_BELOW_S ? `Offer window is ${w} s` : `Offer window is ${w} s (the demo expects ${DEMO_WINDOW_S} s)`,
      fix: w === DEMO_WINDOW_S ? undefined : { label: `Set to ${DEMO_WINDOW_S} s`, run: () => patchConfig({ offerWindowSeconds: DEMO_WINDOW_S }) },
    });
    rows.push({
      key: "failpay",
      ok: !c.failNextPayment,
      text: c.failNextPayment ? "Fail next payment is armed" : "Fail next payment is off",
      fix: c.failNextPayment ? { label: "Turn off", run: () => patchConfig({ failNextPayment: false }) } : undefined,
    });
  }
  if (fl) {
    const faulty = fl.filter((f) => f.autoReject || f.neverAnswer);
    rows.push({
      key: "faults",
      ok: faulty.length === 0,
      text: faulty.length === 0 ? "No store faults set" : `Faults set on ${faulty.map((f) => f.storeName).join(", ")}`,
      fix: faulty.length ? { label: "Clear faults", run: () => patchFaults(faulty, { autoReject: false, neverAnswer: false }) } : undefined,
    });
    if (fl.some((f) => f.isOnline !== undefined)) {
      const offline = fl.filter((f) => f.isOnline === false);
      rows.push({
        key: "online",
        ok: offline.length === 0,
        text: offline.length === 0 ? "All stores online" : `Offline: ${offline.map((f) => f.storeName).join(", ")}`,
        fix: offline.length ? { label: "Bring online", run: () => patchFaults(offline, { isOnline: true }) } : undefined,
      });
    }
  }
  if (txns.data) {
    const n = txns.data.transactions.length;
    rows.push({ key: "clean", ok: n === 0, text: n === 0 ? "No earlier runs in the audit log" : `${n} earlier ${n === 1 ? "run" : "runs"} in the audit log; reset for a clean start` });
  }
  const loading = !c || !fl || !txns.data;
  const error = cfg.isError || faults.isError || txns.isError;
  return { rows, issues: rows.filter((r) => !r.ok).length, loading, error };
}

/** Small readiness status for the page header: "Ready for the demo" or "2 demo issues" (opens the checklist). */
export function ReadinessStatus({ onOpen }: { onOpen: () => void }) {
  const { issues, loading } = useReadiness();
  if (loading) return null;
  if (issues === 0) return <span className="inline-flex min-h-11 items-center"><StatusText tone="good">Ready for the demo</StatusText></span>;
  return (
    <button type="button" onClick={onOpen} className="-mx-2 inline-flex min-h-11 cursor-pointer items-center rounded-[10px] px-2 hover:bg-black/[0.04]"
      aria-label={`${issues} demo readiness ${issues === 1 ? "issue" : "issues"}. Open the checklist`}>
      <StatusText tone="warn">{issues === 1 ? "1 demo issue" : `${issues} demo issues`}</StatusText>
    </button>
  );
}

/** "Demo readiness" checklist: a drawn check per passing row, a warning and its one-click fix per failing row. */
export function ReadinessGroup({ onReset }: { onReset: () => void }) {
  const { rows, issues, loading, error } = useReadiness();
  const snack = useSnackbar();
  const [busy, setBusy] = useState<string | null>(null);

  async function run(r: ReadinessRow) {
    if (!r.fix) return;
    setBusy(r.key);
    try {
      await r.fix.run();
      snack("Fixed.");
    } catch (e) {
      snack(e instanceof ApiError ? e.message : "Could not apply the fix.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div id="demo-readiness" className="scroll-mt-6">
      <Group
        title="Demo readiness"
        footer={loading ? "Checking…" : issues === 0 ? "Everything is set for the demo." : `${issues} ${issues === 1 ? "thing needs" : "things need"} attention before you present.`}
      >
        {loading
          ? [0, 1, 2, 3].map((i) => (
              <li key={i} className="flex min-h-11 items-center gap-3 px-4 [&+li]:border-t-[0.5px]" style={{ borderColor: C.sep }}>
                <Skeleton className="h-5 w-5 rounded-full" /><Skeleton className="h-4 w-48" />
              </li>
            ))
          : rows.map((r) => (
              <Row
                key={r.key}
                leading={r.ok ? <CheckDraw size={20} /> : <span style={{ color: C.orange }}><IWarning size={20} /></span>}
                title={<><span className="sr-only">{r.ok ? "OK: " : "Needs attention: "}</span>{r.text}</>}
                trailing={
                  r.fix ? (
                    <Button size="sm" variant="secondary" className={HIT} busy={busy === r.key} disabled={busy !== null && busy !== r.key} onClick={() => void run(r)}>{r.fix.label}</Button>
                  ) : r.key === "clean" && !r.ok ? (
                    <Button size="sm" variant="secondary" className={HIT} onClick={onReset}>Reset…</Button>
                  ) : undefined
                }
              />
            ))}
      </Group>
      {error && <Notice tone="bad" className="mt-3">Could not read some admin state. Retrying…</Notice>}
    </div>
  );
}
