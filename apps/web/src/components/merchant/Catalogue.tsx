import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { paiseToRupees, rupeesToPaise } from "@kiranaai/shared";
import { api, ApiError } from "../../lib/api";
import { useMedia } from "../../lib/useMedia";
import { useSnackbar } from "../ui/toast";
import {
  Button, C, CheckDraw, EmptyState, IChevron, IPlus, IUpload, IWarning, LargeTitle, Notice, SearchField, Segmented, Sheet, Skeleton, Spinner, StatusText,
  Switch, TextField, cx,
} from "../ui";
import { CsvImport } from "./CsvImport";
import type { Catalogue as CatalogueData, CatalogueItem } from "./types";

const UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
const errText = (e: unknown) => (e instanceof ApiError ? e.message : "Request failed");

/**
 * A number that reads as plain text until hovered or focused, then edits in place. Saves on blur / Enter when changed;
 * Esc reverts. Shows saving, saved and error right in the cell. `value` and `onSave` use the display unit (rupees or packs).
 */
function EditCell({ value, label, onSave, money }: { value: string; label: string; onSave: (v: string) => Promise<void>; money?: boolean }) {
  const [draft, setDraft] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  async function commit() {
    if (draft === null || draft === value) return setDraft(null);
    setState("saving");
    try {
      await onSave(draft);
      setState("saved");
      timer.current = setTimeout(() => setState("idle"), 1400);
    } catch {
      setState("error");
    }
    setDraft(null);
  }
  const bad = state === "error";
  return (
    <span className={cx("group inline-flex h-11 items-center gap-0.5 rounded-[10px] pl-2 pr-1.5 transition-colors hover:bg-black/[0.035] focus-within:bg-white focus-within:ring-2", bad && "ring-1")}
      style={{ ["--tw-ring-color" as string]: bad ? C.red : C.blue }}>
      {money && <span className="text-[15px]" style={{ color: C.secondary }}>₹</span>}
      <input aria-label={label} aria-invalid={bad || undefined} inputMode={money ? "decimal" : "numeric"} value={draft ?? value}
        onChange={(e) => setDraft(e.target.value)} onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setDraft(null);
        }}
        className="bg-transparent text-right text-[15px] outline-none" style={{ width: `${Math.max(3, (draft ?? value).length) + 0.6}ch`, color: C.label, fontVariantNumeric: "tabular-nums" }} />
      <span className="flex w-4 justify-center" aria-live="polite">
        {state === "saving" ? <Spinner size={13} /> : state === "saved" ? <CheckDraw size={15} ring={false} /> : bad ? <span style={{ color: C.red }} title="Not saved"><IWarning size={15} /><span className="sr-only">Not saved</span></span> : null}
      </span>
    </span>
  );
}

/** Native select styled like the kit TextField (the kit has no select). */
function SelectField({ label, value, onChange, help, required, children }: { label: string; value: string; onChange: (v: string) => void; help?: ReactNode; required?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1.5 block text-[13px] font-medium" style={{ color: C.secondary }}>{label}</label>
      <div className="relative">
        <select id={id} value={value} required={required} onChange={(e) => onChange(e.target.value)} aria-describedby={help ? `${id}-help` : undefined}
          className="h-11 w-full cursor-pointer appearance-none rounded-[12px] bg-white pl-3 pr-9 text-[15px] outline-none focus:ring-2"
          style={{ color: C.label, boxShadow: "inset 0 0 0 1px rgba(60,60,67,0.18)", ["--tw-ring-color" as string]: C.blue }}>
          {children}
        </select>
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rotate-90" style={{ color: C.secondary }}><IChevron size={14} /></span>
      </div>
      {help && <p id={`${id}-help`} className="mt-1.5 text-[12px]" style={{ color: C.secondary }}>{help}</p>}
    </div>
  );
}

const EMPTY_NEW = { brand: "", name: "", variant: "", packSize: "", unit: "g" as (typeof UNITS)[number], category: "", gtin: "" };

