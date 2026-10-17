import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "../../lib/api";
import { useLive } from "../../lib/live";
import { Badge } from "../kit";
import { setPendingOffers, unlockAudio } from "./alert";
import { Catalogue } from "./Catalogue";
import { OfferCard } from "./OfferCard";
import { OrderCard } from "./OrderCard";
import type { Dashboard } from "./types";

/**
 * One store's live dashboard (polls every second): Online toggle, offer cards, orders column and
 * (full size only) the catalogue tab. `compact` is the wall tile.
 */
export function StoreDashboard({ storeId, token, compact = false }: { storeId: string; token: string; compact?: boolean }) {
  const qc = useQueryClient();
  const key = ["merchant", storeId];
  const q = useLive<Dashboard>(key, () => api(`/bpp/merchant/${storeId}/dashboard`, { token }));
  const [tab, setTab] = useState<"orders" | "catalogue">("orders");
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

  async function toggleOnline() {
    void unlockAudio(); // the click is the user gesture that unlocks audio
    await run("online", () => api(`/bpp/merchant/${storeId}/store`, { method: "PATCH", token, json: { isOnline: !d?.store.isOnline } }));
  }

  if (q.isError && !d) {
    return <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">Could not load this store ({(q.error as Error).message}).</div>;
  }
  if (!d) return <div className="rounded-xl border border-stone-200 bg-white p-4 text-sm text-stone-500">Loading store…</div>;

  const online = d.store.isOnline;
  const activeOrders = d.orders.filter((o) => o.fulfilmentStatus !== "DELIVERED");
  const doneOrders = d.orders.filter((o) => o.fulfilmentStatus === "DELIVERED");

  return (
    <section className={`rounded-xl border border-stone-200 bg-stone-50 ${compact ? "p-2" : "p-4"}`} data-testid={`dashboard-${storeId}`}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h2 className={`truncate font-semibold ${compact ? "text-sm" : "text-lg"}`}>{d.store.name}</h2>
          <div className="flex flex-wrap gap-1">
            {d.store.faults.autoReject && <Badge tone="warn">auto-reject</Badge>}
            {d.store.faults.neverAnswer && <Badge tone="warn">never answers</Badge>}
          </div>
        </div>
        <button
          role="switch"
          aria-checked={online}
          onClick={toggleOnline}
          disabled={busy === "online"}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium ${online ? "border-emerald-300 bg-emerald-100 text-emerald-800" : "border-stone-300 bg-white text-stone-600"}`}
        >
          <span className={`h-2.5 w-2.5 rounded-full ${online ? "bg-emerald-500" : "bg-stone-400"}`} />
          {online ? "Online" : "Offline"}
        </button>
      </header>

      {error && <p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}

      {!compact && (
        <div className="mb-3 flex gap-1 border-b border-stone-200" role="tablist">
          {(["orders", "catalogue"] as const).map((t) => (
            <button
              key={t}
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b-2 px-3 py-1.5 text-sm font-medium capitalize ${tab === t ? "border-emerald-600 text-emerald-700" : "border-transparent text-stone-500 hover:text-stone-800"}`}
            >
              {t === "orders" ? "Offers & orders" : "Catalogue"}
            </button>
          ))}
        </div>
      )}

      {tab === "catalogue" && !compact ? (
        <Catalogue storeId={storeId} token={token} />
      ) : (
        <div className={compact ? "space-y-3" : "grid gap-4 md:grid-cols-2"}>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">
              New offers {pendingCount > 0 && <Badge tone="warn">{pendingCount}</Badge>}
            </h3>
            <div className="space-y-2">
              {d.offers.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-3 text-center text-xs text-stone-500">{online ? "Waiting for orders…" : "Go online to receive orders"}</p>}
              {d.offers.map((o) => (
                <OfferCard
                  key={o.id}
                  offer={o}
                  compact={compact}
                  hideActions={d.store.faults.neverAnswer}
                  tooLate={tooLate.has(o.id)}
                  busy={busy === o.id}
                  onAccept={() => run(o.id, () => post(`/offers/${o.id}/accept`), markTooLate(o.id))}
                  onReject={(reason) => run(o.id, () => post(`/offers/${o.id}/reject`, { reason }), markTooLate(o.id))}
                />
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-stone-500">Orders</h3>
            <div className="space-y-2">
              {activeOrders.length === 0 && doneOrders.length === 0 && <p className="rounded-lg border border-dashed border-stone-300 p-3 text-center text-xs text-stone-500">No orders yet</p>}
              {[...activeOrders, ...doneOrders].map((o) => (
                <OrderCard key={o.id} order={o} busy={busy === o.id} onAdvance={() => run(o.id, () => post(`/orders/${o.id}/advance`))} />
              ))}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
