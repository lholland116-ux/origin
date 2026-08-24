import {
  randomUUID,
} from "node:crypto";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  ControlledCode,
  RoleId,
} from "../domain/capa-types";

import type {
  CapaAuthorizationPolicy,
  CapaPolicyDecision,
  CapaPolicyEvaluationRequest,
} from "../authorization/capa-policy";

import type {
  CreateCapaDependencies,
  CreateCapaIdGenerator,
} from "./create-capa";

import type {
  SubmitCapaIntakeDependencies,
} from "./submit-capa-intake";

import type {
  CapaRuntime,
} from "./capa-runtime";

import {
  createCapaPromptAssemblyService,
} from "../ai/capa-prompt-service";

import {
  createCapaAgentActivationService,
} from "../ai/capa-agent-activation-service";

import {
  getActiveRoleAssignments,
} from "../../security/tenant-context";

import {
  InMemoryCapaDatabase,
} from "../../database/in-memory/in-memory-capa-database";

import type {
  TransactionId,
} from "../../database/transactions";

/**
 * Development-only CAPA runtime.
 *
 * This module assembles the temporary in-memory persistence adapter,
 * development authorization policy, trusted server clock, identifier
 * generators and controlled configuration used by the browser workflow.
 *
 * It is not approved for production CAPA data storage or authorization.
 */

const DEVELOPMENT_POLICY_VERSION =
  "development-policy-1.0.0";

const DEVELOPMENT_ROLE_ID =
  "CAPA_DEVELOPMENT_USER" as RoleId;

/**
 * Development implementation of the provider-neutral CAPA runtime.
 *
 * The concrete database remains exposed to development and test code that
 * verifies in-memory persistence and transaction behavior.
 */
export interface CapaDevelopmentRuntime
  extends CapaRuntime {
  readonly database:
    InMemoryCapaDatabase;
}

export interface CapaDevelopmentRuntimeOptions {
  readonly environment?: string;
  readonly now?: () => Date;
  readonly generate_uuid?: () => string;
}