/** Add-product sheet: list an existing catalogue product, or create a new one. */
function AddProductSheet({ open, onClose, storeId, token, data, onDone }: { open: boolean; onClose: () => void; storeId: string; token: string; data: CatalogueData; onDone: () => void }) {
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

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const body = {
        pricePaise: rupeesToPaise(price),
        ...(mrp ? { mrpPaise: rupeesToPaise(mrp) } : {}),
        stockQty: Number(stock),
        ...(mode === "existing"
          ? { canonicalProductId: pick }
          : { newProduct: { ...np, packSize: Number(np.packSize), variant: np.variant || null, gtin: np.gtin || null } }),
      };
      await api(`/bpp/merchant/${storeId}/catalogue`, { method: "POST", token, json: body });
      snack("Product added. It is now searchable.");
      setPick(""); setPrice(""); setMrp(""); setStock(""); setNp(EMPTY_NEW);
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
    <Sheet open={open} onClose={onClose} title="Add a product" dismissible={!busy} width={560}
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={onClose}>Cancel</Button>
        <Button type="submit" form="add-product" busy={busy}>Add to catalogue</Button>
      </>}>
      <form id="add-product" onSubmit={submit} className="space-y-5 pt-1">
        <Segmented label="Product source" className="w-full" value={mode} onChange={setMode}
          options={[{ value: "existing", label: "From catalogue" }, { value: "new", label: "New product" }]} />
        {mode === "existing" ? (
          <SelectField label="Catalogue product" required value={pick} onChange={setPick} help={`${options.length} products you don't list yet`}>
            <option value="">Choose a product…</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.category})</option>)}
          </SelectField>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField label="Brand" required value={np.brand} onValueChange={set("brand")} />
            <TextField label="Product name" required value={np.name} onValueChange={set("name")} />
            <TextField label="Variant (optional)" value={np.variant} onValueChange={set("variant")} />
            <TextField label="Category" required list="categories" className="[&_input::-webkit-calendar-picker-indicator]:!hidden" value={np.category} onValueChange={set("category")} />
            <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <TextField label="Pack size" required inputMode="numeric" value={np.packSize} onValueChange={set("packSize")} help="e.g. 500" />
            <SelectField label="Unit" value={np.unit} onChange={(v) => setNp({ ...np, unit: v as (typeof UNITS)[number] })}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </SelectField>
            <TextField label="GTIN (optional)" className="sm:col-span-2" value={np.gtin} onValueChange={set("gtin")} />
          </div>
        )}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
          <TextField label="Price" required prefix="₹" inputMode="decimal" value={price} onValueChange={setPrice} />
          <TextField label="MRP (optional)" prefix="₹" inputMode="decimal" value={mrp} onValueChange={setMrp} />
          <TextField label="Stock" required suffix="packs" inputMode="numeric" value={stock} onValueChange={setStock} />
        </div>
        {error && <Notice tone="bad">{error}</Notice>}
      </form>
    </Sheet>
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
  const [sheet, setSheet] = useState<"add" | "import" | null>(null);
  const phone = useMedia("(max-width: 599.98px)");

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

  const all = q.data?.items ?? [];
  const items = all.filter((i) => `${i.brand} ${i.name} ${i.category}`.toLowerCase().includes(filter.toLowerCase()));
  const activeCount = all.filter((i) => i.active).length;
  const price = (i: CatalogueItem) => <EditCell money label={`Price for ${i.name}`} value={paiseToRupees(i.pricePaise)} onSave={(v) => patch(i, { pricePaise: rupeesToPaise(v) })} />;
  const stock = (i: CatalogueItem) => <EditCell label={`Stock for ${i.name}`} value={String(i.stockQty)} onSave={(v) => patch(i, { stockQty: Number(v) })} />;
  const active = (i: CatalogueItem) => <Switch hideLabel label={`${i.name} active`} checked={i.active} onChange={(v) => void patch(i, { active: v }).catch(() => {})} />;
  const name = (i: CatalogueItem) => (
    <>
      <p className="text-[15px] leading-[1.3]" style={{ color: i.active ? C.label : C.secondary }}>{i.brand} {i.name}</p>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px]" style={{ color: C.secondary }}>
        {i.category} · {i.packLabel}{phone && ` · MRP ₹${paiseToRupees(i.mrpPaise)}`}
        {!i.active && <StatusText>Hidden from customers</StatusText>}
      </p>
    </>
  );

  return (
    <div className="space-y-5">
      <LargeTitle title="Catalogue"
        subtitle={q.data ? `${all.length} products · ${activeCount} active. Changes save as you leave a field.` : "Your products, prices and stock"}
        actions={<>
          <Button variant="secondary" icon={<IUpload size={17} />} onClick={() => setSheet("import")}>Import CSV</Button>
          <Button icon={<IPlus size={17} />} onClick={() => setSheet("add")} disabled={!q.data}>Add product</Button>
        </>} />

      <SearchField label="Filter products" type="text" placeholder="Filter by brand, product or category" className="sm:max-w-sm" value={filter} onValueChange={setFilter} />
      {error && <Notice tone="bad" action={<Button variant="plain" size="sm" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Notice>}

      {q.isError && !q.data ? (
        <Notice tone="bad" title="Could not load the catalogue" action={<Button variant="plain" size="sm" onClick={() => void q.refetch()}>Retry</Button>} />
      ) : !q.data ? (
        <Skeleton className="h-[320px] w-full" style={{ borderRadius: 18 }} />
      ) : items.length === 0 ? (
        <EmptyState title="Nothing matches">Try a brand, product or category name.</EmptyState>
      ) : phone ? (
        <ul aria-label="Products" className="overflow-hidden rounded-[18px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)" }}>
          {items.map((i) => (
            <li key={i.listingId} className="px-4 py-3 [&+li]:border-t-[0.5px]" style={{ borderColor: C.sep }}>
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">{name(i)}</div>
                {active(i)}
              </div>
              <div className="-ml-2 mt-1 flex gap-4 text-[13px]" style={{ color: C.secondary }}>
                <span className="flex items-center"><span className="pl-2" aria-hidden>Price</span>{price(i)}</span>
                <span className="flex items-center"><span aria-hidden>Stock</span>{stock(i)}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-x-auto rounded-[18px] bg-white" style={{ boxShadow: "0 0 0 0.5px rgba(0,0,0,0.05), 0 1px 2px rgba(0,0,0,0.03)" }}>
          <table className="w-full min-w-[640px]">
            <thead>
              <tr className="text-left text-[12px] font-semibold uppercase tracking-[0.04em]" style={{ color: C.tertiary }}>
                <th scope="col" className="px-5 pb-2 pt-4 font-semibold">Product</th>
                <th scope="col" className="px-2 pb-2 pt-4 text-right font-semibold"><span className="pr-6">Price</span></th>
                <th scope="col" className="px-2 pb-2 pt-4 text-right font-semibold">MRP</th>
                <th scope="col" className="px-2 pb-2 pt-4 text-right font-semibold"><span className="pr-6">Stock</span></th>
                <th scope="col" className="px-5 pb-2 pt-4 text-right font-semibold">Active</th>
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.listingId} style={{ borderTop: `0.5px solid ${C.sep}` }}>
                  <td className="px-5 py-2.5">{name(i)}</td>
                  <td className="px-2 py-1 text-right">{price(i)}</td>
                  <td className="px-2 py-1 text-right text-[15px]" style={{ color: C.secondary, fontVariantNumeric: "tabular-nums" }}>₹{paiseToRupees(i.mrpPaise)}</td>
                  <td className="px-2 py-1 text-right">{stock(i)}</td>
                  <td className="px-5 py-1 text-right">{active(i)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {q.data && <AddProductSheet open={sheet === "add"} onClose={() => setSheet(null)} storeId={storeId} token={token} data={q.data} onDone={refresh} />}
      <CsvImport open={sheet === "import"} onClose={() => setSheet(null)} storeId={storeId} token={token} onApplied={refresh} />
    </div>
  );
}
