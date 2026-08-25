import {
  hasRecentReauthentication,
  isHumanPrincipal,
  isSessionActive,
  type AuthenticationContext,
} from "../../../lib/security/auth-context";

import {
  evaluateTenantBoundary,
  type TenantContext,
  type TenantOwnedResource,
} from "../../../lib/security/tenant-context";

/**
 * Mandatory CAPA authorization preconditions.
 *
 * Primary sources:
 * Document #4 — LVT CAPA Workflow and State Specification
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * WFR-002
 * WFR-007
 * WFR-013
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 * SEC-AC-001 through SEC-AC-003
 *
 * Important:
 * Passing these checks is never a final authorization grant. Customer
 * role permissions, assignment, object relationship, workflow state,
 * version, purpose, segregation of duties and policy version must still
 * be evaluated by the configured authorization policy.
 */

export type CapaAuthorizationOperation =
  | "create_case"
  | "view_case"
  | "edit_case"
  | "submit_intake"
  | "submit_for_review"
  | "review_knowledge_citation"
  | "request_ai_intake_advisory"
  | "approve_scope"
  | "accept_containment_risk"
  | "approve_root_cause"
  | "approve_action_plan"
  | "accept_implementation"
  | "approve_effectiveness"
  | "close_case"
  | "cancel_case"
  | "reopen_case"
  | "approve_reentry"
  | "view_audit"
  | "export_case";

/**
 * Operations that can only be performed by an authorized human.
 *
 * A service, integration, administrator privilege alone, background job,
 * or AI agent cannot perform these decisions.
 */
export const HUMAN_ONLY_CAPA_OPERATIONS =
  new Set<CapaAuthorizationOperation>([
    "submit_intake",
    "review_knowledge_citation",
    "request_ai_intake_advisory",
    "approve_scope",
    "accept_containment_risk",
    "approve_root_cause",
    "approve_action_plan",
    "accept_implementation",
    "approve_effectiveness",
    "close_case",
    "cancel_case",
    "reopen_case",
    "approve_reentry",
  ]);

/**
 * Operations requiring recent reauthentication or equivalent approved
 * step-up assurance.
 *
 * Exact maximum-age values remain configuration decisions under
 * SEC-TBD-002.
 */
export const STEP_UP_CAPA_OPERATIONS =
  new Set<CapaAuthorizationOperation>([
    "approve_scope",
    "accept_containment_risk",
    "approve_root_cause",
    "approve_action_plan",
    "accept_implementation",
    "approve_effectiveness",
    "close_case",
    "cancel_case",
    "reopen_case",
    "approve_reentry",
    "export_case",
  ]);

export interface CapaAuthorizationPreconditionRequest {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly resource: TenantOwnedResource;
  readonly operation: CapaAuthorizationOperation;

  /**
   * Trusted server time. Client-provided time must never be used.
   */
  readonly trusted_now: Date;

  /**
   * Configured step-up window. Required only for operations in
   * STEP_UP_CAPA_OPERATIONS.
   */
  readonly step_up_maximum_age_ms?: number;
}

export type CapaAuthorizationPreconditionReason =
  | "SESSION_INACTIVE"
  | "TENANT_SCOPE_DENIED"
  | "AUTHORIZED_HUMAN_REQUIRED"
  | "STEP_UP_CONFIGURATION_MISSING"
  | "STEP_UP_REAUTHENTICATION_REQUIRED"
  | "MANDATORY_PRECONDITIONS_SATISFIED";

export type CapaAuthorizationPreconditionResult =
  | {
      readonly status: "denied";
      readonly reason_code:
        Exclude<
          CapaAuthorizationPreconditionReason,
          "MANDATORY_PRECONDITIONS_SATISFIED"
        >;
      readonly authorization_policy_version: string;
    }
  | {
      /**
       * This is not an authorization grant.
       *
       * The configured policy engine must still evaluate role,
       * permission, assignment, relationship, state, version, purpose,
       * segregation of duties and any additional controls.
       */
      readonly status: "requires_policy_evaluation";
      readonly reason_code:
        "MANDATORY_PRECONDITIONS_SATISFIED";
      readonly authorization_policy_version: string;
    };

export function requiresHumanAuthority(
  operation: CapaAuthorizationOperation,
): boolean {
  return HUMAN_ONLY_CAPA_OPERATIONS.has(operation);
}

export function requiresStepUpAuthentication(
  operation: CapaAuthorizationOperation,
): boolean {
  return STEP_UP_CAPA_OPERATIONS.has(operation);
}

/**
 * Evaluates mandatory fail-closed preconditions before the configured
 * authorization policy is consulted.
 *
 * Evaluation order intentionally avoids disclosing resource existence:
 * session, tenant boundary, human authority and step-up assurance.
 */
export function evaluateCapaAuthorizationPreconditions(
  request: CapaAuthorizationPreconditionRequest,
): CapaAuthorizationPreconditionResult {
  const authorizationPolicyVersion =
    request.tenant.authorization_policy_version;

  if (
    !isSessionActive(
      request.authentication,
      request.trusted_now,
    )
  ) {
    return {
      status: "denied",
      reason_code: "SESSION_INACTIVE",
      authorization_policy_version:
        authorizationPolicyVersion,
    };
  }

  const tenantDecision = evaluateTenantBoundary(
    request.tenant,
    request.resource,
  );

  if (!tenantDecision.allowed) {
    return {
      status: "denied",
      reason_code: "TENANT_SCOPE_DENIED",
      authorization_policy_version:
        authorizationPolicyVersion,
    };
  }

  if (
    requiresHumanAuthority(request.operation) &&
    !isHumanPrincipal(request.authentication)
  ) {
    return {
      status: "denied",
      reason_code: "AUTHORIZED_HUMAN_REQUIRED",
      authorization_policy_version:
        authorizationPolicyVersion,
    };
  }

  if (requiresStepUpAuthentication(request.operation)) {
    const maximumAgeMs =
      request.step_up_maximum_age_ms;

    if (
      maximumAgeMs === undefined ||
      !Number.isFinite(maximumAgeMs) ||
      maximumAgeMs < 0
    ) {
      return {
        status: "denied",
        reason_code: "STEP_UP_CONFIGURATION_MISSING",
        authorization_policy_version:
          authorizationPolicyVersion,
      };
    }

    if (
      !hasRecentReauthentication(
        request.authentication,
        request.trusted_now,
        maximumAgeMs,
      )
    ) {
      return {
        status: "denied",
        reason_code:
          "STEP_UP_REAUTHENTICATION_REQUIRED",
        authorization_policy_version:
          authorizationPolicyVersion,
      };
    }
  }

  return {
    status: "requires_policy_evaluation",
    reason_code:
      "MANDATORY_PRECONDITIONS_SATISFIED",
    authorization_policy_version:
      authorizationPolicyVersion,
  };
}