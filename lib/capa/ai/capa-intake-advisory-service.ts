import type {
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  OrganizationId,
  RequestId,
  RoleId,
  UserId,
} from "../domain/capa-types";

import type {
  CapaStateId,
} from "../domain/capa-state";

import type {
  CapaMinimumCaseContextItem,
} from "./capa-prompt-contract";

import type {
  CapaIntakeAdvisoryCitation,
  CapaIntakeAdvisoryRequest,
  CapaIntakeAdvisoryResponse,
} from "./capa-intake-advisory-contract";

import type {
  TransactionContext,
  TransactionManager,
} from "../../database/transactions";

/**
 * Provider-neutral orchestration for governed CAPA intake assistance.
 *
 * The route supplies only trusted identity and trace values plus an already
 * validated browser request. Every authority-bearing case fact is resolved
 * again by server dependencies. The service never transitions workflow.
 *
 * Traceability:
 * URS-AI-001 through URS-AI-012
 * PAE-001 through PAE-008
 * KSEC-001 through KSEC-004
 * CF-AUTHORITY, CF-TENANT, CF-FAIL
 */

export const CAPA_INTAKE_ADVISORY_OPERATION =
  "draft_intake_analysis" as const;

export const CAPA_INTAKE_ADVISORY_AGENT =
  Object.freeze({
    agent_id: "AG-INTAKE" as const,
    agent_version:
      "ag-intake-1.0.0" as const,
    output_schema_version:
      "capa-intake-draft-output-1.0.0" as const,
    requested_tool_ids: Object.freeze([
      "TOOL-CASE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
    ] as const),
  });

export const CAPA_INTAKE_ADVISORY_SERVICE_REASON_CODES = [
  "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  "CASE_NOT_IN_SUBMITTED_INTAKE",
  "ADVISORY_ACCESS_DENIED",
  "AGENT_NOT_ELIGIBLE",
  "EVIDENCE_RETRIEVAL_FAILED",
  "ADVISORY_GENERATION_FAILED",
  "INVALID_ADVISORY_RESULT",
  "ADVISORY_PERSISTENCE_FAILED",
  "WORKFLOW_MUTATION_DETECTED",
] as const;

export type CapaIntakeAdvisoryServiceReasonCode =
  (typeof CAPA_INTAKE_ADVISORY_SERVICE_REASON_CODES)[number];

export class CapaIntakeAdvisoryServiceError
  extends Error {
  readonly reason_code:
    CapaIntakeAdvisoryServiceReasonCode;

  constructor(
    reasonCode:
      CapaIntakeAdvisoryServiceReasonCode,
  ) {
    super(
      "The governed CAPA intake advisory operation failed.",
    );
    this.name =
      "CapaIntakeAdvisoryServiceError";
    this.reason_code = reasonCode;
  }
}

export interface CapaIntakeAdvisoryInvocation {
  readonly organization_id:
    OrganizationId;
  readonly capa_case_id:
    CapaCaseId;
  readonly user_id: UserId;
  readonly request_id: RequestId;
  readonly correlation_id:
    CorrelationId;
  readonly request:
    CapaIntakeAdvisoryRequest;
}

export interface CapaIntakeAdvisoryCaseContext {
  readonly organization_id:
    OrganizationId;
  readonly capa_case_id:
    CapaCaseId;
  readonly case_version_id:
    CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state:
    CapaStateId;
  readonly user_id: UserId;
  readonly active_role_ids:
    readonly RoleId[];
  readonly minimum_case_context:
    readonly CapaMinimumCaseContextItem[];
}

export interface CapaIntakeAdvisorySnapshot {
  readonly capa_case_id:
    CapaCaseId;

  readonly case_version_id:
    CapaCaseVersionId;

  readonly record_version:
    number;
}

export interface CapaIntakeAdvisoryServiceResult {
  readonly advisory:
    CapaIntakeAdvisoryResponse;

  readonly snapshot:
    CapaIntakeAdvisorySnapshot;
}

