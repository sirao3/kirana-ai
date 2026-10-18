import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../lib/api";
import { AppShell, BrandMark, Button, CircularProgress, InlineMessage, ThemeToggle, TopAppBar, useSnackbar } from "../components/m3";
import { unlockAudio } from "../components/merchant/alert";
import { merchantLogin } from "../components/merchant/StoreChooser";
import { StoreTile } from "../components/merchant/StoreDashboard";

interface StoreToken {
  id: string;
  name: string;
  token: string;
}

/** /wall: all 5 store dashboards side by side. Each uses its own merchant token, so no admin passcode is needed. */
export function Wall() {
  const qc = useQueryClient();
  const snack = useSnackbar();
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
      snack("All stores are online. Offer sounds are on.");
    } catch {
      snack("Could not bring every store online.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <AppShell
      topBar={
        <TopAppBar
          leading={<BrandMark />}
          title="Store wall"
          subtitle="Every store, live. Offers ring and glow when they arrive."
          actions={
            <>
              <Button variant="tonal" icon="cloud_done" loading={working} disabled={!stores.data} onClick={() => void allOnline()}>
                <span className="max-sm:sr-only">All stores online</span>
              </Button>
              <ThemeToggle />
            </>
          }
        />
      }
    >
      <div className="px-4 pb-6 sm:px-6">
        {stores.isError && (
          <InlineMessage tone="error" action={<Button variant="text" onClick={() => void stores.refetch()}>Retry</Button>}>
            Could not load the stores.
          </InlineMessage>
        )}
        {stores.isLoading && (
          <div className="flex items-center gap-3 py-8 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading stores…</div>
        )}
        <div className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {stores.data?.map((s) => <StoreTile key={s.id} storeId={s.id} token={s.token} />)}
        </div>
      </div>
    </AppShell>
  );
}
