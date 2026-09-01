import type { AuthenticationContext } from "../../security/auth-context";
import type { TenantRoleAssignment } from "../../security/tenant-context";
import type { CapaContainmentRiskContent } from "../domain/capa-containment-risk";
import type { CapaCaseId, CapaCaseVersionId, OrganizationId, UserId } from "../domain/capa-types";

export interface AuthoritativeS20ContainmentRiskContext {
  readonly trust: "authoritative_server_context";
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state: "S20";
  readonly actor: UserId;
  readonly active_roles: readonly TenantRoleAssignment[];
  readonly intake_scope: Readonly<Record<string, unknown>>;
  readonly persisted_containment_risk: CapaContainmentRiskContent | null;
}

export interface CapaContainmentRiskAdvisoryContextAssembly {
  readonly authoritative: AuthoritativeS20ContainmentRiskContext;
  readonly untrusted_human_draft: import("./capa-containment-risk-advisory-contract").CapaContainmentRiskAdvisoryUntrustedHumanDraft | null;
}

export interface CapaContainmentRiskAdvisoryContextInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly untrusted_human_draft?: import("./capa-containment-risk-advisory-contract").CapaContainmentRiskAdvisoryUntrustedHumanDraft;
}

export type CapaContainmentRiskAdvisoryAuthentication = AuthenticationContext;
