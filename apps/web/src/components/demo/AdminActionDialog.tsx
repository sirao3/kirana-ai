import { useEffect, useState, type MutableRefObject } from "react";
import { api, ApiError } from "../../lib/api";
import type { Session } from "../../lib/session";
import { Alert, Button, Notice, TextField } from "../ui";

export type AdminAction = "arm" | "reset";

const COPY: Record<AdminAction, { title: string; body: string; confirm: string; danger: boolean }> = {
  arm: {
    title: "Arm demo faults?",
    body: "Sets the offer window to 45 s, turns Lakshmi's auto-reject off and makes Gupta Kirana never answer, so the §14 script plays out: Lakshmi is rejected by hand and Gupta times out. This changes settings for everyone using the demo.",
    confirm: "Arm faults",
    danger: false,
  },
  reset: {
    title: "Reset demo data?",
    body: "Wipes every basket, order, offer, ledger entry and audit row, restores the seed catalogue and brings all stores online. This can't be undone.",
    confirm: "Wipe and reseed",
    danger: true,
  },
};

interface FaultRow { storeId: string; storeName: string }

/** Runs the admin calls the cockpit needs. The passcode is asked for here and the admin token is kept in memory only (never in the tab session). */
export async function runAdminAction(action: AdminAction, token: string): Promise<void> {
  if (action === "reset") {
    await api("/admin/api/reset", { method: "POST", token });
    return;
  }
  await api("/admin/api/config", { method: "PATCH", token, json: { offerWindowSeconds: 45 } });
  const { faults } = await api<{ faults: FaultRow[] }>("/admin/api/faults", { token });
  await Promise.all(
    faults.map((f) => api(`/admin/api/faults/${f.storeId}`, { method: "PATCH", token, json: { autoReject: false, neverAnswer: /gupta/i.test(f.storeName) } })),
  );
}

/** Confirm alert with an inline admin-passcode field. The passcode is never hard-coded. */
export function AdminActionDialog({ action, tokenRef, onClose, onDone }: {
  action: AdminAction | null;
  tokenRef: MutableRefObject<string | null>;
  onClose: () => void;
  onDone: (action: AdminAction) => void;
}) {
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (action) {
      setError(null);
      setBusy(false);
    }
  }, [action]);

  const copy = COPY[action ?? "arm"];
  const needPasscode = !tokenRef.current;
  const close = () => { if (!busy) onClose(); };

  async function go() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (!tokenRef.current) {
        const s = await api<Session>("/auth/persona", { method: "POST", token: "", json: { role: "admin", passcode } });
        tokenRef.current = s.token;
      }
      await runAdminAction(action, tokenRef.current);
      setPasscode("");
      onDone(action);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 401 || e.status === 403)) {
        tokenRef.current = null;
        setError("That passcode was not accepted.");
      } else {
        setError(e instanceof ApiError ? e.message : "Request failed. Is the server running?");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert
      open={action !== null}
      onClose={close}
      title={copy.title}
      message={copy.body}
      actions={
        <>
          <Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
          <Button variant={copy.danger ? "danger" : "primary"} busy={busy} disabled={needPasscode && !passcode} onClick={() => void go()}>
            {copy.confirm}
          </Button>
        </>
      }
    >
      {needPasscode && (
        <TextField
          className="mt-4"
          label="Admin passcode"
          type="password"
          autoComplete="off"
          value={passcode}
          onValueChange={setPasscode}
          onKeyDown={(e) => e.key === "Enter" && passcode && !busy && void go()}
        />
      )}
      <div aria-live="polite">{error && <Notice tone="bad" className="mt-3">{error}</Notice>}</div>
    </Alert>
  );
}
