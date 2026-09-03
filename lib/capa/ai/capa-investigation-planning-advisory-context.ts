import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantRoleAssignment, TenantContext } from "../../security/tenant-context";
import type { CapaContainmentRiskContent } from "../domain/capa-containment-risk";
import type { CapaScopeContent } from "../domain/capa-scope";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  OrganizationId,
  UserId,
} from "../domain/capa-types";

export interface AuthoritativeS30InvestigationPlanningContext {
  readonly trust: "authoritative_server_context";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: "S30";
  readonly actor: UserId;
  readonly active_roles: readonly TenantRoleAssignment[];
  readonly intake_scope: Readonly<{
    readonly initiating_event: string;
    readonly source: Readonly<Record<string, string | null>>;
    readonly organization_reference: string;
  }>;
  readonly accepted_scope: CapaScopeContent;
  readonly accepted_containment_risk: CapaContainmentRiskContent;
}

export interface CapaInvestigationPlanningAdvisoryHumanDraftItem {
  /** Local draft key only; it is not an authoritative CAPA item ID. */
  readonly local_key: string;
  readonly investigation_question: string | null;
  readonly evidence_target: string | null;
  readonly investigation_method: string | null;
  readonly scope_relationship: string | null;
  readonly due_date_consideration: string | null;
  readonly dependency_local_keys: readonly string[];
  /** Derived without exposing the browser's owner_user_id. */
  readonly owner_selected: boolean;
}

export interface CapaInvestigationPlanningAdvisoryHumanDraft {
  readonly trust: "untrusted_human_draft";
  readonly content: Readonly<{
    readonly items:
      readonly CapaInvestigationPlanningAdvisoryHumanDraftItem[];
  }>;
}

export interface CapaInvestigationPlanningAdvisoryContextAssembly {
  readonly authoritative:
    AuthoritativeS30InvestigationPlanningContext;
  readonly untrusted_human_draft:
    CapaInvestigationPlanningAdvisoryHumanDraft | null;
}

export interface CapaInvestigationPlanningAdvisoryContextInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  /** Runtime input is untrusted even though callers may type it narrowly. */
  readonly untrusted_human_draft?: unknown;
}

export type CapaInvestigationPlanningAdvisoryAuthentication =
  AuthenticationContext;

export type CapaInvestigationPlanningAdvisoryTenant = TenantContext;

export type CapaInvestigationPlanningAdvisorySectionType = ControlledCode;

