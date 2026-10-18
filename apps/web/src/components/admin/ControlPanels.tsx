import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { paiseToRupees, rupeesToPaise } from "@kiranaai/shared";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { Button, Card, CircularProgress, Dialog, InlineMessage, SectionHeader, StatusLabel, Switch, TextField, useSnackbar } from "../m3";

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

/** Reset & reseed: a destructive action, so it sits in its own danger section and asks for confirmation in a dialog. */
export function ResetPanel() {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [confirming, setConfirming] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function reset() {
    setWorking(true);
    setError(null);
    try {
      await api("/admin/api/reset", { method: "POST" });
      await qc.invalidateQueries();
      setConfirming(false);
      snack("Reset complete. Demo data restored; all stores are online.");
    } catch (e) {
      setError(msg(e));
    } finally {
      setWorking(false);
    }
  }
  return (
    <Card variant="outlined" className="border-error/50 p-4 sm:p-6">
      <SectionHeader
        title="Reset & reseed"
        subtitle="Wipes every basket, order, offer, ledger entry and audit row, and restores the demo catalogue. Affects everyone using the demo."
        actions={<Button variant="danger-outlined" icon="restart_alt" onClick={() => { setError(null); setConfirming(true); }}>Reset & reseed…</Button>}
      />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        dismissible={!working}
        icon="warning"
        title="Wipe all demo data?"
        actions={
          <>
            <Button variant="text" disabled={working} onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" icon="delete_forever" loading={working} onClick={() => void reset()}>Wipe and reseed</Button>
          </>
        }
      >
        <p>All baskets, orders, payments, ledger entries and audit rows are deleted and the seed catalogue is restored. This can't be undone.</p>
        {error && <InlineMessage tone="error" className="mt-3">{error}</InlineMessage>}
      </Dialog>
    </Card>
  );
}

/** Run settings: offer window, fee and commission save together (transactional); fail-next-payment is an immediate switch. */
export function ConfigPanel() {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const q = useQuery<AdminConfig>({ queryKey: ["admin-config"], queryFn: () => api("/admin/api/config") });
  const [draft, setDraft] = useState<{ window?: string; fee?: string; pct?: string }>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function patch(body: Partial<AdminConfig>, okText: string) {
    setError(null);
    try {
      const next = await api<AdminConfig>("/admin/api/config", { method: "PATCH", json: body });
      qc.setQueryData(["admin-config"], next);
      snack(okText);
      return true;
    } catch (e) {
      setError(msg(e));
      return false;
    }
  }

  if (!q.data) {
    return (
      <Card variant="outlined" className="p-6">
        {q.isError ? <InlineMessage tone="error">Could not load settings.</InlineMessage> : <div className="flex items-center gap-3 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading settings…</div>}
      </Card>
    );
  }
  const c = q.data;
  const win = draft.window ?? String(c.offerWindowSeconds);
  const fee = draft.fee ?? paiseToRupees(c.platformFeePaise);
  const pct = draft.pct ?? String(c.commissionBps / 100);
  const winErr = !/^\d+$/.test(win.trim()) || Number(win) < 1 ? "Whole seconds, 1 or more" : null;
  const feeErr = !/^\d+(\.\d{1,2})?$/.test(fee.trim()) ? "An amount like 5 or 5.50" : null;
  const pctErr = !(Number(pct) >= 0 && Number(pct) <= 100) || pct.trim() === "" ? "A percentage from 0 to 100" : null;
  const dirty = Object.keys(draft).length > 0;

  async function save() {
    setSaving(true);
    const ok = await patch(
      { offerWindowSeconds: Number(win), platformFeePaise: rupeesToPaise(fee), commissionBps: Math.round(Number(pct) * 100) },
      `Settings saved. Offer window ${win} s applies to the next orders.`,
    );
    if (ok) setDraft({});
    setSaving(false);
  }

  return (
    <Card variant="outlined" className="space-y-5 p-4 sm:p-6">
      <SectionHeader title="Run settings" subtitle="Applies to new orders." />
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface-container p-3 pl-4">
        <div className="min-w-0">
          <p className="type-body-large text-on-surface">Fail next payment</p>
          <p className="type-body-small text-on-surface-variant">Clears itself after one failure.</p>
        </div>
        <div className="flex items-center gap-2">
          {c.failNextPayment && <StatusLabel tone="warning" icon="bolt">Armed</StatusLabel>}
          <Switch hideLabel label="Fail next payment" checked={c.failNextPayment} onChange={(v) => void patch({ failNextPayment: v }, v ? "The next payment will fail once." : "Payments will succeed.")} />
        </div>
      </div>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Offer window" suffix="s" inputMode="numeric" value={win} onValueChange={(v) => setDraft({ ...draft, window: v })} error={draft.window !== undefined ? winErr : null} supportingText="Time a store has to answer" />
          <TextField label="Platform fee per basket" prefix="₹" inputMode="decimal" value={fee} onValueChange={(v) => setDraft({ ...draft, fee: v })} error={draft.fee !== undefined ? feeErr : null} />
          <TextField label="Merchant commission" suffix="%" inputMode="decimal" value={pct} onValueChange={(v) => setDraft({ ...draft, pct: v })} error={draft.pct !== undefined ? pctErr : null} />
        </div>
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="text" disabled={!dirty || saving} onClick={() => setDraft({})}>Discard</Button>
          <Button type="submit" icon="save" loading={saving} disabled={!dirty || !!(winErr || feeErr || pctErr)}>Save changes</Button>
        </div>
      </form>
    </Card>
  );
}

/** Per-store fault toggles (bpp.fault): auto-reject and never-answer. Each switch applies immediately. */
export function FaultsPanel() {
  const q = useLive<{ faults: Fault[] }>(["admin-faults"], () => api("/admin/api/faults"));
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  async function toggle(f: Fault, key: "autoReject" | "neverAnswer") {
    setBusy(`${f.storeId}-${key}`);
    try {
      await api(`/admin/api/faults/${f.storeId}`, { method: "PATCH", json: { [key]: !f[key] } });
      await qc.invalidateQueries({ queryKey: ["admin-faults"] });
    } finally {
      setBusy(null);
    }
  }
  return (
    <Card variant="outlined" className="overflow-hidden">
      <SectionHeader
        className="p-4 sm:px-6 sm:pt-6"
        title="Store faults"
        subtitle="Auto-reject: the store declines about 3 s after an offer. Never answer: the dashboard hides Accept/Reject, so the offer times out."
      />
      <div className="overflow-x-auto">
        <table className="w-full type-body-medium">
          <thead className="bg-surface-container type-title-small text-on-surface-variant">
            <tr>
              <th scope="col" className="px-4 py-3 text-left sm:px-6">Store</th>
              <th scope="col" className="px-2 py-3 text-center">Auto-reject</th>
              <th scope="col" className="px-4 py-3 text-center sm:px-6">Never answer</th>
            </tr>
          </thead>
          <tbody>
            {q.data?.faults.map((f) => (
              <tr key={f.storeId} className="border-t border-outline-variant">
                <th scope="row" className="px-4 py-1 text-left font-normal text-on-surface sm:px-6">{f.storeName}</th>
                {(["autoReject", "neverAnswer"] as const).map((k) => (
                  <td key={k} className="px-2 py-1 text-center">
                    <Switch hideLabel label={`${k === "autoReject" ? "Auto-reject" : "Never answer"} for ${f.storeName}`} checked={f[k]} busy={busy === `${f.storeId}-${k}`} onChange={() => void toggle(f, k)} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
