import { randomUUID } from "node:crypto";
import type { QualityAnalysisResult, QualityAnalysisFieldReference } from "./quality-analysis-contract";
import type { QualitySignalDetectionResult, QualitySignalEvidenceRecord, QualitySignalResult } from "./quality-signal-contract";
import { qualityDataAiModelOutputSchema, qualityEvidencePacketSchema, type QualityDataAiAnalysisResult, type QualityEvidenceCitation, type QualityEvidencePacket } from "./quality-data-ai-contract";

export const QUALITY_EVIDENCE_PACKET_MAX_BYTES = 24_000;
export const QUALITY_EVIDENCE_PACKET_MAX_HANDLES = 128;

const UNIT_ALIASES: Readonly<Record<string, QualityEvidencePacket["calculations"][number]["unit"]>> = Object.freeze({
  count: "COUNT", cnt: "COUNT", unit: "UNIT", units: "UNIT", piece: "PIECE", pieces: "PIECE",
  kg: "KG", kilogram: "KG", g: "G", gram: "G", lb: "LB", lbs: "LB", l: "L", liter: "L",
  ml: "ML", m: "M", meter: "M", cm: "CM", mm: "MM", "%": "PERCENT", percent: "PERCENT",
});

function unitAlias(value: string | null): QualityEvidencePacket["calculations"][number]["unit"] {
  return value === null ? "UNSPECIFIED" : UNIT_ALIASES[value.trim().toLowerCase()] ?? "UNSPECIFIED";
}

function staticCode(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toUpperCase().slice(0, 64) || "UNSPECIFIED";
}

function mapStatus(value: string): string {
  return value.toUpperCase();
}

function recordValues(record: QualitySignalEvidenceRecord): readonly string[] {
  return record.cells.flatMap((cell) => cell.source_cell_reference ? [cell.source_cell_reference] : []);
}

