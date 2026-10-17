import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { paiseToRupees, rupeesToPaise } from "@kiranaai/shared";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { Badge, Button, Card } from "../kit";

export interface AdminConfig {
  offerWindowSeconds: number;
  failNextPayment: boolean;
  platformFeePaise: number;
  commissionBps: number;
}
interface Fault {
  storeId: string;
  storeName: string;
  autoReject: boolean;
  neverAnswer: boolean;
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Request failed");

/** Reset & reseed, behind an in-page "are you sure" step (no browser confirm dialog). */
export function ResetPanel() {
  const qc = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [state, setState] = useState<{ kind: "idle" | "working" | "done" | "error"; text?: string }>({ kind: "idle" });
  async function reset() {
    setState({ kind: "working" });
    try {
      await api("/admin/api/reset", { method: "POST" });
      setState({ kind: "done", text: "Reset complete. Demo data restored; all stores are online." });
      await qc.invalidateQueries();
    } catch (e) {
      setState({ kind: "error", text: msg(e) });
    }
    setArmed(false);
  }
  return (
    <Card title="Reset & reseed">
      <p className="mb-3 text-sm text-stone-600">Wipes every basket, order, offer, ledger entry and audit row, and restores the demo catalogue. This affects everyone using the demo.</p>
      {!armed ? (
        <Button tone="danger" onClick={() => { setState({ kind: "idle" }); setArmed(true); }}>Reset & reseed…</Button>
      ) : (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 p-3">
          <span className="text-sm font-medium text-rose-900">Are you sure? All current demo data will be deleted.</span>
          <Button tone="danger" onClick={() => void reset()} disabled={state.kind === "working"}>Yes, wipe and reseed</Button>
          <Button tone="secondary" onClick={() => setArmed(false)}>Cancel</Button>
        </div>
      )}
      {state.kind === "working" && <p className="mt-2 text-sm text-stone-500">Resetting…</p>}
      {state.text && <p className={`mt-2 text-sm ${state.kind === "error" ? "text-rose-700" : "text-emerald-700"}`}>{state.text}</p>}
    </Card>
  );
}

/** Offer window, fail-next-payment, platform fee and commission (bap.config). */
export function ConfigPanel() {
  const qc = useQueryClient();
  const q = useQuery<AdminConfig>({ queryKey: ["admin-config"], queryFn: () => api("/admin/api/config") });
  const [draft, setDraft] = useState<{ window?: string; fee?: string; bps?: string }>({});
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);

  async function patch(body: Partial<AdminConfig>, okText: string) {
    try {
      const next = await api<AdminConfig>("/admin/api/config", { method: "PATCH", json: body });
      qc.setQueryData(["admin-config"], next);
      setDraft({});
      setNote({ ok: true, text: okText });
    } catch (e) {
      setNote({ ok: false, text: msg(e) });
    }
  }
  if (!q.data) return <Card title="Run settings"><p className="text-sm text-stone-500">Loading…</p></Card>;
  const c = q.data;
  const input = "w-24 rounded-lg border border-stone-300 px-2 py-1.5 text-right text-sm";
  return (
    <Card title="Run settings">
      <div className="space-y-4 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <label className="w-44 font-medium" htmlFor="offer-window">Offer window (seconds)</label>
          <input id="offer-window" inputMode="numeric" className={input} value={draft.window ?? String(c.offerWindowSeconds)} onChange={(e) => setDraft({ ...draft, window: e.target.value })} />
          <Button disabled={draft.window === undefined} onClick={() => void patch({ offerWindowSeconds: Number(draft.window) }, `Offer window set to ${draft.window} s for the next orders.`)}>Save</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="w-44 font-medium" htmlFor="fail-pay">Fail next payment</label>
          <input id="fail-pay" type="checkbox" className="h-5 w-5" checked={c.failNextPayment} onChange={(e) => void patch({ failNextPayment: e.target.checked }, e.target.checked ? "The next payment will fail once." : "Payments will succeed.")} />
          {c.failNextPayment && <Badge tone="warn">armed (clears after one failure)</Badge>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="w-44 font-medium" htmlFor="fee">Platform fee (₹ per basket)</label>
          <input id="fee" inputMode="decimal" className={input} value={draft.fee ?? paiseToRupees(c.platformFeePaise)} onChange={(e) => setDraft({ ...draft, fee: e.target.value })} />
          <Button disabled={draft.fee === undefined} onClick={() => { try { void patch({ platformFeePaise: rupeesToPaise(draft.fee!) }, "Platform fee saved."); } catch { setNote({ ok: false, text: "Enter an amount like 5 or 5.50." }); } }}>Save</Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="w-44 font-medium" htmlFor="bps">Merchant commission (%)</label>
          <input id="bps" inputMode="decimal" className={input} value={draft.bps ?? String(c.commissionBps / 100)} onChange={(e) => setDraft({ ...draft, bps: e.target.value })} />
          <Button disabled={draft.bps === undefined} onClick={() => void patch({ commissionBps: Math.round(Number(draft.bps) * 100) }, "Commission saved.")}>Save</Button>
        </div>
        {note && <p className={note.ok ? "text-emerald-700" : "text-rose-700"}>{note.text}</p>}
      </div>
    </Card>
  );
}

/** Per-store fault toggles (bpp.fault): auto-reject and never-answer. */
export function FaultsPanel() {
  const q = useLive<{ faults: Fault[] }>(["admin-faults"], () => api("/admin/api/faults"));
  const qc = useQueryClient();
  async function toggle(f: Fault, key: "autoReject" | "neverAnswer") {
    await api(`/admin/api/faults/${f.storeId}`, { method: "PATCH", json: { [key]: !f[key] } });
    await qc.invalidateQueries({ queryKey: ["admin-faults"] });
  }
  return (
    <Card title="Store faults">
      <p className="mb-2 text-xs text-stone-500">Auto-reject: the store declines ~3 s after an offer. Never answer: the dashboard hides Accept/Reject, so the offer times out.</p>
      <table className="w-full text-sm">
        <thead><tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500"><th className="py-1">Store</th><th className="text-center">Auto-reject</th><th className="text-center">Never answer</th></tr></thead>
        <tbody>
          {q.data?.faults.map((f) => (
            <tr key={f.storeId} className="border-b border-stone-100">
              <td className="py-1.5">{f.storeName}</td>
              {(["autoReject", "neverAnswer"] as const).map((k) => (
                <td key={k} className="text-center">
                  <input type="checkbox" className="h-5 w-5" aria-label={`${k} for ${f.storeName}`} checked={f[k]} onChange={() => void toggle(f, k)} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
