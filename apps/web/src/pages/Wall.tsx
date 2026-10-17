import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { Button } from "../components/kit";
import { unlockAudio } from "../components/merchant/alert";
import { merchantLogin } from "../components/merchant/StoreChooser";
import { StoreDashboard } from "../components/merchant/StoreDashboard";

interface StoreToken {
  id: string;
  name: string;
  token: string;
}

/** /wall: all 5 store dashboards side by side. Each uses its own merchant token, so no admin passcode is needed. */
export function Wall() {
  const qc = useQueryClient();
  const [working, setWorking] = useState(false);
  const stores = useQuery<StoreToken[]>({
    queryKey: ["wall-tokens"],
    staleTime: Infinity,
    queryFn: async () => {
      const { stores } = await api<{ stores: { id: string; name: string }[] }>("/auth/personas");
      return Promise.all(stores.map(async (s) => ({ ...s, token: (await merchantLogin(s.id)).token })));
    },
  });

  async function allOnline() {
    void unlockAudio(); // first click unlocks audio for every tile
    setWorking(true);
    try {
      await Promise.all(
        (stores.data ?? []).map((s) => api(`/bpp/merchant/${s.id}/store`, { method: "PATCH", token: s.token, json: { isOnline: true } })),
      );
      await qc.invalidateQueries({ queryKey: ["merchant"] });
    } finally {
      setWorking(false);
    }
  }

  return (
    <main className="p-3">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-lg font-semibold">Demo wall — all stores</h1>
        <Button onClick={() => void allOnline()} disabled={working || !stores.data}>All stores online</Button>
      </header>
      {stores.isError && <p className="text-sm text-rose-700">Could not load the stores.</p>}
      {stores.isLoading && <p className="text-sm text-stone-500">Loading stores…</p>}
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {stores.data?.map((s) => <StoreDashboard key={s.id} storeId={s.id} token={s.token} compact />)}
      </div>
    </main>
  );
}
