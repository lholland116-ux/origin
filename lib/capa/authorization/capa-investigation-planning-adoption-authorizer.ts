import type {
  AuthenticationContext,
} from "../../security/auth-context";
import type {
  TenantContext,
} from "../../security/tenant-context";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  UserId,
} from "../domain/capa-types";
import {
  CAPA_STATE,
} from "../domain/capa-state";
import {
  evaluateCapaAuthorizationPreconditions,
} from "./capa-permissions";
import type {
  CapaAuthorizationPolicy,
} from "./capa-policy";

export const CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION =
  "adopt_ai_investigation_planning_proposal" as const;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface CapaInvestigationPlanningAdoptionAuthorizationInput {
  readonly organization_id: string;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly output_id: string;
  readonly adopter: {
    readonly actor_type: "human";
    readonly actor_id: UserId;
  };
  readonly trusted_now: Date;
}

export interface CapaInvestigationPlanningAdoptionAuthorizer {
  authorize(
    input: CapaInvestigationPlanningAdoptionAuthorizationInput,
  ): Promise<boolean>;
}

export interface CapaInvestigationPlanningAdoptionAuthorizerDependencies {
  readonly authentication: AuthenticationContext;
  readonly tenant: TenantContext;
  readonly policy: CapaAuthorizationPolicy;
}

function validUuid(value: unknown): boolean {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function controlled(value: string): ControlledCode {
  return value as ControlledCode;
}

export class PolicyBackedCapaInvestigationPlanningAdoptionAuthorizer
  implements CapaInvestigationPlanningAdoptionAuthorizer {
  constructor(
    private readonly dependencies:
      CapaInvestigationPlanningAdoptionAuthorizerDependencies,
  ) {}

  async authorize(
    input: CapaInvestigationPlanningAdoptionAuthorizationInput,
  ): Promise<boolean> {
    const principal = this.dependencies.authentication?.principal;
    if (
      input === null ||
      typeof input !== "object" ||
      input.adopter === null ||
      typeof input.adopter !== "object" ||
      !validUuid(input.organization_id) ||
      !validUuid(input.capa_case_id) ||
      !validUuid(input.case_version_id) ||
      !validUuid(input.output_id) ||
      !Number.isSafeInteger(input.record_version) ||
      input.record_version < 1 ||
      input.adopter.actor_type !== "human" ||
      !validUuid(input.adopter.actor_id) ||
      !(input.trusted_now instanceof Date) ||
      !Number.isFinite(input.trusted_now.getTime()) ||
      principal === undefined ||
      principal.principal_type !== "human" ||
      principal.user_id !== input.adopter.actor_id ||
      this.dependencies.tenant.organization_id !== input.organization_id
    ) {
      return false;
    }

    const preconditions = evaluateCapaAuthorizationPreconditions({
      authentication: this.dependencies.authentication,
      tenant: this.dependencies.tenant,
      resource: { organization_id: input.organization_id as never },
      operation: CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION,
      trusted_now: input.trusted_now,
    });
    if (preconditions.status === "denied") return false;

    try {
      const decision = await this.dependencies.policy.evaluate({
        authentication: this.dependencies.authentication,
        tenant: this.dependencies.tenant,
        operation: CAPA_INVESTIGATION_PLANNING_ADOPTION_OPERATION,
        resource: {
          organization_id: input.organization_id as never,
          resource_type: controlled("CAPA_CASE"),
          resource_id: input.capa_case_id,
          resource_version_id: input.case_version_id,
          capa_case_id: input.capa_case_id,
          case_version_id: input.case_version_id,
          workflow_state: CAPA_STATE.INVESTIGATION_PLANNING,
        },
        purpose: controlled("CAPA_AI_INVESTIGATION_PLANNING_ADOPTION"),
        trusted_now: input.trusted_now,
      });
      return decision.decision === "allow";
    } catch {
      return false;
    }
  }
}
