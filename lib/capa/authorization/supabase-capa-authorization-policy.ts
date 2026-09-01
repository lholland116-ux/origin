import type postgres from "postgres";

import {
  CAPA_STATE,
  CANCELLABLE_STATES,
} from "../domain/capa-state";

import type {
  ControlledCode,
  IsoDateTime,
} from "../domain/capa-types";

import type {
  CapaAuthorizationPolicy,
  CapaPolicyDecision,
  CapaPolicyEvaluationRequest,
} from "./capa-policy";

import {
  evaluateCapaAuthorizationPreconditions,
  requiresHumanAuthority,
  type CapaAuthorizationOperation,
} from "./capa-permissions";

import {
  isHumanPrincipal,
} from "../../security/auth-context";

import {
  getActiveRoleAssignments,
  type RoleAssignmentId,
} from "../../security/tenant-context";

/**
 * Durable PostgreSQL-backed CAPA authorization policy.
 *
 * Controlled sources:
 * - LVT-CAPA-WFS-004, sections 4 and 13
 * - LVT CAPA Security, Privacy, and Access-Control Specification
 * - WFR-002, WFR-007 and WFR-013
 * - AUTH-001 through AUTH-010
 * - SEC-AC-001 through SEC-AC-003
 *
 * The policy independently rechecks authentication, tenant membership,
 * role-assignment activity, role status, permissions, workflow state,
 * purpose, policy version and pilot segregation of duties.
 *
 * An authorization context resolved earlier in a request is necessary,
 * but it is not independently sufficient to grant an operation.
 */

const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

const ORGANIZATION_SCOPE = "ORGANIZATION";

const CASE_OWNER_RELATIONSHIP =
  "CASE_OWNER";

const NOT_CASE_OWNER_RELATIONSHIP =
  "NOT_CASE_OWNER";

const OPERATION_PERMISSION = {
  create_case: "capa.case.create",
  view_case: "capa.case.view",
  edit_case: "capa.case.edit",
  submit_intake: "capa.case.submit",
  submit_for_review: "capa.case.submit",
  review_knowledge_citation:
    "capa.knowledge.citation.review",
  request_ai_intake_advisory:
    "capa.ai.intake.advise",
  request_ai_containment_risk_advisory:
    "capa.ai.intake.advise",
  review_ai_intake_advisory:
    "capa.ai.intake.review",
  approve_scope:
    "capa.review.disposition",
  accept_containment_risk:
    "capa.review.disposition",
  release_investigation:
    "capa.case.submit",
  approve_root_cause:
    "capa.gate.approve",
  approve_action_plan:
    "capa.gate.approve",
  accept_implementation:
    "capa.review.disposition",
  approve_effectiveness:
    "capa.gate.approve",
  close_case:
    "capa.gate.approve",
  cancel_case:
    "capa.gate.approve",
  reopen_case:
    "capa.gate.approve",
  approve_reentry:
    "capa.gate.approve",
  view_audit:
    "capa.audit.view",
  export_case:
    "capa.case.export",
} as const satisfies Record<
  CapaAuthorizationOperation,
  string
>;

const OPERATION_PURPOSE = {
  create_case:
    "CAPA_CASE_CREATION",
  view_case:
    "CAPA_CASE_ACCESS",
  edit_case:
    "CAPA_CASE_EDIT",
  submit_intake:
    "CAPA_WORKFLOW_TRANSITION",
  submit_for_review:
    "CAPA_WORKFLOW_TRANSITION",
  review_knowledge_citation:
    "CAPA_KNOWLEDGE_CITATION_REVIEW",
  request_ai_intake_advisory:
    "CAPA_AI_INTAKE_ADVISORY",
  request_ai_containment_risk_advisory:
    "CAPA_AI_CONTAINMENT_RISK_ADVISORY",
  review_ai_intake_advisory:
    "CAPA_AI_INTAKE_ADVISORY_REVIEW",
  approve_scope:
    "CAPA_GATE_DECISION",
  accept_containment_risk:
    "CAPA_GATE_DECISION",
  release_investigation:
    "CAPA_WORKFLOW_TRANSITION",
  approve_root_cause:
    "CAPA_GATE_DECISION",
  approve_action_plan:
    "CAPA_GATE_DECISION",
  accept_implementation:
    "CAPA_GATE_DECISION",
  approve_effectiveness:
    "CAPA_GATE_DECISION",
  close_case:
    "CAPA_GATE_DECISION",
  cancel_case:
    "CAPA_GATE_DECISION",
  reopen_case:
    "CAPA_GATE_DECISION",
  approve_reentry:
    "CAPA_GATE_DECISION",
  view_audit:
    "CAPA_AUDIT_ACCESS",
  export_case:
    "CAPA_CASE_EXPORT",
} as const satisfies Record<
  CapaAuthorizationOperation,
  string
