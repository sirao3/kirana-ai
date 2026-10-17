import { useState } from "react";
import { AuditViewer, LedgerPanel } from "../components/admin/LedgerAudit";
import { ConfigPanel, FaultsPanel, ResetPanel } from "../components/admin/ControlPanels";
import { Button, Card } from "../components/kit";
import { api, ApiError } from "../lib/api";
import { getSession, setSession, type Session } from "../lib/session";

/** Passcode gate: exchanges the passcode for an admin token via POST /auth/persona. */
function Gate({ onAuthed }: { onAuthed: (s: Session) => void }) {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const s = await api<Session>("/auth/persona", { method: "POST", json: { role: "admin", passcode }, token: "" });
      setSession(s);
      onAuthed(s);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Wrong passcode." : "Could not sign in.");
    }
  }
  return (
    <main className="mx-auto max-w-sm p-6">
      <Card title="Admin console">
        <form onSubmit={submit} className="space-y-3">
          <input type="password" autoFocus aria-label="Admin passcode" placeholder="Passcode" value={passcode} onChange={(e) => setPasscode(e.target.value)} className="w-full rounded-lg border border-stone-300 px-3 py-2" />
          <Button type="submit" className="w-full" disabled={!passcode}>Enter</Button>
          {error && <p className="text-sm text-rose-700">{error}</p>}
        </form>
      </Card>
    </main>
  );
}

/** /admin: reset & reseed, run settings, store faults, ledger, audit viewer. */
export function Admin() {
  const [session, setLocal] = useState<Session | null>(() => {
    const s = getSession();
    return s?.role === "admin" ? s : null;
  });
  if (!session) return <Gate onAuthed={setLocal} />;
  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Admin console</h1>
        <Button tone="ghost" onClick={() => { setSession(null); setLocal(null); }}>Sign out</Button>
      </header>
      <ResetPanel />
      <div className="grid gap-4 md:grid-cols-2">
        <ConfigPanel />
        <FaultsPanel />
      </div>
      <LedgerPanel />
      <AuditViewer />
    </main>
  );
}