/** Builds a provider-safe packet and keeps the reversible provenance map in this server request only. */
export function buildQualityEvidencePacket(
  analysis: QualityAnalysisResult,
  detection: QualitySignalDetectionResult,
  createHandle: () => string = randomUUID,
  interpretationMode: "external_ai" | "not_requested" = "external_ai",
): { readonly packet: QualityEvidencePacket; readonly citations: ReadonlyMap<string, QualityEvidenceCitation> } | null {
  if (analysis.dataset.dataset_version_id !== detection.dataset.dataset_version_id
    || analysis.dataset.organization_id !== detection.dataset.organization_id
    || analysis.approval.approval_event_id !== detection.dataset.approval_event_id
    || analysis.sources.length !== 1 || detection.sources.length !== 1
    || analysis.sources[0]?.source_id !== detection.sources[0]?.source_id
    || analysis.sources[0]?.source_version_id !== detection.sources[0]?.source_version_id
    || analysis.sources[0]?.source_sha256 !== detection.sources[0]?.source_sha256) return null;

  const citations = new Map<string, QualityEvidenceCitation>();
  const handleByRecord = new Map<string, string>();
  let evidenceTruncated = false;
  const source = analysis.sources[0]!;
  const getHandle = (input: {
    record_id: string; record_ordinal: number; source_worksheet: string; source_row_number: number;
    cells: readonly string[];
  }): string | null => {
    const existing = handleByRecord.get(input.record_id);
    if (existing) {
      const previous = citations.get(existing)!;
      citations.set(existing, { ...previous, source_cells: [...new Set([...previous.source_cells, ...input.cells])].slice(0, 8) });
      return existing;
    }
    if (citations.size >= QUALITY_EVIDENCE_PACKET_MAX_HANDLES) { evidenceTruncated = true; return null; }
    const handle = createHandle();
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(handle)) return null;
    handleByRecord.set(input.record_id, handle);
    citations.set(handle, {
      handle, record_id: input.record_id, record_ordinal: input.record_ordinal,
      source_worksheet: input.source_worksheet, source_row_number: input.source_row_number,
      source_cells: [...new Set(input.cells)].slice(0, 8),
      source_id: source.source_id, source_version_id: source.source_version_id, source_sha256: source.source_sha256,
    });
    return handle;
  };
  const fromMetric = (reference: QualityAnalysisFieldReference): string | null => getHandle({
    record_id: reference.record_id, record_ordinal: reference.record_ordinal,
    source_worksheet: reference.source_worksheet, source_row_number: reference.source_row_number,
    cells: reference.source_cell_reference ? [reference.source_cell_reference] : [],
  });
  const fromSignalRecord = (record: QualitySignalEvidenceRecord): string | null => getHandle({
    record_id: record.record_id, record_ordinal: record.record_ordinal,
    source_worksheet: record.source_worksheet, source_row_number: record.source_row_number,
    cells: recordValues(record),
  });
  const pickMetricHandles = (refs: readonly QualityAnalysisFieldReference[]): string[] => refs.slice(0, 16).flatMap((ref) => {
    const handle = fromMetric(ref); return handle ? [handle] : [];
  });
  const pickSignalHandles = (records: readonly QualitySignalEvidenceRecord[]): string[] => records.slice(0, 16).flatMap((record) => {
    const handle = fromSignalRecord(record); return handle ? [handle] : [];
  });

  const calculations: QualityEvidencePacket["calculations"] = analysis.metrics.map((metric, index) => ({
    reference: `M${index + 1}`, kind: metric.kind === "field_completeness" ? "FIELD_COMPLETENESS" : "NUMERIC_SUMMARY",
    status: mapStatus(metric.status) as "COMPLETE" | "MISSING_DATA" | "UNIT_MISMATCH",
    sample_size: metric.numerator_record_count, numerator_count: metric.numerator_record_count,
    denominator_count: metric.denominator_record_count, excluded_counts: metric.exclusions,
    unit: unitAlias(metric.unit), value: metric.value, minimum: metric.minimum, maximum: metric.maximum,
    evidence_handles: pickMetricHandles(metric.calculation_inputs),
  }));

  const limitations = new Set<string>();
  const assumptions = new Set<string>([
    "STAGE3A_APPROVED_IMMUTABLE_VERSION", "STAGE3B_DETERMINISTIC_CALCULATIONS", "CATEGORY_VALUES_REPLACED_BY_ALIASES",
    interpretationMode === "external_ai" ? "MODEL_OUTPUT_IS_UNVERIFIED_ADVISORY" : "EXTERNAL_AI_NOT_REQUESTED",
  ]);
  const packetSignals: QualityEvidencePacket["signals"] = detection.signals.map((signal: QualitySignalResult, index) => {
    const reference = `S${index + 1}`;
    const allSignalRecords: QualitySignalEvidenceRecord[] = [];
    const exclusions = "exclusions" in signal ? { ...signal.exclusions } : {};
    for (const [key, value] of Object.entries(exclusions)) if (typeof value === "number" && value > 0) limitations.add(`EXCLUDED_${staticCode(key)}`);
    if (signal.status !== "detected" && signal.status !== "not_detected") limitations.add(`SIGNAL_${staticCode(signal.status)}`);
    if ("reason_code" in signal && signal.reason_code) limitations.add(staticCode(signal.reason_code));

    const categoryGroups: QualityEvidencePacket["signals"][number]["category_groups"] = [];
    const monthlyBuckets: QualityEvidencePacket["signals"][number]["monthly_buckets"] = [];
    const changeComparisons: QualityEvidencePacket["signals"][number]["change_comparisons"] = [];
    let threshold: number | null = null;
    let ratePer: number | null = null;
    let sampleSize = 0;
    let minimumSampleSize = 0;
    let unit: QualityEvidencePacket["signals"][number]["unit"] = "UNSPECIFIED";
    if (signal.kind === "recurring_category") {
      sampleSize = signal.sample_record_count;
      minimumSampleSize = signal.minimum_sample_size;
      signal.observed_patterns.slice(0, 20).forEach((pattern, categoryIndex) => {
        const evidence = pattern.evidence.slice(0, 8);
        allSignalRecords.push(...evidence);
        categoryGroups.push({ alias: `C${categoryIndex + 1}`, occurrence_count: pattern.occurrence_count, evidence_handles: pickSignalHandles(evidence) });
      });
      if (signal.observed_patterns.length > 20) limitations.add("CATEGORY_GROUPS_TRUNCATED");
    } else {
      ratePer = signal.rate_definition.rate_per;
      unit = unitAlias(signal.rate_definition.production_quantity_unit);
      minimumSampleSize = signal.buckets[0]?.minimum_records_per_window ?? 0;
      threshold = signal.kind === "defect_rate_threshold" ? signal.rate_definition.threshold : signal.rate_definition.minimum_absolute_change;
      for (const bucket of signal.buckets) {
        const records = bucket.calculation_inputs.slice(0, 8);
        allSignalRecords.push(...records);
        sampleSize += bucket.sample_record_count;
        monthlyBuckets.push({
          period: bucket.period, status: bucket.status === "evaluated" ? "EVALUATED" : "INSUFFICIENT_DATA",
          sample_size: bucket.sample_record_count, numerator_total: bucket.defect_count_total,
          denominator_total: bucket.production_quantity_total, rate: bucket.rate, threshold: bucket.threshold,
          triggered: bucket.triggered, evidence_handles: pickSignalHandles(records),
        });
      }
      if (signal.kind === "defect_rate_trend") for (const comparison of signal.comparisons) {
        const records = comparison.calculation_inputs.slice(0, 8);
        allSignalRecords.push(...records);
        changeComparisons.push({ from_period: comparison.from_period, to_period: comparison.to_period,
          change: comparison.change, triggered: comparison.triggered, evidence_handles: pickSignalHandles(records) });
      }
      if (unit === "UNSPECIFIED") limitations.add("NONSTANDARD_UNIT_NOT_SENT_TO_PROVIDER");
    }
    const handles = [...new Set(allSignalRecords.flatMap((record) => {
      const handle = handleByRecord.get(record.record_id) ?? fromSignalRecord(record); return handle ? [handle] : [];
    }))].slice(0, 32);
    return {
      reference, kind: signal.kind === "recurring_category" ? "RECURRING_CATEGORY" : signal.kind === "defect_rate_threshold" ? "DEFECT_RATE_THRESHOLD" : "DEFECT_RATE_TREND",
      status: mapStatus(signal.status) as QualityEvidencePacket["signals"][number]["status"], sample_size: sampleSize,
      minimum_sample_size: minimumSampleSize, exclusions, threshold, rate_per: ratePer, unit,
      category_groups: categoryGroups, monthly_buckets: monthlyBuckets, change_comparisons: changeComparisons,
      evidence_handles: handles,
    };
  });

  if (evidenceTruncated) limitations.add("EVIDENCE_REFERENCES_SAMPLED_TO_LIMIT");
  if (calculations.some((item) => item.unit === "UNSPECIFIED") || packetSignals.some((item) => item.unit === "UNSPECIFIED")) limitations.add("UNIT_UNSPECIFIED_OR_NONSTANDARD");
  const windows = new Set<string>();
  if (calculations.length > 0) windows.add("ALL_APPROVED_RECORDS");
  for (const signal of packetSignals) for (const bucket of signal.monthly_buckets) windows.add(bucket.period);
  for (const signal of packetSignals) for (const change of signal.change_comparisons) { windows.add(change.from_period); windows.add(change.to_period); }
  const packetCandidate = {
    schema_version: "quality-evidence-packet-1.0.0" as const, packet_id: randomUUID(),
    calculation_versions: [...new Set([analysis.calculation_version, detection.calculation_version])],
    time_windows: [...windows].sort().slice(0, 120), assumptions: [...assumptions].sort(),
    data_quality_limitations: [...limitations].sort(), calculations, signals: packetSignals,
  };
  const parsed = qualityEvidencePacketSchema.safeParse(packetCandidate);
  if (!parsed.success || citations.size === 0 || Buffer.byteLength(JSON.stringify(parsed.data), "utf8") > QUALITY_EVIDENCE_PACKET_MAX_BYTES) return null;
  return { packet: parsed.data, citations };
}

