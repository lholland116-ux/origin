import type {
  AuthenticationContext,
} from "../../security/auth-context";
import type {
  TenantContext,
  TenantRoleAssignment,
} from "../../security/tenant-context";
import type {
  CapaEvidenceAssumptionLedgerContent,
  CapaEvidenceAssumptionLedgerItem,
} from "../domain/capa-evidence-assumption-ledger";
import type {
  CapaInvestigationPlanContent,
  CapaInvestigationPlanItem,
} from "../domain/capa-investigation-plan";
import type {
  CapaCausalHypothesis,
  CapaRootCausePackageContent,
} from "../domain/capa-root-cause-package";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  OrganizationId,
  UserId,
} from "../domain/capa-types";
import type {
  CapaRootCauseReviewAdvisoryReferenceKey,
} from "./capa-root-cause-review-advisory-contract";

/** Governed server context for the AG-REVIEW S50 boundary. */
export interface CapaRootCauseReviewAdvisorySectionSnapshot<Content> {
  readonly section_version_id: CapaSectionVersionId;
  readonly section_type: string;
  readonly section_version_number: number;
  readonly schema_version: string;
  readonly content: Content;
}

export interface AuthoritativeS50RootCauseReviewContext {
  readonly trust: "authoritative_server_context";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: "S50";
  readonly actor: UserId;
  readonly active_roles: readonly TenantRoleAssignment[];
  readonly case_version: Readonly<{
    readonly version_number: number;
    readonly parent_version_id: CapaCaseVersionId | null;
    readonly change_reason: string;
  }>;
  readonly sections: Readonly<{
    readonly investigation_ledger:
      CapaRootCauseReviewAdvisorySectionSnapshot<CapaEvidenceAssumptionLedgerContent>;
    readonly root_cause_package:
      CapaRootCauseReviewAdvisorySectionSnapshot<CapaRootCausePackageContent>;
    readonly investigation_plan:
      CapaRootCauseReviewAdvisorySectionSnapshot<CapaInvestigationPlanContent> | null;
  }>;
  readonly comparison_version: Readonly<{
    readonly version_number: number;
    readonly case_version_id: CapaCaseVersionId;
    readonly sections: Readonly<{
      readonly investigation_ledger:
        CapaRootCauseReviewAdvisorySectionSnapshot<CapaEvidenceAssumptionLedgerContent>;
      readonly root_cause_package:
        CapaRootCauseReviewAdvisorySectionSnapshot<CapaRootCausePackageContent>;
      readonly investigation_plan:
        CapaRootCauseReviewAdvisorySectionSnapshot<CapaInvestigationPlanContent> | null;
    }>;
  }> | null;
}

export type CapaRootCauseReviewAdvisoryReferenceSourceKind =
  | "investigation_plan_item"
  | "ledger_item"
  | "causal_hypothesis"
  | "root_cause_not_confirmed";

export interface CapaRootCauseReviewAdvisoryReferenceManifestEntry {
  readonly reference_key:
    CapaRootCauseReviewAdvisoryReferenceKey;
  readonly trust: "authoritative_server_context";
  readonly source_kind:
    CapaRootCauseReviewAdvisoryReferenceSourceKind;
  readonly source_id: string;
  readonly version_scope: "current" | "comparison";
}

interface CapaRootCauseReviewAdvisoryModelReferenceBase {
  readonly reference_key:
    CapaRootCauseReviewAdvisoryReferenceKey;
  readonly trust: "authoritative_server_context";
  readonly source_kind:
    CapaRootCauseReviewAdvisoryReferenceSourceKind;
  readonly version_scope: "current" | "comparison";
}

export interface CapaRootCauseReviewAdvisoryLedgerReference
  extends CapaRootCauseReviewAdvisoryModelReferenceBase {
  readonly source_kind: "ledger_item";
  readonly information_class: CapaEvidenceAssumptionLedgerItem["information_class"];
  readonly statement: string;
  readonly evidence_status: CapaEvidenceAssumptionLedgerItem["evidence_status"];
  readonly assumption_status: CapaEvidenceAssumptionLedgerItem["assumption_status"];
  readonly gap_status: CapaEvidenceAssumptionLedgerItem["gap_status"];
  readonly conflict_status: CapaEvidenceAssumptionLedgerItem["conflict_status"];
  readonly source_version: string | null;
  readonly context: string | null;
  readonly material_to_conclusion: boolean;
  readonly critical_to_conclusion: boolean;
  readonly recommended_next_step: string | null;
}