export class CapaDevelopmentRuntimeDisabledError
  extends Error {
  constructor() {
    super(
      "The in-memory CAPA development runtime is disabled in production.",
    );

    this.name =
      "CapaDevelopmentRuntimeDisabledError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function assertDevelopmentRuntimeAllowed(
  environment:
    string | undefined,
): void {
  if (environment === "production") {
    throw new CapaDevelopmentRuntimeDisabledError();
  }
}

function developmentAuthorizationPolicy():
  CapaAuthorizationPolicy {
  return {
    async evaluate(
      request:
        CapaPolicyEvaluationRequest,
    ): Promise<CapaPolicyDecision> {
      const activeAssignments =
        getActiveRoleAssignments(
          request.tenant,
          request.trusted_now,
        );

      const developmentAssignment =
        activeAssignments.find(
          (assignment) =>
            assignment.role_id ===
              DEVELOPMENT_ROLE_ID &&
            assignment.scope ===
              "ORGANIZATION",
        );

      const tenantIsDevelopmentScoped =
        request.tenant.access_path ===
        "DEVELOPMENT_SINGLE_USER_TENANT";

      const organizationMatches =
        request.resource.organization_id ===
        request.tenant.organization_id;

      const operationIsSupported =
        request.operation ===
          "create_case" ||
        request.operation ===
          "view_case" ||
        request.operation ===
          "submit_intake";

      if (
        !tenantIsDevelopmentScoped ||
        !organizationMatches ||
        !operationIsSupported ||
        developmentAssignment === undefined
      ) {
        return {
          decision: "deny",
          reason_code:
            controlled(
              "DEVELOPMENT_POLICY_DENIED",
            ),
          policy_version:
            DEVELOPMENT_POLICY_VERSION,
          evaluated_at:
            request.trusted_now
              .toISOString() as
                CapaPolicyDecision[
                  "evaluated_at"
                ],
        };
      }

      return {
        decision: "allow",
        reason_code:
          controlled(
            request.operation ===
              "create_case"
              ? "DEVELOPMENT_CREATE_ALLOWED"
              : request.operation ===
                  "view_case"
                ? "DEVELOPMENT_VIEW_ALLOWED"
                : "DEVELOPMENT_SUBMIT_INTAKE_ALLOWED",
          ),
        policy_version:
          DEVELOPMENT_POLICY_VERSION,
        evaluated_at:
          request.trusted_now
            .toISOString() as
              CapaPolicyDecision[
                "evaluated_at"
              ],
        relied_on_role_assignment_ids: [
          developmentAssignment
            .role_assignment_id,
        ],
      };
    },
  };
}

function createIdGenerator(
  generateUuid: () => string,
): CreateCapaIdGenerator {
  return {
    generateCapaCaseId() {
      return generateUuid() as
        CapaCaseId;
    },

    generateCaseVersionId() {
      return generateUuid() as
        CapaCaseVersionId;
    },

    generateSectionVersionId() {
      return generateUuid() as
        CapaSectionVersionId;
    },

    generateAuditEventId() {
      return generateUuid() as
        AuditEventId;
    },
  };
}

/**
 * Creates an isolated development runtime.
 *
 * Tests should use this factory so their state does not leak between
 * cases. The API route uses getCapaDevelopmentRuntime() to share one
 * in-memory database for the current development-server process.
 */
export function createCapaDevelopmentRuntime(
  options:
    CapaDevelopmentRuntimeOptions = {},
): CapaDevelopmentRuntime {
  assertDevelopmentRuntimeAllowed(
    options.environment ??
      process.env.NODE_ENV,
  );

  const now =
    options.now ??
    (() => new Date());

  const generateUuid =
    options.generate_uuid ??
    randomUUID;

  const database =
    new InMemoryCapaDatabase({
      generate_transaction_id() {
        return generateUuid() as
          TransactionId;
      },

      now,
    });

  const dependencies:
    CreateCapaDependencies = {
    transaction_manager:
      database,
    capa_repository:
      database,
    audit_repository:
      database,

    /*
     * The database owns the development counter so allocation participates
     * in the same snapshot, commit and rollback boundary as CAPA creation.
     */
    creation_idempotency_repository:
      database,

    case_number_allocator:
      database,

    authorization_policy:
      developmentAuthorizationPolicy(),

    id_generator:
      createIdGenerator(
        generateUuid,
      ),

    clock: {
      now,
    },

    configuration: {
      workflow_version:
        "workflow-development-1.0.0",
      intake_schema_version:
        "intake-schema-1.0.0",
      audit_schema_version:
        "audit-schema-1.0.0",
      intake_section_type:
        controlled(
          "CAPA.INTAKE",
        ),
      default_confidentiality:
        controlled(
          "CUSTOMER_CONFIDENTIAL",
        ),
      authorization_purpose:
        controlled(
          "CAPA_CASE_CREATION",
        ),
    },
  };

  const submitIntakeDependencies:
    SubmitCapaIntakeDependencies = {
    transaction_manager:
      database,
    capa_repository:
      database,
    audit_repository:
      database,
    workflow_idempotency_repository:
      database,
    authorization_policy:
      dependencies.authorization_policy,
    id_generator:
      dependencies.id_generator,
    clock:
      dependencies.clock,
    configuration: {
      workflow_version:
        dependencies.configuration
          .workflow_version,
      audit_schema_version:
        dependencies.configuration
          .audit_schema_version,
      authorization_purpose:
        controlled(
          "CAPA_WORKFLOW_TRANSITION",
        ),
    },
  };

  return {
    database,
    dependencies,
    submit_intake_dependencies:
      submitIntakeDependencies,
    prompt_assembly_service:
      createCapaPromptAssemblyService(),

    agent_activation_service:
      createCapaAgentActivationService(),
  };
}

type DevelopmentRuntimeGlobal =
  typeof globalThis & {
    __lvt_capa_development_runtime__?:
      CapaDevelopmentRuntime;
  };

/**
 * Returns the process-shared development runtime.
 *
 * Storing the runtime on globalThis preserves in-memory records across
 * ordinary Next.js development module reloads. Data still disappears when
 * the server process restarts.
 */
export function getCapaDevelopmentRuntime():
  CapaDevelopmentRuntime {
  assertDevelopmentRuntimeAllowed(
    process.env.NODE_ENV,
  );

  const developmentGlobal =
    globalThis as
      DevelopmentRuntimeGlobal;

  if (
    developmentGlobal
      .__lvt_capa_development_runtime__ ===
    undefined
  ) {
    developmentGlobal
      .__lvt_capa_development_runtime__ =
      createCapaDevelopmentRuntime({
        environment:
          process.env.NODE_ENV,
      });
  }

  return developmentGlobal
    .__lvt_capa_development_runtime__;
}