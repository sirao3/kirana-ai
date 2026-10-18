import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "../../lib/api";
import { merchantLogin } from "./StoreChooser";

export interface StoreToken {
  id: string;
  name: string;
  token: string;
}

/** One merchant token per demo store (personas need no passcode). Shared by /wall and the /demo cockpit. */
export function useWallTokens() {
  return useQuery<StoreToken[]>({
    queryKey: ["wall-tokens"],
    staleTime: Infinity,
    queryFn: async () => {
      const { stores } = await api<{ stores: { id: string; name: string }[] }>("/auth/personas");
      return Promise.all(stores.map(async (s) => ({ ...s, token: (await merchantLogin(s.id)).token })));
    },
  });
}

/** Bring every store online (the click that also unlocks audio is the caller's job). */
export async function setAllOnline(stores: StoreToken[], qc: ReturnType<typeof useQueryClient>): Promise<void> {
  await Promise.all(stores.map((s) => api(`/bpp/merchant/${s.id}/store`, { method: "PATCH", token: s.token, json: { isOnline: true } })));
  await qc.invalidateQueries({ queryKey: ["merchant"] });
}
