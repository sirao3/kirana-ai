import { useState } from "react";
import { MotionConfig } from "motion/react";
import { AuditViewer, LedgerPanel } from "../components/admin/LedgerAudit";
import { ReadinessGroup, ReadinessStatus } from "../components/admin/Readiness";
import { ConfigPanel, FaultsPanel, ResetPanel } from "../components/admin/ControlPanels";
import { AppFrame, Button, C, Card, FONT, IBank, IconButton, IEye, IList, ISliders, LargeTitle, TextField, type FrameNav } from "../components/ui";
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
    <main className="flex min-h-dvh items-center justify-center px-4 py-10" style={{ background: C.bg, fontFamily: FONT }}>
      <Card className="w-full max-w-[400px]" padding={28}>
        <span className="mb-5 flex h-11 w-11 items-center justify-center rounded-[12px] text-[18px] font-bold text-white" style={{ background: C.green }} aria-hidden>K</span>
        <h1 className="text-[24px] font-bold tracking-[-0.02em]" style={{ color: C.label }}>Admin console</h1>
        <p className="mb-6 mt-1 text-[15px] leading-[1.45]" style={{ color: C.secondary }}>Reset the demo, set store faults and read the ledger.</p>
        <form onSubmit={submit} className="space-y-4" noValidate>
          <TextField
            label="Passcode"
            type={show ? "text" : "password"}
            autoFocus
            autoComplete="current-password"
            value={passcode}
            onValueChange={(v) => { setPasscode(v); setError(null); }}
            error={error}
            trailing={<IconButton label={show ? "Hide passcode" : "Show passcode"} size={40} className="-mr-2" onClick={() => setShow((v) => !v)}><IEye off={show} size={19} /></IconButton>}
          />
          <p className="sr-only" role="alert">{error ?? ""}</p>
          <Button type="submit" size="lg" full busy={busy} disabled={!passcode}>Sign in</Button>
        </form>
      </Card>
    </main>
  );
}

type Dest = "controls" | "ledger" | "audit";
const PAGES: Record<Dest, { title: string; subtitle: string }> = {
  controls: { title: "Controls", subtitle: "Changes here apply to everyone using the demo right now." },
  ledger: { title: "Ledger", subtitle: "One entry per delivered store order. Amounts in rupees." },
  audit: { title: "Audit", subtitle: "Every Beckn message and state change, per transaction." },
};

/** /admin: Controls (readiness, run settings, store faults, reset), Ledger, Audit. */
export function Admin() {
  const [session, setLocal] = useState<Session | null>(() => {
    const s = getSession();
    return s?.role === "admin" ? s : null;
  });
  const [dest, setDest] = useState<Dest>("controls");
  const [resetOpen, setResetOpen] = useState(false);
  if (!session) return <MotionConfig reducedMotion="user"><Gate onAuthed={setLocal} /></MotionConfig>;

  const nav: FrameNav[] = [
    { key: "controls", label: "Controls", icon: <ISliders />, onSelect: () => setDest("controls") },
    { key: "ledger", label: "Ledger", icon: <IBank />, onSelect: () => setDest("ledger") },
    { key: "audit", label: "Audit", icon: <IList />, onSelect: () => setDest("audit") },
  ];
  const openChecklist = () => {
    setDest("controls");
    setTimeout(() => {
      const el = document.getElementById("demo-readiness");
      el?.scrollIntoView({ block: "start", behavior: "smooth" });
      el?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    }, 0);
  };
  const page = PAGES[dest];
  return (
    <MotionConfig reducedMotion="user">
      <AppFrame nav={nav} active={dest} label="Admin" context="Admin console" maxWidth={dest === "controls" ? 760 : 1120}
        account={{ name: session.name || "Admin", role: "Signed in", switchLabel: "Sign out", onSwitch: () => { setSession(null); setLocal(null); } }}>
        <LargeTitle title={page.title} subtitle={page.subtitle} actions={<ReadinessStatus onOpen={openChecklist} />} className="mb-8" />
        {dest === "controls" && (
          <div className="space-y-8">
            <ReadinessGroup onReset={() => setResetOpen(true)} />
            <ConfigPanel />
            <FaultsPanel />
            <div className="pt-4"><ResetPanel open={resetOpen} onOpenChange={setResetOpen} /></div>
          </div>
        )}
        {dest === "ledger" && <LedgerPanel />}
        {dest === "audit" && <AuditViewer />}
      </AppFrame>
    </MotionConfig>
  );
}