export interface CapaRootCauseReviewAdvisoryHypothesisReference
  extends CapaRootCauseReviewAdvisoryModelReferenceBase {
  readonly source_kind: "causal_hypothesis";
  readonly statement: CapaCausalHypothesis["statement"];
  readonly status: CapaCausalHypothesis["status"];
  readonly causal_role: CapaCausalHypothesis["causal_role"];
  readonly rationale: CapaCausalHypothesis["rationale"];
  readonly supporting_reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly contradictory_reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly linked_assumption_reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly linked_gap_reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly linked_conflict_reference_keys:
    readonly CapaRootCauseReviewAdvisoryReferenceKey[];
  readonly material_to_package: boolean;
}

export interface CapaRootCauseReviewAdvisoryPlanReference
  extends CapaRootCauseReviewAdvisoryModelReferenceBase {
  readonly source_kind: "investigation_plan_item";
  readonly investigation_question: CapaInvestigationPlanItem["investigation_question"];
  readonly evidence_target: CapaInvestigationPlanItem["evidence_target"];
  readonly investigation_method: CapaInvestigationPlanItem["investigation_method"];
  readonly scope_relationship: CapaInvestigationPlanItem["scope_relationship"];
  readonly status: CapaInvestigationPlanItem["status"];
  readonly disposition: CapaInvestigationPlanItem["disposition"];
  readonly disposition_rationale: CapaInvestigationPlanItem["disposition_rationale"];
}

export interface CapaRootCauseReviewAdvisoryNotConfirmedReference
  extends CapaRootCauseReviewAdvisoryModelReferenceBase {
  readonly source_kind: "root_cause_not_confirmed";
  readonly rationale: string;
  readonly next_steps: readonly string[];
}

export type CapaRootCauseReviewAdvisoryModelSafeReference =
  | CapaRootCauseReviewAdvisoryLedgerReference
  | CapaRootCauseReviewAdvisoryHypothesisReference
  | CapaRootCauseReviewAdvisoryPlanReference
  | CapaRootCauseReviewAdvisoryNotConfirmedReference;

export interface CapaRootCauseReviewAdvisoryModelSafeContext {
  readonly trust: "model_safe_context";
  readonly workflow_state: "S50";
  readonly current_version_number: number;
  readonly comparison_version_number: number | null;
  readonly current_section_versions: Readonly<{
    readonly investigation_ledger: string;
    readonly root_cause_package: string;
    readonly investigation_plan: string | null;
  }>;
  readonly comparison_section_versions: Readonly<{
    readonly investigation_ledger: string;
    readonly root_cause_package: string;
    readonly investigation_plan: string | null;
  }> | null;
  readonly references:
    readonly CapaRootCauseReviewAdvisoryModelSafeReference[];
}

export interface CapaRootCauseReviewAdvisoryContextAssembly {
  readonly authoritative: AuthoritativeS50RootCauseReviewContext;
  /** Server-only source mapping; never serialized into the model prompt. */
  readonly reference_manifest:
    readonly CapaRootCauseReviewAdvisoryReferenceManifestEntry[];
  readonly model_safe_context:
    CapaRootCauseReviewAdvisoryModelSafeContext;
}

export type CapaRootCauseReviewAdvisoryContextResolution =
  | {
      readonly status: "resolved";
      readonly assembly: CapaRootCauseReviewAdvisoryContextAssembly;
    }
  | { readonly status: "not_found_or_not_authorized" }
  | { readonly status: "wrong_workflow_state" }
  | { readonly status: "invalid_authoritative_context" };

export interface CapaRootCauseReviewAdvisoryContextInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
}

export type CapaRootCauseReviewAdvisoryAuthentication =
  AuthenticationContext;

export type CapaRootCauseReviewAdvisoryTenant = TenantContext;
