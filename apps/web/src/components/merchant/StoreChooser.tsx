import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { setSession, type Session } from "../../lib/session";
import { Button, C, FONT, Group, IStore, LargeTitle, Notice, Row, Skeleton, Spinner } from "../ui";

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
    if (busy) return;
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
    <div className="min-h-dvh px-4 pb-16 pt-6 sm:pt-16" style={{ background: C.bg, fontFamily: FONT, color: C.label }}>
      <main className="mx-auto max-w-[480px]">
        <Link to="/" className="mb-8 inline-flex items-center gap-2.5" aria-label="KiranaAI home">
          <span className="flex h-7 w-7 items-center justify-center rounded-[8px] text-[13px] font-bold text-white" style={{ background: C.green }}>K</span>
          <span className="text-[15px] font-semibold">KiranaAI <span className="font-normal" style={{ color: C.secondary }}>for stores</span></span>
        </Link>
        <LargeTitle title="Which store are you?" subtitle="Demo stores, no password needed. Each opens its own dashboard." className="mb-6" />
        {error && <Notice tone="bad" className="mb-4">{error}</Notice>}
        {q.isError ? (
          <Notice tone="bad" title="Could not load the stores" action={<Button variant="plain" size="sm" onClick={() => void q.refetch()}>Retry</Button>} />
        ) : (
          <Group footer="You can switch store later from the account menu.">
            {q.data
              ? q.data.stores.map((s) => (
                  <Row key={s.id} title={s.name} onClick={() => void choose(s.id)}
                    leading={<span className="flex h-8 w-8 items-center justify-center rounded-[8px]" style={{ background: C.fill, color: C.green }}><IStore size={18} /></span>}
                    trailing={busy === s.id ? <Spinner /> : undefined} chevron={busy !== s.id} />
                ))
              : [0, 1, 2, 3, 4].map((i) => (
                  <li key={i} className="flex h-[52px] items-center gap-3 px-4 [&+li]:border-t-[0.5px]" style={{ borderColor: C.sep }}>
                    <Skeleton className="h-8 w-8" /><Skeleton className="h-4 w-40" />
                  </li>
                ))}
          </Group>
        )}
      </main>
    </div>
  );
}
