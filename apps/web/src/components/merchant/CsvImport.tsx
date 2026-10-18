import { useRef, useState } from "react";
import { api, ApiError } from "../../lib/api";
import { useSnackbar } from "../ui/toast";
import { Button, C, Group, IDownload, Notice, Row, Sheet, Spinner, StatusText } from "../ui";
import type { ImportReport } from "./types";

/** CSV import sheet (MER-05): template download, choose file → per-row check (dry run) → apply the valid rows. */
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
    await send(true, text); // check first: nothing is written yet
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
    <Sheet open={open} onClose={close} title="Import from CSV" dismissible={!busy} width={600}
      footer={<>
        <Button variant="secondary" disabled={busy} onClick={close}>Cancel</Button>
        <Button busy={busy && !!report} disabled={!report?.dryRun || !csv || valid === 0} onClick={() => csv && void send(false, csv)}>
          {report?.dryRun && valid > 0 ? `Apply ${valid} valid ${valid === 1 ? "row" : "rows"}` : "Apply"}
        </Button>
      </>}>
      <div className="space-y-5">
        <p className="text-[15px] leading-[1.45]" style={{ color: C.secondary }}>
          Upload products, prices and stock. Every row is checked before anything is saved; the valid rows apply together.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>{fileName ? "Choose another file" : "Choose CSV file"}</Button>
          <Button variant="plain" icon={<IDownload size={17} />} onClick={() => void downloadTemplate()}>Download template</Button>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="sr-only" aria-label="CSV file" tabIndex={-1} onChange={(e) => void onFile(e.target.files?.[0])} />
        </div>
        {busy && !report && <p className="flex items-center gap-2 text-[14px]" style={{ color: C.secondary }} role="status"><Spinner /> Checking {fileName}…</p>}
        {error && <Notice tone="bad">{error}</Notice>}
        {report?.dryRun && (
          <div className="space-y-4" role="status">
            <div>
              <p className="truncate text-[15px] font-semibold" style={{ color: C.label }}>{fileName}</p>
              <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]" style={{ color: C.secondary }}>
                {report.total} rows
                <StatusText tone="good">{valid} valid</StatusText>
                {report.rejected.length > 0 && <StatusText tone="bad">{report.rejected.length} rejected</StatusText>}
              </p>
            </div>
            {report.rejected.length > 0 && (
              <Group title="Rows that will be skipped">
                {report.rejected.map((r) => <Row key={r.line} title={`Line ${r.line}`} subtitle={r.errors.join("; ")} />)}
              </Group>
            )}
          </div>
        )}
      </div>
    </Sheet>
  );
}
