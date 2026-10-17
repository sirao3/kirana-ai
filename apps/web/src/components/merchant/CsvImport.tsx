import { useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Button, Card } from "../kit";
import type { ImportReport } from "./types";

/** CSV import (MER-05): template download, upload → per-row validation report → apply the valid rows. */
export function CsvImport({ storeId, token, onApplied }: { storeId: string; token: string; onApplied: () => void }) {
  const base = `/bpp/merchant/${storeId}/catalogue`;
  const [csv, setCsv] = useState<string | null>(null);
  const [fileName, setFileName] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function downloadTemplate() {
    // The template route needs the bearer token, so fetch it as a blob rather than linking to it.
    const res = await fetch(`${base}/template.csv`, { headers: { authorization: `Bearer ${token}` } });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement("a");
    a.href = url;
    a.download = "catalogue-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function send(dryRun: boolean, text: string) {
    setBusy(true);
    setError(null);
    try {
      const r = await api<ImportReport>(`${base}/import`, { method: "POST", token, json: { csv: text, dryRun } });
      setReport(r);
      if (!dryRun) {
        setCsv(null);
        onApplied();
      }
    } catch (e) {
      setReport(null);
      setError(e instanceof ApiError ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onFile(f: File | undefined) {
    if (!f) return;
    const text = await f.text();
    setFileName(f.name);
    setCsv(text);
    await send(true, text); // preview first: nothing is written yet
  }

  const valid = report ? report.total - report.rejected.length : 0;
  return (
    <Card title="Import from CSV" actions={<Button tone="secondary" onClick={() => void downloadTemplate()}>Download template</Button>}>
      <div className="space-y-3 text-sm">
        <input type="file" accept=".csv,text/csv" aria-label="CSV file" onChange={(e) => void onFile(e.target.files?.[0])} />
        {error && <p className="rounded-md bg-rose-50 px-2 py-1 text-rose-700">{error}</p>}
        {report && (
          <div>
            <p>
              {report.dryRun ? (
                <><b>{fileName}</b>: {report.total} rows, <span className="text-emerald-700">{valid} valid</span>, <span className={report.rejected.length ? "text-rose-700" : ""}>{report.rejected.length} rejected</span>.</>
              ) : (
                <span className="text-emerald-700">Applied {report.applied} rows in one transaction.{report.rejected.length > 0 && ` ${report.rejected.length} rejected rows were skipped.`}</span>
              )}
            </p>
            {report.rejected.length > 0 && (
              <table className="mt-2 w-full text-xs">
                <thead><tr className="border-b border-stone-200 text-left text-stone-500"><th className="py-1 pr-2">Line</th><th>Problems</th></tr></thead>
                <tbody>
                  {report.rejected.map((r) => (
                    <tr key={r.line} className="border-b border-stone-100 align-top"><td className="py-1 pr-2 font-mono">{r.line}</td><td>{r.errors.join("; ")}</td></tr>
                  ))}
                </tbody>
              </table>
            )}
            {report.dryRun && csv && valid > 0 && (
              <Button className="mt-2" disabled={busy} onClick={() => void send(false, csv)}>Apply {valid} valid rows</Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
