import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AddressView } from "@kiranaai/shared";
import { Button, C, CheckDraw, IPin, Sheet, Spinner } from "../ui";
import { useSnackbar } from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";
import { DANGER, LINK } from "./tokens";

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/** Delivery address: demo presets, and which stores deliver there. The map behind the card shows the same coverage. */
export function AddressSheet({ open, onClose, address, error, onRetry }: {
  open: boolean;
  onClose: () => void;
  address: AddressView | undefined;
  error: unknown;
  onRetry: () => void;
}) {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const id = useId();
  const change = useMutation({
    mutationFn: (presetId: string) => bap.setAddress(presetId),
    onSuccess: (a) => {
      qc.setQueryData(["address"], a);
      // Search, plans and quotes read the saved address on the server, so anything cached from the old one is stale.
      void qc.invalidateQueries({ queryKey: ["basket"] });
      const off = a.stores.filter((s) => !s.delivers).length;
      snack(off ? `Delivering to ${a.label}. ${off} store${off === 1 ? "" : "s"} can't deliver here.` : `Delivering to ${a.label}`);
    },
  });

  const serving = address?.stores.filter((s) => s.delivers).length ?? 0;
  const total = address?.stores.length ?? 0;
  const isPreset = (p: { lat: number; lng: number }) => !!address && p.lat === address.lat && p.lng === address.lng;

  return (
    <Sheet open={open} onClose={onClose} title="Delivery address" width={480} footer={<Button onClick={onClose}>Done</Button>}>
      {!address ? (
        error ? (
          <p role="alert" className="text-[15px]" style={{ color: DANGER }}>
            Could not load your address: {errorMessage(error)}{" "}
            <button type="button" className="cursor-pointer font-semibold" style={{ color: LINK }} onClick={onRetry}>Retry</button>
          </p>
        ) : <p className="flex items-center gap-2 py-6 text-[15px]" style={{ color: C.secondary }}><Spinner /> Loading address…</p>
      ) : (
        <div className="space-y-6">
          <p className="flex items-start gap-2.5 text-[15px] leading-[1.4]" style={{ color: C.label }}>
            <span className="mt-0.5 shrink-0" style={{ color: LINK }}><IPin size={18} /></span>{address.address}
          </p>

          <section aria-labelledby={`${id}-pick`}>
            <h3 id={`${id}-pick`} className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.secondary }}>Try a demo address</h3>
            <div role="radiogroup" aria-labelledby={`${id}-pick`} className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08)" }}>
              {address.presets.map((p, i) => {
                const sel = isPreset(p);
                const busy = change.isPending && change.variables === p.id;
                return (
                  <button key={p.id} type="button" role="radio" aria-checked={sel} disabled={change.isPending} onClick={() => !sel && change.mutate(p.id)}
                    className="flex min-h-[54px] w-full cursor-pointer items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-black/[0.025] disabled:cursor-default"
                    style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[15px]" style={{ color: C.label, fontWeight: sel ? 600 : 400 }}>{p.label}</span>
                      <span className="block text-[13px]" style={{ color: C.secondary }}>{p.hint}</span>
                    </span>
                    <span className="flex h-6 w-6 items-center justify-center">{busy ? <Spinner /> : sel ? <CheckDraw size={20} color={LINK} ring={false} /> : null}</span>
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 px-1 text-[12px]" style={{ color: C.secondary }}>Address search isn't connected in this demo, so these presets stand in for it.</p>
            {change.error && <p role="alert" className="mt-2 px-1 text-[13px]" style={{ color: DANGER }}>{errorMessage(change.error)}</p>}
          </section>

          <section aria-labelledby={`${id}-near`}>
            <h3 id={`${id}-near`} className="mb-1.5 px-1 text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.secondary }}>Stores that deliver here</h3>
            {total > 0 ? (
              <>
                <p className="mb-2 px-1 text-[14px]" style={{ color: C.label }} aria-live="polite">
                  {serving === total ? `All ${total} stores deliver to this address.` : serving === 0 ? `None of the ${total} stores deliver here. Pick another address to shop.` : `${serving} of ${total} stores deliver here. Search and plans only use these.`}
                </p>
                <ul className="overflow-hidden rounded-[14px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.08)" }}>
                  {address.stores.map((s, i) => (
                    <li key={s.storeId} className="flex min-h-11 items-center gap-3 px-4 py-2" style={{ borderTop: i ? `0.5px solid ${C.sep}` : undefined }}>
                      <span className="h-2 w-2 shrink-0 rounded-full" aria-hidden style={{ background: s.delivers ? C.green : "#C7C7CC" }} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px]" style={{ color: s.delivers ? C.label : C.secondary }}>{s.name}</span>
                        <span className="block text-[12px]" style={{ color: C.secondary }}>{km(s.distanceM)} away · delivers within {km(s.radiusM)}</span>
                      </span>
                      <span className="shrink-0 text-[13px] font-medium" style={{ color: s.delivers ? "#1A7536" : C.secondary }}>{s.delivers ? "Delivers" : "Too far"}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="px-1 text-[14px]" style={{ color: C.secondary }}>Store distances aren't available right now.</p>}
          </section>
        </div>
      )}
    </Sheet>
  );
}
