import { useEffect, useRef, useState } from "react";
import { useSnackbar } from "../m3";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { setPendingOffers, unlockAudio } from "./alert";
import type { Dashboard } from "./types";

/** Shown when an offer was answered elsewhere or expired before this store acted. */
export const TOO_LATE = "Too late — offer moved to another store";

/**
 * One store's live state (polls every second) and its actions: online toggle, accept/reject, advance.
 * Shared by the full merchant dashboard and the wall tiles.
 */
export function useStore(storeId: string, token: string) {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const key = ["merchant", storeId];
  const q = useLive<Dashboard>(key, () => api(`/bpp/merchant/${storeId}/dashboard`, { token }));
  const [tooLate, setTooLate] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const d = q.data;
  const pendingCount = d?.offers.length ?? 0;
  const topTotal = d?.offers.reduce((m, o) => Math.max(m, o.totalPaise), 0) ?? 0;
  useEffect(() => {
    setPendingOffers(`${storeId}`, pendingCount > 0 && !d?.store.faults.neverAnswer, { count: pendingCount, totalPaise: topTotal });
    return () => setPendingOffers(`${storeId}`, false);
  }, [storeId, pendingCount, topTotal, d?.store.faults.neverAnswer]);

  // An offer that disappears without this merchant answering it was taken by another store or timed out.
  const acted = useRef(new Set<string>());
  const prevOffers = useRef<string[] | null>(null);
  useEffect(() => {
    if (!d) return;
    const now = d.offers.map((o) => o.id);
    const gone = (prevOffers.current ?? []).filter((id) => !now.includes(id) && !acted.current.has(id));
    prevOffers.current = now;
    if (gone.length) snack(TOO_LATE);
  }, [d, snack]);

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
  const markTooLate = (id: string) => () => {
    setTooLate((s) => new Set(s).add(id));
    snack(TOO_LATE);
  };
  const post = (path: string, json?: unknown) => api(`/bpp/merchant/${storeId}${path}`, { method: "POST", token, json: json ?? {} });

  const answer = (offerId: string, path: string, json?: unknown) => {
    acted.current.add(offerId);
    return run(offerId, () => post(path, json), markTooLate(offerId));
  };

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
    accept: (offerId: string) => answer(offerId, `/offers/${offerId}/accept`),
    reject: (offerId: string, reason: string) => answer(offerId, `/offers/${offerId}/reject`, { reason }),
    advance: (orderId: string) => run(orderId, () => post(`/orders/${orderId}/advance`)),
  };
}

export type StoreState = ReturnType<typeof useStore>;
