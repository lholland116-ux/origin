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
} from "../domain/capa-types";
import type { CapaAiOutputId } from "./capa-prompt-contract";
import type {
  CapaInvestigationActiveAdvisoryReferenceKey,
} from "./capa-investigation-active-advisory-contract";
import type {
  CapaInvestigationActiveAdvisoryReferenceSourceKind,
  CapaInvestigationActiveAdvisoryReferenceTrust,
} from "./capa-investigation-active-advisory-context";

export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION =
  "capa-investigation-active-adoption-1.0.0" as const;
export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_ITEMS = 20 as const;
export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_TEXT_CHARACTERS = 4_000 as const;
export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS = 128 as const;
export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_SERIALIZED_REQUEST_CHARACTERS = 30_000 as const;

type AdoptionIdentity<Name extends string> = string & { readonly __brand: Name };
export type CapaInvestigationActiveAdoptionId = AdoptionIdentity<"CapaInvestigationActiveAdoptionId">;

export type CapaInvestigationActiveAdoptionCategory =
  | "evidence_gap"
  | "conflicting_information"
  | "assumption"
  | "causal_hypothesis"
  | "alternative_hypothesis"
  | "investigation_recommendation";

export interface EvidenceGapAdoptedContent {
  readonly gap: string;
  readonly why_it_matters: string;
  readonly recommended_next_step: string;
}
export interface ConflictingInformationAdoptedContent {
  readonly conflict: string;
  readonly why_it_matters: string;
}
export interface AssumptionAdoptedContent {
  readonly assumption: string;
  readonly verification_question: string;
}
export interface CausalHypothesisAdoptedContent {
  readonly hypothesis: string;
  readonly rationale: string;
}
export interface AlternativeHypothesisAdoptedContent {
  readonly hypothesis: string;
  readonly rationale: string;
}
export interface InvestigationRecommendationAdoptedContent {
  readonly recommendation: string;
  readonly rationale: string;
}

export type CapaInvestigationActiveAdoptedContent =
  | EvidenceGapAdoptedContent
  | ConflictingInformationAdoptedContent
  | AssumptionAdoptedContent
  | CausalHypothesisAdoptedContent
  | AlternativeHypothesisAdoptedContent
  | InvestigationRecommendationAdoptedContent;

export interface CapaInvestigationActiveAdoptionItemIntent {
  readonly proposal_key: string;
  readonly adopted_content: unknown;
}
export interface CapaInvestigationActiveAdoptionIntentRequest {
  readonly expected_case_version_id: CapaCaseVersionId;
  readonly expected_record_version: number;
  readonly output_id: CapaAiOutputId;
  readonly selected_items: readonly CapaInvestigationActiveAdoptionItemIntent[];
}

export type CapaInvestigationActiveAdoptionRelationship =
  | "related" | "conflicting" | "supporting" | "contradictory";

export interface CapaInvestigationActiveResolvedReferenceBinding {
  readonly reference_key: CapaInvestigationActiveAdvisoryReferenceKey;
  readonly relationship: CapaInvestigationActiveAdoptionRelationship;
  readonly trust: CapaInvestigationActiveAdvisoryReferenceTrust;
  readonly source_kind: CapaInvestigationActiveAdvisoryReferenceSourceKind;
  readonly source_id: string;
}

export interface CapaInvestigationActiveAdoptedItem {
  readonly proposal_key: string;
  readonly adopted_content: CapaInvestigationActiveAdoptedContent;
}

export interface CapaInvestigationActiveAdoptionRecord {
  readonly adoption_id: CapaInvestigationActiveAdoptionId;
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly output_id: CapaAiOutputId;
  readonly proposal_key: string;
  readonly proposal_category: CapaInvestigationActiveAdoptionCategory;
  readonly adopted_item: CapaInvestigationActiveAdoptedItem;
  readonly resolved_reference_bindings: readonly CapaInvestigationActiveResolvedReferenceBinding[];
  readonly reference_manifest_schema_version: string;
  readonly reference_manifest_fingerprint_algorithm: string;
  readonly reference_manifest_sha256: string;
  readonly adopted_at: IsoDateTime;
  readonly adopted_by: ActorReference & { readonly actor_type: "human" };
  readonly adoption_policy_version: typeof CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly idempotency_key: IdempotencyKey;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly gate_approved: false;
}

export interface ConstructCapaInvestigationActiveAdoptionInput {
  readonly adoption_id: CapaInvestigationActiveAdoptionId;
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly output_id: string;
  readonly proposal_key: string;
  readonly proposal_category: CapaInvestigationActiveAdoptionCategory;
  readonly adopted_item: CapaInvestigationActiveAdoptedItem;
  readonly resolved_reference_bindings: readonly CapaInvestigationActiveResolvedReferenceBinding[];
  readonly reference_manifest_schema_version: string;
  readonly reference_manifest_fingerprint_algorithm: string;
  readonly reference_manifest_sha256: string;
  readonly adopted_at: IsoDateTime;
  readonly adopted_by: ActorReference;
  readonly adoption_policy_version?: string;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly idempotency_key: IdempotencyKey;
  readonly workflow_mutated: false;
  readonly controlled_record_mutated: false;
  readonly gate_approved: false;
}

export type CapaInvestigationActiveAdoptionAuditBinding = { readonly audit_event_id: AuditEventId };
