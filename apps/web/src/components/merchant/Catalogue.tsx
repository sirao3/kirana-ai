import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { paiseToRupees, rupeesToPaise } from "@kiranaai/shared";
import { api, ApiError } from "../../lib/api";
import { Badge, Button, Card } from "../kit";
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
    <input
      aria-label={label}
      inputMode={money ? "decimal" : "numeric"}
      value={draft ?? value}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        if (e.key === "Escape") setDraft(null);
      }}
      className={`w-20 rounded border px-2 py-1 text-right text-sm tabular-nums ${state === "error" ? "border-rose-400 bg-rose-50" : "border-stone-300 bg-white"} ${state === "saving" ? "opacity-60" : ""}`}
    />
  );
}

function AddProduct({ storeId, token, data, onDone }: { storeId: string; token: string; data: CatalogueData; onDone: () => void }) {
  const [mode, setMode] = useState<"existing" | "new">("existing");
  const [pick, setPick] = useState("");
  const [np, setNp] = useState({ brand: "", name: "", variant: "", packSize: "", unit: "g" as (typeof UNITS)[number], category: "", gtin: "" });
  const [price, setPrice] = useState("");
  const [mrp, setMrp] = useState("");
  const [stock, setStock] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const listed = useMemo(() => new Set(data.items.map((i) => i.canonicalProductId)), [data.items]);
  const options = data.canonicalProducts.filter((p) => !listed.has(p.id));
  const categories = useMemo(() => [...new Set(data.canonicalProducts.map((p) => p.category))], [data.canonicalProducts]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
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
      setMsg({ ok: true, text: "Added. It is now searchable." });
      setPick(""); setPrice(""); setMrp(""); setStock("");
      setNp({ brand: "", name: "", variant: "", packSize: "", unit: "g", category: "", gtin: "" });
      onDone();
    } catch (err) {
      setMsg({ ok: false, text: err instanceof ApiError ? err.message : "Enter valid prices (like 125.50) and a whole-number stock." });
    }
  }

  const field = "w-full rounded-lg border border-stone-300 bg-white px-2 py-1.5 text-sm";
  return (
    <Card title="Add a product">
      <form onSubmit={submit} className="space-y-3">
        <div className="flex gap-2 text-sm">
          {(["existing", "new"] as const).map((m) => (
            <label key={m} className="flex items-center gap-1">
              <input type="radio" checked={mode === m} onChange={() => setMode(m)} />
              {m === "existing" ? "Pick from catalogue" : "New product"}
            </label>
          ))}
        </div>
        {mode === "existing" ? (
          <select aria-label="Catalogue product" required value={pick} onChange={(e) => setPick(e.target.value)} className={field}>
            <option value="">Choose a product…</option>
            {options.map((p) => <option key={p.id} value={p.id}>{p.label} ({p.category})</option>)}
          </select>
        ) : (
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            <input aria-label="Brand" required placeholder="Brand" className={field} value={np.brand} onChange={(e) => setNp({ ...np, brand: e.target.value })} />
            <input aria-label="Product name" required placeholder="Product name" className={field} value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} />
            <input aria-label="Variant" placeholder="Variant (optional)" className={field} value={np.variant} onChange={(e) => setNp({ ...np, variant: e.target.value })} />
            <input aria-label="Category" required list="categories" placeholder="Category" className={field} value={np.category} onChange={(e) => setNp({ ...np, category: e.target.value })} />
            <datalist id="categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
            <input aria-label="Pack size" required inputMode="numeric" placeholder="Pack size (e.g. 500)" className={field} value={np.packSize} onChange={(e) => setNp({ ...np, packSize: e.target.value })} />
            <select aria-label="Unit" className={field} value={np.unit} onChange={(e) => setNp({ ...np, unit: e.target.value as (typeof UNITS)[number] })}>
              {UNITS.map((u) => <option key={u}>{u}</option>)}
            </select>
            <input aria-label="GTIN" placeholder="GTIN (optional)" className={field} value={np.gtin} onChange={(e) => setNp({ ...np, gtin: e.target.value })} />
          </div>
        )}
        <div className="grid grid-cols-3 gap-2">
          <input aria-label="Price" required inputMode="decimal" placeholder="Price ₹" className={field} value={price} onChange={(e) => setPrice(e.target.value)} />
          <input aria-label="MRP" inputMode="decimal" placeholder="MRP ₹ (optional)" className={field} value={mrp} onChange={(e) => setMrp(e.target.value)} />
          <input aria-label="Stock" required inputMode="numeric" placeholder="Stock (packs)" className={field} value={stock} onChange={(e) => setStock(e.target.value)} />
        </div>
        <div className="flex items-center gap-3">
          <Button type="submit">Add to my catalogue</Button>
          {msg && <span className={`text-sm ${msg.ok ? "text-emerald-700" : "text-rose-700"}`}>{msg.text}</span>}
        </div>
      </form>
    </Card>
  );
}