export interface CapaIntakeAdvisoryEvidence {
  readonly prompt_context:
    readonly unknown[];
  readonly citations:
    readonly CapaIntakeAdvisoryCitation[];
  readonly warnings: readonly string[];
}

export interface CapaIntakeAdvisoryGenerationInput {
  readonly context:
    CapaIntakeAdvisoryCaseContext;
  readonly request:
    CapaIntakeAdvisoryRequest;
  readonly evidence:
    CapaIntakeAdvisoryEvidence;
  readonly request_id: RequestId;
  readonly correlation_id:
    CorrelationId;
  readonly agent:
    typeof CAPA_INTAKE_ADVISORY_AGENT;
}

export interface CapaIntakeAdvisoryContextResolver {
  resolve(
    invocation:
      CapaIntakeAdvisoryInvocation,
  ): Promise<
    CapaIntakeAdvisoryCaseContext | null
  >;
}

export interface CapaIntakeAdvisoryAuthorizer {
  authorize(input: {
    readonly context:
      CapaIntakeAdvisoryCaseContext;
    readonly operation:
      typeof CAPA_INTAKE_ADVISORY_OPERATION;
  }): Promise<boolean>;
}

export interface CapaIntakeAdvisoryAgentGate {
  evaluate(input: {
    readonly context:
      CapaIntakeAdvisoryCaseContext;
    readonly agent:
      typeof CAPA_INTAKE_ADVISORY_AGENT;
    readonly operation:
      typeof CAPA_INTAKE_ADVISORY_OPERATION;
  }): boolean;
}

export interface CapaIntakeAdvisoryEvidenceProvider {
  retrieve(input: {
    readonly context:
      CapaIntakeAdvisoryCaseContext;
    readonly request:
      CapaIntakeAdvisoryRequest;
    readonly request_id: RequestId;
    readonly correlation_id:
      CorrelationId;
  }): Promise<CapaIntakeAdvisoryEvidence>;
}

export interface CapaIntakeAdvisoryGenerator {
  generate(
    input:
      CapaIntakeAdvisoryGenerationInput,
  ): Promise<CapaIntakeAdvisoryResponse>;
}

export type CapaIntakeAdvisoryOutputSaveResult =
  | "saved"
  | "case_changed";

export interface CapaIntakeAdvisoryOutputRepository {
  save(
    transaction: TransactionContext,
    input: {
      readonly context:
        CapaIntakeAdvisoryCaseContext;
      readonly response:
        CapaIntakeAdvisoryResponse;
      readonly request_id: RequestId;
      readonly correlation_id:
        CorrelationId;
    },
  ): Promise<CapaIntakeAdvisoryOutputSaveResult>;
}

export interface CapaIntakeAdvisoryIntegrityGuard {
  assertCaseUnchanged(
    context:
      CapaIntakeAdvisoryCaseContext,
  ): Promise<boolean>;
}

export interface CapaIntakeAdvisoryServiceDependencies {
  readonly context_resolver:
    CapaIntakeAdvisoryContextResolver;
  readonly authorizer:
    CapaIntakeAdvisoryAuthorizer;
  readonly agent_gate:
    CapaIntakeAdvisoryAgentGate;
  readonly evidence_provider:
    CapaIntakeAdvisoryEvidenceProvider;
  readonly generator:
    CapaIntakeAdvisoryGenerator;
  readonly output_repository:
    CapaIntakeAdvisoryOutputRepository;
  readonly transaction_manager:
    TransactionManager;
  readonly integrity_guard:
    CapaIntakeAdvisoryIntegrityGuard;
}

function fail(
  reasonCode:
    CapaIntakeAdvisoryServiceReasonCode,
): never {
  throw new CapaIntakeAdvisoryServiceError(
    reasonCode,
  );
}

