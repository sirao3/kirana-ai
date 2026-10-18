import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { paiseToRupees, rupeesToPaise } from "@kiranaai/shared";
import { api, ApiError } from "../../lib/api";
import { useMedia } from "../../lib/useMedia";
import {
  Button, CellField, CircularProgress, Dialog, EmptyState, InlineMessage, SegmentedButton, SelectField, StatusLabel, Switch, TextField, useSnackbar,
} from "../m3";
import { CsvImport } from "./CsvImport";
import type { Catalogue as CatalogueData, CatalogueItem } from "./types";

const UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Request failed");

/** A number cell that saves on blur / Enter when the value changed. `value` and `onSave` use the display unit (rupees or packs). */
function EditCell({ value, label, onSave, money }: { value: string; label: string; onSave: (v: string) => Promise<void>; money?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  async function commit() {
    if (draft === null || draft === value) return setDraft(null);
    setState("saving");
    try {
      await onSave(draft);
      setState("idle");
    } catch {
      setState("error");
    }
    setDraft(null);
  }
  return (
    <CellField
      label={label}
      prefix={money ? "₹" : undefined}
      state={state}
      inputMode={money ? "decimal" : "numeric"}
      className="w-24"
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
    />
  );
}

const EMPTY_NEW = { brand: "", name: "", variant: "", packSize: "", unit: "g" as (typeof UNITS)[number], category: "", gtin: "" };

/** Add-product dialog: list an existing catalogue product, or create a new one. */
function AddProductDialog({ open, onClose, storeId, token, data, onDone }: { open: boolean; onClose: () => void; storeId: string; token: string; data: CatalogueData; onDone: () => void }) {
  const snack = useSnackbar();
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [pick, setPick] = useState("");
  const [np, setNp] = useState(EMPTY_NEW);
  const [price, setPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [stock, setStock] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const listed = useMemo(() => new Set(data.items.map((i) => i.canonicalProductId)), [data.items]);
  const options = data.canonicalProducts.filter((p) => !listed.has(p.id));
  const categories = useMemo(() => [...new Set(data.canonicalProducts.map((p) => p.category))], [data.canonicalProducts]);

  function reset() {
    setPick(""); setPrice(""); setMrp(""); setStock(""); setNp(EMPTY_NEW); setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const pricePaise = rupeesToPaise(price);
      const body = {
        pricePaise,
        ...(mrp ? { mrpPaise: rupeesToPaise(mrp) } : {}),
        stockQty: Number(stock),
        ...(mode === "existing"
          ? { canonicalProductId: pick }
          : { newProduct: { ...np, packSize: Number(np.packSize), variant: np.variant || null, gtin: np.gtin || null } }),
      };
      await api(`/bpp/merchant/${storeId}/catalogue`, { method: "POST", token, json: body });
      snack("Product added. It is now searchable.");
      reset();
      onDone();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Enter valid prices (like 125.50) and a whole-number stock.");
    } finally {
      setBusy(false);
    }
  }

  const set = (k: keyof typeof EMPTY_NEW) => (v: string) => setNp({ ...np, [k]: v });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add a product"
      fullScreenOnCompact
      dismissible={!busy}
      actions={
        <>
          <Button variant="text" disabled={busy} onClick={onClose}>Cancel</Button>
          <Button type="submit" form="add-product" icon="add" loading={busy}>Add to catalogue</Button>
        </>
      }
    >
      <form id="add-product" onSubmit={submit} className="space-y-4 pt-1">
        <SegmentedButton
          label="Product source"
          className="w-full"
          value={mode}
          onChange={setMode}
          options={[
            { value: "existing", label: "From catalogue" },
            { value: "new", label: "New product" },
          ]}
        />
        {mode === "existing" ? (
          <SelectField label="Catalogue product" required value={pick} onChange={(e) => setPick(e.target.value)} supportingText={`${options.length} products you don't list yet`}>
            <option value="">Choose a product…</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.category})</option>)}
          </SelectField>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextField label="Brand" required value={np.brand} onValueChange={set("brand")} />
            <TextField label="Product name" required value={np.name} onValueChange={set("name")} />
            <TextField label="Variant (optional)" value={np.variant} onValueChange={set("variant")} />
            <TextField label="Category" required list="categories" value={np.category} onValueChange={set("category")} />
            <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <TextField label="Pack size" required inputMode="numeric" value={np.packSize} onValueChange={set("packSize")} supportingText="e.g. 500" />
            <SelectField label="Unit" value={np.unit} onChange={(e) => setNp({ ...np, unit: e.target.value as (typeof UNITS)[number] })}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </SelectField>
            <TextField label="GTIN (optional)" className="sm:col-span-2" value={np.gtin} onValueChange={set("gtin")} />
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-3">
          <TextField label="Price" required prefix="₹" inputMode="decimal" value={price} onValueChange={setPrice} />
          <TextField label="MRP (optional)" prefix="₹" inputMode="decimal" value={mrp} onValueChange={setMrp} />
          <TextField label="Stock" required suffix="packs" inputMode="numeric" value={stock} onValueChange={setStock} />
        </div>
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
      </form>
    </Dialog>
  );
}

