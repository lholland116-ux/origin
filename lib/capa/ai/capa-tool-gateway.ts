import type {
  CapaAgentActivationService,
} from "./capa-agent-activation-service";

import {
  authorizeCapaToolExecution,
  type CapaToolAuthorizationRequest,
} from "./capa-tool-authorization";

import type {
  CapaToolAdapter,
  CapaToolDefinition,
  CapaToolExecutionReasonCode,
  CapaToolExecutionResult,
} from "./capa-tool-contract";

import type {
  CapaToolRegistry,
} from "./capa-tool-registry";

/**
 * Governed provider-neutral CAPA tool execution gateway.
 *
 * Primary sources:
 * Document #7 — Agent Definition and Configuration Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * BL-066, BL-068, BL-069
 * TOOL-AC-001 through TOOL-AC-008
 * AG-AC-004 through AG-AC-007
 * P-01 through P-04
 */

export interface CapaToolAdapterRegistry {
  findExact(
    toolId: CapaToolDefinition["tool_id"],
    toolVersion: string,
  ): CapaToolAdapter | null;
}

export interface CapaToolPayloadValidator {
  validateInput(
    definition: CapaToolDefinition,
    input: unknown,
  ): boolean;

  validateOutput(
    definition: CapaToolDefinition,
    output: unknown,
  ): boolean;
}

export interface CapaToolAuditRecord {
  readonly organization_id: string;
  readonly capa_case_id?: string;
  readonly tool_id: string;
  readonly tool_version: string;
  readonly agent_id: string;
  readonly agent_version: string;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly idempotency_key?: string;
  readonly status:
    CapaToolExecutionResult["status"];
  readonly reason_code:
    CapaToolExecutionReasonCode;
  readonly tool_registry_version: string;
  readonly agent_registry_version: string;
}

export interface CapaToolAuditRecorder {
  record(
    event: CapaToolAuditRecord,
  ): Promise<void>;
}

export interface CapaToolGatewayDependencies {
  readonly tool_registry:
    CapaToolRegistry;
  readonly agent_activation_service:
    CapaAgentActivationService;
  readonly adapter_registry:
    CapaToolAdapterRegistry;
  readonly payload_validator:
    CapaToolPayloadValidator;
  readonly audit_recorder:
    CapaToolAuditRecorder;
}

export interface CapaToolGateway {
  execute(
    request: CapaToolAuthorizationRequest,
  ): Promise<CapaToolExecutionResult>;
}

class ToolExecutionTimeoutError
  extends Error {
  constructor() {
    super("Controlled CAPA tool execution timed out.");
    this.name = "ToolExecutionTimeoutError";
  }
}

function failure(
  status: "denied" | "blocked" | "failed",
  reasonCode: Exclude<
    CapaToolExecutionReasonCode,
    "TOOL_EXECUTION_SUCCEEDED"
  >,
): CapaToolExecutionResult {
  return Object.freeze({
    status,
    reason_code: reasonCode,
  });
}

async function executeWithTimeout(
  adapter: CapaToolAdapter,
  request:
    CapaToolAuthorizationRequest["execution_request"],
  maximumExecutionMs: number,
): Promise<Readonly<Record<string, unknown>>> {
  let timeout:
    ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      adapter.execute(request),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(
            new ToolExecutionTimeoutError(),
          ),
          maximumExecutionMs,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) {
      clearTimeout(timeout);
    }
  }
}