function validateResolvedContext(
  invocation:
    CapaIntakeAdvisoryInvocation,
  context:
    CapaIntakeAdvisoryCaseContext,
): void {
  if (
    context.organization_id !==
      invocation.organization_id ||
    context.capa_case_id !==
      invocation.capa_case_id ||
    context.user_id !==
      invocation.user_id
  ) {
    fail("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
  }

  if (
    context.workflow_state !== "S10" ||
    !Number.isSafeInteger(
      context.record_version,
    ) ||
    context.record_version < 1
  ) {
    fail("CASE_NOT_IN_SUBMITTED_INTAKE");
  }
}

function validateResponse(
  response:
    CapaIntakeAdvisoryResponse,
): void {
  if (
    response.advisory_only !== true ||
    response.workflow_mutated !== false ||
    response.human_acceptance_required !==
      true ||
    response.output_schema_version !==
      CAPA_INTAKE_ADVISORY_AGENT
        .output_schema_version
  ) {
    fail("INVALID_ADVISORY_RESULT");
  }
}

export class CapaIntakeAdvisoryService {
  constructor(
    private readonly dependencies:
      CapaIntakeAdvisoryServiceDependencies,
  ) {}

  async advise(
    invocation:
      CapaIntakeAdvisoryInvocation,
  ): Promise<CapaIntakeAdvisoryServiceResult> {
    const context =
      await this.dependencies
        .context_resolver
        .resolve(invocation);

    if (context === null) {
      fail("CASE_NOT_FOUND_OR_NOT_AUTHORIZED");
    }

    validateResolvedContext(
      invocation,
      context,
    );

    if (
      !await this.dependencies.authorizer
        .authorize({
          context,
          operation:
            CAPA_INTAKE_ADVISORY_OPERATION,
        })
    ) {
      fail("ADVISORY_ACCESS_DENIED");
    }

    if (
      !this.dependencies.agent_gate
        .evaluate({
          context,
          agent:
            CAPA_INTAKE_ADVISORY_AGENT,
          operation:
            CAPA_INTAKE_ADVISORY_OPERATION,
        })
    ) {
      fail("AGENT_NOT_ELIGIBLE");
    }

    let evidence:
      CapaIntakeAdvisoryEvidence;

    try {
      evidence =
        await this.dependencies
          .evidence_provider
          .retrieve({
            context,
            request:
              invocation.request,
            request_id:
              invocation.request_id,
            correlation_id:
              invocation.correlation_id,
          });
    } catch {
      fail("EVIDENCE_RETRIEVAL_FAILED");
    }

    let response:
      CapaIntakeAdvisoryResponse;

    try {
      response =
        await this.dependencies.generator
          .generate({
            context,
            request:
              invocation.request,
            evidence,
            request_id:
              invocation.request_id,
            correlation_id:
              invocation.correlation_id,
            agent:
              CAPA_INTAKE_ADVISORY_AGENT,
          });
    } catch {
      fail("ADVISORY_GENERATION_FAILED");
    }

    validateResponse(response);

    let persistenceResult:
      CapaIntakeAdvisoryOutputSaveResult;

    try {
      persistenceResult =
        await this.dependencies
          .transaction_manager
          .runInTransaction(
            {
              request_id:
                invocation.request_id,
              correlation_id:
                invocation.correlation_id,
            },
            (transaction) =>
              this.dependencies
                .output_repository
                .save(
                  transaction,
                  {
                    context,
                    response,
                    request_id:
                      invocation.request_id,
                    correlation_id:
                      invocation.correlation_id,
                  },
                ),
          );
    } catch {
      fail("ADVISORY_PERSISTENCE_FAILED");
    }

    if (
      persistenceResult ===
        "case_changed"
    ) {
      fail("WORKFLOW_MUTATION_DETECTED");
    }

    if (
      !await this.dependencies
        .integrity_guard
        .assertCaseUnchanged(context)
    ) {
      fail("WORKFLOW_MUTATION_DETECTED");
    }

    return Object.freeze({
      advisory:
        response,

      snapshot:
        Object.freeze({
          capa_case_id:
            context.capa_case_id,

          case_version_id:
            context.case_version_id,

          record_version:
            context.record_version,
        }),
    });
  }
}

export function createCapaIntakeAdvisoryService(
  dependencies:
    CapaIntakeAdvisoryServiceDependencies,
): CapaIntakeAdvisoryService {
  return new CapaIntakeAdvisoryService(
    dependencies,
  );
}