export function validateModelEvidenceReferences(
  value: unknown,
  allowedHandles: ReadonlyMap<string, QualityEvidenceCitation>,
): { readonly valid: true; readonly output: QualityDataAiAnalysisResult["interpretation"]; readonly citations: readonly QualityEvidenceCitation[] } | { readonly valid: false } {
  const parsed = qualityDataAiModelOutputSchema.safeParse(value);
  if (!parsed.success) return { valid: false };
  const cited = new Set<string>();
  for (const finding of [...parsed.data.possible_causes, ...parsed.data.uncertainty, ...parsed.data.human_investigation_steps]) {
    if (/\b(?:lot|serial(?:\s*(?:number|no|#))?|batch(?:\s*(?:number|no|#))?|customer\s*(?:id|number|no|#)|order\s*(?:id|number|no|#))[\s:#-]*[A-Z0-9][A-Z0-9-]{2,}\b|\b[A-Z]{2,}[-_]\d{3,}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\+?\d[\d ()-]{8,}\d/i.test(finding.text)) return { valid: false };
    for (const reference of finding.evidence_refs) {
      if (!allowedHandles.has(reference)) return { valid: false };
      cited.add(reference);
    }
  }
  return { valid: true, output: parsed.data, citations: [...cited].map((handle) => allowedHandles.get(handle)!) };
}
