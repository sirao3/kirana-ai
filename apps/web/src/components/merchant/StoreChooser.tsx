import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { setSession, type Session } from "../../lib/session";
import { Button, Card } from "../kit";

interface Personas {
  stores: { id: string; name: string }[];
}

/** Persona token for one store (demo personas: no passcode). */
export const merchantLogin = (id: string) =>
  api<Session>("/auth/persona", { method: "POST", json: { role: "merchant", id }, token: "" });

/** Shown on /merchant when there is no merchant session: pick a store, get its token. */
export function StoreChooser({ onChosen }: { onChosen: (s: Session) => void }) {
  const q = useQuery<Personas>({ queryKey: ["personas"], queryFn: () => api("/auth/personas") });
  async function choose(id: string) {
    const s = await merchantLogin(id);
    setSession(s);
    onChosen(s);
  }
  return (
    <main className="mx-auto max-w-lg p-6">
      <Card title="Which store are you?">
        <p className="mb-3 text-sm text-stone-600">Demo personas: pick a store to open its dashboard. No password needed.</p>
        <div className="grid gap-2">
          {q.data?.stores.map((s) => (
            <Button key={s.id} tone="secondary" className="justify-start" onClick={() => void choose(s.id)}>{s.name}</Button>
          ))}
          {q.isLoading && <p className="text-sm text-stone-500">Loading stores…</p>}
          {q.isError && <p className="text-sm text-rose-700">Could not load stores.</p>}
        </div>
      </Card>
    </main>
  );
}
