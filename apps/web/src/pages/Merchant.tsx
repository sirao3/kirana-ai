import { useState } from "react";
import { StoreChooser } from "../components/merchant/StoreChooser";
import { StoreDashboard } from "../components/merchant/StoreDashboard";
import { Button } from "../components/kit";
import { getSession, setSession, type Session } from "../lib/session";

/** /merchant: the logged-in store's dashboard; without a merchant session, a store chooser. */
export function Merchant() {
  const [session, setLocal] = useState<Session | null>(() => {
    const s = getSession();
    return s?.role === "merchant" ? s : null;
  });
  if (!session) return <StoreChooser onChosen={setLocal} />;
  return (
    <main className="mx-auto max-w-5xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-stone-500">Signed in as {session.name}</p>
        <Button tone="ghost" onClick={() => { setSession(null); setLocal(null); }}>Switch store</Button>
      </div>
      <StoreDashboard storeId={session.sub} token={session.token} />
    </main>
  );
}
