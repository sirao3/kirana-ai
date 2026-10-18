import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { setSession, type Session } from "../../lib/session";
import { Avatar, BrandMark, Card, CircularProgress, Icon, InlineMessage, ThemeToggle, TopAppBar } from "../m3";

interface Personas {
  stores: { id: string; name: string }[];
}

/** Persona token for one store (demo personas: no passcode). */
export const merchantLogin = (id: string) =>
  api<Session>("/auth/persona", { method: "POST", json: { role: "merchant", id }, token: "" });

/** Shown on /merchant when there is no merchant session: pick a store, get its token. */
export function StoreChooser({ onChosen }: { onChosen: (s: Session) => void }) {
  const q = useQuery<Personas>({ queryKey: ["personas"], queryFn: () => api("/auth/personas") });
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function choose(id: string) {
    setBusy(id);
    setError(null);
    try {
      const s = await merchantLogin(id);
      setSession(s);
      onChosen(s);
    } catch {
      setError("Could not open that store. Is the server running?");
    } finally {
      setBusy(null);
    }
  }
  return (
    <div className="min-h-dvh bg-surface">
      <TopAppBar leading={<BrandMark />} title="Store dashboard" actions={<ThemeToggle />} />
      <main className="mx-auto max-w-lg px-4 py-6">
        <h2 className="type-headline-small text-on-surface">Which store are you?</h2>
        <p className="mb-4 mt-1 type-body-medium text-on-surface-variant">Demo personas: pick a store to open its dashboard. No password needed.</p>
        {error && <InlineMessage tone="error" className="mb-3">{error}</InlineMessage>}
        <Card variant="outlined" className="overflow-hidden py-2">
          <ul>
            {q.data?.stores.map((s) => (
              <li key={s.id}>
                <button className="state-layer flex min-h-14 w-full cursor-pointer items-center gap-4 px-4 py-2 text-left disabled:opacity-60" disabled={busy !== null} onClick={() => void choose(s.id)}>
                  <Avatar name={s.name} icon="storefront" />
                  <span className="min-w-0 flex-1 truncate type-body-large text-on-surface">{s.name}</span>
                  {busy === s.id ? <CircularProgress size={20} className="text-primary" /> : <Icon name="chevron_right" className="text-on-surface-variant" />}
                </button>
              </li>
            ))}
          </ul>
          {q.isLoading && <p className="flex items-center gap-3 px-4 py-3 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading stores…</p>}
          {q.isError && <p className="px-4 py-3 type-body-medium text-error">Could not load stores.</p>}
        </Card>
      </main>
    </div>
  );
}
