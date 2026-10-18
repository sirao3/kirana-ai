import { useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { Button, Dialog, Icon, InlineMessage, LinearProgress, StatusLabel, useSnackbar } from "../m3";
import type { ImportReport } from "./types";

/** CSV import dialog (MER-05): template download, choose file → per-row validation preview → apply the valid rows. */
export function CsvImport({ open, onClose, storeId, token, onApplied }: { open: boolean; onClose: () => void; storeId: string; token: string; onApplied: () => void }) {
  const base = `/bpp/merchant/${storeId}/catalogue`;
  const snack = useSnackbar();
  const fileRef = useRef<HTMLInputElement>(null);
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
        snack(`Imported ${r.applied} rows.`);
        close();
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

  function close() {
    setCsv(null);
    setReport(null);
    setFileName("");
    setError(null);
    if (fileRef.current) fileRef.current.value = "";
    onClose();
  }

  const valid = report ? report.total - report.rejected.length : 0;
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Import from CSV"
      icon="upload_file"
      wide
      fullScreenOnCompact
      dismissible={!busy}
      actions={
        <>
          <Button variant="text" disabled={busy} onClick={close}>Cancel</Button>
          <Button icon="done_all" loading={busy && !!report} disabled={!report?.dryRun || !csv || valid === 0} onClick={() => csv && void send(false, csv)}>
            {report?.dryRun && valid > 0 ? `Apply ${valid} valid rows` : "Apply"}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p>Upload a CSV of products, prices and stock. You'll see a check of every row before anything is saved; valid rows apply in one transaction.</p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="tonal" icon="attach_file" disabled={busy} onClick={() => fileRef.current?.click()}>
            {fileName ? "Choose another file" : "Choose CSV file"}
          </Button>
          <Button variant="text" icon="download" onClick={() => void downloadTemplate()}>Download template</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {busy && <LinearProgress label="Checking file" />}
        {error && <InlineMessage tone="error">{error}</InlineMessage>}
        {report?.dryRun && (
          <div className="space-y-3">
            <p className="flex flex-wrap items-center gap-2 text-on-surface">
              <Icon name="description" size={20} className="text-on-surface-variant" />
              <b className="truncate">{fileName}</b>
              <span>{report.total} rows</span>
              <StatusLabel tone="success" icon="check">{valid} valid</StatusLabel>
              {report.rejected.length > 0 && <StatusLabel tone="error" icon="close">{report.rejected.length} rejected</StatusLabel>}
            </p>
            {report.rejected.length > 0 && (
              <div className="max-h-64 overflow-auto rounded-md border border-outline-variant">
                <table className="w-full type-body-small">
                  <thead className="sticky top-0 bg-surface-container text-left type-label-medium text-on-surface-variant">
                    <tr><th scope="col" className="px-3 py-2">Line</th><th scope="col" className="px-3 py-2">Problems</th></tr>
                  </thead>
                  <tbody>
                    {report.rejected.map((r) => (
                      <tr key={r.line} className="border-t border-outline-variant align-top">
                        <td className="px-3 py-2 font-mono">{r.line}</td>
                        <td className="px-3 py-2 text-on-surface">{r.errors.join("; ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {report.rejected.length > 0 && valid > 0 && <p className="type-body-small">Rejected rows are skipped when you apply.</p>}
          </div>
        )}
      </div>
    </Dialog>
  );
}
