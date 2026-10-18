import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { setPendingOffers, unlockAudio } from "./alert";
import type { Dashboard } from "./types";

/**
 * One store's live state (polls every second) and its actions: online toggle, accept/reject, advance.
 * Shared by the full merchant dashboard and the wall tiles.
 */
export function useStore(storeId: string, token: string) {
  const qc = useQueryClient();
  const key = ["merchant", storeId];
  const q = useLive<Dashboard>(key, () => api(`/bpp/merchant/${storeId}/dashboard`, { token }));
  const [tooLate, setTooLate] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const d = q.data;
  const pendingCount = d?.offers.length ?? 0;
  useEffect(() => {
    setPendingOffers(`${storeId}`, pendingCount > 0 && !d?.store.faults.neverAnswer);
    return () => setPendingOffers(`${storeId}`, false);
  }, [storeId, pendingCount, d?.store.faults.neverAnswer]);

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  async function run(id: string, fn: () => Promise<unknown>, onConflict?: () => void) {
    setBusy(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409 && onConflict) onConflict();
      else setError(e instanceof ApiError ? `${e.code}${e.message !== e.code ? `: ${e.message}` : ""}` : "Request failed");
    } finally {
      setBusy(null);
      void refresh();
    }
  }
  const markTooLate = (id: string) => () => setTooLate((s) => new Set(s).add(id));
  const post = (path: string, json?: unknown) => api(`/bpp/merchant/${storeId}${path}`, { method: "POST", token, json: json ?? {} });

  return {
    q,
    d,
    busy,
    error,
    clearError: () => setError(null),
    tooLate,
    pendingCount,
    toggleOnline: async () => {
      void unlockAudio(); // the click is the user gesture that unlocks audio
      await run("online", () => api(`/bpp/merchant/${storeId}/store`, { method: "PATCH", token, json: { isOnline: !d?.store.isOnline } }));
    },
    accept: (offerId: string) => run(offerId, () => post(`/offers/${offerId}/accept`), markTooLate(offerId)),
    reject: (offerId: string, reason: string) => run(offerId, () => post(`/offers/${offerId}/reject`, { reason }), markTooLate(offerId)),
    advance: (orderId: string) => run(orderId, () => post(`/orders/${orderId}/advance`)),
  };
}

export type StoreState = ReturnType<typeof useStore>;
