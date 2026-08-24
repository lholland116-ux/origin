import {
  CAPA_STATE_DEFINITIONS,
  type CapaStateId,
} from "../domain/capa-state";

import type {
  ControlledCode,
} from "../domain/capa-types";

import type {
  CapaAgentId,
  CapaPromptComponentVersions,
  ControlledVersion,
} from "./capa-prompt-contract";

/**
 * Fail-closed configuration for controlled CAPA prompt assembly.
 *
 * Primary sources:
 * Document #7 — Agent Definition and Configuration Specification
 * Document #10 — Knowledge Base, Retrieval and Citation Specification
 * Document #12 — AI and Software Risk Management Specification
 *
 * Traceability:
 * BL-066
 * PAE-001, PAE-002, PAE-006, PAE-007, PAE-008
 * KSEC-002
 * AI-09, AI-10, AI-12
 */

const VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

const CONTROLLED_CODE_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

const MAXIMUM_CONTROLLED_VALUE_LENGTH =
  128;

const MAXIMUM_INSTRUCTION_LENGTH =
  32_000;

const MAXIMUM_PROMPT_CHARACTERS =
  200_000;

const IMPLICIT_VERSION_ALIASES =
  new Set([
    "current",
    "default",
    "latest",
    "next",
    "stable",
  ]);

export const CAPA_CONTROLLED_INSTRUCTION_NAMES = [
  "platform_system_policy",
  "product_policy",
  "agent_definition",
  "output_contract",
] as const;

export type CapaControlledInstructionName =
  (typeof CAPA_CONTROLLED_INSTRUCTION_NAMES)[number];

export type CapaPromptConfigurationReasonCode =
  | "INVALID_REGISTRY_VERSION"
  | "INVALID_AGENT_ID"
  | "INVALID_COMPONENT_VERSION"
  | "AGENT_VERSION_MISMATCH"
  | "INVALID_WORKFLOW_STATE_ALLOWLIST"
  | "INVALID_OPERATION_ALLOWLIST"
  | "INVALID_CONTROLLED_INSTRUCTION"
  | "INVALID_PROMPT_SIZE_LIMIT";

export class CapaPromptConfigurationError
  extends Error {
  constructor(
    readonly reason_code:
      CapaPromptConfigurationReasonCode,
  ) {
    super(
      `Controlled CAPA prompt configuration is invalid: ${reason_code}.`,
    );

    this.name =
      "CapaPromptConfigurationError";
  }
}

export interface CapaControlledInstruction {
  readonly name: CapaControlledInstructionName;
  readonly version: ControlledVersion;
  readonly content: string;
}

export interface CapaPromptConfigurationInput {
  readonly registry_version: string;
  readonly agent_id: string;
  readonly agent_version: string;
  readonly component_versions:
    Readonly<Record<
      keyof CapaPromptComponentVersions,
      string
    >>;
  readonly allowed_workflow_states:
    readonly string[];
  readonly allowed_operations:
    readonly string[];
  readonly controlled_instructions:
    Readonly<Record<
      CapaControlledInstructionName,
      {
        readonly version: string;
        readonly content: string;
      }
    >>;
  readonly maximum_prompt_characters: number;
  readonly maximum_untrusted_block_characters:
    number;
}

export interface CapaPromptConfiguration {
  readonly registry_version: ControlledVersion;
  readonly agent_id: CapaAgentId;
  readonly agent_version: ControlledVersion;
  readonly component_versions:
    CapaPromptComponentVersions;
  readonly allowed_workflow_states:
    readonly CapaStateId[];
  readonly allowed_operations:
    readonly ControlledCode[];
  readonly controlled_instructions:
    Readonly<Record<
      CapaControlledInstructionName,
      CapaControlledInstruction
    >>;
  readonly maximum_prompt_characters: number;
  readonly maximum_untrusted_block_characters:
    number;
}

function isExplicitVersion(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <=
      MAXIMUM_CONTROLLED_VALUE_LENGTH &&
    VERSION_PATTERN.test(value) &&
    !IMPLICIT_VERSION_ALIASES.has(
      value.toLowerCase(),
    )
  );
}

function isControlledCode(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <=
      MAXIMUM_CONTROLLED_VALUE_LENGTH &&
    CONTROLLED_CODE_PATTERN.test(value)
  );
}

function hasUniqueValues(
  values: readonly string[],
): boolean {
  return new Set(values).size ===
    values.length;
}

function validateComponentVersions(
  versions:
    CapaPromptConfigurationInput["component_versions"],
): void {
  for (
    const value
    of Object.values(versions)
  ) {
    if (!isExplicitVersion(value)) {
      throw new CapaPromptConfigurationError(
        "INVALID_COMPONENT_VERSION",
      );
    }
  }
}