>;

const ACTIVE_EDIT_STATES =
  new Set<string>([
    ...CANCELLABLE_STATES,
    CAPA_STATE.REOPENED_ASSESSMENT,
  ]);

const SUBMISSION_STATES =
  new Set<string>([
    CAPA_STATE.INVESTIGATION_ACTIVE,
    CAPA_STATE.ACTION_PLANNING,
    CAPA_STATE.IMPLEMENTATION_ACTIVE,
    CAPA_STATE.EFFECTIVENESS_MONITORING,
  ]);

const EXPORTABLE_STATES =
  new Set<string>([
    CAPA_STATE.CLOSURE_REVIEW,
    CAPA_STATE.CLOSED,
  ]);

const REQUIRED_WORKFLOW_STATES:
  Readonly<
    Partial<
      Record<
        CapaAuthorizationOperation,
        ReadonlySet<string>
      >
    >
  > = {
    edit_case:
      ACTIVE_EDIT_STATES,

    request_ai_intake_advisory:
      new Set([
        CAPA_STATE.TRIAGE_AND_SCOPE,
      ]),

    request_ai_containment_risk_advisory:
      new Set([
        CAPA_STATE.CONTAINMENT_AND_IMPACT_RISK,
      ]),

    review_ai_intake_advisory:
      new Set([
        CAPA_STATE.TRIAGE_AND_SCOPE,
      ]),

    submit_intake:
      new Set([
        CAPA_STATE.DRAFT_INTAKE,
      ]),

    submit_for_review:
      SUBMISSION_STATES,

    approve_scope:
      new Set([
        CAPA_STATE.TRIAGE_AND_SCOPE,
      ]),

    accept_containment_risk:
      new Set([
        CAPA_STATE
          .CONTAINMENT_AND_IMPACT_RISK,
      ]),

    release_investigation:
      new Set([
        CAPA_STATE.INVESTIGATION_PLANNING,
      ]),

    approve_root_cause:
      new Set([
        CAPA_STATE.ROOT_CAUSE_REVIEW,
      ]),

    approve_action_plan:
      new Set([
        CAPA_STATE.ACTION_PLAN_REVIEW,
      ]),

    accept_implementation:
      new Set([
        CAPA_STATE.IMPLEMENTATION_REVIEW,
      ]),

    approve_effectiveness:
      new Set([
        CAPA_STATE.EFFECTIVENESS_REVIEW,
      ]),

    close_case:
      new Set([
        CAPA_STATE.CLOSURE_REVIEW,
      ]),

    cancel_case:
      new Set(CANCELLABLE_STATES),

    reopen_case:
      new Set([
        CAPA_STATE.CLOSED,
      ]),

    approve_reentry:
      new Set([
        CAPA_STATE.REOPENED_ASSESSMENT,
      ]),

    export_case:
      EXPORTABLE_STATES,
  };

const APPROVER_LEVEL_OPERATIONS =
  new Set<CapaAuthorizationOperation>([
    "approve_root_cause",
    "approve_action_plan",
    "approve_effectiveness",
    "close_case",
    "cancel_case",
    "reopen_case",
    "approve_reentry",
  ]);

interface ActiveMembershipRow
  extends postgres.Row {
  readonly authorization_policy_version:
    string;
}

interface AuthorityRow
  extends postgres.Row {
  readonly role_assignment_id: string;
  readonly role_id: string;
  readonly permissions: string[];
  readonly human_authority: boolean;
}

export interface SupabaseCapaAuthorizationPolicyOptions {
  /**
   * Maximum permitted age of trusted reauthentication for operations
   * requiring step-up assurance.
   */
  readonly step_up_maximum_age_ms:
    number;

  /**
   * Assurance level communicated when step-up authentication is needed.
   */
  readonly required_step_up_assurance:
    ControlledCode;
}

