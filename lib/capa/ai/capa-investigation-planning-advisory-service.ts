import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationPlanAdvisoryResponse,
} from "./capa-investigation-planning-advisory-contract";
import type {
  AuthoritativeS30InvestigationPlanningContext,
  CapaInvestigationPlanningAdvisoryContextAssembly,
  CapaInvestigationPlanningAdvisoryContextInvocation,
} from "./capa-investigation-planning-advisory-context";
import {
  CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
  type CapaInvestigationPlanningAdvisoryAgentGate,
} from "./capa-investigation-planning-advisory-agent-gate";
import {
  validateCapaInvestigationPlanAdvisoryModelOutput,
} from "./capa-investigation-planning-advisory-output-validator";
import type {
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  OrganizationId,
  RequestId,
  UserId,
} from "../domain/capa-types";
import type { CapaInvestigationPlanningAdvisoryGenerationTraceCapture } from "./capa-ai-generation-trace";
import {
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION,
} from "./capa-ai-generation-trace";
import type { TransactionManager } from "../../database/transactions";
import type {
  CapaInvestigationPlanningAdvisoryOutputRepository,
  CapaInvestigationPlanningAdvisoryOutputSaveResult,
} from "../../database/repositories/capa-investigation-planning-advisory-output-repository";

export {
  CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
  CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
} from "./capa-investigation-planning-advisory-agent-gate";

export const CAPA_INVESTIGATION_PLANNING_ADVISORY_SERVICE_REASON_CODES = [
  "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
  "CASE_NOT_IN_INVESTIGATION_PLANNING",
  "ADVISORY_ACCESS_DENIED",
  "AGENT_NOT_ELIGIBLE",
  "ADVISORY_GENERATION_FAILED",
  "INVALID_ADVISORY_RESULT",
  "ADVISORY_PERSISTENCE_FAILED",
  "WORKFLOW_MUTATION_DETECTED",
] as const;

export type CapaInvestigationPlanningAdvisoryServiceReasonCode =
  (typeof CAPA_INVESTIGATION_PLANNING_ADVISORY_SERVICE_REASON_CODES)[number];

export class CapaInvestigationPlanningAdvisoryServiceError extends Error {
  readonly reason_code:
    CapaInvestigationPlanningAdvisoryServiceReasonCode;

  constructor(reasonCode: CapaInvestigationPlanningAdvisoryServiceReasonCode) {
    super("The governed CAPA investigation-planning advisory operation failed.");
    this.name = "CapaInvestigationPlanningAdvisoryServiceError";
    this.reason_code = reasonCode;
  }
}

export interface CapaInvestigationPlanningAdvisoryRequest {
  readonly requested_output: typeof CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT;
  readonly focus?: string | null;
  readonly untrusted_human_draft?: unknown;
}

export interface CapaInvestigationPlanningAdvisoryInvocation {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly user_id: UserId;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly request: CapaInvestigationPlanningAdvisoryRequest;
}

export interface CapaInvestigationPlanningAdvisoryContextResolver {
  resolve(
    input: CapaInvestigationPlanningAdvisoryContextInvocation,
  ): Promise<CapaInvestigationPlanningAdvisoryContextAssembly | null>;
  assertCaseUnchanged(
    context: AuthoritativeS30InvestigationPlanningContext,
  ): Promise<boolean>;
}

export interface CapaInvestigationPlanningAdvisoryAuthorizer {
  authorize(input: {
    readonly context: AuthoritativeS30InvestigationPlanningContext;
    readonly operation: typeof CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION;
  }): Promise<boolean>;
}

export interface CapaInvestigationPlanningAdvisoryGenerator {
  generate(input: {
    readonly context: CapaInvestigationPlanningAdvisoryContextAssembly;
    readonly focus: string | null;
    readonly request_id: RequestId;
    readonly correlation_id: CorrelationId;
  }): Promise<{
    readonly response: CapaInvestigationPlanAdvisoryResponse;
    readonly trace: CapaInvestigationPlanningAdvisoryGenerationTraceCapture;
  }>;
}