class ControlledCapaToolGateway
  implements CapaToolGateway {
  constructor(
    private readonly dependencies:
      CapaToolGatewayDependencies,
  ) {}

  async execute(
    request: CapaToolAuthorizationRequest,
  ): Promise<CapaToolExecutionResult> {
    const authorization =
      authorizeCapaToolExecution(
        this.dependencies.tool_registry,
        this.dependencies
          .agent_activation_service,
        request,
      );

    if (!authorization.authorized) {
      const status =
        authorization.reason_code ===
          "TOOL_BLOCKED_OR_RETIRED"
          ? "blocked" as const
          : "denied" as const;

      return this.finalize(
        request,
        failure(
          status,
          authorization.reason_code,
        ),
      );
    }

    const definition =
      authorization.tool_definition;

    let inputValid = false;
    try {
      inputValid =
        this.dependencies.payload_validator
          .validateInput(
            definition,
            request.execution_request.input,
          );
    } catch {
      inputValid = false;
    }

    if (!inputValid) {
      return this.finalize(
        request,
        failure(
          "blocked",
          "INPUT_VALIDATION_FAILED",
        ),
      );
    }

    const adapter =
      this.dependencies.adapter_registry
        .findExact(
          definition.tool_id,
          definition.tool_version,
        );

    if (
      adapter === null ||
      adapter.tool_id !==
        definition.tool_id ||
      adapter.tool_version !==
        definition.tool_version
    ) {
      return this.finalize(
        request,
        failure(
          "failed",
          "EXECUTION_FAILED",
        ),
      );
    }

    let output:
      Readonly<Record<string, unknown>>;

    try {
      output = await executeWithTimeout(
        adapter,
        request.execution_request,
        definition.maximum_execution_ms,
      );
    } catch (error) {
      return this.finalize(
        request,
        failure(
          "failed",
          error instanceof
            ToolExecutionTimeoutError
            ? "EXECUTION_TIMEOUT"
            : "EXECUTION_FAILED",
        ),
      );
    }

    let outputValid = false;
    try {
      outputValid =
        this.dependencies.payload_validator
          .validateOutput(
            definition,
            output,
          );
    } catch {
      outputValid = false;
    }

    if (!outputValid) {
      return this.finalize(
        request,
        failure(
          "failed",
          "OUTPUT_VALIDATION_FAILED",
        ),
      );
    }

    const execution =
      request.execution_request;
    const result = Object.freeze({
      status: "succeeded" as const,
      reason_code:
        "TOOL_EXECUTION_SUCCEEDED" as const,
      output: Object.freeze({
        ...output,
      }),
      receipt: Object.freeze({
        tool_id: definition.tool_id,
        tool_version:
          definition.tool_version,
        agent_id: execution.agent_id,
        agent_version:
          execution.agent_version,
        organization_id:
          execution.organization_id,
        request_id:
          execution.request_trace.request_id,
        correlation_id:
          execution.request_trace
            .correlation_id,
        input_schema_version:
          definition.input_schema_version,
        output_schema_version:
          definition.output_schema_version,
        output_data_class:
          definition.output_data_class,
        audit_required: true as const,
      }),
    });

    return this.finalize(request, result);
  }

  private async finalize(
    request: CapaToolAuthorizationRequest,
    result: CapaToolExecutionResult,
  ): Promise<CapaToolExecutionResult> {
    const execution =
      request.execution_request;

    try {
      await this.dependencies.audit_recorder
        .record(Object.freeze({
          organization_id:
            execution.organization_id,
          ...(execution.capa_case_id ===
          undefined
            ? {}
            : {
                capa_case_id:
                  execution.capa_case_id,
              }),
          tool_id: execution.tool_id,
          tool_version:
            execution.tool_version,
          agent_id: execution.agent_id,
          agent_version:
            execution.agent_version,
          request_id:
            execution.request_trace.request_id,
          correlation_id:
            execution.request_trace
              .correlation_id,
          ...(execution.request_trace
            .idempotency_key === undefined
            ? {}
            : {
                idempotency_key:
                  execution.request_trace
                    .idempotency_key,
              }),
          status: result.status,
          reason_code: result.reason_code,
          tool_registry_version:
            this.dependencies.tool_registry
              .registry_version,
          agent_registry_version:
            this.dependencies
              .agent_activation_service
              .registry_version,
        }));
    } catch {
      return failure(
        "failed",
        "EXECUTION_FAILED",
      );
    }

    return result;
  }
}

export function createCapaToolGateway(
  dependencies:
    CapaToolGatewayDependencies,
): CapaToolGateway {
  return Object.freeze(
    new ControlledCapaToolGateway(
      dependencies,
    ),
  );
}