function validateInstructions(
  instructions:
    CapaPromptConfigurationInput["controlled_instructions"],
): void {
  for (
    const name
    of CAPA_CONTROLLED_INSTRUCTION_NAMES
  ) {
    const instruction =
      instructions[name];

    if (
      instruction === undefined ||
      !isExplicitVersion(
        instruction.version,
      ) ||
      instruction.content.trim()
        .length === 0 ||
      instruction.content.length >
        MAXIMUM_INSTRUCTION_LENGTH ||
      instruction.content.includes(
        "\u0000",
      )
    ) {
      throw new CapaPromptConfigurationError(
        "INVALID_CONTROLLED_INSTRUCTION",
      );
    }
  }
}

function freezeInstructions(
  instructions:
    CapaPromptConfigurationInput["controlled_instructions"],
): CapaPromptConfiguration[
  "controlled_instructions"
] {
  return Object.freeze(
    Object.fromEntries(
      CAPA_CONTROLLED_INSTRUCTION_NAMES
        .map((name) => [
          name,
          Object.freeze({
            name,
            version:
              instructions[name]
                .version as
                ControlledVersion,
            content:
              instructions[name]
                .content,
          }),
        ]),
    ) as unknown as
      CapaPromptConfiguration[
        "controlled_instructions"
      ],
  );
}

/**
 * Validates and freezes one approved server-side configuration snapshot.
 * No implicit version selection or fallback is permitted here.
 */
export function createCapaPromptConfiguration(
  input: CapaPromptConfigurationInput,
): CapaPromptConfiguration {
  if (
    !isExplicitVersion(
      input.registry_version,
    )
  ) {
    throw new CapaPromptConfigurationError(
      "INVALID_REGISTRY_VERSION",
    );
  }

  if (!isControlledCode(input.agent_id)) {
    throw new CapaPromptConfigurationError(
      "INVALID_AGENT_ID",
    );
  }

  if (!isExplicitVersion(input.agent_version)) {
    throw new CapaPromptConfigurationError(
      "INVALID_COMPONENT_VERSION",
    );
  }

  validateComponentVersions(
    input.component_versions,
  );

  if (
    input.agent_version !==
      input.component_versions
        .agent_version
  ) {
    throw new CapaPromptConfigurationError(
      "AGENT_VERSION_MISMATCH",
    );
  }

  if (
    !Array.isArray(
      input.allowed_workflow_states,
    ) ||
    input.allowed_workflow_states
      .length === 0 ||
    !hasUniqueValues(
      input.allowed_workflow_states,
    ) ||
    input.allowed_workflow_states
      .some(
        (state) =>
          !(state in
            CAPA_STATE_DEFINITIONS),
      )
  ) {
    throw new CapaPromptConfigurationError(
      "INVALID_WORKFLOW_STATE_ALLOWLIST",
    );
  }

  if (
    !Array.isArray(
      input.allowed_operations,
    ) ||
    input.allowed_operations.length ===
      0 ||
    !hasUniqueValues(
      input.allowed_operations,
    ) ||
    input.allowed_operations.some(
      (operation) =>
        !isControlledCode(operation),
    )
  ) {
    throw new CapaPromptConfigurationError(
      "INVALID_OPERATION_ALLOWLIST",
    );
  }

  validateInstructions(
    input.controlled_instructions,
  );

  if (
    !Number.isInteger(
      input.maximum_prompt_characters,
    ) ||
    input.maximum_prompt_characters < 1 ||
    input.maximum_prompt_characters >
      MAXIMUM_PROMPT_CHARACTERS ||
    !Number.isInteger(
      input
        .maximum_untrusted_block_characters,
    ) ||
    input
      .maximum_untrusted_block_characters <
      1 ||
    input
      .maximum_untrusted_block_characters >
      input.maximum_prompt_characters
  ) {
    throw new CapaPromptConfigurationError(
      "INVALID_PROMPT_SIZE_LIMIT",
    );
  }

  return Object.freeze({
    registry_version:
      input.registry_version as
        ControlledVersion,
    agent_id:
      input.agent_id as CapaAgentId,
    agent_version:
      input.agent_version as
        ControlledVersion,
    component_versions:
      Object.freeze({
        ...input.component_versions,
      }) as unknown as
        CapaPromptComponentVersions,
    allowed_workflow_states:
      Object.freeze([
        ...input.allowed_workflow_states,
      ]) as readonly CapaStateId[],
    allowed_operations:
      Object.freeze([
        ...input.allowed_operations,
      ]) as readonly ControlledCode[],
    controlled_instructions:
      freezeInstructions(
        input.controlled_instructions,
      ),
    maximum_prompt_characters:
      input.maximum_prompt_characters,
    maximum_untrusted_block_characters:
      input
        .maximum_untrusted_block_characters,
  });
}
