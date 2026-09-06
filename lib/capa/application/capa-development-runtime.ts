import type {
  ApproveCapaScopeDependencies,
} from "./approve-capa-scope";

import type {
  AcceptCapaContainmentRiskDependencies,
} from "./accept-capa-containment-risk";

import type {
  ReleaseCapaInvestigationDependencies,
} from "./release-capa-investigation";

import type {
  SubmitCapaRootCausePackageDependencies,
} from "./submit-capa-root-cause-package";

import type {
  UpdateCapaInvestigationProgressDependencies,
} from "./update-capa-investigation-progress";

import type {
  DecideCapaRootCauseGateDependencies,
} from "./decide-capa-root-cause-gate";

import {
  randomUUID,
} from "node:crypto";
import {
  isAbsolute,
  resolve,
} from "node:path";

import OpenAI from "openai";

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
  createRequestScopedCapaIntakeAdvisoryService,
} from "./capa-intake-advisory-runtime-factory";

import {
  createRequestScopedCapaContainmentRiskAdvisoryService,
} from "./capa-containment-risk-advisory-runtime-factory";

import {
  createRequestScopedCapaInvestigationPlanningAdvisoryService,
} from "./capa-investigation-planning-advisory-runtime-factory";

import {
  createRequestScopedCapaInvestigationPlanningAdoptionService,
} from "./capa-investigation-planning-adoption-runtime-factory";
import {
  createRequestScopedCapaInvestigationActiveAdvisoryService,
} from "./capa-investigation-active-advisory-runtime-factory";
import {
  createRequestScopedCapaRootCauseReviewAdvisoryService,
} from "./capa-root-cause-review-advisory-runtime-factory";
import {
  createRequestScopedCapaInvestigationActiveAdoptionService,
} from "./capa-investigation-active-adoption-runtime-factory";
import { RepositoryCapaInvestigationActiveAdoptionSourceResolver } from "./capa-investigation-active-adoption-source-resolver";
import type {
  CapaInvestigationActiveAdvisoryStructuredModelClient,
} from "../ai/capa-investigation-active-advisory-model-profile";
import { createOpenAICapaInvestigationActiveAdvisoryStructuredModelClient } from "../ai/openai-capa-investigation-active-advisory-structured-model-client";
import type { CapaRootCauseReviewAdvisoryStructuredModelClient } from "../ai/capa-root-cause-review-advisory-model-generator";
import { createOpenAICapaRootCauseReviewAdvisoryStructuredModelClient } from "../ai/openai-capa-root-cause-review-advisory-structured-model-client";

import type {
  CapaIntakeAdvisoryStructuredModelClient,
} from "../ai/capa-intake-advisory-model-generator";

import type {
  CapaContainmentRiskAdvisoryStructuredModelClient,
} from "../ai/capa-containment-risk-advisory-model-generator";

