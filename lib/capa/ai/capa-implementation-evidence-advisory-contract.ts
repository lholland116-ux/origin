import type { CapaAiOutputId, CapaAiRunId, ControlledVersion } from "./capa-prompt-contract";
import type { CapaImplementationEvidenceId } from "../domain/capa-types";

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT = "implementation_evidence_advisory_draft" as const;
export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION = "capa_implementation_evidence_advisory-1.0.0" as const;

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_CATEGORIES = [
  "missing_evidence",
  "evidence_provenance_gap",
  "narrative_evidence_mismatch",
  "incomplete_implementation_narrative",
  "unsupported_completion_claim",
  "approved_action_alignment_gap",
  "evidence_quality_concern",
  "controlled_knowledge_gap",
  "documentation_improvement",
  "other",
] as const;
export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SEVERITIES = ["low", "medium", "high", "critical"] as const;

export type CapaImplementationEvidenceAdvisoryCategory = typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_CATEGORIES[number];
export type CapaImplementationEvidenceAdvisorySeverity = typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SEVERITIES[number];

export interface CapaImplementationEvidenceAdvisoryAdoption {
  readonly eligible: boolean;
  readonly field: "implementation_narrative" | null;
  readonly suggested_value: string | null;
}

export interface CapaImplementationEvidenceAdvisoryFinding {
  readonly finding_id: string;
  readonly approved_action_reference: string;
  readonly category: CapaImplementationEvidenceAdvisoryCategory;
  readonly severity: CapaImplementationEvidenceAdvisorySeverity;
  readonly finding: string;
  readonly rationale: string;
  readonly evidence_reference_ids: readonly CapaImplementationEvidenceId[];
  readonly reference_keys: readonly string[];
  readonly suggested_human_action: string;
  readonly adoption: CapaImplementationEvidenceAdvisoryAdoption;
}

export interface CapaImplementationEvidenceAdvisoryCitation {
  readonly reference_key: string;
  readonly source_kind: "approved_action" | "implementation_evidence" | "governed_knowledge";
  readonly source_reference: string;
  readonly source_status: "authoritative" | "untrusted_human_draft" | "governed_current_effective";
  readonly locator: string | null;
}

export interface RawCapaImplementationEvidenceAdvisoryModelOutput {
  readonly schema_version: typeof CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION;
  readonly status: "completed_draft";
  readonly advisory_summary: string;
  readonly findings: readonly CapaImplementationEvidenceAdvisoryFinding[];
  readonly warnings: readonly string[];
  readonly uncertainty_and_limitations: readonly string[];
  /** The model must return no citations; the server resolves governed citations. */
  readonly citations: readonly unknown[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly approval_claimed: false;
  readonly workflow_transition: null;
  readonly human_acceptance_required: true;
}

export interface CapaImplementationEvidenceAdvisoryResponse extends Omit<RawCapaImplementationEvidenceAdvisoryModelOutput, "citations"> {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version: ControlledVersion;
  readonly citations: readonly CapaImplementationEvidenceAdvisoryCitation[];
}
