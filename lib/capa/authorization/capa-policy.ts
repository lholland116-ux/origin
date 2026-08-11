import type {
  CapaCaseId,
  CapaCaseStatus,
  CapaCaseVersionId,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
} from "../domain/capa-types";

import type {
  AuthenticationContext,
} from "../../security/auth-context";

import type {
  RoleAssignmentId,
  TenantContext,
} from "../../security/tenant-context";

import type {
  CapaAuthorizationOperation,
} from "./capa-permissions";

/**
 * Provider-neutral final authorization-policy contract.
 *
 * Primary sources:
 * Document #4 — LVT CAPA Workflow and State Specification
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * WFR-002
 * AUTH-001 through AUTH-010
 * SEC-AC-001 through SEC-AC-003
 * Appendix A — Authorization Decision Record
 *
 * Customer role templates and segregation-of-duties rules remain
 * configurable under DEC-004 and SEC-TBD-003.
 */

export interface CapaAuthorizationResource {
  readonly organization_id: OrganizationId;
  readonly resource_type: ControlledCode;
  readonly resource_id?: string;
  readonly resource_version_id?: string;

  readonly capa_case_id?: CapaCaseId;
  readonly case_version_id?: CapaCaseVersionId;
  readonly workflow_state?: CapaCaseStatus;

  readonly relationship?: ControlledCode;
  readonly sensitivity?: ControlledCode;
}

export interface CapaPolicyEvaluationRequest {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly operation: CapaAuthorizationOperation;
  readonly resource: CapaAuthorizationResource;
  readonly purpose: ControlledCode;
  readonly trusted_now: Date;
}

export type CapaPolicyDecision =
  | {
      readonly decision: "allow";
      readonly reason_code: ControlledCode;
      readonly policy_version: string;
      readonly evaluated_at: IsoDateTime;
      readonly relied_on_role_assignment_ids:
        readonly RoleAssignmentId[];
    }
  | {
      readonly decision: "deny";
      readonly reason_code: ControlledCode;
      readonly policy_version: string;
      readonly evaluated_at: IsoDateTime;
    }
  | {
      readonly decision: "step_up";
      readonly reason_code: ControlledCode;
      readonly policy_version: string;
      readonly evaluated_at: IsoDateTime;
      readonly required_assurance: ControlledCode;
    };

/**
 * Final configured authorization-policy evaluator.
 *
 * Implementations must evaluate role, permission, assignment, object
 * relationship, workflow state, version, purpose, segregation of duties
 * and applicable assurance requirements.
 *
 * The implementation cannot override a failed mandatory precondition.
 */
export interface CapaAuthorizationPolicy {
  evaluate(
    request: CapaPolicyEvaluationRequest,
  ): Promise<CapaPolicyDecision>;
}