import type {
  CapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "../ai/capa-investigation-planning-advisory-model-profile";

import {
  createOpenAICapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "../ai/openai-capa-investigation-planning-advisory-structured-model-client";

import type {
  CapaIntakeAdvisoryRetrievalConfiguration,
} from "../ai/capa-intake-advisory-retrieval-request-factory";

import {
  createOpenAICapaIntakeAdvisoryStructuredModelClient,
} from "../ai/openai-capa-intake-advisory-structured-model-client";

import {
  createOpenAICapaContainmentRiskAdvisoryStructuredModelClient,
} from "../ai/openai-capa-containment-risk-advisory-structured-model-client";

import {
  CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_VERSION,
} from "../knowledge/capa-knowledge-query-construction";

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
  getActiveRoleAssignments,
} from "../../security/tenant-context";

import {
  InMemoryCapaDatabase,
} from "../../database/in-memory/in-memory-capa-database";

import {
  InMemoryCapaKnowledgeDatabase,
} from "../../database/in-memory/in-memory-capa-knowledge-database";

import {
  InMemoryCapaKnowledgeRetrievalRepository,
} from "../../database/in-memory/in-memory-capa-knowledge-retrieval-repository";

import {
  InMemoryCapaKnowledgeCitationReviewRepository,
} from "../../database/in-memory/in-memory-capa-knowledge-citation-review-repository";

import {
  createCapaKnowledgeRetrievalService,
} from "../knowledge/capa-knowledge-retrieval-service";

import {
  createCapaKnowledgeCitationReviewService,
  type CapaKnowledgeCitationReviewSourceStatusResolver,
} from "../knowledge/capa-knowledge-citation-review-service";

import {
  PolicyBackedCapaKnowledgeCitationReviewAuthorizer,
} from "../authorization/capa-knowledge-citation-review-authorizer";

import {
  createRepositoryBackedCapaKnowledgeCandidateMaterialResolver,
} from "../knowledge/capa-knowledge-candidate-material-resolver";

import type {
  TransactionId,
} from "../../database/transactions";
import { InMemoryCapaParticipantEligibilityRepository } from "../../database/in-memory/in-memory-capa-participant-eligibility-repository";
import {
  CapaDevelopmentFileStateStore,
} from "../../database/development/capa-development-file-state-store";
import type {
  CapaDevelopmentStateSnapshot,
} from "../../database/development/capa-development-state-snapshot";
import {
  createCapaInvestigationActiveWorkspaceDraftService,
} from "./capa-investigation-active-workspace-draft-service";
import { createReconcileCapaInvestigationActiveWorkspaceAdoptionsService } from "./reconcile-capa-investigation-active-workspace-adoptions";

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
  "CAPA_OWNER" as RoleId;

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

export interface CapaDevelopmentIntakeAdvisoryConfiguration {
  readonly retrieval_configuration:
    CapaIntakeAdvisoryRetrievalConfiguration;

  readonly structured_model_client:
    CapaIntakeAdvisoryStructuredModelClient;
}

export interface CapaDevelopmentContainmentRiskAdvisoryConfiguration {
  readonly structured_model_client:
    CapaContainmentRiskAdvisoryStructuredModelClient;
}

export interface CapaDevelopmentInvestigationPlanningAdvisoryConfiguration {
  readonly structured_model_client:
    CapaInvestigationPlanningAdvisoryStructuredModelClient;
}

export interface CapaDevelopmentInvestigationActiveAdvisoryConfiguration {
  readonly structured_model_client: CapaInvestigationActiveAdvisoryStructuredModelClient;
}

export interface CapaDevelopmentRootCauseReviewAdvisoryConfiguration {
  readonly structured_model_client: CapaRootCauseReviewAdvisoryStructuredModelClient;
}

export interface CapaDevelopmentPersistenceConfiguration {
  readonly state_store: CapaDevelopmentFileStateStore;
  readonly initial_snapshot?: CapaDevelopmentStateSnapshot;
}

export interface CapaDevelopmentRuntimeOptions {
  readonly environment?: string;
  readonly now?: () => Date;
  readonly generate_uuid?: () => string;

  /** Explicit opt-in; ordinary factory calls remain process-local only. */
  readonly persistence?: CapaDevelopmentPersistenceConfiguration;

  readonly intake_advisory?:
    CapaDevelopmentIntakeAdvisoryConfiguration;

  readonly containment_risk_advisory?:
    CapaDevelopmentContainmentRiskAdvisoryConfiguration;

  readonly investigation_planning_advisory?:
    CapaDevelopmentInvestigationPlanningAdvisoryConfiguration;
  readonly investigation_active_advisory?:
    CapaDevelopmentInvestigationActiveAdvisoryConfiguration;
  readonly root_cause_review_advisory?:
    CapaDevelopmentRootCauseReviewAdvisoryConfiguration;
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

export class CapaDevelopmentRuntimeAdvisoryConfigurationError
  extends Error {
  constructor() {
    super(
      "The CAPA intake advisory development runtime is not configured.",
    );

    this.name =
      "CapaDevelopmentRuntimeAdvisoryConfigurationError";
  }
}

export class CapaDevelopmentRuntimePersistenceConfigurationError extends Error {
  constructor(message = "The CAPA development file-persistence configuration is invalid.") {
    super(message);
    this.name = "CapaDevelopmentRuntimePersistenceConfigurationError";
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

export function resolveCapaDevelopmentPersistencePath(
  configuredPath: string | undefined,
): string {
  if (configuredPath !== undefined && isAbsolute(configuredPath)) {
    return configuredPath;
  }

  return resolve(
    /* turbopackIgnore: true */ process.cwd(),
    configuredPath ?? ".local/capa-development-state.json",
  );
}

function developmentPersistenceConfigurationFromEnvironment(
  environment: string | undefined,
): CapaDevelopmentPersistenceConfiguration | undefined {
  const enabled = process.env.CAPA_DEVELOPMENT_PERSISTENCE_ENABLED;
  if (enabled === undefined || enabled.length === 0 || enabled === "false") return undefined;
  if (environment === "production") {
    throw new CapaDevelopmentRuntimeDisabledError();
  }
  if (enabled !== "true") {
    throw new CapaDevelopmentRuntimePersistenceConfigurationError(
      "CAPA_DEVELOPMENT_PERSISTENCE_ENABLED must be true or false.",
    );
  }
  const configuredPath = process.env.CAPA_DEVELOPMENT_PERSISTENCE_PATH;
  if (configuredPath !== undefined &&
    (configuredPath.length === 0 || configuredPath.trim() !== configuredPath)) {
    throw new CapaDevelopmentRuntimePersistenceConfigurationError(
      "CAPA_DEVELOPMENT_PERSISTENCE_PATH must be a non-empty path.",
    );
  }
  const statePath = resolveCapaDevelopmentPersistencePath(configuredPath);
  const stateStore = new CapaDevelopmentFileStateStore({ state_path: statePath });
  return { state_store: stateStore, initial_snapshot: stateStore.loadSync() ?? undefined };
}

function developmentAllowReasonCode(
  operation:
    CapaPolicyEvaluationRequest["operation"],
): ControlledCode {
  switch (operation) {
    case "create_case":
      return controlled(
        "DEVELOPMENT_CREATE_ALLOWED",
      );

    case "view_case":
      return controlled(
        "DEVELOPMENT_VIEW_ALLOWED",
      );

    case "submit_intake":
      return controlled(
        "DEVELOPMENT_SUBMIT_INTAKE_ALLOWED",
      );

    case "approve_scope":
      return controlled(
        "DEVELOPMENT_APPROVE_SCOPE_ALLOWED",
      );

    case "accept_containment_risk":
      return controlled(
        "DEVELOPMENT_ACCEPT_CONTAINMENT_RISK_ALLOWED",
      );

    case "release_investigation":
      return controlled(
        "DEVELOPMENT_RELEASE_INVESTIGATION_ALLOWED",
      );

    case "edit_case":
      return controlled(
        "DEVELOPMENT_EDIT_CASE_ALLOWED",
      );

    case "submit_for_review":
      return controlled(
        "DEVELOPMENT_SUBMIT_FOR_REVIEW_ALLOWED",
      );

    case "review_knowledge_citation":
      return controlled(
        "DEVELOPMENT_KNOWLEDGE_CITATION_REVIEW_ALLOWED",
      );

    case "request_ai_intake_advisory":
      return controlled(
        "DEVELOPMENT_AI_INTAKE_ADVISORY_ALLOWED",
      );

    case "request_ai_containment_risk_advisory":
      return controlled(
        "DEVELOPMENT_AI_CONTAINMENT_RISK_ADVISORY_ALLOWED",
      );

    case "request_ai_investigation_planning_advisory":
      return controlled(
        "DEVELOPMENT_AI_INVESTIGATION_PLANNING_ADVISORY_ALLOWED",
      );

    case "request_ai_investigation_active_advisory":
      return controlled(
        "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_ADVISORY_ALLOWED",
      );

    case "request_ai_root_cause_review_advisory":
      return controlled(
        "DEVELOPMENT_AI_ROOT_CAUSE_REVIEW_ADVISORY_ALLOWED",
      );

    case "adopt_ai_investigation_planning_proposal":
      return controlled(
        "DEVELOPMENT_AI_INVESTIGATION_PLANNING_ADOPTION_ALLOWED",
      );

    case "adopt_ai_investigation_active_proposal":
      return controlled(
        "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_ADOPTION_ALLOWED",
      );

    case "read_investigation_active_workspace_draft":
      return controlled(
        "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_WORKSPACE_READ_ALLOWED",
      );

    case "edit_investigation_active_workspace_draft":
      return controlled(
        "DEVELOPMENT_AI_INVESTIGATION_ACTIVE_WORKSPACE_EDIT_ALLOWED",
      );

    default:
      return controlled(
        "DEVELOPMENT_POLICY_DENIED",
      );
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
          "submit_intake" ||
        request.operation ===
          "approve_scope" ||
        request.operation ===
          "accept_containment_risk" ||
        request.operation ===
          "release_investigation" ||
        request.operation ===
          "edit_case" ||
        request.operation ===
          "submit_for_review" ||
        request.operation ===
          "review_knowledge_citation" ||
        request.operation ===
          "request_ai_intake_advisory" ||
        request.operation ===
          "request_ai_containment_risk_advisory" ||
        request.operation ===
          "request_ai_investigation_planning_advisory" ||
        request.operation ===
          "request_ai_investigation_active_advisory" ||
        request.operation ===
          "request_ai_root_cause_review_advisory" ||
        request.operation ===
          "adopt_ai_investigation_planning_proposal" ||
        request.operation ===
          "adopt_ai_investigation_active_proposal" ||
        request.operation ===
          "read_investigation_active_workspace_draft" ||
        request.operation ===
          "edit_investigation_active_workspace_draft";

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
          developmentAllowReasonCode(
            request.operation,
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

function developmentIntakeAdvisoryConfigurationFromEnvironment():
  CapaDevelopmentIntakeAdvisoryConfiguration | undefined {
  const enabled =
    process.env.CAPA_INTAKE_ADVISORY_DEVELOPMENT_ENABLED;

  if (
    enabled === undefined ||
    enabled.trim().length === 0 ||
    enabled === "false"
  ) {
    return undefined;
  }

  if (enabled !== "true") {
    throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  }

  const values = {
    model:
      process.env.CAPA_INTAKE_ADVISORY_MODEL,

    collection_id:
      process.env.CAPA_INTAKE_ADVISORY_COLLECTION_ID,

    collection_version_id:
      process.env
        .CAPA_INTAKE_ADVISORY_COLLECTION_VERSION_ID,

    retrieval_policy_version:
      process.env
        .CAPA_INTAKE_ADVISORY_RETRIEVAL_POLICY_VERSION,

    source_precedence_policy_version:
      process.env
        .CAPA_INTAKE_ADVISORY_SOURCE_PRECEDENCE_POLICY_VERSION,

    ranking_policy_version:
      process.env
        .CAPA_INTAKE_ADVISORY_RANKING_POLICY_VERSION,

    citation_policy_version:
      process.env
        .CAPA_INTAKE_ADVISORY_CITATION_POLICY_VERSION,

    openai_api_key:
      process.env.OPENAI_API_KEY,
  };

  if (
    Object.values(values).some(
      (value) =>
        typeof value !== "string" ||
        value.trim().length === 0,
    )
  ) {
    throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  }

  const openaiClient =
    new OpenAI({
      apiKey:
        values.openai_api_key!,
    });

  const structuredModelClient =
    createOpenAICapaIntakeAdvisoryStructuredModelClient(
      openaiClient,
      {
        model:
          values.model!,
      },
    );

  return {
    retrieval_configuration: {
      collection_id:
        values.collection_id! as
          CapaIntakeAdvisoryRetrievalConfiguration[
            "collection_id"
          ],

      collection_version_id:
        values.collection_version_id! as
          CapaIntakeAdvisoryRetrievalConfiguration[
            "collection_version_id"
          ],

      retrieval_policy_version:
        values.retrieval_policy_version!,

      source_precedence_policy_version:
        values.source_precedence_policy_version!,

      query_construction_version:
        CAPA_KNOWLEDGE_QUERY_CONSTRUCTION_VERSION,

      ranking_policy_version:
        values.ranking_policy_version!,

      citation_policy_version:
        values.citation_policy_version!,
    },

    structured_model_client:
      structuredModelClient,
  };
}

function developmentContainmentRiskAdvisoryConfigurationFromEnvironment():
  CapaDevelopmentContainmentRiskAdvisoryConfiguration | undefined {
  const enabled =
    process.env.CAPA_CONTAINMENT_RISK_ADVISORY_DEVELOPMENT_ENABLED;

  if (
    enabled === undefined ||
    enabled.trim().length === 0 ||
    enabled === "false"
  ) {
    return undefined;
  }

  if (enabled !== "true") {
    throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  }

  const model =
    process.env.CAPA_CONTAINMENT_RISK_ADVISORY_MODEL;
  const apiKey =
    process.env.OPENAI_API_KEY;

  if (
    typeof model !== "string" ||
    model.trim().length === 0 ||
    typeof apiKey !== "string" ||
    apiKey.trim().length === 0
  ) {
    throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  }

  const openaiClient =
    new OpenAI({ apiKey });

  return {
    structured_model_client:
      createOpenAICapaContainmentRiskAdvisoryStructuredModelClient(
        openaiClient,
        { model },
      ),
  };
}

function developmentInvestigationPlanningAdvisoryConfigurationFromEnvironment():
  CapaDevelopmentInvestigationPlanningAdvisoryConfiguration | undefined {
  const enabled =
    process.env.CAPA_INVESTIGATION_PLANNING_ADVISORY_DEVELOPMENT_ENABLED;

  if (
    enabled === undefined ||
    enabled.trim().length === 0 ||
    enabled === "false"
  ) {
    return undefined;
  }

  if (enabled !== "true") {
    throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  }

  const model =
    process.env.CAPA_INVESTIGATION_PLANNING_ADVISORY_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;

  if (
    typeof model !== "string" ||
    model.trim().length === 0 ||
    typeof apiKey !== "string" ||
    apiKey.trim().length === 0
  ) {
    throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  }

  const openaiClient = new OpenAI({ apiKey });

  return {
    structured_model_client:
      createOpenAICapaInvestigationPlanningAdvisoryStructuredModelClient(
        openaiClient,
        { model },
      ),
  };
}

function developmentInvestigationActiveAdvisoryConfigurationFromEnvironment(): CapaDevelopmentInvestigationActiveAdvisoryConfiguration | undefined {
  const enabled = process.env.CAPA_INVESTIGATION_ACTIVE_ADVISORY_DEVELOPMENT_ENABLED;
  if (enabled === undefined || enabled.trim().length === 0 || enabled === "false") return undefined;
  if (enabled !== "true") throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  const model = process.env.CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (typeof model !== "string" || model.trim().length === 0 || typeof apiKey !== "string" || apiKey.trim().length === 0) throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  return { structured_model_client: createOpenAICapaInvestigationActiveAdvisoryStructuredModelClient(new OpenAI({ apiKey }), { model }) };
}

function developmentRootCauseReviewAdvisoryConfigurationFromEnvironment(): CapaDevelopmentRootCauseReviewAdvisoryConfiguration | undefined {
  const enabled = process.env.CAPA_ROOT_CAUSE_REVIEW_ADVISORY_DEVELOPMENT_ENABLED;
  if (enabled === undefined || enabled.trim().length === 0 || enabled === "false") return undefined;
  if (enabled !== "true") throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  const model = process.env.CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL;
  const apiKey = process.env.OPENAI_API_KEY;
  if (typeof model !== "string" || model.trim().length === 0 || typeof apiKey !== "string" || apiKey.trim().length === 0) throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
  return { structured_model_client: createOpenAICapaRootCauseReviewAdvisoryStructuredModelClient(new OpenAI({ apiKey }), { model }) };
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

  const intakeAdvisoryConfiguration =
    options.intake_advisory;

  const containmentRiskAdvisoryConfiguration =
    options.containment_risk_advisory;

  const investigationPlanningAdvisoryConfiguration =
    options.investigation_planning_advisory;
  const investigationActiveAdvisoryConfiguration =
    options.investigation_active_advisory;
  const rootCauseReviewAdvisoryConfiguration =
    options.root_cause_review_advisory;

  const database =
    new InMemoryCapaDatabase({
      generate_transaction_id() {
        return generateUuid() as
          TransactionId;
      },

      now,

      initial_snapshot: options.persistence?.initial_snapshot ??
        options.persistence?.state_store.loadSync() ?? undefined,

      before_commit: options.persistence === undefined
        ? undefined
        : (snapshot) => options.persistence!.state_store.save(snapshot),
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

  const approveScopeDependencies:
    ApproveCapaScopeDependencies = {
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

      step_up_maximum_age_ms:
        15 * 60 * 1000,

      required_step_up_assurance:
        controlled(
          "MFA",
        ),

      approval_rationale_required:
        true,
    },
  };

  const acceptContainmentRiskDependencies:
    AcceptCapaContainmentRiskDependencies = {
    ...approveScopeDependencies,
  };

  const releaseInvestigationDependencies:
    ReleaseCapaInvestigationDependencies = {
    ...submitIntakeDependencies,
    adoption_repository: database,
    participant_eligibility_repository:
      new InMemoryCapaParticipantEligibilityRepository(),
  };

  const submitRootCauseDependencies:
    SubmitCapaRootCausePackageDependencies = {
    ...submitIntakeDependencies,
    adoption_repository: database,
  };

  const decideRootCauseGateDependencies:
    DecideCapaRootCauseGateDependencies = {
    ...approveScopeDependencies,
    configuration: {
      workflow_version: dependencies.configuration.workflow_version,
      audit_schema_version: dependencies.configuration.audit_schema_version,
      step_up_maximum_age_ms: 15 * 60 * 1000,
      required_step_up_assurance: controlled("MFA"),
      authorization_purpose: controlled("CAPA_GATE_DECISION"),
    },
  };

  const updateInvestigationProgressDependencies:
    UpdateCapaInvestigationProgressDependencies = {
    ...submitIntakeDependencies,
    configuration: {
      ...submitIntakeDependencies.configuration,
      authorization_purpose: controlled("CAPA_CASE_EDIT"),
    },
  };

  const knowledgeRepository =
    new InMemoryCapaKnowledgeDatabase({
      generate_transaction_id: () =>
        randomUUID() as TransactionId,
      now,
    });

  const citationReviewRepository =
    new InMemoryCapaKnowledgeCitationReviewRepository();

  const citationReviewSourceStatusResolver:
    CapaKnowledgeCitationReviewSourceStatusResolver = {
    async resolveSourceStatus(input) {
      const organizationVersion =
        await knowledgeRepository.findSourceVersionById({
          scope: {
            visibility: "organization",
            organization_id: input.organization_id,
          },
          source_id: input.source_id,
          source_version_id: input.source_version_id,
        });
      if (organizationVersion !== null) return organizationVersion.status;
      const globalVersion =
        await knowledgeRepository.findSourceVersionById({
          scope: { visibility: "approved_global" },
          source_id: input.source_id,
          source_version_id: input.source_version_id,
        });
      return globalVersion?.status ?? null;
    },
  };

  const knowledgeRetrievalIndexRepository =
    new InMemoryCapaKnowledgeRetrievalRepository();

  const knowledgeRetrievalService =
    createCapaKnowledgeRetrievalService({
      index_repository:
        knowledgeRetrievalIndexRepository,
      material_resolver:
        createRepositoryBackedCapaKnowledgeCandidateMaterialResolver(
          knowledgeRepository,
        ),
      now,
    });

  const promptAssemblyService =
    createCapaPromptAssemblyService();

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
        database,
      ),
    payload_validator:
      new CapaCaseReadPayloadValidator(),
    audit_recorder:
      new RepositoryCapaToolAuditRecorder({
        transaction_manager: database,
        audit_repository: database,
        generate_audit_event_id:
          dependencies.id_generator
            .generateAuditEventId,
        now,
        audit_schema_version:
          dependencies.configuration
            .audit_schema_version,
      }),
  });

  return {
    database,
    participant_eligibility_repository:
      releaseInvestigationDependencies.participant_eligibility_repository,
    knowledge_repository:
      knowledgeRepository,
    knowledge_retrieval_service:
      knowledgeRetrievalService,
    create_knowledge_citation_review_service(context) {
      return createCapaKnowledgeCitationReviewService({
        repository: citationReviewRepository,
        transaction_manager: database,
        authorizer:
          new PolicyBackedCapaKnowledgeCitationReviewAuthorizer({
            authentication: context.authentication,
            tenant: context.tenant,
            policy: dependencies.authorization_policy,
            now,
          }),
        source_status_resolver: citationReviewSourceStatusResolver,
        now,
      });
    },

    create_intake_advisory_service(context) {
      if (
        intakeAdvisoryConfiguration ===
          undefined
      ) {
        throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
      }

      return createRequestScopedCapaIntakeAdvisoryService({
        request_context:
          context,

        capa_repository:
          database,

        transaction_manager:
          database,

        output_repository:
          database,

        authorization_policy:
          dependencies.authorization_policy,

        agent_activation_service:
          agentActivationService,

        knowledge_retrieval_service:
          knowledgeRetrievalService,

        prompt_assembly_service:
          promptAssemblyService,

        structured_model_client:
          intakeAdvisoryConfiguration
            .structured_model_client,

        retrieval_configuration:
          intakeAdvisoryConfiguration
            .retrieval_configuration,

        intake_section_type:
          dependencies.configuration
            .intake_section_type,

        now,

        generate_uuid:
          generateUuid,
      });
    },

    create_containment_risk_advisory_service(context) {
      if (
        containmentRiskAdvisoryConfiguration ===
          undefined
      ) {
        throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
      }

      return createRequestScopedCapaContainmentRiskAdvisoryService(
        context,
        {
          capa_repository: database,
          authorization_policy:
            dependencies.authorization_policy,
          agent_activation_service:
            agentActivationService,
          structured_model_client:
            containmentRiskAdvisoryConfiguration
              .structured_model_client,
          output_repository: database,
          transaction_manager: database,
          intake_section_type:
            dependencies.configuration
              .intake_section_type,
          now,
          generate_uuid: generateUuid,
        },
      );
    },

    create_investigation_planning_advisory_service(context) {
      if (
        investigationPlanningAdvisoryConfiguration ===
          undefined
      ) {
        throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
      }

      return createRequestScopedCapaInvestigationPlanningAdvisoryService({
        request_context: context,
        capa_repository: database,
        authorization_policy: dependencies.authorization_policy,
        agent_activation_service: agentActivationService,
        structured_model_client:
          investigationPlanningAdvisoryConfiguration
            .structured_model_client,
        output_repository: database,
        transaction_manager: database,
        intake_section_type:
          dependencies.configuration.intake_section_type,
        intake_schema_version:
          dependencies.configuration.intake_schema_version,
        now,
        generate_uuid: generateUuid,
      });
    },

    create_investigation_planning_adoption_service(context) {
      return createRequestScopedCapaInvestigationPlanningAdoptionService({
        request_context: context,
        transaction_manager: database,
        adoption_repository: database,
        audit_repository: database,
        authorization_policy: dependencies.authorization_policy,
        now,
        generate_uuid: generateUuid,
        audit_schema_version: dependencies.configuration.audit_schema_version,
      });
    },

    create_investigation_active_advisory_service(context) {
      if (investigationActiveAdvisoryConfiguration === undefined) throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
      return createRequestScopedCapaInvestigationActiveAdvisoryService({ request_context: context, capa_repository: database, authorization_policy: dependencies.authorization_policy, agent_activation_service: agentActivationService, structured_model_client: investigationActiveAdvisoryConfiguration.structured_model_client, output_repository: database, transaction_manager: database, now, generate_uuid: generateUuid });
    },

    create_root_cause_review_advisory_service(context) {
      if (rootCauseReviewAdvisoryConfiguration === undefined) throw new CapaDevelopmentRuntimeAdvisoryConfigurationError();
      return createRequestScopedCapaRootCauseReviewAdvisoryService({ request_context: context, capa_repository: database, authorization_policy: dependencies.authorization_policy, agent_activation_service: agentActivationService, structured_model_client: rootCauseReviewAdvisoryConfiguration.structured_model_client, output_repository: database, transaction_manager: database, now, generate_uuid: generateUuid });
    },

    create_investigation_active_adoption_service(context) {
      return createRequestScopedCapaInvestigationActiveAdoptionService({ request_context: context, transaction_manager: database, adoption_repository: database, audit_repository: database, source_resolver: new RepositoryCapaInvestigationActiveAdoptionSourceResolver(database), workspace_repository: database, authorization_policy: dependencies.authorization_policy, now, generate_uuid: generateUuid, audit_schema_version: dependencies.configuration.audit_schema_version });
    },

    create_investigation_active_workspace_draft_service(context) {
      return createCapaInvestigationActiveWorkspaceDraftService({
        request_context: context,
        capa_repository: database,
        workspace_repository: database,
        transaction_manager: database,
        authorization_policy: dependencies.authorization_policy,
        now,
      });
    },

    create_investigation_active_workspace_reconciliation_service(context) {
      return createReconcileCapaInvestigationActiveWorkspaceAdoptionsService({ request_context: context, capa_repository: database, adoption_repository: database, workspace_repository: database, transaction_manager: database, authorization_policy: dependencies.authorization_policy, now });
    },

    dependencies,
    submit_intake_dependencies:
      submitIntakeDependencies,

    approve_scope_dependencies:
      approveScopeDependencies,

    accept_containment_risk_dependencies:
      acceptContainmentRiskDependencies,

    release_investigation_dependencies:
      releaseInvestigationDependencies,

    update_investigation_progress_dependencies:
      updateInvestigationProgressDependencies,

    submit_root_cause_dependencies:
      submitRootCauseDependencies,

    decide_root_cause_gate_dependencies:
      decideRootCauseGateDependencies,
    prompt_assembly_service:
      promptAssemblyService,

    agent_activation_service:
      agentActivationService,

    tool_gateway: toolGateway,
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
    const persistence =
      developmentPersistenceConfigurationFromEnvironment(
        process.env.NODE_ENV,
      );
    developmentGlobal
      .__lvt_capa_development_runtime__ =
      createCapaDevelopmentRuntime({
        environment:
          process.env.NODE_ENV,

        intake_advisory:
          developmentIntakeAdvisoryConfigurationFromEnvironment(),

        containment_risk_advisory:
          developmentContainmentRiskAdvisoryConfigurationFromEnvironment(),
        investigation_planning_advisory:
          developmentInvestigationPlanningAdvisoryConfigurationFromEnvironment(),
        investigation_active_advisory:
          developmentInvestigationActiveAdvisoryConfigurationFromEnvironment(),
        root_cause_review_advisory:
          developmentRootCauseReviewAdvisoryConfigurationFromEnvironment(),

        persistence,
      });
  }

  return developmentGlobal
    .__lvt_capa_development_runtime__;
}
