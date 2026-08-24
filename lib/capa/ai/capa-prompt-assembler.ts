import type {
  CapaPromptAssemblyRequest,
  CapaPromptComponentVersions,
  CapaPromptLayer,
  CapaPromptLayers,
  CapaPromptTrustLevel,
  CapaControlledPromptPackage,
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaControlledInstructionName,
  CapaPromptConfiguration,
} from "./capa-prompt-configuration";

/**
 * Deterministic, provider-neutral CAPA prompt assembler.
 *
 * This module does not invoke a model, select a fallback, authorize a
 * workflow action, mutate a CAPA record, or persist an AI output.
 *
 * Traceability:
 * BL-066
 * PAE-001 through PAE-007
 * KSEC-001 through KSEC-004
 * CF-TENANT, CF-AUTHORITY, CF-FAIL
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const COMPONENT_VERSION_KEYS = [
  "assembly_version",
  "platform_policy_version",
  "product_policy_version",
  "agent_version",
  "workflow_context_version",
  "authorization_context_version",
  "case_context_schema_version",
  "retrieval_policy_version",
  "tool_policy_version",
  "output_schema_version",
  "model_profile_version",
  "evaluation_suite_version",
] as const satisfies readonly (
  keyof CapaPromptComponentVersions
)[];

export type CapaPromptAssemblyReasonCode =
  | "INVALID_SCOPE"
  | "CONFIGURATION_MISMATCH"
  | "AGENT_NOT_ELIGIBLE"
  | "WORKFLOW_STATE_NOT_ELIGIBLE"
  | "OPERATION_NOT_ELIGIBLE"
  | "CROSS_ORGANIZATION_SOURCE"
  | "INVALID_UNTRUSTED_CONTENT"
  | "UNTRUSTED_CONTENT_LIMIT_EXCEEDED"
  | "UNSUPPORTED_CONTEXT_VALUE"
  | "PROMPT_LIMIT_EXCEEDED";

export class CapaPromptAssemblyError
  extends Error {
  constructor(
    readonly reason_code:
      CapaPromptAssemblyReasonCode,
  ) {
    super(
      `Controlled CAPA prompt assembly failed: ${reason_code}.`,
    );

    this.name = "CapaPromptAssemblyError";
  }
}

type CanonicalJson =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJson[]
  | {
      readonly [key: string]:
        CanonicalJson;
    };

function canonicalize(
  value: unknown,
): CanonicalJson {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new CapaPromptAssemblyError(
        "UNSUPPORTED_CONTEXT_VALUE",
      );
    }

    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      canonicalize(item),
    );
  }

  if (
    typeof value === "object" &&
    value !== null &&
    (
      Object.getPrototypeOf(value) ===
        Object.prototype ||
      Object.getPrototypeOf(value) ===
        null
    )
  ) {
    const result:
      Record<string, CanonicalJson> =
        {};

    for (
      const key
      of Object.keys(value).sort()
    ) {
      const item =
        (value as
          Record<string, unknown>)[key];

      if (item === undefined) {
        throw new CapaPromptAssemblyError(
          "UNSUPPORTED_CONTEXT_VALUE",
        );
      }

      result[key] =
        canonicalize(item);
    }

    return result;
  }

  throw new CapaPromptAssemblyError(
    "UNSUPPORTED_CONTEXT_VALUE",
  );
}

function validateScope(
  request: CapaPromptAssemblyRequest,
): void {
  if (
    !UUID_PATTERN.test(
      request.scope.organization_id,
    ) ||
    !UUID_PATTERN.test(
      request.scope.capa_case_id,
    ) ||
    !UUID_PATTERN.test(
      request.scope.case_version_id,
    ) ||
    !Number.isInteger(
      request.scope.record_version,
    ) ||
    request.scope.record_version < 1 ||
    !UUID_PATTERN.test(
      request.trace.run_id,
    ) ||
    !UUID_PATTERN.test(
      request.trace.prompt_package_id,
    ) ||
    !UUID_PATTERN.test(
      request.trace.request_id,
    ) ||
    !UUID_PATTERN.test(
      request.trace.correlation_id,
    )
  ) {
    throw new CapaPromptAssemblyError(
      "INVALID_SCOPE",
    );
  }
}

function validateConfigurationMatch(
  configuration:
    CapaPromptConfiguration,
  request: CapaPromptAssemblyRequest,
): void {
  for (
    const key
    of COMPONENT_VERSION_KEYS
  ) {
    if (
      request.component_versions[key] !==
        configuration
          .component_versions[key]
    ) {
      throw new CapaPromptAssemblyError(
        "CONFIGURATION_MISMATCH",
      );
    }
  }

  if (
    request.agent.agent_id !==
      configuration.agent_id ||
    request.agent.agent_version !==
      configuration.agent_version
  ) {
    throw new CapaPromptAssemblyError(
      "AGENT_NOT_ELIGIBLE",
    );
  }

  if (
    !configuration
      .allowed_workflow_states
      .includes(
        request.scope.workflow_state,
      )
  ) {
    throw new CapaPromptAssemblyError(
      "WORKFLOW_STATE_NOT_ELIGIBLE",
    );
  }

  if (
    !configuration.allowed_operations
      .includes(
        request.authorization
          .authorized_operation,
      )
  ) {
    throw new CapaPromptAssemblyError(
      "OPERATION_NOT_ELIGIBLE",
    );
  }
}

function validateUntrustedText(
  value:
    CapaPromptAssemblyRequest[
      "user_request"
    ],
  expectedProvenance:
    CapaPromptAssemblyRequest[
      "user_request"
    ]["provenance_type"],
  maximumCharacters: number,
): void {
  if (
    value.trust !== "untrusted_data" ||
    value.provenance_type !==
      expectedProvenance ||
    typeof value.content !== "string" ||
    value.content.trim().length === 0 ||
    value.content.includes("\u0000")
  ) {
    throw new CapaPromptAssemblyError(
      "INVALID_UNTRUSTED_CONTENT",
    );
  }

  if (
    value.content.length >
      maximumCharacters
  ) {
    throw new CapaPromptAssemblyError(
      "UNTRUSTED_CONTENT_LIMIT_EXCEEDED",
    );
  }
}

function validateUntrustedInputs(
  configuration:
    CapaPromptConfiguration,
  request: CapaPromptAssemblyRequest,
): void {
  validateUntrustedText(
    request.user_request,
    "user_request",
    configuration
      .maximum_untrusted_block_characters,
  );

  for (
    const passage
    of request.retrieved_passages
  ) {
    if (
      passage.organization_id !==
        request.scope.organization_id
    ) {
      throw new CapaPromptAssemblyError(
        "CROSS_ORGANIZATION_SOURCE",
      );
    }

    validateUntrustedText(
      passage.text,
      "retrieved_passage",
      configuration
        .maximum_untrusted_block_characters,
    );
  }

  for (
    const result
    of request.tool_results
  ) {
    validateUntrustedText(
      result.result,
      "tool_result",
      configuration
        .maximum_untrusted_block_characters,
    );
  }
}

function controlledLayer(
  position: number,
  name: CapaControlledInstructionName,
  configuration:
    CapaPromptConfiguration,
): CapaPromptLayer {
  const instruction =
    configuration
      .controlled_instructions[name];

  return Object.freeze({
    position,
    name,
    trust:
      "trusted_control" as const,
    content: Object.freeze({
      instruction:
        instruction.content,
    }),
    content_version:
      instruction.version,
  });
}

function contextLayer(
  position: number,
  name: CapaPromptLayer["name"],
  trust: CapaPromptTrustLevel,
  content: unknown,
  contentVersion: ControlledVersion,
): CapaPromptLayer {
  return Object.freeze({
    position,
    name,
    trust,
    content: canonicalize(content),
    content_version: contentVersion,
  });
}

/**
 * Produces the exact approved ten-layer prompt package.
 *
 * Identical validated inputs and configuration produce structurally
 * identical layer content. Object keys in dynamic context are sorted.
 */
