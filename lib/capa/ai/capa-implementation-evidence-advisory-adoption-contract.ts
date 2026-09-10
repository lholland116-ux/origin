import type { AuditEventId, CapaCaseId, CapaCaseVersionId, RequestTrace } from "../domain/capa-types";

export const CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_ADOPTION_POLICY_VERSION = "capa-implementation-evidence-advisory-adoption-1.0.0" as const;

export interface CapaImplementationEvidenceAdvisoryAdoptionRequest {
  readonly output_id: string;
  readonly finding_id: string;
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
}

export interface CapaImplementationEvidenceAdvisoryPreparedPatch {
  readonly output_id: string;
  readonly finding_id: string;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly approved_action_reference: string;
  readonly field: "implementation_narrative";
  readonly value: string;
  readonly requires_human_review: true;
  readonly auto_saved: false;
  readonly auto_submitted: false;
  readonly evidence_created: false;
  readonly owner_reported_status_changed: false;
  readonly approved_baseline_changed: false;
  readonly audit_event_id: AuditEventId | null;
}

export interface CapaImplementationEvidenceAdvisoryAdoptionResult {
  readonly status: "prepared";
  readonly patch: CapaImplementationEvidenceAdvisoryPreparedPatch;
  readonly request_trace: Pick<RequestTrace, "request_id" | "correlation_id">;
}
