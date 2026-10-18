import { useId, useState, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { paiseToRupees, rupeesToPaise } from "@kiranaai/shared";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { EXPANDED, useMedia } from "../../lib/useMedia";
import { useSnackbar } from "../ui/toast";
import { Alert, Button, C, Group, Notice, Row, Segmented, Skeleton, StatusText, Switch, TextField, cx, ease } from "../ui";

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
  isOnline?: boolean;
}

const msg = (e: unknown) => (e instanceof ApiError ? e.message : "Request failed");

/** Grows a 32 pt button's hit area to 44 pt without changing its look. */
export const HIT = "relative before:absolute before:inset-x-0 before:-inset-y-1.5 before:content-['']";

/** A Group row for controls that don't fit Row's single line (a field, a segmented control). */
function ControlRow({ children, className }: { children: ReactNode; className?: string }) {
  return <li className={cx("px-4 py-3 [&+li]:border-t-[0.5px]", className)} style={{ borderColor: C.sep }}>{children}</li>;
}

function RowText({ title, sub, error, errorId, className }: { title: ReactNode; sub?: ReactNode; error?: string | null; errorId?: string; className?: string }) {
  return (
    <span className={cx("block min-w-0 flex-1", className)}>
      <span className="block text-[15px] leading-[1.3]" style={{ color: C.label }}>{title}</span>
      {error ? (
        <span id={errorId} className="mt-0.5 block text-[13px]" style={{ color: C.red }}>{error}</span>
      ) : sub ? (
        <span className="mt-0.5 block text-[13px] leading-[1.35]" style={{ color: C.secondary }}>{sub}</span>
      ) : null}
    </span>
  );
}

/** A compact inline field: the label is the row title (visually hidden on the field), the error shows under the title. */
function InlineField({ title, sub, error, ...field }: { title: string; sub?: ReactNode; error: string | null; value: string; onValueChange: (v: string) => void; prefix?: string; suffix?: string; inputMode: "numeric" | "decimal" }) {
  const id = useId();
  return (
    <ControlRow className="flex items-center gap-3 py-2">
      <RowText title={title} sub={sub} error={error} errorId={`${id}-err`} />
      <TextField label={title} hideLabel className="w-[112px] shrink-0 [&_input]:text-right [&>div]:h-9 [&>div]:rounded-[10px]" error={error ? <span className="sr-only">{error}</span> : undefined} {...field} />
    </ControlRow>
  );
}

const PRESETS = [5, 45, 120] as const;
type WindowChoice = "5" | "45" | "120" | "custom";

