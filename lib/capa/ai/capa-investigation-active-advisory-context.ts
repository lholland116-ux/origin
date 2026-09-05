import type { AuthenticationContext } from "../../security/auth-context";
import type {
  TenantContext,
  TenantRoleAssignment,
} from "../../security/tenant-context";
import type {
  CapaEvidenceStatus,
  CapaAssumptionStatus,
  CapaConflictStatus,
  CapaGapStatus,
  CapaLedgerInformationClass,
} from "../domain/capa-evidence-assumption-ledger";
import type {
  CapaInvestigationPlanContent,
  CapaInvestigationPlanItemStatus,
} from "../domain/capa-investigation-plan";
import type {
  CapaCausalHypothesisStatus,
  CapaCausalRole,
} from "../domain/capa-root-cause-package";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  OrganizationId,
  UserId,
} from "../domain/capa-types";
import type {
  CapaInvestigationActiveAdvisoryReferenceKey,
} from "./capa-investigation-active-advisory-contract";

export type CapaInvestigationActiveAdvisoryReferenceTrust =
  | "authoritative_server_context"
  | "untrusted_human_draft";

export type CapaInvestigationActiveAdvisoryReferenceSourceKind =
  | "investigation_plan_item"
  | "ledger_item"
  | "causal_hypothesis"
  | "root_cause_not_confirmed";

export interface AuthoritativeS40InvestigationActiveContext {
  readonly trust: "authoritative_server_context";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: "S40";
  readonly actor: UserId;
  readonly active_roles: readonly TenantRoleAssignment[];
  readonly investigation_plan: CapaInvestigationPlanContent;
}

/**
 * Server-only mapping. source_id must never be copied into the model prompt.
 */
export interface CapaInvestigationActiveAdvisoryReferenceManifestEntry {
  readonly reference_key:
    CapaInvestigationActiveAdvisoryReferenceKey;
  readonly trust:
    CapaInvestigationActiveAdvisoryReferenceTrust;
  readonly source_kind:
    CapaInvestigationActiveAdvisoryReferenceSourceKind;
  readonly source_id: string;
}

export interface CapaInvestigationActiveAdvisoryPlanReference {
  readonly reference_key:
    CapaInvestigationActiveAdvisoryReferenceKey;
  readonly trust: "authoritative_server_context";
  readonly source_kind: "investigation_plan_item";
  readonly investigation_question: string | null;
  readonly evidence_target: string | null;
  readonly investigation_method: string | null;
  readonly scope_relationship: string | null;
  readonly status: CapaInvestigationPlanItemStatus;
  readonly disposition: string | null;
  readonly disposition_rationale: string | null;
}

export interface CapaInvestigationActiveAdvisoryLedgerReference {
  readonly reference_key:
    CapaInvestigationActiveAdvisoryReferenceKey;
  readonly trust: "untrusted_human_draft";
  readonly source_kind: "ledger_item";
  readonly information_class: CapaLedgerInformationClass;
  readonly statement: string;
  readonly evidence_status: CapaEvidenceStatus | null;
  readonly assumption_status: CapaAssumptionStatus | null;
  readonly gap_status: CapaGapStatus | null;
  readonly conflict_status: CapaConflictStatus | null;
  readonly context: string | null;
  readonly material_to_conclusion: boolean;
  readonly critical_to_conclusion: boolean;
  readonly recommended_next_step: string | null;
}

export interface CapaInvestigationActiveAdvisoryHypothesisReference {
  readonly reference_key:
    CapaInvestigationActiveAdvisoryReferenceKey;
  readonly trust: "untrusted_human_draft";
  readonly source_kind: "causal_hypothesis";
  readonly statement: string;
  readonly status: CapaCausalHypothesisStatus;
  readonly causal_role: CapaCausalRole;
  readonly rationale: string;
  readonly supporting_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly contradictory_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly linked_assumption_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly linked_gap_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly linked_conflict_reference_keys:
    readonly CapaInvestigationActiveAdvisoryReferenceKey[];
  readonly material_to_package: boolean;
}

export interface CapaInvestigationActiveAdvisoryNotConfirmedReference {
  readonly reference_key:
    CapaInvestigationActiveAdvisoryReferenceKey;
  readonly trust: "untrusted_human_draft";
  readonly source_kind: "root_cause_not_confirmed";
  readonly rationale: string;
  readonly next_steps: readonly string[];
}

export type CapaInvestigationActiveAdvisoryModelSafeReference =
  | CapaInvestigationActiveAdvisoryPlanReference
  | CapaInvestigationActiveAdvisoryLedgerReference
  | CapaInvestigationActiveAdvisoryHypothesisReference
  | CapaInvestigationActiveAdvisoryNotConfirmedReference;

export interface CapaInvestigationActiveAdvisoryModelSafeContext {
  readonly trust: "model_safe_context";
  readonly workflow_state: "S40";
  readonly references:
    readonly CapaInvestigationActiveAdvisoryModelSafeReference[];
}

export interface CapaInvestigationActiveAdvisoryContextAssembly {
  readonly authoritative:
    AuthoritativeS40InvestigationActiveContext;

  /**
   * Server-owned mapping retained for trace/adoption verification.
   * It must not be serialized into the model prompt.
   */
  readonly reference_manifest:
    readonly CapaInvestigationActiveAdvisoryReferenceManifestEntry[];

  /**
   * The only reference-oriented S40 context intended for model prompting.
   */
  readonly model_safe_context:
    CapaInvestigationActiveAdvisoryModelSafeContext;
}

export type CapaInvestigationActiveAdvisoryContextResolution =
  | {
      readonly status: "resolved";
      readonly assembly: CapaInvestigationActiveAdvisoryContextAssembly;
    }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "wrong_workflow_state" }
  | { readonly status: "invalid_authoritative_context" };

export interface CapaInvestigationActiveAdvisoryContextInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;

  /**
   * Current browser workspace draft. It is always untrusted input.
   *
   * Expected shape:
   * {
   *   trust: "untrusted_human_draft",
   *   evidence_assumption_ledger: ...,
   *   root_cause_package: ...
   * }
   */
  readonly untrusted_human_draft?: unknown;
}

export type CapaInvestigationActiveAdvisoryAuthentication =
  AuthenticationContext;

export type CapaInvestigationActiveAdvisoryTenant =
  TenantContext;
