import { useState } from "react";
import { AuditViewer, LedgerPanel } from "../components/admin/LedgerAudit";
import { ConfigPanel, FaultsPanel, ResetPanel } from "../components/admin/ControlPanels";
import { AppShell, BrandMark, Button, Card, Icon, IconButton, InlineMessage, TextField, ThemeToggle, TopAppBar, type NavItem } from "../components/m3";
import { api, ApiError } from "../lib/api";
import { getSession, setSession, type Session } from "../lib/session";

/** Passcode gate: exchanges the passcode for an admin token via POST /auth/persona. */
function Gate({ onAuthed }: { onAuthed: (s: Session) => void }) {
  const [passcode, setPasscode] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const s = await api<Session>("/auth/persona", { method: "POST", json: { role: "admin", passcode }, token: "" });
      setSession(s);
      onAuthed(s);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 401 ? "Wrong passcode. Try again." : "Could not sign in. Is the server running?");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-dvh bg-surface">
      <TopAppBar leading={<BrandMark />} title="Admin console" actions={<ThemeToggle />} />
      <main className="mx-auto flex max-w-md flex-col px-4 pt-10">
        <Card variant="elevated" className="p-6">
          <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary-container text-on-secondary-container">
            <Icon name="admin_panel_settings" />
          </span>
          <h2 className="type-headline-small text-on-surface">Sign in</h2>
          <p className="mb-6 mt-1 type-body-medium text-on-surface-variant">Enter the admin passcode to reset the demo, inject faults and read the ledger.</p>
          <form onSubmit={submit} className="space-y-4">
            <TextField
              label="Passcode"
              type={show ? "text" : "password"}
              autoFocus
              autoComplete="current-password"
              value={passcode}
              onValueChange={setPasscode}
              error={error}
              trailing={<IconButton type="button" icon={show ? "visibility_off" : "visibility"} label={show ? "Hide passcode" : "Show passcode"} onClick={() => setShow((v) => !v)} />}
            />
            <Button type="submit" className="w-full" icon="login" loading={busy} disabled={!passcode}>Sign in</Button>
          </form>
        </Card>
      </main>
    </div>
  );
}

type Dest = "controls" | "ledger" | "audit";
const TITLES: Record<Dest, string> = { controls: "Controls", ledger: "Ledger", audit: "Audit" };

/** /admin: Controls (settings, faults, reset), Ledger, Audit, as navigation destinations. */
export function Admin() {
  const [session, setLocal] = useState<Session | null>(() => {
    const s = getSession();
    return s?.role === "admin" ? s : null;
  });
  const [dest, setDest] = useState<Dest>("controls");
  if (!session) return <Gate onAuthed={setLocal} />;
  const nav: NavItem[] = [
    { key: "controls", label: "Controls", icon: "tune", onSelect: () => setDest("controls") },
    { key: "ledger", label: "Ledger", icon: "account_balance", onSelect: () => setDest("ledger") },
    { key: "audit", label: "Audit", icon: "fact_check", onSelect: () => setDest("audit") },
  ];
  return (
    <AppShell
      nav={nav}
      active={dest}
      navLabel="Admin"
      topBar={
        <TopAppBar
          leading={<BrandMark />}
          title={TITLES[dest]}
          subtitle="Admin console"
          actions={
            <>
              <ThemeToggle />
              <IconButton icon="logout" label="Sign out" onClick={() => { setSession(null); setLocal(null); }} />
            </>
          }
        />
      }
    >
      <div className="mx-auto w-full max-w-[1200px] flex-1 space-y-4 px-4 pb-8 sm:px-6">
        {dest === "controls" && (
          <>
            <InlineMessage tone="info" live={false}>Changes here affect everyone using the demo right now.</InlineMessage>
            <div className="grid items-start gap-4 md:grid-cols-2">
              <ConfigPanel />
              <FaultsPanel />
            </div>
            <ResetPanel />
          </>
        )}
        {dest === "ledger" && <LedgerPanel />}
        {dest === "audit" && <AuditViewer />}
      </div>
    </AppShell>
  );
}
