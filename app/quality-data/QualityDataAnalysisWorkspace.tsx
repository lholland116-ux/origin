"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Dataset = { dataset_id: string; dataset_version_id: string; source_version_id: string; record_count: number; source_sha256: string };
type SuggestedFields = { date: string; category: string; count: string; quantity: string; quantityUnit: string };
type Approval = { current_decision: string | null; transition_number: number; current_event?: { rationale?: string } | null };

function record(value: unknown): Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function clientId(): string { return crypto.randomUUID(); }

export default function QualityDataAnalysisWorkspace({ dataset, suggestedFields }: { dataset: Dataset; suggestedFields: SuggestedFields }) {
  const [approval, setApproval] = useState<Approval | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [approvalRationale, setApprovalRationale] = useState("Synthetic dataset reviewed for deterministic quality analysis.");
  const [metricKind, setMetricKind] = useState<"numeric_summary" | "field_completeness">("numeric_summary");
  const [metricField, setMetricField] = useState(suggestedFields.count);
  const [categoryField, setCategoryField] = useState(suggestedFields.category);
  const [defectField, setDefectField] = useState(suggestedFields.count);
  const [quantityField, setQuantityField] = useState(suggestedFields.quantity);
  const [dateField, setDateField] = useState(suggestedFields.date);
  const [quantityUnit, setQuantityUnit] = useState(suggestedFields.quantityUnit);
  const [minimumOccurrences, setMinimumOccurrences] = useState(2);
  const [trendChange, setTrendChange] = useState(0.5);
  const [threshold, setThreshold] = useState(5);
  const [useRecurring, setUseRecurring] = useState(true);
  const [useTrend, setUseTrend] = useState(true);
  const [useThreshold, setUseThreshold] = useState(false);
  const [reportId, setReportId] = useState("");
  const [reportPayload, setReportPayload] = useState<Record<string, unknown> | null>(null);
  const reportIdempotencyKey = useRef(clientId());
  const reportRequestInFlight = useRef(false);
  const configurationLocked = reportPayload !== null || !!reportId;

  const loadApproval = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(`/api/quality-data/versions/${encodeURIComponent(dataset.dataset_version_id)}/approval`, { cache: "no-store" });
      const body = record(await response.json().catch(() => null));
      if (!response.ok) throw new Error(record(body.error).message as string || "Dataset approval status is unavailable.");
      setApproval(record(body.approval) as Approval);
    } catch (error) { setStatus(error instanceof Error ? error.message : "Dataset approval status is unavailable."); }
    finally { setLoading(false); }
  }, [dataset.dataset_version_id]);

  useEffect(() => { void loadApproval(); }, [loadApproval]);

  async function approveVersion() {
    if (!approval || busy || !approvalRationale.trim()) return;
    setBusy(true); setStatus("Recording explicit dataset-version approval…");
    try {
      const response = await fetch(`/api/quality-data/versions/${encodeURIComponent(dataset.dataset_version_id)}/approval`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": clientId() },
        body: JSON.stringify({ schema_version: "quality-data-analytical-approval-1.0.0", dataset_version_id: dataset.dataset_version_id,
          decision: "approved", expected_transition_number: approval.transition_number, rationale: approvalRationale }), cache: "no-store",
      });
      const body = record(await response.json().catch(() => null));
      if (!response.ok) throw new Error(record(body.error).message as string || "Dataset approval could not be recorded.");
      const state = record(body.approval);
      setApproval({ current_decision: state.decision as string, transition_number: Number(state.transition_number ?? approval.transition_number + 1), current_event: { rationale: String(state.rationale ?? approvalRationale) } });
      setStatus("Dataset version approved for analytical use. This does not verify source evidence.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Dataset approval failed."); }
    finally { setBusy(false); }
  }

  async function createReport() {
    if (busy || reportRequestInFlight.current || reportId || !approval || approval.current_decision !== "approved") return;
    let payload = reportPayload;
    if (!payload) {
      const signals: Record<string, unknown>[] = [];
      if (useRecurring) signals.push({ signal_id: "recurring-failure-mode", kind: "recurring_category", semantic_role: "failure_mode",
        field_key: categoryField.trim(), minimum_occurrences: minimumOccurrences, minimum_sample_size: 3,
        time_window: { kind: "all_records_in_dataset_version" } });
      const rateFields = { defect_count_field_key: defectField.trim(), production_quantity_field_key: quantityField.trim(),
        observation_date_field_key: dateField.trim(), production_quantity_unit: quantityUnit.trim(), rate_per: 1_000,
        minimum_records_per_window: 3, time_window: { kind: "calendar_month" } };
      if (useTrend) signals.push({ signal_id: "monthly-defect-rate-trend", kind: "defect_rate_trend", ...rateFields,
        direction: "increase", minimum_absolute_change: trendChange });
      if (useThreshold) signals.push({ signal_id: "monthly-defect-rate-threshold", kind: "defect_rate_threshold", ...rateFields, threshold });
      if (signals.length === 0 || !metricField.trim() || signals.some((item) => item.kind !== "recurring_category" &&
        [defectField, quantityField, dateField, quantityUnit].some((value) => !value.trim()))) {
        setStatus("Choose at least one signal and provide valid canonical field keys and units."); return;
      }
      payload = { schema_version: "quality-data-deterministic-analysis-request-1.0.0", mode: "deterministic_only",
        dataset_version_id: dataset.dataset_version_id,
        metrics: [{ metric_id: "configured-metric-1", kind: metricKind, field_key: metricField.trim() }], signals };
      setReportPayload(payload);
    }
    reportRequestInFlight.current = true;
    setBusy(true); setStatus("Calculating deterministic findings and saving the evidence-bound report…");
    try {
      const response = await fetch("/api/quality-data/intelligence/deterministic", {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": reportIdempotencyKey.current },
        body: JSON.stringify(payload), cache: "no-store",
      });
      const body = record(await response.json().catch(() => null));
      if (!response.ok) throw new Error(record(body.error).message as string || "Deterministic analysis could not be completed.");
      const report = record(body.report);
      const id = String(report.report_id ?? body.report_id ?? "");
      if (!id) throw new Error("The report was saved but its identifier was not returned.");
      setReportId(id);
      setStatus("Deterministic report saved. No external AI interpretation was requested.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "Deterministic analysis failed."); }
    finally { reportRequestInFlight.current = false; setBusy(false); }
  }

  return <section className="mt-8 rounded-2xl border border-slate-300 bg-white p-5 shadow-sm dark:border-slate-700 dark:bg-slate-900 sm:p-7">
    <h2 className="text-xl font-semibold">Approval and deterministic analysis</h2>
    <dl className="mt-4 grid gap-2 break-all rounded-lg bg-slate-50 p-4 text-sm dark:bg-slate-800 sm:grid-cols-2">
      <div><dt className="text-slate-500">Dataset ID</dt><dd>{dataset.dataset_id}</dd></div>
      <div><dt className="text-slate-500">Dataset version ID</dt><dd>{dataset.dataset_version_id}</dd></div>
      <div><dt className="text-slate-500">Source version ID</dt><dd>{dataset.source_version_id}</dd></div>
      <div><dt className="text-slate-500">Source SHA-256</dt><dd>{dataset.source_sha256 || "Unavailable"}</dd></div>
    </dl>
    {loading ? <p className="mt-4" role="status">Checking current approval…</p> : <div className="mt-5 space-y-4">
      <p className="text-sm">Current decision: <strong>{approval?.current_decision ?? "review_required"}</strong>. Dataset approval, report review, and CAPA draft creation are separate human actions.</p>
      {approval?.current_decision !== "approved" && <div className="space-y-3">
        <label className="block text-sm">Approval rationale<textarea className="mt-1 w-full rounded border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" rows={2} maxLength={1000} value={approvalRationale} onChange={(event) => setApprovalRationale(event.target.value)} /></label>
        <button type="button" disabled={busy || !approvalRationale.trim()} onClick={() => void approveVersion()} className="rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Approve version for analytical use</button>
      </div>}
      {approval?.current_decision === "approved" && <div className="space-y-5 border-t border-slate-200 pt-5 dark:border-slate-700">
        <p className="text-sm text-slate-600 dark:text-slate-300">Configure existing Stage 3A metrics and Stage 3B signals. Canonical field keys and units must match the explicit import mapping.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="text-sm">Metric type<select disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={metricKind} onChange={(event) => setMetricKind(event.target.value as typeof metricKind)}><option value="numeric_summary">Numeric summary</option><option value="field_completeness">Field completeness</option></select></label>
          <label className="text-sm">Metric field key<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={metricField} onChange={(event) => setMetricField(event.target.value)} /></label>
          <label className="text-sm">Failure-mode field key<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={categoryField} onChange={(event) => setCategoryField(event.target.value)} /></label>
          <label className="text-sm">Defect-count field key<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={defectField} onChange={(event) => setDefectField(event.target.value)} /></label>
          <label className="text-sm">Inspected-quantity field key<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={quantityField} onChange={(event) => setQuantityField(event.target.value)} /></label>
          <label className="text-sm">Inspection-date field key<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={dateField} onChange={(event) => setDateField(event.target.value)} /></label>
          <label className="text-sm">Inspected-quantity unit<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" maxLength={128} value={quantityUnit} onChange={(event) => setQuantityUnit(event.target.value)} /></label>
          <label className="text-sm">Recurring mode minimum occurrences<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" type="number" min={2} max={10000} value={minimumOccurrences} onChange={(event) => setMinimumOccurrences(Number(event.target.value))} /></label>
          <label className="text-sm">Minimum upward trend change per 1,000<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" type="number" min={0.001} step="any" value={trendChange} onChange={(event) => setTrendChange(Number(event.target.value))} /></label>
          <label className="text-sm">Rate threshold per 1,000<input disabled={configurationLocked} className="mt-1 w-full rounded border p-2 dark:bg-slate-800" type="number" min={0} step="any" value={threshold} onChange={(event) => setThreshold(Number(event.target.value))} /></label>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2"><input disabled={configurationLocked} type="checkbox" checked={useRecurring} onChange={(event) => setUseRecurring(event.target.checked)} />Recurring failure modes</label>
          <label className="flex items-center gap-2"><input disabled={configurationLocked} type="checkbox" checked={useTrend} onChange={(event) => setUseTrend(event.target.checked)} />Monthly defect-rate trend</label>
          <label className="flex items-center gap-2"><input disabled={configurationLocked} type="checkbox" checked={useThreshold} onChange={(event) => setUseThreshold(event.target.checked)} />Monthly threshold signal</label>
        </div>
        <p className="text-xs text-slate-500">Rate formula: sum(defect count) ÷ sum(inspected quantity) × 1,000 per calendar month. Rows must represent non-overlapping inspected quantities. Unsupported or missing unit semantics are reported as data limitations.</p>
        <button type="button" disabled={busy || !!reportId} onClick={() => void createReport()} className="rounded-lg bg-blue-700 px-4 py-2 font-semibold text-white disabled:opacity-50">{reportPayload ? "Retry the same deterministic report" : "Create deterministic report (no external AI)"}</button>
        {reportPayload && !reportId && <p className="text-xs text-slate-500">A retry reuses the same request and idempotency key. Reload before changing the report configuration.</p>}
      </div>}
    </div>}
    {reportId && <p className="mt-4 rounded-lg bg-blue-50 p-3 text-sm dark:bg-blue-950"><a className="font-semibold underline" href={`/quality-data/intelligence/${encodeURIComponent(reportId)}`}>Open saved intelligence report and review findings</a></p>}
    <p className="mt-4 text-sm" role="status" aria-live="polite">{busy ? "Please wait… " : ""}{status}</p>
  </section>;
}
