import type {
  CapaAiOutputId,
  CapaAiRunId,
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaKnowledgeCitationId,
  CapaKnowledgeCitationRelationship,
  CapaKnowledgeCitationValidationStatus,
} from "../knowledge/capa-knowledge-retrieval-contract";

/**
 * Browser-safe contract for advisory AI assistance on one server-resolved
 * CAPA intake record.
 *
 * Primary sources:
 * Document #5 — Human Review UI Specification
 * Document #7 — Agent Definition and Configuration Specification
 * Document #10 — Knowledge Base, Retrieval, and Citation Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * URS-AI-001 through URS-AI-012
 * PAE-001 through PAE-008
 * CIT-001 through CIT-012
 *
 * The browser never supplies organization, role, workflow state, agent,
 * model, tool, prompt, collection, or retrieval-policy authority. Trusted
 * server code resolves those values from the authenticated CAPA case.
 */

export const CAPA_INTAKE_ADVISORY_OUTPUT =
  "intake_analysis" as const;

export const CAPA_INTAKE_ADVISORY_PROPOSAL_FIELDS = [
  "problem_statement_draft",
  "scope_dimensions",
  "missing_dimensions",
  "containment_risk_questions",
  "investigation_questions",
] as const;

export type CapaIntakeAdvisoryProposalField =
  (typeof CAPA_INTAKE_ADVISORY_PROPOSAL_FIELDS)[number];

export interface CapaIntakeAdvisoryBrowserRequest {
  /** Optional untrusted human focus. It grants no additional authority. */
  readonly focus?: string;
}

export interface CapaIntakeAdvisoryRequest {
  readonly requested_output:
    typeof CAPA_INTAKE_ADVISORY_OUTPUT;
  readonly focus: string | null;
}

export interface CapaIntakeAdvisoryProposal {
  readonly problem_statement_draft: string;
  readonly scope_dimensions:
    readonly string[];
  readonly missing_dimensions:
    readonly string[];
  readonly containment_risk_questions:
    readonly string[];
  readonly investigation_questions:
    readonly string[];
}

export interface CapaIntakeAdvisoryCitation {
  readonly citation_id:
    CapaKnowledgeCitationId;
  readonly rendered_label: string;
  readonly source_title: string;
  readonly precise_locator: string;
  readonly relationship:
    CapaKnowledgeCitationRelationship;
  readonly validation_status:
    CapaKnowledgeCitationValidationStatus;
}

export const CAPA_INTAKE_ADVISORY_STATUSES = [
  "completed_draft",
  "validation_failed",
  "service_failed",
] as const;

export type CapaIntakeAdvisoryStatus =
  (typeof CAPA_INTAKE_ADVISORY_STATUSES)[number];

export interface CapaIntakeAdvisoryResponse {
  readonly run_id: CapaAiRunId;
  readonly output_id: CapaAiOutputId;
  readonly output_schema_version:
    ControlledVersion;
  readonly status:
    CapaIntakeAdvisoryStatus;
  readonly proposal:
    CapaIntakeAdvisoryProposal | null;
  readonly citations:
    readonly CapaIntakeAdvisoryCitation[];
  readonly assumptions: readonly string[];
  readonly missing_information:
    readonly string[];
  readonly conflicts_and_alternatives:
    readonly string[];
  readonly uncertainty_and_limitations:
    readonly string[];
  readonly human_action_required:
    readonly string[];
  readonly warnings: readonly string[];
  readonly advisory_only: true;
  readonly workflow_mutated: false;
  readonly human_acceptance_required: true;
}
