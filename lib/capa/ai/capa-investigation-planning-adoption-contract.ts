import type {
  ActorReference,
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
  UserId,
} from "../domain/capa-types";

import type {
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaInvestigationPlanAdvisoryProposalKey,
  CapaInvestigationPlanAdvisoryResponse,
} from "./capa-investigation-planning-advisory-contract";

/** Policy identity for the future human-controlled S30 adoption service. */
export const CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION =
  "capa-investigation-planning-adoption-1.0.0" as ControlledVersion;

export const CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_ITEMS = 20 as const;
export const CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_TEXT_CHARACTERS =
  4_000 as const;
export const CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_DEPENDENCIES =
  20 as const;

type CapaInvestigationPlanningAdoptionIdentity<Name extends string> =
  string & { readonly __brand: Name };

export type CapaInvestigationPlanningAdoptionId =
  CapaInvestigationPlanningAdoptionIdentity<
    "CapaInvestigationPlanningAdoptionId"
  >;

/**
 * Human-owned intent for selectively adopting S30 advisory proposals.
 *
 * The browser identifies an immutable output and advisory-local proposal
 * keys, then supplies editable intent. Identity, provenance, actor, time,
 * trace, policy and workflow flags are server-owned.
 */
export interface CapaInvestigationPlanningAdoptionItemIntent {
  readonly proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly investigation_question: string | null;
  readonly evidence_target: string | null;
  readonly investigation_method: string | null;
  readonly scope_relationship: string | null;
  readonly owner_user_id: UserId | null;
  readonly due_date: string | null;
  readonly dependency_proposal_keys:
    readonly CapaInvestigationPlanAdvisoryProposalKey[];
}

export interface CapaInvestigationPlanningAdoptionIntentRequest {
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
  readonly output_id:
    CapaInvestigationPlanAdvisoryResponse["output_id"];
  readonly selected_items:
    readonly CapaInvestigationPlanningAdoptionItemIntent[];
}

/** Immutable snapshot of one human-selected advisory proposal. */
export type CapaInvestigationPlanningAdoptedItem =
  CapaInvestigationPlanningAdoptionItemIntent;

/**
 * Canonical immutable evidence that a human selected one S30 proposal.
 *
 * The adoption_id is intentionally the future
 * investigation-plan.draft_provenance.source_reference. This record is not
 * itself a controlled CAPA investigation-plan section and does not release
 * or advance the CAPA workflow.
 */
export interface CapaInvestigationPlanningAdoptionRecord {
  readonly adoption_id:
    CapaInvestigationPlanningAdoptionId;
  readonly organization_id:
    OrganizationId;
  readonly capa_case_id:
    CapaCaseId;
  readonly case_version_id:
    CapaCaseVersionId;
  readonly record_version: number;
  readonly output_id:
    CapaInvestigationPlanAdvisoryResponse["output_id"];
  readonly proposal_key:
    CapaInvestigationPlanAdvisoryProposalKey;
  readonly adopted_item:
    CapaInvestigationPlanningAdoptedItem;
  readonly adopted_at:
    IsoDateTime;
  readonly adopted_by:
    ActorReference & { readonly actor_type: "human" };
  readonly adoption_policy_version:
    ControlledVersion;
  readonly request_id:
    RequestId;
  readonly correlation_id:
    CorrelationId;
  readonly idempotency_key:
    IdempotencyKey;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly gate_approved: false;
}

export interface ConstructCapaInvestigationPlanningAdoptionInput {
  readonly adoption_id: CapaInvestigationPlanningAdoptionId;
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly output_id: string;
  readonly adopted_item: CapaInvestigationPlanningAdoptedItem;
  readonly adopted_at: IsoDateTime;
  readonly adopted_by: ActorReference;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly idempotency_key: IdempotencyKey;
  readonly adoption_policy_version?: ControlledVersion;
}

/** Optional audit binding supplied by the future application service. */
export interface CapaInvestigationPlanningAdoptionAuditBinding {
  readonly audit_event_id: AuditEventId;
}