/** Run settings: fail-next-payment and the offer-window presets apply at once; a custom window, fee and commission save together. */
export function ConfigPanel() {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const q = useQuery<AdminConfig>({ queryKey: ["admin-config"], queryFn: () => api("/admin/api/config") });
  const [draft, setDraft] = useState<{ window?: string; fee?: string; pct?: string }>({});
  const [custom, setCustom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [switching, setSwitching] = useState(false);

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
      <Group title="Run settings">
        {q.isError ? (
          <ControlRow><Notice tone="bad">Could not load settings.</Notice></ControlRow>
        ) : (
          [0, 1, 2, 3].map((i) => <ControlRow key={i} className="flex h-11 items-center"><Skeleton className="h-4 w-40" /></ControlRow>)
        )}
      </Group>
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
  const isPreset = (PRESETS as readonly number[]).includes(c.offerWindowSeconds);
  const showCustom = custom || draft.window !== undefined || !isPreset;
  const choice: WindowChoice = showCustom ? "custom" : (String(c.offerWindowSeconds) as WindowChoice);

  async function save() {
    setSaving(true);
    const ok = await patch(
      { offerWindowSeconds: Number(win), platformFeePaise: rupeesToPaise(fee), commissionBps: Math.round(Number(pct) * 100) },
      `Settings saved. Offer window ${win} s applies to the next orders.`,
    );
    if (ok) { setDraft({}); setCustom(false); }
    setSaving(false);
  }

  function pickWindow(v: WindowChoice) {
    if (v === "custom") { setCustom(true); return; }
    const n = Number(v);
    setCustom(false);
    setDraft(({ window: _w, ...rest }) => rest);
    if (n !== c.offerWindowSeconds) void patch({ offerWindowSeconds: n }, `Offer window set to ${n} s for the next orders.`);
  }

  return (
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Group title="Run settings" footer="Applies to new orders. Presets and the switch apply at once; the other fields save together.">
        <Row
          title="Fail next payment"
          subtitle={c.failNextPayment ? <StatusText tone="warn">Armed: the next payment fails once</StatusText> : "Clears itself after one failure."}
          trailing={<Switch hideLabel label="Fail next payment" checked={c.failNextPayment} busy={switching}
            onChange={async (v) => { setSwitching(true); await patch({ failNextPayment: v }, v ? "The next payment will fail once." : "Payments will succeed."); setSwitching(false); }} />}
        />
        <ControlRow className="flex flex-wrap items-center gap-x-3 gap-y-2.5">
          <RowText title="Offer window" sub="Time a store has to answer an offer" className="basis-[220px]" />
          <Segmented<WindowChoice> label="Offer window presets" value={choice} onChange={pickWindow} className="max-sm:w-full"
            options={[...PRESETS.map((n) => ({ value: String(n) as WindowChoice, label: `${n} s` })), { value: "custom", label: "Custom" }]} />
        </ControlRow>
        {showCustom && (
          <InlineField title="Custom offer window" sub="Whole seconds" suffix="s" inputMode="numeric" value={win}
            onValueChange={(v) => setDraft({ ...draft, window: v })} error={draft.window !== undefined ? winErr : null} />
        )}
        <InlineField title="Platform fee per basket" prefix="₹" inputMode="decimal" value={fee} onValueChange={(v) => setDraft({ ...draft, fee: v })} error={draft.fee !== undefined ? feeErr : null} />
        <InlineField title="Merchant commission" suffix="%" inputMode="decimal" value={pct} onValueChange={(v) => setDraft({ ...draft, pct: v })} error={draft.pct !== undefined ? pctErr : null} />
      </Group>
      <div aria-live="polite">
        {error && <Notice tone="bad" className="mt-3">{error}</Notice>}
      </div>
      <AnimatePresence initial={false}>
        {(dirty || custom) && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={ease} className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" disabled={saving} onClick={() => { setDraft({}); setCustom(false); setError(null); }}>Discard</Button>
            <Button type="submit" busy={saving} disabled={!dirty || !!(winErr || feeErr || pctErr)}>Save changes</Button>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}

/** Per-store fault toggles (bpp.fault): auto-reject and never-answer. Each switch applies immediately. */
export function FaultsPanel() {
  const wide = useMedia(EXPANDED);
  const q = useLive<{ faults: Fault[] }>(["admin-faults"], () => api("/admin/api/faults"));
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [busy, setBusy] = useState<string | null>(null);
  async function toggle(f: Fault, key: "autoReject" | "neverAnswer") {
    setBusy(`${f.storeId}-${key}`);
    try {
      await api(`/admin/api/faults/${f.storeId}`, { method: "PATCH", json: { [key]: !f[key] } });
      await qc.invalidateQueries({ queryKey: ["admin-faults"] });
    } catch (e) {
      snack(msg(e));
    } finally {
      setBusy(null);
    }
  }
  const KEYS = [["autoReject", "Auto-reject"], ["neverAnswer", "Never answer"]] as const;
  const sw = (f: Fault, k: (typeof KEYS)[number][0], name: string) => (
    <Switch hideLabel label={`${name} for ${f.storeName}`} checked={f[k]} busy={busy === `${f.storeId}-${k}`} onChange={() => void toggle(f, k)} />
  );
  return (
    <Group
      title="Store faults"
      footer="Auto-reject: the store declines about 3 s after an offer. Never answer: the dashboard hides Accept and Decline, so the offer times out."
    >
      {wide && (
        <li className="flex h-9 items-center gap-3 px-4 text-[12px] font-medium" style={{ color: C.secondary }} aria-hidden>
          <span className="flex-1">Store</span>
          {KEYS.map(([k, name]) => <span key={k} className="w-[104px] text-center">{name}</span>)}
        </li>
      )}
      {!q.data
        ? [0, 1, 2, 3, 4].map((i) => <ControlRow key={i} className="flex h-11 items-center"><Skeleton className="h-4 w-44" /></ControlRow>)
        : q.data.faults.map((f) => (
            <ControlRow key={f.storeId} className={cx("flex gap-3", wide ? "items-center py-1.5" : "flex-col py-2.5")}>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px]" style={{ color: C.label }}>{f.storeName}</span>
                {f.isOnline === false && <StatusText tone="neutral" className="mt-0.5">Offline</StatusText>}
              </span>
              {wide ? (
                KEYS.map(([k, name]) => <span key={k} className="flex w-[104px] justify-center">{sw(f, k, name)}</span>)
              ) : (
                <span className="flex gap-6">
                  {KEYS.map(([k, name]) => (
                    <span key={k} className="flex items-center gap-2.5">
                      {sw(f, k, name)}
                      <span className="cursor-pointer text-[14px]" style={{ color: C.secondary }} aria-hidden onClick={() => busy === null && void toggle(f, k)}>{name}</span>
                    </span>
                  ))}
                </span>
              )}
            </ControlRow>
          ))}
    </Group>
  );
}

/** Reset & reseed: a destructive row set apart at the bottom; the Alert names the consequence and the action. */
export function ResetPanel({ open, onOpenChange }: { open?: boolean; onOpenChange?: (open: boolean) => void } = {}) {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const [own, setOwn] = useState(false);
  const confirming = open ?? own;
  const setConfirming = (v: boolean) => (onOpenChange ? onOpenChange(v) : setOwn(v));
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
  const close = () => { if (!working) setConfirming(false); };
  return (
    <>
      <Group footer="Wipes every basket, order, offer, ledger entry and audit row, and restores the demo catalogue. Affects everyone using the demo.">
        <Row title="Reset & reseed…" destructive chevron={false} onClick={() => { setError(null); setConfirming(true); }} />
      </Group>
      <Alert
        open={confirming}
        onClose={close}
        title="Wipe all demo data?"
        message="All baskets, orders, payments, ledger entries and audit rows are deleted and the seed catalogue is restored for everyone using the demo. This can't be undone."
        actions={
          <>
            <Button variant="secondary" disabled={working} onClick={close}>Cancel</Button>
            <Button variant="danger" busy={working} onClick={() => void reset()}>Wipe and reseed</Button>
          </>
        }
      >
        {error && <Notice tone="bad" className="mt-3">{error}</Notice>}
      </Alert>
    </>
  );
}