export interface CapaInvestigationPlanningAdvisoryServiceDependencies {
  readonly context_resolver: CapaInvestigationPlanningAdvisoryContextResolver;
  readonly authorizer: CapaInvestigationPlanningAdvisoryAuthorizer;
  readonly agent_gate: CapaInvestigationPlanningAdvisoryAgentGate;
  readonly generator: CapaInvestigationPlanningAdvisoryGenerator;
  readonly output_repository: CapaInvestigationPlanningAdvisoryOutputRepository;
  readonly transaction_manager: TransactionManager;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasText(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isAuthoritativeContextValid(
  context: unknown,
  invocation: CapaInvestigationPlanningAdvisoryInvocation,
): context is AuthoritativeS30InvestigationPlanningContext {
  if (!isRecord(context)) return false;

  return context.trust === "authoritative_server_context" &&
    context.organization_id === invocation.organization_id &&
    context.capa_case_id === invocation.capa_case_id &&
    context.actor === invocation.user_id &&
    context.workflow_state === "S30" &&
    Number.isSafeInteger(context.record_version) &&
    (context.record_version as number) > 0 &&
    hasText(context.case_version_id) &&
    Array.isArray(context.active_roles) &&
    context.active_roles.length > 0;
}

function hasGeneratedIdentityConsistency(
  response: unknown,
  generatedTrace: unknown,
  invocation: CapaInvestigationPlanningAdvisoryInvocation,
  context: AuthoritativeS30InvestigationPlanningContext,
): boolean {
  if (!isRecord(response) || !isRecord(generatedTrace)) return false;

  if (
    generatedTrace.trace_schema_version !==
      CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION
  ) {
    return false;
  }

  const packageValue = generatedTrace.package;
  if (
    !isRecord(packageValue) ||
    packageValue.package_schema_version !==
      CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION
  ) {
    return false;
  }

  const traceValue = packageValue.trace;
  const scopeValue = packageValue.scope;
  const agentValue = packageValue.agent;
  const generationValue = packageValue.generation_contract;
  if (
    !isRecord(traceValue) ||
    !isRecord(scopeValue) ||
    !isRecord(agentValue) ||
    !isRecord(generationValue)
  ) {
    return false;
  }

  if (
    !hasText(traceValue.run_id) ||
    !hasText(traceValue.prompt_package_id) ||
    !hasText(traceValue.request_id) ||
    !hasText(traceValue.correlation_id) ||
    !hasText(traceValue.assembled_at) ||
    !hasText(scopeValue.organization_id) ||
    !hasText(scopeValue.capa_case_id) ||
    !hasText(scopeValue.case_version_id) ||
    !Number.isSafeInteger(scopeValue.record_version) ||
    (scopeValue.record_version as number) <= 0 ||
    scopeValue.workflow_state !== "S30" ||
    agentValue.agent_id !== "AG-PLAN" ||
    agentValue.agent_version !== "ag-plan-1.0.0" ||
    generationValue.operation !== CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION ||
    generationValue.requested_output !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT ||
    generationValue.output_schema_version !==
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION
  ) {
    return false;
  }

  return response.run_id === traceValue.run_id &&
    traceValue.request_id === invocation.request_id &&
    traceValue.correlation_id === invocation.correlation_id &&
    scopeValue.organization_id === context.organization_id &&
    scopeValue.capa_case_id === context.capa_case_id &&
    scopeValue.case_version_id === context.case_version_id &&
    scopeValue.record_version === context.record_version;
}

function validateGeneratedResponse(
  response: unknown,
): response is CapaInvestigationPlanAdvisoryResponse {
  if (!isRecord(response)) return false;

  const expectedFields = [
    "run_id",
    "output_id",
    "output_schema_version",
    "status",
    "proposal",
    "assumptions",
    "uncertainty_and_limitations",
    "citations",
    "warnings",
    "advisory_only",
    "workflow_mutated",
    "human_acceptance_required",
  ];
  const actualFields = Object.keys(response);
  if (
    actualFields.length !== expectedFields.length ||
    expectedFields.some((field) => !actualFields.includes(field))
  ) {
    return false;
  }

  if (
    !hasText(response.run_id) ||
    !hasText(response.output_id) ||
    response.output_schema_version !==
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
    response.status !== "completed_draft" ||
    !isRecord(response.proposal) ||
    !Array.isArray(response.assumptions) ||
    !Array.isArray(response.uncertainty_and_limitations) ||
    !Array.isArray(response.citations) ||
    response.citations.length !== 0 ||
    !Array.isArray(response.warnings) ||
    response.warnings.length !== 0 ||
    response.advisory_only !== true ||
    response.workflow_mutated !== false ||
    response.human_acceptance_required !== true
  ) {
    return false;
  }

  try {
    validateCapaInvestigationPlanAdvisoryModelOutput(
      JSON.stringify({
        proposal: response.proposal,
        assumptions: response.assumptions,
        uncertainty_and_limitations: response.uncertainty_and_limitations,
        citations: response.citations,
        advisory_only: response.advisory_only,
        workflow_mutated: response.workflow_mutated,
        human_acceptance_required: response.human_acceptance_required,
      }),
    );
    return true;
  } catch {
    return false;
  }
}

export class CapaInvestigationPlanningAdvisoryService {
  constructor(
    private readonly dependencies:
      CapaInvestigationPlanningAdvisoryServiceDependencies,
  ) {}

  async execute(invocation: CapaInvestigationPlanningAdvisoryInvocation): Promise<{
    readonly advisory: CapaInvestigationPlanAdvisoryResponse;
    readonly snapshot: Readonly<{
      readonly capa_case_id: CapaCaseId;
      readonly case_version_id: CapaCaseVersionId;
      readonly record_version: number;
    }>;
  }> {
    if (
      !isRecord(invocation?.request) ||
      invocation.request.requested_output !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT
    ) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "INVALID_ADVISORY_RESULT",
      );
    }

    let assembly: CapaInvestigationPlanningAdvisoryContextAssembly | null;
    try {
      assembly = await this.dependencies.context_resolver.resolve({
        organization_id: invocation.organization_id,
        capa_case_id: invocation.capa_case_id,
        untrusted_human_draft: invocation.request.untrusted_human_draft,
      });
    } catch {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      );
    }

