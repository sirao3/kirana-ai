import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { setSession, type Session } from "../lib/session";
import { Button, Card } from "../components/kit";

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

  return (
    <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-8">
      <header className="space-y-3 pt-4">
        <h1 className="text-3xl font-bold tracking-tight">KiranaAI</h1>
        <p className="text-stone-700">
          Tell an AI agent what you need. It finds packaged groceries across nearby kirana stores over Beckn/ONDC, builds one
          basket with verified prices, and you approve and pay once.
        </p>
        <p className="text-stone-700">
          Each store gets a timed offer, ride-hailing style. If a store rejects or stays silent, the order moves to the next
          store automatically.
        </p>
        <Button className="w-full py-4 text-lg sm:w-auto" disabled={busy !== null} onClick={startDemo}>
          {busy === "demo" ? "Starting…" : "Start demo"}
        </Button>
        <p className="text-sm text-stone-500">Signs you in as Priya, opens the shop here and the store wall in a new tab.</p>
        {error && (
          <p role="alert" className="rounded-lg bg-rose-50 p-3 text-sm text-rose-800">
            {error}
          </p>
        )}
      </header>

      <Card title="Shop as a customer">
        <div className="flex flex-wrap gap-2">
          {(personas.data?.customers ?? []).map((c) => (
            <Button key={c.id} tone="secondary" disabled={busy !== null} onClick={() => go(c.id, { role: "customer", id: c.id }, "/shop")}>
              {c.name}
            </Button>
          ))}
          {personas.isLoading && <span className="text-sm text-stone-500">Loading…</span>}
          {personas.isError && <span className="text-sm text-rose-700">Could not load personas.</span>}
        </div>
      </Card>

      <Card title="Run a store">
        <div className="flex flex-wrap gap-2">
          {(personas.data?.stores ?? []).map((s) => (
            <Button key={s.id} tone="secondary" disabled={busy !== null} onClick={() => go(s.id, { role: "merchant", id: s.id }, "/merchant")}>
              {s.name}
            </Button>
          ))}
        </div>
      </Card>

      <Card title="Operations">
        <div className="flex flex-wrap gap-2">
          <Button tone="secondary" onClick={() => nav("/wall")}>
            Store wall (all 5 stores)
          </Button>
          <Button tone="secondary" onClick={() => nav("/admin")}>
            Admin console
          </Button>
        </div>
      </Card>
    </main>
  );
}
