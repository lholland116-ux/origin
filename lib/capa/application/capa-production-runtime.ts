import { randomUUID } from "node:crypto";

import type postgres from "postgres";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  ControlledCode,
} from "../domain/capa-types";

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
  createInitialCapaToolRegistry,
} from "../ai/capa-tool-registry";

import {
  createCapaToolGateway,
} from "../ai/capa-tool-gateway";

import {
  CapaCaseReadPayloadValidator,
  createInitialCapaToolAdapterRegistry,
} from "../ai/capa-case-read-tool";

import {
  RepositoryCapaToolAuditRecorder,
} from "../ai/capa-tool-audit-recorder";

import {
  SupabaseCapaAuthorizationPolicy,
} from "../authorization/supabase-capa-authorization-policy";

import {
  SupabaseCapaRepository,
} from "../../database/supabase/supabase-capa-repository";

import {
  SupabaseCapaKnowledgeRepository,
} from "../../database/supabase/supabase-capa-knowledge-repository";

import {
  SupabaseAuditRepository,
} from "../../database/supabase/supabase-audit-repository";

import {
  SupabaseCapaCaseNumberAllocator,
} from "../../database/supabase/supabase-capa-case-number-allocator";

import {
  SupabaseCapaCreationIdempotencyRepository,
} from "../../database/supabase/supabase-capa-creation-idempotency-repository";

import {
  SupabaseCapaWorkflowIdempotencyRepository,
} from "../../database/supabase/supabase-capa-workflow-idempotency-repository";

import {
  createSupabaseDatabaseSql,
  SupabaseTransactionManager,
} from "../../database/supabase/supabase-transactions";

import {
  SupabaseCapaDurableContextResolver,
} from "../../security/supabase-capa-durable-context";

import type {
  SupabaseCapaContextResolver,
} from "../../security/supabase-capa-context";

/**
 * Production CAPA runtime assembly.
 *
 * Primary sources:
 * Document #8 — LVT CAPA Data Model and Audit-Trail Specification
 * Document #9 — LVT CAPA Security, Privacy, and Access-Control
 * Specification
 *
 * Traceability:
 * DM-COM-001 through DM-COM-009
 * AUD-001 through AUD-011
 * AUTH-001 through AUTH-010
 * TEN-001 through TEN-010
 * SEC-AC-001 through SEC-AC-003
 *
 * This runtime binds the provider-neutral CAPA application layer to the
 * durable PostgreSQL persistence, tenant-resolution and authorization
 * implementations.
 *
 * It must be instantiated only in trusted server code. PostgreSQL
 * credentials and privileged adapters must never cross the browser
 * boundary.
 */

const DEFAULT_WORKFLOW_VERSION =
  "workflow-1.0.0";

const DEFAULT_INTAKE_SCHEMA_VERSION =
  "intake-schema-1.0.0";

const DEFAULT_AUDIT_SCHEMA_VERSION =
  "audit-schema-1.0.0";

const DEFAULT_STEP_UP_MAXIMUM_AGE_MS =
  10 * 60 * 1_000;

const VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

export interface CapaProductionRuntime
  extends CapaRuntime {
  /**
   * Durable resolver used by the API boundary after server-side
   * Supabase authentication succeeds.
   */
  readonly resolve_context:
    SupabaseCapaContextResolver;
}

export interface CapaProductionRuntimeOptions {
  /**
   * Optional injected PostgreSQL client.
   *
   * Production callers normally omit this value so CAPA_DATABASE_URL is
   * used. Tests inject a controlled SQL harness.
   */
  readonly sql?: postgres.Sql;

  /**
   * Trusted server clock.
   */
  readonly now?: () => Date;

  /**
   * Cryptographically secure UUID generator.
   */
  readonly generate_uuid?: () => string;

  readonly workflow_version?: string;
  readonly intake_schema_version?: string;
  readonly audit_schema_version?: string;

  readonly step_up_maximum_age_ms?:
    number;

  readonly required_step_up_assurance?:
    string;
}

export class CapaProductionRuntimeConfigurationError
  extends Error {
  constructor(message: string) {
    super(message);

    this.name =
      "CapaProductionRuntimeConfigurationError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function requireVersion(
  value: string,
  fieldName: string,
): string {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 100 ||
    !VERSION_PATTERN.test(value)
  ) {
    throw new CapaProductionRuntimeConfigurationError(
      `${fieldName} must be a valid controlled version identifier.`,
    );
  }

  return value;
}

function requireControlledCode(
  value: string,
  fieldName: string,
): ControlledCode {
  if (
    value.trim() !== value ||
    value.length < 1 ||
    value.length > 64 ||
    !CONTROLLED_CODE_PATTERN.test(value)
  ) {
    throw new CapaProductionRuntimeConfigurationError(
      `${fieldName} must be a valid controlled code.`,
    );
  }

  return controlled(value);
}

function requireStepUpMaximumAge(
  value: number,
): number {
  if (
    !Number.isFinite(value) ||
    value < 0
  ) {
    throw new CapaProductionRuntimeConfigurationError(
      "step_up_maximum_age_ms must be a non-negative finite number.",
    );
  }

  return value;
}

function createIdGenerator(
  generateUuid: () => string,
): CreateCapaIdGenerator {
  return {
    generateCapaCaseId() {
      return generateUuid() as CapaCaseId;
    },

    generateCaseVersionId() {
      return generateUuid() as CapaCaseVersionId;
    },

    generateSectionVersionId() {
      return generateUuid() as CapaSectionVersionId;
    },

    generateAuditEventId() {
      return generateUuid() as AuditEventId;
    },
  };
}

