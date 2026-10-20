"use client";

import { type ChangeEvent, useEffect, useRef, useState } from "react";
import QualityDataAnalysisWorkspace from "./QualityDataAnalysisWorkspace";

type Worksheet = { name: string; visible: boolean; row_count: number; column_count: number };
type Header = { column_reference: string; value: string };
type ColumnMapping = { header: string; field_key: string; value_type: "" | "text" | "number" | "date" | "boolean"; normalized_unit: string; required: boolean; ignored: boolean };
type Diagnostic = { code: string; worksheet?: string; row_number?: number; cell_reference?: string; field_key?: string };
type ApiError = { error?: { message?: string; code?: string } };
type ImportedDataset = { dataset_id: string; dataset_version_id: string; source_version_id: string; record_count: number; source_sha256: string };

function createClientId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function parseJson(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export default function QualityDataIngestionClient() {
  const [file, setFile] = useState<File | null>(null);
  const [worksheets, setWorksheets] = useState<Worksheet[]>([]);
  const [worksheet, setWorksheet] = useState("");
  const [headerRow, setHeaderRow] = useState("1");
  const [headers, setHeaders] = useState<Header[]>([]);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [datasetKey, setDatasetKey] = useState("");
  const [datasetName, setDatasetName] = useState("");
  const [sourceKey, setSourceKey] = useState("");
  const [submissionKey, setSubmissionKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [eligibility, setEligibility] = useState<"checking" | "allowed" | "denied">("checking");
  const [preview, setPreview] = useState<{ valid: boolean; recordCount?: number; fieldCount?: number } | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostic[]>([]);
  const [status, setStatus] = useState("");
  const [imported, setImported] = useState<ImportedDataset | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let active = true;
    void fetch("/api/quality-data/xlsx", { method: "GET", cache: "no-store" })
      .then(async (response) => {
        const body = parseJson(await response.json().catch(() => null));
        if (!active) return;
        if (response.ok && body.can_ingest === true) setEligibility("allowed");
        else {
          setEligibility("denied");
          const apiError = parseJson(body.error) as ApiError["error"];
          setStatus(apiError?.message ?? "You are not authorized to ingest quality data.");
        }
      })
      .catch(() => {
        if (active) {
          setEligibility("denied");
          setStatus("Authorization could not be verified. Refresh the page and sign in again.");
        }
      });
    return () => { active = false; };
  }, []);

  function markChanged() {
    setPreview(null);
    setDiagnostics([]);
    setStatus("");
    setSubmissionKey(createClientId());
  }

  function multipart(): FormData | null {
    if (!file) return null;
    const form = new FormData();
    form.append("file", file, file.name);
    return form;
  }

  async function send(action: "inspect" | "preview" | "ingest", form: FormData, idempotencyKey?: string, allowValidationFailure = false) {
    const response = await fetch(`/api/quality-data/xlsx?action=${action}`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : undefined,
      body: form,
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    const body = parseJson(await response.json().catch(() => null));
    if (!response.ok && !(allowValidationFailure && response.status === 422)) {
      const apiError = parseJson(body.error) as ApiError["error"];
      throw new Error(apiError?.message ?? "The workbook request could not be completed.");
    }
    return body;
  }

  async function inspectWorkbook(withHeaders: boolean) {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setStatus("");
    setDiagnostics([]);
    try {
      const form = multipart();
      if (!form) return;
      if (withHeaders) {
        form.append("worksheet", worksheet);
        form.append("header_row", headerRow);
      }
      const body = await send("inspect", form, undefined, true);
      if (body.status === "invalid") {
        setDiagnostics(Array.isArray(body.diagnostics) ? body.diagnostics as Diagnostic[] : []);
        setStatus("Workbook inspection found structural issues.");
        return;
      }
      const returnedWorksheets = Array.isArray(body.worksheets) ? body.worksheets as Worksheet[] : [];
      setWorksheets(returnedWorksheets);
      if (!withHeaders) {
        setWorksheet("");
        setHeaders([]);
        setMappings([]);
        setStatus(returnedWorksheets.length ? "Workbook inspected. Select a worksheet and header row." : "No worksheets were found.");
        return;
      }
      const returnedHeaders = Array.isArray(body.headers) ? body.headers as Header[] : [];
      setHeaders(returnedHeaders);
      setMappings(returnedHeaders.map((item) => ({ header: item.value, field_key: "", value_type: "", normalized_unit: "", required: false, ignored: false })));
      setStatus(returnedHeaders.length ? "Headers loaded. Map or explicitly ignore every column." : "No usable headers were found.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workbook inspection failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function mappingPayload() {
    return {
      worksheet_name: worksheet,
      header_row: Number(headerRow),
      columns: mappings.filter((item) => !item.ignored && item.field_key.trim()).map(({ header, field_key, value_type, required, normalized_unit }) => ({ header, field_key: field_key.trim(), value_type, required, ...(normalized_unit.trim() ? { normalized_unit: normalized_unit.trim() } : {}) })),
      ignored_headers: mappings.filter((item) => item.ignored).map((item) => item.header),
    };
  }

  function appendMapping(form: FormData) {
    form.append("mapping", JSON.stringify(mappingPayload()));
  }

  async function validateWorkbook() {
    if (!file || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setPreview(null);
    setDiagnostics([]);
    setStatus("");
    try {
      const form = multipart();
      if (!form) return;
      appendMapping(form);
      const body = await send("preview", form, undefined, true);
      if (body.status === "valid") {
        setPreview({ valid: true, recordCount: Number(body.record_count), fieldCount: Number(body.field_count) });
        setStatus("Validation passed. Review the mapping and submit when ready.");
      } else {
        setPreview({ valid: false });
        setDiagnostics(Array.isArray(body.diagnostics) ? body.diagnostics as Diagnostic[] : []);
        setStatus("Validation found issues. Correct the mapping or workbook before submitting.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Workbook validation failed.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  async function submitIngestion() {
    if (!file || !preview?.valid || !submissionKey || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setStatus("Submitting import…");
    try {
      const form = multipart();
      if (!form) return;
      appendMapping(form);
      form.append("dataset_key", datasetKey);
      form.append("dataset_name", datasetName);
      form.append("source_key", sourceKey);
      const body = await send("ingest", form, submissionKey, true);
      if (body.status === "invalid") {
        setPreview({ valid: false });
        setDiagnostics(Array.isArray(body.diagnostics) ? body.diagnostics as Diagnostic[] : []);
        setStatus("The server rejected the workbook during final validation. Correct the issues and validate again.");
        return;
      }
      const receipt = parseJson(body.receipt);
      const source = parseJson(body.source);
      const datasetId = String(receipt.dataset_id ?? "");
      const datasetVersionId = String(receipt.dataset_version_id ?? "");
      const sourceVersionId = String(receipt.source_version_id ?? "");
      const sourceSha256 = String(source.sha256 ?? "");
      if (datasetId && datasetVersionId && sourceVersionId) setImported({
        dataset_id: datasetId, dataset_version_id: datasetVersionId, source_version_id: sourceVersionId,
        record_count: Number(receipt.record_count ?? 0), source_sha256: sourceSha256,
      });
      setStatus(`${body.status === "already_registered" ? "This import was already registered" : "Import accepted"} for ${String(source.source_name ?? file.name)}. ${String(receipt.record_count ?? 0)} records; review state: ${String(body.review_state ?? "review_required")}; source SHA-256: ${String(source.sha256 ?? "unavailable")}.`);
      setPreview(null);
    } catch (error) {
      setStatus(error instanceof Error
        ? `${error.message} No automatic retry was made. If the result was ambiguous, submit again without changing the form to reuse the same idempotency key.`
        : "The result is uncertain. No automatic retry was made; submit again without changing the form to reuse the same idempotency key.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  function updateMapping(index: number, update: Partial<ColumnMapping>) {
    markChanged();
    setMappings((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...update } : item));
  }

  const mappingComplete = mappings.length > 0
    && mappings.some((item) => !item.ignored && item.field_key.trim().length > 0 && item.value_type !== "")
    && mappings.every((item) => item.ignored || (item.field_key.trim().length > 0 && item.value_type !== ""));

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const next = event.currentTarget.files?.[0] ?? null;
    markChanged();
    setFile(next);
    setSourceKey("");
    setWorksheets([]);
    setWorksheet("");
    setHeaderRow("1");
    setHeaders([]);
    setMappings([]);
  }

  return (
    <section className="mx-auto w-full max-w-5xl rounded-2xl border border-slate-200 bg-white p-5 text-slate-900 shadow-xl dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 sm:p-8">
      <h1 className="text-2xl font-semibold">Import quality data</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Upload a manufacturing .xlsx workbook, explicitly map its columns, review validation, then submit. Values are recorded deterministically and remain marked for human review.</p>
      <p className="mt-3 rounded-lg bg-blue-50 p-3 text-sm dark:bg-blue-950">Demonstration data only: <a className="font-semibold underline" href="/demo/synthetic-manufacturing-quality.xlsx" download>Download the fictional three-month inspection workbook</a>. Each row is a separate, non-overlapping 250-unit cohort; monthly rates use summed defects divided by summed inspected quantities.</p>

      {eligibility === "checking" && <p className="mt-4 text-sm" role="status">Checking organization ingestion access…</p>}
      {eligibility === "denied" && <p className="mt-4 rounded-lg border border-rose-300 bg-rose-50 p-3 text-sm text-rose-900 dark:bg-rose-950 dark:text-rose-100" role="alert">{status || "You are not authorized to ingest quality data."}</p>}
      <fieldset disabled={busy || eligibility !== "allowed"} className="mt-6 space-y-5 disabled:opacity-70">
        <label className="block text-sm font-medium">Workbook (.xlsx, up to 10 MiB)
          <input className="mt-2 block w-full rounded-lg border border-slate-300 p-3 text-base dark:border-slate-600 dark:bg-slate-800" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onChange={selectFile} />
        </label>

        {file && <div className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800">Selected: <span className="break-all font-medium">{file.name}</span> ({(file.size / 1024).toFixed(1)} KiB)</div>}
        <button className="rounded-lg bg-blue-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!file || busy} onClick={() => void inspectWorkbook(false)}>Inspect workbook</button>

        {worksheets.length > 0 && <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium">Worksheet
            <select className="mt-2 block w-full rounded-lg border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" value={worksheet} onChange={(event) => { markChanged(); setWorksheet(event.target.value); setHeaders([]); setMappings([]); }}>
              <option value="">Choose worksheet</option>
              {worksheets.filter((item) => item.visible).map((item) => <option key={item.name} value={item.name}>{item.name} ({item.row_count} rows, {item.column_count} columns)</option>)}
            </select>
          </label>
          <label className="block text-sm font-medium">Header row
            <input className="mt-2 block w-full rounded-lg border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" type="number" min={1} max={10_000} value={headerRow} onChange={(event) => { markChanged(); setHeaderRow(event.target.value); setHeaders([]); setMappings([]); }} />
          </label>
          <button className="w-fit rounded-lg border border-slate-400 px-4 py-2 font-medium disabled:opacity-50" type="button" disabled={!worksheet || !headerRow || busy} onClick={() => void inspectWorkbook(true)}>Load selected headers</button>
        </div>}

        {headers.length > 0 && <div className="space-y-4">
          <h2 className="text-lg font-semibold">Map every column</h2>
          <p className="text-sm text-slate-600 dark:text-slate-300">No field meaning is inferred. Enter a canonical field key or explicitly ignore the column.</p>
          <div className="space-y-3">
            {mappings.map((item, index) => <div key={`${item.header}-${index}`} className="grid gap-3 rounded-xl border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-[minmax(8rem,1fr)_minmax(8rem,1fr)_8rem_auto_auto] sm:items-end">
              <div className="min-w-0"><span className="block text-xs text-slate-500">{headers[index]?.column_reference}</span><span className="block break-words font-medium">{item.header}</span></div>
              <label className="text-sm">Canonical field key<input className="mt-1 w-full rounded border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" value={item.field_key} disabled={item.ignored} maxLength={128} onChange={(event) => updateMapping(index, { field_key: event.target.value })} /></label>
              <div className="space-y-2"><label className="block text-sm">Value type<select className="mt-1 w-full rounded border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" value={item.value_type} disabled={item.ignored} onChange={(event) => updateMapping(index, { value_type: event.target.value as ColumnMapping["value_type"] })}><option value="">Select type</option><option value="text">Text</option><option value="number">Number</option><option value="date">Date</option><option value="boolean">Boolean</option></select></label>{item.value_type === "number" && <label className="block text-sm">Normalized unit (required for rate analysis)<input className="mt-1 w-full rounded border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" value={item.normalized_unit} disabled={item.ignored} maxLength={32} onChange={(event) => updateMapping(index, { normalized_unit: event.target.value })} placeholder="e.g. count or units" /></label>}</div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.required} disabled={item.ignored} onChange={(event) => updateMapping(index, { required: event.target.checked })} />Required</label>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={item.ignored} onChange={(event) => updateMapping(index, { ignored: event.target.checked, field_key: "" })} />Ignore</label>
            </div>)}
          </div>
        </div>}

        {headers.length > 0 && <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm font-medium">Stable source key<input className="mt-2 block w-full rounded border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" value={sourceKey} maxLength={128} onChange={(event) => { markChanged(); setSourceKey(event.target.value); }} /><span className="mt-1 block text-xs font-normal text-slate-500">Reuse this key for later versions of the same source.</span></label>
          <label className="text-sm font-medium">Dataset key<input className="mt-2 block w-full rounded border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" value={datasetKey} maxLength={128} onChange={(event) => { markChanged(); setDatasetKey(event.target.value); }} /></label>
          <label className="text-sm font-medium">Dataset name<input className="mt-2 block w-full rounded border border-slate-300 p-3 dark:border-slate-600 dark:bg-slate-800" value={datasetName} maxLength={200} onChange={(event) => { markChanged(); setDatasetName(event.target.value); }} /></label>
        </div>}

        <div className="flex flex-wrap gap-3">
          <button className="rounded-lg bg-slate-700 px-4 py-2 font-medium text-white disabled:opacity-50" type="button" disabled={!file || !mappingComplete || busy} onClick={() => void validateWorkbook()}>Validate mapping</button>
          <button className="rounded-lg bg-emerald-700 px-4 py-2 font-medium text-white disabled:cursor-not-allowed disabled:opacity-50" type="button" disabled={!preview?.valid || !sourceKey.trim() || !datasetKey.trim() || !datasetName.trim() || busy} onClick={() => void submitIngestion()}>Submit import</button>
        </div>
      </fieldset>

      {preview?.valid && <p className="mt-5 rounded-lg border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900 dark:bg-emerald-950 dark:text-emerald-100">Validated: {preview.recordCount} records, {preview.fieldCount} fields. The import will require human review.</p>}
      {diagnostics.length > 0 && <div className="mt-5 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100"><h2 className="font-semibold">Validation diagnostics</h2><ul className="mt-2 list-inside list-disc">{diagnostics.map((item, index) => <li key={`${item.code}-${index}`}>{item.code}{item.worksheet ? ` — ${item.worksheet}` : ""}{item.row_number ? ` row ${item.row_number}` : ""}{item.cell_reference ? ` cell ${item.cell_reference}` : ""}{item.field_key ? ` field ${item.field_key}` : ""}</li>)}</ul></div>}
      <p className="mt-4 min-h-6 break-all text-sm" role="status" aria-live="polite">{status}</p>
      {busy && <p className="text-sm" aria-live="polite">Processing workbook…</p>}
      {imported && <QualityDataAnalysisWorkspace dataset={imported} suggestedFields={{
        date: mappings.find((item) => item.value_type === "date")?.field_key || "inspection_date",
        category: mappings.find((item) => item.value_type === "text")?.field_key || "failure_mode",
        count: mappings.find((item) => item.value_type === "number" && item.normalized_unit.trim().toLowerCase() === "count")?.field_key || "defect_count",
        quantity: mappings.find((item) => item.value_type === "number" && item.normalized_unit.trim().toLowerCase() !== "count")?.field_key || "inspected_quantity",
        quantityUnit: mappings.find((item) => item.value_type === "number" && item.normalized_unit.trim().toLowerCase() !== "count")?.normalized_unit || "units",
      }} />}
      <p className="mt-6 border-t border-slate-200 pt-4 text-xs text-slate-500 dark:border-slate-700">Access is checked on the server for every request. Original workbooks are stored in private organization-scoped storage. Deterministic analysis does not call AI; analysis and review do not verify source evidence.</p>
    </section>
  );
}