export function assembleCapaPrompt(
  configuration:
    CapaPromptConfiguration,
  request: CapaPromptAssemblyRequest,
): CapaControlledPromptPackage {
  validateScope(request);
  validateConfigurationMatch(
    configuration,
    request,
  );
  validateUntrustedInputs(
    configuration,
    request,
  );

  const layers = Object.freeze([
    controlledLayer(
      1,
      "platform_system_policy",
      configuration,
    ),
    controlledLayer(
      2,
      "product_policy",
      configuration,
    ),
    controlledLayer(
      3,
      "agent_definition",
      configuration,
    ),
    contextLayer(
      4,
      "workflow_context",
      "trusted_server_context",
      request.scope,
      request.component_versions
        .workflow_context_version,
    ),
    contextLayer(
      5,
      "authorization_context",
      "trusted_server_context",
      request.authorization,
      request.component_versions
        .authorization_context_version,
    ),
    contextLayer(
      6,
      "minimum_case_context",
      "trusted_server_context",
      request.minimum_case_context,
      request.component_versions
        .case_context_schema_version,
    ),
    contextLayer(
      7,
      "retrieved_sources",
      "untrusted_data",
      request.retrieved_passages,
      request.component_versions
        .retrieval_policy_version,
    ),
    contextLayer(
      8,
      "user_request",
      "untrusted_data",
      request.user_request,
      request.component_versions
        .assembly_version,
    ),
    contextLayer(
      9,
      "tool_results",
      "untrusted_data",
      request.tool_results,
      request.component_versions
        .tool_policy_version,
    ),
    controlledLayer(
      10,
      "output_contract",
      configuration,
    ),
  ]) as CapaPromptLayers;

  if (
    JSON.stringify(layers).length >
      configuration
        .maximum_prompt_characters
  ) {
    throw new CapaPromptAssemblyError(
      "PROMPT_LIMIT_EXCEEDED",
    );
  }

  return Object.freeze({
    scope: request.scope,
    trace: request.trace,
    agent: request.agent,
    component_versions:
      request.component_versions,
    layers,
    reduction_applied: false,
  });
}