/**
 * Creates one durable CAPA runtime.
 *
 * All durable adapters share the same PostgreSQL client. Material writes
 * are bound to transaction contexts issued by SupabaseTransactionManager,
 * ensuring that case-number allocation, aggregate creation and audit
 * append either commit or roll back together.
 */
export function createCapaProductionRuntime(
  options:
    CapaProductionRuntimeOptions = {},
): CapaProductionRuntime {
  const workflowVersion =
    requireVersion(
      options.workflow_version ??
        DEFAULT_WORKFLOW_VERSION,
      "workflow_version",
    );

  const intakeSchemaVersion =
    requireVersion(
      options.intake_schema_version ??
        DEFAULT_INTAKE_SCHEMA_VERSION,
      "intake_schema_version",
    );

  const auditSchemaVersion =
    requireVersion(
      options.audit_schema_version ??
        DEFAULT_AUDIT_SCHEMA_VERSION,
      "audit_schema_version",
    );

  const stepUpMaximumAge =
    requireStepUpMaximumAge(
      options.step_up_maximum_age_ms ??
        DEFAULT_STEP_UP_MAXIMUM_AGE_MS,
    );

  const requiredStepUpAssurance =
    requireControlledCode(
      options.required_step_up_assurance ??
        "MFA",
      "required_step_up_assurance",
    );

  const now =
    options.now ??
    (() => new Date());

  const generateUuid =
    options.generate_uuid ??
    randomUUID;

  const sql =
    options.sql ??
    createSupabaseDatabaseSql();

  const transactionManager =
    new SupabaseTransactionManager(
      sql,
    );

  const capaRepository =
    new SupabaseCapaRepository(
      sql,
    );

  const auditRepository =
    new SupabaseAuditRepository(
      sql,
    );

  const creationIdempotencyRepository =
    new SupabaseCapaCreationIdempotencyRepository();

  const workflowIdempotencyRepository =
    new SupabaseCapaWorkflowIdempotencyRepository();

  const caseNumberAllocator =
    new SupabaseCapaCaseNumberAllocator();

  const authorizationPolicy =
    new SupabaseCapaAuthorizationPolicy(
      sql,
      {
        step_up_maximum_age_ms:
          stepUpMaximumAge,

        required_step_up_assurance:
          requiredStepUpAssurance,
      },
    );

  const contextResolver =
    new SupabaseCapaDurableContextResolver(
      sql,
    );

  const dependencies:
    CreateCapaDependencies = {
    transaction_manager:
      transactionManager,

    capa_repository:
      capaRepository,

    audit_repository:
      auditRepository,

    creation_idempotency_repository:
      creationIdempotencyRepository,

    case_number_allocator:
      caseNumberAllocator,

    authorization_policy:
      authorizationPolicy,

    id_generator:
      createIdGenerator(
        generateUuid,
      ),

    clock: {
      now,
    },

    configuration: {
      workflow_version:
        workflowVersion,

      intake_schema_version:
        intakeSchemaVersion,

      audit_schema_version:
        auditSchemaVersion,

      intake_section_type:
        controlled("CAPA.INTAKE"),

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
      transactionManager,
    capa_repository:
      capaRepository,
    audit_repository:
      auditRepository,
    workflow_idempotency_repository:
      workflowIdempotencyRepository,
    authorization_policy:
      authorizationPolicy,
    id_generator:
      dependencies.id_generator,
    clock:
      dependencies.clock,
    configuration: {
      workflow_version:
        workflowVersion,
      audit_schema_version:
        auditSchemaVersion,
      authorization_purpose:
        controlled(
          "CAPA_WORKFLOW_TRANSITION",
        ),
    },
  };

  const knowledgeRepository =
    new SupabaseCapaKnowledgeRepository(
      sql,
    );

  const agentActivationService =
    createCapaAgentActivationService();
  const toolRegistry =
    createInitialCapaToolRegistry();
  const toolGateway = createCapaToolGateway({
    tool_registry: toolRegistry,
    agent_activation_service:
      agentActivationService,
    adapter_registry:
      createInitialCapaToolAdapterRegistry(
        capaRepository,
      ),
    payload_validator:
      new CapaCaseReadPayloadValidator(),
    audit_recorder:
      new RepositoryCapaToolAuditRecorder({
        transaction_manager:
          transactionManager,
        audit_repository: auditRepository,
        generate_audit_event_id:
          dependencies.id_generator
            .generateAuditEventId,
        now,
        audit_schema_version:
          auditSchemaVersion,
      }),
  });

  return {
    database:
      capaRepository,

    knowledge_repository:
      knowledgeRepository,

    dependencies,

    submit_intake_dependencies:
      submitIntakeDependencies,

    prompt_assembly_service:
      createCapaPromptAssemblyService(),

    agent_activation_service:
      agentActivationService,

    tool_gateway: toolGateway,

    resolve_context:
      contextResolver.resolve,
  };
}

type ProductionRuntimeGlobal =
  typeof globalThis & {
    __lvt_capa_production_runtime__?:
      CapaProductionRuntime;
  };

/**
 * Returns the process-shared durable CAPA runtime.
 *
 * A process-level singleton prevents a new PostgreSQL connection pool
 * from being created during every request or ordinary Next.js module
 * reload. Serverless platforms may still create one runtime per warm
 * execution environment.
 */
export function getCapaProductionRuntime():
  CapaProductionRuntime {
  const productionGlobal =
    globalThis as ProductionRuntimeGlobal;

  if (
    productionGlobal
      .__lvt_capa_production_runtime__ ===
    undefined
  ) {
    productionGlobal
      .__lvt_capa_production_runtime__ =
      createCapaProductionRuntime();
  }

  return productionGlobal
    .__lvt_capa_production_runtime__;
}