export class SupabaseCapaAuthorizationConfigurationError
  extends Error {
  constructor(message: string) {
    super(message);
    this.name =
      "SupabaseCapaAuthorizationConfigurationError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function isControlledCode(
  value: string,
): boolean {
  return (
    value.length >= 1 &&
    value.length <= 64 &&
    CONTROLLED_CODE_PATTERN.test(value)
  );
}

function deny(
  request:
    CapaPolicyEvaluationRequest,
  evaluatedAt: IsoDateTime,
  reasonCode: string,
): CapaPolicyDecision {
  return {
    decision: "deny",
    reason_code:
      controlled(reasonCode),
    policy_version:
      request.tenant
        .authorization_policy_version,
    evaluated_at:
      evaluatedAt,
  };
}

function workflowStateIsAllowed(
  request:
    CapaPolicyEvaluationRequest,
): boolean {
  const allowedStates =
    REQUIRED_WORKFLOW_STATES[
      request.operation
    ];

  if (allowedStates === undefined) {
    return true;
  }

  const workflowState =
    request.resource.workflow_state;

  return (
    workflowState !== undefined &&
    allowedStates.has(workflowState)
  );
}

function requiresRelationshipEvaluation(
  operation:
    CapaAuthorizationOperation,
): boolean {
  return APPROVER_LEVEL_OPERATIONS.has(
    operation,
  );
}

function validateOptions(
  options:
    SupabaseCapaAuthorizationPolicyOptions,
): void {
  if (
    !Number.isFinite(
      options.step_up_maximum_age_ms,
    ) ||
    options.step_up_maximum_age_ms < 0
  ) {
    throw new SupabaseCapaAuthorizationConfigurationError(
      "step_up_maximum_age_ms must be a non-negative finite number.",
    );
  }

  if (
    !isControlledCode(
      options.required_step_up_assurance,
    )
  ) {
    throw new SupabaseCapaAuthorizationConfigurationError(
      "required_step_up_assurance must be a valid controlled code.",
    );
  }
}

export class SupabaseCapaAuthorizationPolicy
  implements CapaAuthorizationPolicy
{
  constructor(
    private readonly sql: postgres.Sql,
    private readonly options:
      SupabaseCapaAuthorizationPolicyOptions,
  ) {
    validateOptions(options);
  }

  async evaluate(
    request:
      CapaPolicyEvaluationRequest,
  ): Promise<CapaPolicyDecision> {
    if (
      !Number.isFinite(
        request.trusted_now.getTime(),
      )
    ) {
      throw new SupabaseCapaAuthorizationConfigurationError(
        "trusted_now must be a valid trusted server time.",
      );
    }

    const evaluatedAt =
      request.trusted_now
        .toISOString() as IsoDateTime;

    const precondition =
      evaluateCapaAuthorizationPreconditions({
        authentication:
          request.authentication,
        tenant:
          request.tenant,
        resource:
          request.resource,
        operation:
          request.operation,
        trusted_now:
          request.trusted_now,
        step_up_maximum_age_ms:
          this.options
            .step_up_maximum_age_ms,
      });

    if (
      precondition.status === "denied"
    ) {
      if (
        precondition.reason_code ===
        "STEP_UP_REAUTHENTICATION_REQUIRED"
      ) {
        return {
          decision: "step_up",
          reason_code:
            controlled(
              "STEP_UP_REAUTHENTICATION_REQUIRED",
            ),
          policy_version:
            request.tenant
              .authorization_policy_version,
          evaluated_at:
            evaluatedAt,
          required_assurance:
            this.options
              .required_step_up_assurance,
        };
      }

      return deny(
        request,
        evaluatedAt,
        precondition.reason_code,
      );
    }

    if (
      !isHumanPrincipal(
        request.authentication,
      )
    ) {
      return deny(
        request,
        evaluatedAt,
        "HUMAN_PRINCIPAL_REQUIRED",
      );
    }

    const expectedPurpose =
      OPERATION_PURPOSE[
        request.operation
      ];

    if (
      request.purpose !==
      expectedPurpose
    ) {
      return deny(
        request,
        evaluatedAt,
        "PURPOSE_NOT_AUTHORIZED",
      );
    }

    if (
      !workflowStateIsAllowed(request)
    ) {
      return deny(
        request,
        evaluatedAt,
        request.resource
          .workflow_state === undefined
          ? "WORKFLOW_STATE_REQUIRED"
          : "WORKFLOW_STATE_NOT_AUTHORIZED",
      );
    }

    if (
      requiresRelationshipEvaluation(
        request.operation,
      )
    ) {
      if (
        request.resource.relationship ===
        undefined
      ) {
        return deny(
          request,
          evaluatedAt,
          "RELATIONSHIP_REQUIRED",
        );
      }

      if (
        request.resource.relationship ===
        CASE_OWNER_RELATIONSHIP
      ) {
        return deny(
          request,
          evaluatedAt,
          "SEGREGATION_OF_DUTIES_DENIED",
        );
      }

      if (
        request.resource.relationship !==
        NOT_CASE_OWNER_RELATIONSHIP
      ) {
        return deny(
          request,
          evaluatedAt,
          "RELATIONSHIP_NOT_AUTHORIZED",
        );
      }
    }

    const userId =
      request.authentication
        .principal.user_id;

    const trustedNowIso =
      evaluatedAt;

    const membershipRows =
      await this.sql<
        ActiveMembershipRow[]
      >`
        select
          organization.authorization_policy_version
        from public.capa_organization_memberships
          as membership
        join public.capa_organizations
          as organization
          on organization.organization_id =
            membership.organization_id
        where membership.organization_id =
            ${request.tenant.organization_id}
          and membership.membership_id =
            ${request.tenant.access_grant_id}
          and membership.user_id =
            ${userId}
          and membership.status = 'active'
          and membership.effective_at <=
            ${trustedNowIso}
          and (
            membership.expires_at is null
            or membership.expires_at >
              ${trustedNowIso}
          )
          and organization.status = 'active'
          and organization.effective_at <=
            ${trustedNowIso}
          and (
            organization.superseded_at is null
            or organization.superseded_at >
              ${trustedNowIso}
          )
        limit 2
      `;

    if (membershipRows.length !== 1) {
      return deny(
        request,
        evaluatedAt,
        "ACTIVE_MEMBERSHIP_NOT_FOUND",
      );
    }

    const membership =
      membershipRows[0];

    if (
      membership === undefined ||
      typeof membership
        .authorization_policy_version !==
        "string"
    ) {
      return deny(
        request,
        evaluatedAt,
        "INVALID_AUTHORIZATION_DATA",
      );
    }

    if (
      membership
        .authorization_policy_version !==
      request.tenant
        .authorization_policy_version
    ) {
      return deny(
        request,
        evaluatedAt,
        "AUTHORIZATION_POLICY_VERSION_MISMATCH",
      );
    }

    const authorityRows =
      await this.sql<AuthorityRow[]>`
        select
          assignment.role_assignment_id,
          assignment.role_id,
          role.permissions,
          role.human_authority
        from public.capa_role_assignments
          as assignment
        join public.capa_roles as role
          on role.role_id =
            assignment.role_id
        where assignment.organization_id =
            ${request.tenant.organization_id}
          and assignment.membership_id =
            ${request.tenant.access_grant_id}
          and assignment.user_id =
            ${userId}
          and assignment.status = 'active'
          and assignment.scope_code =
            ${ORGANIZATION_SCOPE}
          and assignment.effective_at <=
            ${trustedNowIso}
          and (
            assignment.expires_at is null
            or assignment.expires_at >
              ${trustedNowIso}
          )
          and role.status = 'active'
        order by
          assignment.role_assignment_id
      `;

    const activeContextAssignments =
      getActiveRoleAssignments(
        request.tenant,
        request.trusted_now,
      );

    const requiredPermission =
      OPERATION_PERMISSION[
        request.operation
      ];

    const reliedOnAssignments:
      RoleAssignmentId[] = [];

    for (
      const contextAssignment
      of activeContextAssignments
    ) {
      const databaseAssignment =
        authorityRows.find(
          (row) =>
            row.role_assignment_id ===
              contextAssignment
                .role_assignment_id &&
            row.role_id ===
              contextAssignment.role_id,
        );

      if (
        databaseAssignment === undefined
      ) {
        continue;
      }

      if (
        !Array.isArray(
          databaseAssignment.permissions,
        ) ||
        databaseAssignment.permissions.some(
          (permission) =>
            typeof permission !== "string",
        ) ||
        typeof databaseAssignment
          .human_authority !== "boolean"
      ) {
        return deny(
          request,
          evaluatedAt,
          "INVALID_AUTHORIZATION_DATA",
        );
      }

      if (
        requiresHumanAuthority(
          request.operation,
        ) &&
        !databaseAssignment
          .human_authority
      ) {
        continue;
      }

      if (
        databaseAssignment.permissions.includes(
          requiredPermission,
        )
      ) {
        reliedOnAssignments.push(
          contextAssignment
            .role_assignment_id,
        );
      }
    }

    if (
      reliedOnAssignments.length === 0
    ) {
      return deny(
        request,
        evaluatedAt,
        "REQUIRED_PERMISSION_NOT_GRANTED",
      );
    }

    return {
      decision: "allow",
      reason_code:
        controlled(
          "AUTHORIZED_BY_ACTIVE_ROLE_ASSIGNMENT",
        ),
      policy_version:
        membership
          .authorization_policy_version,
      evaluated_at:
        evaluatedAt,
      relied_on_role_assignment_ids:
        Object.freeze(
          reliedOnAssignments,
        ),
    };
  }
}