/** Catalogue tab: inline price/stock edit, activate/deactivate, add product, CSV import. */
export function Catalogue({ storeId, token }: { storeId: string; token: string }) {
  const qc = useQueryClient();
  const key = ["catalogue", storeId];
  const base = `/bpp/merchant/${storeId}/catalogue`;
  const q = useQuery<CatalogueData>({ queryKey: key, queryFn: () => api(base, { token }) });
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  if (!q.data) return <p className="text-sm text-stone-500">{q.isError ? "Could not load the catalogue." : "Loading catalogue…"}</p>;
  const items = q.data.items.filter((i) => `${i.brand} ${i.name} ${i.category}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <div className="space-y-4">
      <AddProduct storeId={storeId} token={token} data={q.data} onDone={refresh} />
      <CsvImport storeId={storeId} token={token} onApplied={refresh} />
      <Card
        title={`My catalogue (${q.data.items.length})`}
        actions={<input aria-label="Filter catalogue" placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} className="w-40 rounded-lg border border-stone-300 px-2 py-1 text-sm" />}
      >
        {error && <p className="mb-2 rounded-md bg-rose-50 px-2 py-1 text-xs text-rose-700">{error}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase text-stone-500">
                <th className="py-1 pr-2">Product</th><th className="pr-2">Pack</th><th className="pr-2 text-right">Price ₹</th><th className="pr-2 text-right">MRP ₹</th><th className="pr-2 text-right">Stock</th><th />
              </tr>
            </thead>
            <tbody>
              {items.map((i) => (
                <tr key={i.listingId} className={`border-b border-stone-100 ${i.active ? "" : "text-stone-400"}`}>
                  <td className="py-1 pr-2">
                    <div className="font-medium">{i.brand} {i.name}</div>
                    <div className="text-xs text-stone-500">{i.category}{!i.active && <> · <Badge>inactive</Badge></>}</div>
                  </td>
                  <td className="pr-2 whitespace-nowrap">{i.packLabel}</td>
                  <td className="pr-2 text-right">
                    <EditCell money label={`Price for ${i.name}`} value={paiseToRupees(i.pricePaise)} onSave={(v) => patch(i, { pricePaise: rupeesToPaise(v) })} />
                  </td>
                  <td className="pr-2 text-right tabular-nums">{paiseToRupees(i.mrpPaise)}</td>
                  <td className="pr-2 text-right">
                    <EditCell label={`Stock for ${i.name}`} value={String(i.stockQty)} onSave={(v) => patch(i, { stockQty: Number(v) })} />
                  </td>
                  <td className="text-right">
                    <Button tone="ghost" className="px-2 py-1 text-xs" onClick={() => void patch(i, { active: !i.active }).catch(() => {})}>
                      {i.active ? "Deactivate" : "Activate"}
                    </Button>
                  </td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={6} className="py-4 text-center text-stone-500">Nothing matches.</td></tr>}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
