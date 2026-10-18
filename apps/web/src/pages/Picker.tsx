import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { setSession, type Session } from "../lib/session";
import { Avatar, Button, Card, CircularProgress, Icon, InlineMessage, ThemeToggle, TopAppBar, BrandMark } from "../components/m3";

interface Personas {
  customers: { id: string; name: string }[];
  stores: { id: string; name: string }[];
}

type Login = { role: "customer" | "merchant"; id: string };

async function signIn(body: Login): Promise<Session> {
  const s = await api<Session>("/auth/persona", { method: "POST", json: body });
  const session: Session = { token: s.token, role: s.role, sub: s.sub, name: s.name };
  setSession(session);
  return session;
}

const DEMO_CUSTOMER = "cust_priya";

const STEPS = [
  { icon: "chat", title: "Say what you need", body: "Type your list in English or Hinglish. The agent searches nearby kirana stores over Beckn/ONDC." },
  { icon: "verified", title: "Approve one verified total", body: "Every store re-checks prices and stock. You approve and pay once, even when the basket spans several stores." },
  { icon: "two_wheeler", title: "Stores accept like ride-hailing", body: "Each store gets a timed offer. If it declines or goes silent, the order moves to the next store on its own." },
];

/** Persona row in a list: avatar, name, chevron. The whole row is the button. */
function PersonaRow({ name, icon, supporting, busy, disabled, onClick }: { name: string; icon?: string; supporting?: string; busy: boolean; disabled: boolean; onClick: () => void }) {
  return (
    <li>
      <button
        className="state-layer flex min-h-14 w-full cursor-pointer items-center gap-4 px-4 py-2 text-left disabled:cursor-not-allowed disabled:opacity-60"
        disabled={disabled}
        onClick={onClick}
      >
        <Avatar name={name} icon={icon} />
        <span className="min-w-0 flex-1">
          <span className="block truncate type-body-large text-on-surface">{name}</span>
          {supporting && <span className="block type-body-medium text-on-surface-variant">{supporting}</span>}
        </span>
        {busy ? <CircularProgress size={20} className="text-primary" /> : <Icon name="chevron_right" className="text-on-surface-variant" />}
      </button>
    </li>
  );
}

function RoleCard({ icon, title, subtitle, children }: { icon: string; title: string; subtitle: string; children: ReactNode }) {
  return (
    <Card variant="outlined" className="flex flex-col overflow-hidden">
      <header className="flex items-start gap-3 p-4 pb-2">
        <Icon name={icon} className="mt-0.5 text-primary" />
        <div>
          <h2 className="type-title-medium text-on-surface">{title}</h2>
          <p className="type-body-medium text-on-surface-variant">{subtitle}</p>
        </div>
      </header>
      <ul className="pb-2">{children}</ul>
    </Card>
  );
}