    const context = assembly?.authoritative;
    if (!assembly || !isAuthoritativeContextValid(context, invocation)) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "CASE_NOT_IN_INVESTIGATION_PLANNING",
      );
    }

    let authorized = false;
    try {
      authorized = await this.dependencies.authorizer.authorize({
        context,
        operation: CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
      });
    } catch {
      authorized = false;
    }
    if (!authorized) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "ADVISORY_ACCESS_DENIED",
      );
    }

    let eligible = false;
    try {
      eligible = this.dependencies.agent_gate.evaluate({
        context,
        agent: CAPA_INVESTIGATION_PLANNING_ADVISORY_AGENT,
        operation: CAPA_INVESTIGATION_PLANNING_ADVISORY_OPERATION,
      });
    } catch {
      eligible = false;
    }
    if (!eligible) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "AGENT_NOT_ELIGIBLE",
      );
    }

    let generated: {
      readonly response: CapaInvestigationPlanAdvisoryResponse;
      readonly trace: CapaInvestigationPlanningAdvisoryGenerationTraceCapture;
    };
    try {
      generated = await this.dependencies.generator.generate({
        context: assembly,
        focus: invocation.request.focus ?? null,
        request_id: invocation.request_id,
        correlation_id: invocation.correlation_id,
      });
    } catch {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "ADVISORY_GENERATION_FAILED",
      );
    }

    if (!validateGeneratedResponse(generated?.response)) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "INVALID_ADVISORY_RESULT",
      );
    }

    if (
      !hasGeneratedIdentityConsistency(
        generated.response,
        generated.trace,
        invocation,
        context,
      )
    ) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "INVALID_ADVISORY_RESULT",
      );
    }

    let unchanged = false;
    try {
      unchanged = await this.dependencies.context_resolver.assertCaseUnchanged(
        context,
      );
    } catch {
      unchanged = false;
    }
    if (!unchanged) {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "WORKFLOW_MUTATION_DETECTED",
      );
    }

    let persistenceResult: CapaInvestigationPlanningAdvisoryOutputSaveResult;
    try {
      persistenceResult =
        await this.dependencies.transaction_manager.runInTransaction(
          {
            request_id: invocation.request_id,
            correlation_id: invocation.correlation_id,
          },
          (transaction) =>
            this.dependencies.output_repository.save(transaction, {
              context,
              response: generated.response,
              generation_trace: generated.trace,
              request_id: invocation.request_id,
              correlation_id: invocation.correlation_id,
            }),
        );
    } catch {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "ADVISORY_PERSISTENCE_FAILED",
      );
    }

    if (persistenceResult === "case_changed") {
      throw new CapaInvestigationPlanningAdvisoryServiceError(
        "WORKFLOW_MUTATION_DETECTED",
      );
    }

    return Object.freeze({
      advisory: generated.response,
      snapshot: Object.freeze({
        capa_case_id: context.capa_case_id,
        case_version_id: context.case_version_id,
        record_version: context.record_version,
      }),
    });
  }
}
