import { useId } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { AddressView, StoreServiceability } from "@kiranaai/shared";
import { cx, BottomSheet, Button, CircularProgress, Dialog, Icon, InlineMessage, StatusLabel, useSnackbar } from "../m3";
import { bap } from "./bap";
import { errorMessage } from "./errors";

const km = (m: number) => `${(m / 1000).toFixed(1)} km`;

/** Delivery address: bottom sheet on compact windows, dialog on expanded ones. */
export function AddressSheet({ open, onClose, wide, address, loading, error, onRetry }: {
  open: boolean;
  onClose: () => void;
  wide: boolean;
  address: AddressView | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
}) {
  const body = <AddressBody address={address} loading={loading} error={error} onRetry={onRetry} />;
  return wide ? (
    <Dialog open={open} onClose={onClose} title="Delivery address" wide actions={<Button onClick={onClose}>Done</Button>}>
      {body}
    </Dialog>
  ) : (
    <BottomSheet open={open} onClose={onClose} title="Delivery address">
      <div className="space-y-1 pb-2">
        <h2 className="type-title-large text-on-surface">Delivery address</h2>
        {body}
        <Button className="mt-4 w-full" onClick={onClose}>Done</Button>
      </div>
    </BottomSheet>
  );
}

function AddressBody({ address, loading, error, onRetry }: { address: AddressView | undefined; loading: boolean; error: unknown; onRetry: () => void }) {
  const qc = useQueryClient();
  const snack = useSnackbar();
  const groupId = useId();
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

  if (!address) {
    return error ? (
      <InlineMessage tone="error" action={<Button variant="text" onClick={onRetry}>Retry</Button>}>
        Could not load your address: {errorMessage(error)}
      </InlineMessage>
    ) : (
      <div className="flex items-center gap-3 py-6 type-body-medium text-on-surface-variant">
        <CircularProgress size={20} className="text-primary" /> {loading ? "Loading address…" : "…"}
      </div>
    );
  }

  const isPreset = address.presets.some((p) => p.lat === address.lat && p.lng === address.lng);
  const serving = address.stores.filter((s) => s.delivers).length;
  const total = address.stores.length;

  return (
    <div className="space-y-5 text-on-surface">
      <div className="flex items-start gap-3 rounded-md bg-surface-container p-3">
        <Icon name="location_on" filled className="mt-0.5 text-primary" />
        <div className="min-w-0">
          <p className="type-label-medium text-on-surface-variant">Saved address</p>
          <p className="type-body-large">{address.address}</p>
        </div>
      </div>

      <section aria-labelledby={`${groupId}-pick`} className="space-y-3">
        <div>
          <h3 id={`${groupId}-pick`} className="type-title-small">Try a demo address</h3>
          <p className="type-body-small text-on-surface-variant">Address search is not connected in this demo, so these presets stand in for it.</p>
        </div>
        {change.error && <InlineMessage tone="error">{errorMessage(change.error)}</InlineMessage>}
        <div role="radiogroup" aria-labelledby={`${groupId}-pick`} className="grid gap-2">
          {address.presets.map((p) => {
            const selected = isPreset && p.lat === address.lat && p.lng === address.lng;
            const busy = change.isPending && change.variables === p.id;
            return (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={change.isPending}
                onClick={() => !selected && change.mutate(p.id)}
                className={cx(
                  "state-layer flex min-h-14 w-full cursor-pointer items-center gap-3 rounded-md border px-3 py-2 text-left disabled:cursor-default",
                  selected ? "border-primary bg-secondary-container text-on-secondary-container" : "border-outline-variant text-on-surface",
                )}
              >
                <Icon name="location_on" className={selected ? "" : "text-on-surface-variant"} />
                <span className="min-w-0 flex-1">
                  <span className="block type-body-large">{p.label}</span>
                  <span className={cx("block type-body-small", selected ? "" : "text-on-surface-variant")}>{p.hint}</span>
                </span>
                {busy ? <CircularProgress size={20} label="Saving" /> : selected ? <Icon name="check" /> : null}
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby={`${groupId}-near`} className="space-y-3">
        <h3 id={`${groupId}-near`} className="type-title-small">Stores that deliver here</h3>
        {total > 0 ? (
          <>
            <p className="type-body-medium text-on-surface-variant" aria-live="polite">
              {serving === total
                ? `All ${total} stores deliver to this address.`
                : serving === 0
                  ? `None of the ${total} stores deliver to this address. Pick another one to shop.`
                  : `${serving} of ${total} stores deliver here. Search and basket plans only use these.`}
            </p>
            <ServiceMap address={address} />
            <ul className="divide-y divide-outline-variant rounded-md border border-outline-variant">
              {address.stores.map((s) => (
                <li key={s.storeId} className="flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <Icon name="storefront" className={s.delivers ? "text-primary" : "text-on-surface-variant"} />
                  <div className="min-w-0 flex-1 basis-40">
                    <p className="truncate type-body-large">{s.name}</p>
                    <p className="type-body-small text-on-surface-variant">{km(s.distanceM)} away · delivers within {km(s.radiusM)}</p>
                  </div>
                  {s.delivers ? <StatusLabel tone="success" icon="check_circle">Delivers to you</StatusLabel> : <StatusLabel tone="warning" icon="block">Doesn't deliver to you</StatusLabel>}
                </li>
              ))}
            </ul>
          </>
        ) : (
          <p className="type-body-medium text-on-surface-variant">Store distances are not available right now.</p>
        )}
      </section>
    </div>
  );
}

// ---------- Approximate map (no Maps API): equirectangular projection of stores, their radii and the customer pin ----------

const W = 320;
const H = 220;
const PAD = 28;

/** Metres east / north of (lat0, lng0). Accurate enough at city scale. */
const toXY = (lat: number, lng: number, lat0: number, lng0: number) => ({
  x: (lng - lng0) * 111_320 * Math.cos((lat0 * Math.PI) / 180),
  y: (lat - lat0) * 110_574,
});

export function ServiceMap({ address }: { address: AddressView }) {
  const stores = address.stores;
  if (!stores.length) return null;
  const lat0 = address.lat;
  const lng0 = address.lng;
  const pts = [{ x: 0, y: 0 }, ...stores.map((s) => toXY(s.lat, s.lng, lat0, lng0))];
  const minX = Math.min(...pts.map((p) => p.x));
  const maxX = Math.max(...pts.map((p) => p.x));
  const minY = Math.min(...pts.map((p) => p.y));
  const maxY = Math.max(...pts.map((p) => p.y));
  const scale = Math.min((W - 2 * PAD) / Math.max(maxX - minX, 500), (H - 2 * PAD) / Math.max(maxY - minY, 500));
  const cx0 = (minX + maxX) / 2;
  const cy0 = (minY + maxY) / 2;
  const px = (p: { x: number; y: number }) => ({ x: W / 2 + (p.x - cx0) * scale, y: H / 2 - (p.y - cy0) * scale });
  const me = px({ x: 0, y: 0 });
  const summary = `Map of ${stores.length} stores around your address. ${stores.filter((s) => s.delivers).length} deliver to you.`;

  return (
    <figure className="m-0 mx-auto max-w-[460px]">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={summary} className="block w-full rounded-md bg-surface-container-low">
        <defs>
          <clipPath id="map-clip"><rect width={W} height={H} rx="12" /></clipPath>
        </defs>
        <g clipPath="url(#map-clip)">
          {stores.map((s) => (
            <RadiusRing key={s.storeId} s={s} c={px(toXY(s.lat, s.lng, lat0, lng0))} r={s.radiusM * scale} />
          ))}
          {stores.map((s) => {
            const c = px(toXY(s.lat, s.lng, lat0, lng0));
            return (
              <g key={`${s.storeId}-pin`}>
                <circle cx={c.x} cy={c.y} r="4.5" className={s.delivers ? "fill-primary" : "fill-outline"} />
                <text x={c.x} y={c.y - 8} textAnchor="middle" fontSize="9" className={cx(s.delivers ? "fill-on-surface" : "fill-on-surface-variant")} style={{ paintOrder: "stroke" }} strokeWidth="3" stroke="var(--md-surface-container-low)">
                  {s.name.split(" ")[0]}
                </text>
              </g>
            );
          })}
          <circle cx={me.x} cy={me.y} r="9" className="fill-tertiary" fillOpacity="0.25" />
          <circle cx={me.x} cy={me.y} r="5" className="fill-tertiary stroke-surface" strokeWidth="2" />
          <text x={me.x} y={me.y + 20} textAnchor="middle" fontSize="9" fontWeight="600" className="fill-tertiary" style={{ paintOrder: "stroke" }} strokeWidth="3" stroke="var(--md-surface-container-low)">
            You
          </text>
        </g>
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 type-body-small text-on-surface-variant">
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-tertiary" aria-hidden /> Your address</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-primary" aria-hidden /> Store that delivers</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-outline" aria-hidden /> Too far</span>
        <span>Approximate positions and delivery radii.</span>
      </figcaption>
    </figure>
  );
}

function RadiusRing({ s, c, r }: { s: StoreServiceability; c: { x: number; y: number }; r: number }) {
  return s.delivers ? (
    <circle cx={c.x} cy={c.y} r={r} className="fill-primary stroke-primary" fillOpacity="0.07" strokeOpacity="0.5" strokeWidth="1" />
  ) : (
    <circle cx={c.x} cy={c.y} r={r} className="fill-none stroke-outline" strokeWidth="1" strokeDasharray="4 3" />
  );
}