/** Landing page and persona picker. Doubles as the judge-friendly entry point. */
export function Picker() {
  const nav = useNavigate();
  const personas = useQuery({ queryKey: ["personas"], queryFn: () => api<Personas>("/auth/personas") });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function go(key: string, login: Login, to: string) {
    setBusy(key);
    setError(null);
    try {
      await signIn(login);
      nav(to);
    } catch {
      setError("Could not sign in. Is the server running?");
    } finally {
      setBusy(null);
    }
  }

  async function startDemo() {
    setBusy("demo");
    setError(null);
    // Open the wall first (inside the click) so pop-up blockers allow it; it signs itself in.
    const wall = window.open("/wall", "_blank");
    try {
      await signIn({ role: "customer", id: DEMO_CUSTOMER });
      nav("/shop");
    } catch {
      wall?.close();
      setError("Could not start the demo. Is the server running?");
    } finally {
      setBusy(null);
    }
  }

  const loading = personas.isLoading && (
    <li className="flex items-center gap-3 px-4 py-4 type-body-medium text-on-surface-variant">
      <CircularProgress size={20} className="text-primary" /> Loading…
    </li>
  );

  return (
    <div className="min-h-dvh bg-surface">
      <TopAppBar leading={<BrandMark />} title="KiranaAI" actions={<ThemeToggle />} />

      <main className="mx-auto max-w-[1200px] px-4 pb-16 sm:px-6">
        {/* Hero: the single expressive moment on this page. */}
        <section className="relative mt-2 overflow-hidden rounded-xl bg-primary-container px-6 py-10 text-on-primary-container sm:px-10 sm:py-14 md:grid md:grid-cols-[1.4fr_1fr] md:gap-10">
          <div className="relative z-10 max-w-2xl">
            <p className="mb-3 inline-flex items-center gap-2 rounded-sm bg-surface/60 px-3 py-1 type-label-large text-on-surface">
              <Icon name="hub" size={18} /> Agentic commerce on Beckn / ONDC
            </p>
            <h2 className="type-display-small type-emphasized sm:type-display-medium">Your weekly kirana basket, assembled by AI.</h2>
            <p className="mt-4 max-w-xl type-body-large">
              Tell the agent what you need. It compares nearby kirana stores, builds one basket with verified prices, and you approve and pay once.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              <Button size="lg" icon="play_arrow" expressive loading={busy === "demo"} disabled={busy !== null} onClick={startDemo}>
                {busy === "demo" ? "Starting demo…" : "Start demo"}
              </Button>
              <p className="max-w-xs type-body-medium">Signs you in as Priya and opens the live store wall in a new tab.</p>
            </div>
          </div>
          <ol className="relative z-10 mt-10 space-y-3 md:mt-0" aria-label="How it works">
            {STEPS.map((s, i) => (
              <li key={s.title} className="flex gap-4 rounded-lg bg-surface/70 p-4 text-on-surface">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-primary text-on-primary" aria-hidden>
                  <Icon name={s.icon} />
                </span>
                <div>
                  <p className="type-title-small">
                    <span className="sr-only">Step {i + 1}: </span>
                    {s.title}
                  </p>
                  <p className="type-body-medium text-on-surface-variant">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          {/* Decorative shapes from the M3 Expressive shape family. */}
          <svg aria-hidden className="pointer-events-none absolute -bottom-24 -left-16 h-72 w-72 text-primary opacity-10" viewBox="0 0 100 100">
            <path fill="currentColor" d="M50 0c8 0 12 9 19 12s17 0 21 7-2 15 0 22 10 13 10 20-9 11-12 18 0 17-7 21-15-2-22 0-13 10-20 10-11-9-18-12-17 0-21-7 2-15 0-22S0 56 0 49s9-11 12-18 0-17 7-21 15 2 22 0S43 0 50 0z" />
          </svg>
        </section>

        {error && <InlineMessage tone="error" className="mt-4">{error}</InlineMessage>}
        {personas.isError && (
          <InlineMessage tone="error" className="mt-4" action={<Button variant="text" onClick={() => void personas.refetch()}>Retry</Button>}>
            Could not load the demo personas. Check that the server is running.
          </InlineMessage>
        )}

        <h2 className="mb-4 mt-10 type-headline-small text-on-surface">Or pick a role</h2>
        <div className="grid gap-4 md:grid-cols-3">
          <RoleCard icon="shopping_basket" title="Shop as a customer" subtitle="Chat with the agent or search yourself.">
            {loading}
            {(personas.data?.customers ?? []).map((c) => (
              <PersonaRow key={c.id} name={c.name} busy={busy === c.id} disabled={busy !== null} onClick={() => go(c.id, { role: "customer", id: c.id }, "/shop")} />
            ))}
          </RoleCard>
          <RoleCard icon="storefront" title="Run a store" subtitle="Accept offers, fulfil orders, edit the catalogue.">
            {loading}
            {(personas.data?.stores ?? []).map((s) => (
              <PersonaRow key={s.id} name={s.name} icon="storefront" busy={busy === s.id} disabled={busy !== null} onClick={() => go(s.id, { role: "merchant", id: s.id }, "/merchant")} />
            ))}
          </RoleCard>
          <RoleCard icon="monitoring" title="Operations" subtitle="For the demo presenter.">
            <PersonaRow name="Store wall" icon="grid_view" supporting="All 5 stores live, side by side" busy={false} disabled={busy !== null} onClick={() => nav("/wall")} />
            <PersonaRow name="Admin console" icon="admin_panel_settings" supporting="Reset, faults, ledger, audit" busy={false} disabled={busy !== null} onClick={() => nav("/admin")} />
          </RoleCard>
        </div>
      </main>
    </div>
  );
}
