import { createHash } from "node:crypto";
import type { QualityDataAiAnalysisResult, QualityEvidenceCitation } from "./quality-data-ai-contract";
import type { QualityDataCapaFindingClassification } from "./quality-data-capa-handoff-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ResolvedQualityDataIntelligenceFinding {
  readonly classification: QualityDataCapaFindingClassification;
  readonly value: unknown;
  readonly fingerprint: string;
  readonly citations: readonly QualityEvidenceCitation[];
}

export function resolveQualityDataIntelligenceFinding(
  result: QualityDataAiAnalysisResult,
  key: string,
): ResolvedQualityDataIntelligenceFinding | null {
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const reference = key.slice(separator + 1);
  let value: unknown;
  let classification: QualityDataCapaFindingClassification;

  if (kind === "signal") {
    value = result.observed_signals.find((entry) => entry.reference === reference) ?? null;
    classification = "deterministic_signal";
  } else if (kind === "metric") {
    value = result.verified_calculations.find((entry) => entry.reference === reference) ?? null;
    classification = "deterministic_calculation";
  } else {
    const index = Number(reference);
    if (!Number.isInteger(index) || index < 0) return null;
    if (kind === "possible_cause") {
      value = result.interpretation.possible_causes[index] ?? null;
      classification = "advisory_hypothesis";
    } else if (kind === "uncertainty") {
      value = result.interpretation.uncertainty[index] ?? null;
      classification = "advisory_uncertainty";
    } else if (kind === "investigation_step") {
      value = result.interpretation.human_investigation_steps[index] ?? null;
      classification = "advisory_investigation_step";
    } else return null;
  }
  if (value === null || value === undefined || typeof value !== "object" || Array.isArray(value)) return null;

  const record = value as Record<string, unknown>;
  const handles = new Set<string>();
  const collect = (candidate: unknown): boolean => {
    if (!Array.isArray(candidate)) return true;
    for (const handle of candidate) {
      if (typeof handle !== "string" || !UUID.test(handle)) return false;
      handles.add(handle);
    }
    return true;
  };
  if (classification.startsWith("advisory_")) {
    if (!collect(record.evidence_refs)) return null;
  } else {
    if (!collect(record.evidence_handles)) return null;
    for (const property of ["category_groups", "monthly_buckets", "change_comparisons"]) {
      const nested = record[property];
      if (!Array.isArray(nested)) continue;
      for (const item of nested) {
        if (typeof item !== "object" || item === null || !collect((item as Record<string, unknown>).evidence_handles)) return null;
      }
    }
  }
  if (handles.size === 0) return null;
  const citationsByHandle = new Map(result.evidence_citations.map((citation) => [citation.handle, citation]));
  if (citationsByHandle.size !== result.evidence_citations.length) return null;
  const citations = [...handles].sort().map((handle) => citationsByHandle.get(handle));
  if (citations.some((citation) => citation === undefined)) return null;

  return {
    classification,
    value,
    fingerprint: createHash("sha256").update(JSON.stringify(value)).digest("hex"),
    citations: citations as QualityEvidenceCitation[],
  };
}
