import { createHash } from "node:crypto";
import { canonicalJson } from "../capa/ai/capa-ai-generation-trace";
import { qualityDataAiAnalysisResultSchema } from "./quality-data-ai-contract";
import type { QualityDataIntelligenceResult } from "./quality-data-intelligence-contract";

/** Matches both historical schema-ordered AI fingerprints and canonical deterministic fingerprints after JSONB hydration. */
export function qualityDataIntelligenceResultFingerprint(result: QualityDataIntelligenceResult): string {
  const serialized = result.interpretation_status === "not_requested"
    ? canonicalJson(result)
    : JSON.stringify(qualityDataAiAnalysisResultSchema.parse(result));
  return createHash("sha256").update(serialized).digest("hex");
}