/** Catalogue destination: filter, inline price/stock edit, active switch, add product, CSV import. */
export function Catalogue({ storeId, token }: { storeId: string; token: string }) {
  const qc = useQueryClient();
  const key = ["catalogue", storeId];
  const base = `/bpp/merchant/${storeId}/catalogue`;
  const q = useQuery<CatalogueData>({ queryKey: key, queryFn: () => api(base, { token }) });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"add" | "import" | null>(null);
  const compact = useMedia("(max-width: 599.98px)");

  const refresh = () => qc.invalidateQueries({ queryKey: key });
  async function patch(item: CatalogueItem, body: Record<string, unknown>) {
    setError(null);
    try {
      await api(`${base}/${item.listingId}`, { method: "PATCH", token, json: body });
      await refresh();
    } catch (e) {
      setError(`${item.brand} ${item.name}: ${errText(e)}`);
      throw e;
    }
  }

  if (!q.data) {
    return q.isError ? (
      <InlineMessage tone="error" action={<Button variant="text" onClick={() => void q.refetch()}>Retry</Button>}>Could not load the catalogue.</InlineMessage>
    ) : (
      <div className="flex items-center gap-3 py-8 type-body-medium text-on-surface-variant"><CircularProgress size={20} className="text-primary" /> Loading catalogue…</div>
    );
  }
  const items = q.data.items.filter((i) => `${i.brand} ${i.name} ${i.category}`.toLowerCase().includes(filter.toLowerCase()));
  const activeCount = q.data.items.filter((i) => i.active).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="type-title-large text-on-surface">My catalogue</h2>
          <p className="type-body-medium text-on-surface-variant">{q.data.items.length} products · {activeCount} active. Prices and stock save as you leave a field.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outlined" icon="upload_file" onClick={() => setDialog("import")}>Import CSV</Button>
          <Button icon="add" onClick={() => setDialog("add")}>Add product</Button>
        </div>
      </div>

      <TextField label="Filter products" leadingIcon="filter_list" dense className="max-w-sm" value={filter} onValueChange={setFilter} />
      {error && <InlineMessage tone="error">{error}</InlineMessage>}

      {compact ? (
        // Phones: one card per product with price / stock stacked, instead of a horizontally scrolling table.
        <ul className="space-y-3" aria-label="Products">
          {items.map((i) => (
            <li key={i.listingId} className="rounded-md border border-outline-variant p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className={i.active ? "type-body-large text-on-surface" : "type-body-large text-on-surface-variant"}>{i.brand} {i.name}</p>
                  <p className="type-body-small text-on-surface-variant">{i.category} · {i.packLabel} · MRP ₹{paiseToRupees(i.mrpPaise)}</p>
                  {!i.active && <StatusLabel icon="visibility_off" className="mt-1">Inactive</StatusLabel>}
                </div>
                <Switch hideLabel label={`${i.name} active`} checked={i.active} onChange={(v) => void patch(i, { active: v }).catch(() => {})} />
              </div>
              <div className="mt-2 flex flex-wrap gap-3">
                <div><p className="type-label-medium text-on-surface-variant" aria-hidden>Price</p><EditCell money label={`Price for ${i.name}`} value={paiseToRupees(i.pricePaise)} onSave={(v) => patch(i, { pricePaise: rupeesToPaise(v) })} /></div>
                <div><p className="type-label-medium text-on-surface-variant" aria-hidden>Stock (packs)</p><EditCell label={`Stock for ${i.name}`} value={String(i.stockQty)} onSave={(v) => patch(i, { stockQty: Number(v) })} /></div>
              </div>
            </li>
          ))}
          {items.length === 0 && <EmptyState icon="search_off" title="Nothing matches">Try a brand, product or category name.</EmptyState>}
        </ul>
      ) : (
      <div className="overflow-x-auto rounded-md border border-outline-variant">
        <table className="w-full min-w-[640px] type-body-medium">
          <thead className="bg-surface-container type-title-small text-on-surface-variant">
            <tr className="text-left">
              <th scope="col" className="px-4 py-3">Product</th>
              <th scope="col" className="px-2 py-3">Pack</th>
              <th scope="col" className="px-2 py-3 text-right">Price</th>
              <th scope="col" className="px-2 py-3 text-right">MRP</th>
              <th scope="col" className="px-2 py-3 text-right">Stock</th>
              <th scope="col" className="px-4 py-3 text-right">Active</th>
            </tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.listingId} className="border-t border-outline-variant hover:bg-on-surface/4">
                <td className="px-4 py-2">
                  <p className={i.active ? "type-body-large text-on-surface" : "type-body-large text-on-surface-variant"}>{i.brand} {i.name}</p>
                  <p className="flex items-center gap-2 type-body-small text-on-surface-variant">
                    {i.category}
                    {!i.active && <StatusLabel icon="visibility_off">Inactive</StatusLabel>}
                  </p>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-on-surface-variant">{i.packLabel}</td>
                <td className="px-2 py-2 text-right">
                  <EditCell money label={`Price for ${i.name}`} value={paiseToRupees(i.pricePaise)} onSave={(v) => patch(i, { pricePaise: rupeesToPaise(v) })} />
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-on-surface-variant">₹{paiseToRupees(i.mrpPaise)}</td>
                <td className="px-2 py-2 text-right">
                  <EditCell label={`Stock for ${i.name}`} value={String(i.stockQty)} onSave={(v) => patch(i, { stockQty: Number(v) })} />
                </td>
                <td className="px-4 py-2 text-right">
                  <Switch hideLabel label={`${i.name} active`} checked={i.active} onChange={(v) => void patch(i, { active: v }).catch(() => {})} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {items.length === 0 && <EmptyState icon="search_off" title="Nothing matches">Try a brand, product or category name.</EmptyState>}
      </div>
      )}

      <AddProductDialog open={dialog === "add"} onClose={() => setDialog(null)} storeId={storeId} token={token} data={q.data} onDone={refresh} />
      <CsvImport open={dialog === "import"} onClose={() => setDialog(null)} storeId={storeId} token={token} onApplied={refresh} />
    </div>
  );
}
