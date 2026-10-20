"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type AnyRecord = Record<string, unknown>;
function object(value: unknown): AnyRecord { return typeof value === "object" && value !== null && !Array.isArray(value) ? value as AnyRecord : {}; }
function array(value: unknown): unknown[] { return Array.isArray(value) ? value : []; }
function clientId(): string { return crypto.randomUUID(); }

export default function QualityDataIntelligenceReportClient({ reportId }: { reportId: string }) {
  const [report, setReport] = useState<AnyRecord | null>(null);
  const [events, setEvents] = useState<AnyRecord[]>([]);
  const [status, setStatus] = useState("Loading report…");
  const [busy, setBusy] = useState(false);
  const [findingKey, setFindingKey] = useState("");
  const [reviewDecision, setReviewDecision] = useState("follow_up_requested");
  const [reviewRationale, setReviewRationale] = useState("");
  const [capaRationale, setCapaRationale] = useState("");
  const [capaCaseId, setCapaCaseId] = useState("");
  const actionKey = useRef(clientId());

  const reload = useCallback(async () => {
    try {
      const response = await fetch(`/api/quality-data/intelligence/${encodeURIComponent(reportId)}`, { cache: "no-store" });
      const body = object(await response.json().catch(() => null));
      if (!response.ok) throw new Error(object(body.error).message as string || "The report is unavailable.");
      const nextReport = object(body.report);
      setReport(nextReport);
      setEvents(array(object(body.review_history).events).map(object));
      setStatus("");
    } catch (error) { setStatus(error instanceof Error ? error.message : "The report is unavailable."); }
  }, [reportId]);
  useEffect(() => { void reload(); }, [reload]);

  const result = object(report?.result);
  const findingOptions = useMemo(() => {
    const metrics = array(result.verified_calculations).map((item, index) => ({ key: `metric:M${index + 1}`, label: `Calculation M${index + 1}` }));
    const signals = array(result.observed_signals).map((item, index) => ({ key: `signal:S${index + 1}`, label: `Observed signal S${index + 1}` }));
    const interpretation = object(result.interpretation);
    const advisory = result.interpretation_status === "unverified_advisory_hypotheses"
      ? [...array(interpretation.possible_causes).map((_, i) => ({ key: `possible_cause:${i}`, label: `AI hypothesis ${i + 1}` })),
        ...array(interpretation.uncertainty).map((_, i) => ({ key: `uncertainty:${i}`, label: `AI uncertainty ${i + 1}` })),
        ...array(interpretation.human_investigation_steps).map((_, i) => ({ key: `investigation_step:${i}`, label: `AI investigation suggestion ${i + 1}` }))]
      : [];
    return [...metrics, ...signals, ...advisory];
  }, [result]);

  useEffect(() => { if (findingOptions.length && !findingOptions.some((item) => item.key === findingKey)) setFindingKey(findingOptions[0]!.key); }, [findingOptions, findingKey]);

  const selected = useMemo(() => {
    const [kind, ref] = findingKey.split(":");
    if (kind === "metric") return array(result.verified_calculations)[Number(ref?.slice(1)) - 1];
    if (kind === "signal") return array(result.observed_signals)[Number(ref?.slice(1)) - 1];
    const interpretation = object(result.interpretation);
    if (kind === "possible_cause") return array(interpretation.possible_causes)[Number(ref)];
    if (kind === "uncertainty") return array(interpretation.uncertainty)[Number(ref)];
    if (kind === "investigation_step") return array(interpretation.human_investigation_steps)[Number(ref)];
    return undefined;
  }, [findingKey, result]);

  const citations = useMemo(() => {
    const handles = new Set<string>();
    const visit = (value: unknown, key = "") => {
      if (Array.isArray(value)) { for (const item of value) visit(item, key); return; }
      if (typeof value === "object" && value !== null) { for (const [childKey, child] of Object.entries(value)) visit(child, childKey); return; }
      if ((key === "evidence_handles" || key === "evidence_refs") && typeof value === "string") handles.add(value);
    };
    visit(selected);
    const byHandle = new Map(array(result.evidence_citations).map((item) => [String(object(item).handle), object(item)]));
    return [...handles].map((handle) => byHandle.get(handle)).filter((item): item is AnyRecord => Boolean(item));
  }, [result.evidence_citations, selected]);

  async function submitReview() {
    if (!report || !findingKey || !selected || !reviewRationale.trim() || busy) return;
    setBusy(true); setStatus("Recording the human triage decision…");
    try {
      const currentTransition = Math.max(0, ...events.filter((event) => event.finding_key === findingKey).map((event) => Number(event.transition_number ?? 0)));
      const response = await fetch(`/api/quality-data/intelligence/${encodeURIComponent(reportId)}/review`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": actionKey.current },
        body: JSON.stringify({ schema_version: "quality-data-intelligence-review-1.0.0", report_id: reportId,
          finding_key: findingKey, expected_transition_number: currentTransition, decision: reviewDecision, rationale: reviewRationale }), cache: "no-store",
      });
      const body = object(await response.json().catch(() => null));
      if (!response.ok) throw new Error(object(body.error).message as string || "The review decision was not recorded.");
      actionKey.current = clientId(); setReviewRationale(""); setStatus("Human triage decision recorded. Source evidence is not thereby verified.");
      await reload();
    } catch (error) { setStatus(error instanceof Error ? error.message : "Review could not be recorded."); }
    finally { setBusy(false); }
  }

  async function createCapaDraft() {
    if (!report || !findingKey || !report.result_fingerprint || !capaRationale.trim() || busy) return;
    setBusy(true); setStatus("Submitting the separate human-authorized S00 CAPA draft decision…");
    try {
      const response = await fetch(`/api/quality-data/intelligence/${encodeURIComponent(reportId)}/capa-draft`, {
        method: "POST", headers: { "content-type": "application/json", "idempotency-key": actionKey.current },
        body: JSON.stringify({ schema_version: "quality-data-capa-handoff-1.0.0", finding_key: findingKey,
          expected_result_fingerprint: report.result_fingerprint, decision: "create_capa_draft", rationale: capaRationale }), cache: "no-store",
      });
      const body = object(await response.json().catch(() => null));
      if (!response.ok) throw new Error(object(body.error).message as string || "The CAPA draft was not created.");
      actionKey.current = clientId(); setCapaCaseId(String(object(body.capa_case).capa_case_id ?? ""));
      setStatus("Human-authorized CAPA draft created. Its state remains S00; no workflow advancement or approval occurred.");
    } catch (error) { setStatus(error instanceof Error ? error.message : "CAPA draft creation failed."); }
    finally { setBusy(false); }
  }

  if (!report) return <main className="mx-auto min-h-screen max-w-5xl px-4 py-10"><a href="/quality-data" className="text-blue-700 underline">Quality-data workspace</a><p className="mt-5" role="status">{status || "Loading report…"}</p></main>;

  return <main className="mx-auto min-h-screen max-w-6xl space-y-6 px-4 py-8 sm:px-6 sm:py-12">
    <header className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-700 dark:bg-slate-900">
      <a href="/quality-data" className="text-sm text-blue-700 underline dark:text-blue-300">Quality-data workspace</a>
      <h1 className="mt-2 text-2xl font-bold">Quality Intelligence Report</h1>
      <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">Report {reportId} · dataset version {String(report.dataset_version_id)} · approval {String(report.approval_event_id)}</p>
      <p className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-950 dark:bg-amber-950 dark:text-amber-100">Deterministic observations and calculations are separate from AI hypotheses, human triage, and source-evidence verification. Current dataset approval is checked on every read and decision.</p>
    </header>

    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Deterministic calculations</h2>
      <p className="mb-4 text-xs text-slate-500">Interpretation status: {String(result.interpretation_status ?? "unknown")} · source verification: not asserted · report fingerprint: {String(report.result_fingerprint)}</p>
      <div className="grid gap-3 md:grid-cols-2">{array(result.verified_calculations).map((raw, index) => { const metric = object(raw); return <article key={`metric-${index}`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-semibold">Calculation M{index + 1}</h3><p className="mt-2 text-sm">{String(metric.kind)} · {String(metric.status)} · value {metric.value === null ? "not available" : String(metric.value)} {String(metric.unit ?? "")}</p><p className="text-xs text-slate-500">Sample {String(metric.sample_size)} · exclusions {JSON.stringify(metric.excluded_counts ?? {})}</p></article>; })}</div>
    </section>

    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Observed quality signals</h2>
      <div className="mt-4 space-y-3">{array(result.observed_signals).map((raw, index) => { const signal = object(raw); return <article key={`signal-${index}`} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700"><h3 className="font-semibold">Signal S{index + 1} · {String(signal.kind)}</h3><p className="mt-1 text-sm">Status: {String(signal.status)} · sample: {String(signal.sample_size ?? "not available")}</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{array(signal.monthly_buckets).map((bucket, bucketIndex) => { const item = object(bucket); return <p key={bucketIndex} className="rounded bg-slate-50 p-2 text-sm dark:bg-slate-800">{String(item.period)}: {item.rate === null ? "not calculated" : `${String(item.rate)} per ${String(item.rate_per ?? "1,000")}`} · n={String(item.sample_size)}</p>; })}</div>{array(signal.category_groups).length > 0 && <p className="mt-2 text-sm">Recurring categories: {array(signal.category_groups).map((group) => String(object(group).alias)).join(", ")} (opaque aliases)</p>}</article>; })}</div>
    </section>

    {result.interpretation_status === "unverified_advisory_hypotheses" && <section className="rounded-2xl border border-amber-300 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-950"><h2 className="font-semibold">Unverified AI advisory hypotheses</h2><p className="mt-1 text-xs">Not causal proof, source verification, or a CAPA decision.</p>{array(object(result.interpretation).possible_causes).map((item, index) => <p key={index} className="mt-3 text-sm">{String(object(item).text)}</p>)}</section>}
    {result.interpretation_status === "not_requested" && <p className="rounded-xl bg-slate-100 p-4 text-sm dark:bg-slate-800">External AI interpretation: not requested. No AI hypotheses or citations were generated.</p>}

    <section className="rounded-2xl border border-slate-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900">
      <h2 className="text-lg font-semibold">Cell-level source provenance</h2>
      <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Source cells identify where the calculation input came from. They do not independently verify the workbook.</p>
      <label className="mt-4 block text-sm">Finding<select className="mt-1 w-full rounded border border-slate-300 p-2 dark:border-slate-600 dark:bg-slate-800" value={findingKey} onChange={(event) => setFindingKey(event.target.value)}>{findingOptions.map((item) => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      {citations.length === 0 ? <p className="mt-3 text-sm">No source-cell references are available for this finding.</p> : <ul className="mt-3 space-y-2">{citations.map((citation) => <li key={String(citation.handle)} className="break-all rounded bg-slate-50 p-3 text-sm dark:bg-slate-800">Worksheet {String(citation.source_worksheet)}, row {String(citation.source_row_number)}, cell(s) {array(citation.source_cells).map(String).join(", ")}; source SHA-256 {String(citation.source_sha256)}.</li>)}</ul>}
    </section>

    <section className="grid gap-5 lg:grid-cols-2">
      <div className="rounded-2xl border border-blue-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900"><h2 className="text-lg font-semibold">Human report review</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Triage only. This is a separate action from dataset approval and CAPA creation.</p><label className="mt-4 block text-sm">Decision<select className="mt-1 w-full rounded border p-2 dark:bg-slate-800" value={reviewDecision} onChange={(event) => setReviewDecision(event.target.value)}><option value="acknowledged">Acknowledged</option><option value="follow_up_requested">Follow-up requested</option><option value="deferred">Deferred</option></select></label><label className="mt-3 block text-sm">Rationale<textarea className="mt-1 w-full rounded border p-2 dark:bg-slate-800" rows={3} maxLength={1000} value={reviewRationale} onChange={(event) => setReviewRationale(event.target.value)} /></label><button type="button" disabled={busy || !reviewRationale.trim() || !findingKey} onClick={() => void submitReview()} className="mt-3 rounded-lg bg-blue-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Record human review</button><h3 className="mt-5 font-medium">Review history</h3>{events.length ? <ul className="mt-2 space-y-2 text-xs">{events.map((event) => <li key={String(event.event_id)}>{String(event.finding_key)} · {String(event.decision)} · {String(event.occurred_at)} · {String(event.rationale)}</li>)}</ul> : <p className="mt-2 text-sm text-slate-500">No human review decision recorded yet.</p>}</div>
      <div className="rounded-2xl border border-emerald-200 bg-white p-6 dark:border-slate-700 dark:bg-slate-900"><h2 className="text-lg font-semibold">Human-authorized CAPA draft</h2><p className="mt-1 text-sm text-slate-600 dark:text-slate-300">Creates only a new S00 draft after server authorization. It never approves or advances the CAPA.</p><label className="mt-4 block text-sm">Separate CAPA creation rationale<textarea className="mt-1 w-full rounded border p-2 dark:bg-slate-800" rows={3} maxLength={1000} value={capaRationale} onChange={(event) => setCapaRationale(event.target.value)} /></label><button type="button" disabled={busy || !capaRationale.trim() || !findingKey || !report.result_fingerprint} onClick={() => void createCapaDraft()} className="mt-3 rounded-lg bg-emerald-700 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Create S00 CAPA draft</button>{capaCaseId && <p className="mt-3 text-sm">Draft case created: {capaCaseId} · S00 · workflow not advanced. <a className="underline" href="/capa">Open CAPA workspace</a></p>}</div>
    </section>
    <p role="status" aria-live="polite" className="break-words text-sm">{busy ? "Please wait… " : ""}{status}</p>
  </main>;
}
