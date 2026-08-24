import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_CONTROLLED_INSTRUCTION_NAMES,
  CapaPromptConfigurationError,
  createCapaPromptConfiguration,
  type CapaPromptConfigurationInput,
} from "../../lib/capa/ai/capa-prompt-configuration";

function validInput():
  CapaPromptConfigurationInput {
  return {
    registry_version:
      "capa-ai-registry-1.0.0",
    agent_id: "AG-INTAKE",
    agent_version:
      "ag-intake-1.0.0",
    component_versions: {
      assembly_version:
        "assembly-1.0.0",
      platform_policy_version:
        "platform-policy-1.0.0",
      product_policy_version:
        "product-policy-1.0.0",
      agent_version:
        "ag-intake-1.0.0",
      workflow_context_version:
        "workflow-context-1.0.0",
      authorization_context_version:
        "authorization-context-1.0.0",
      case_context_schema_version:
        "case-context-1.0.0",
      retrieval_policy_version:
        "retrieval-policy-1.0.0",
      tool_policy_version:
        "tool-policy-1.0.0",
      output_schema_version:
        "intake-output-1.0.0",
      model_profile_version:
        "model-profile-1.0.0",
      evaluation_suite_version:
        "evaluation-suite-1.0.0",
    },
    allowed_workflow_states: [
      "S10",
    ],
    allowed_operations: [
      "draft_intake_analysis",
    ],
    controlled_instructions: {
      platform_system_policy: {
        version:
          "platform-policy-1.0.0",
        content:
          "Enforce platform safety and human authority.",
      },
      product_policy: {
        version:
          "product-policy-1.0.0",
        content:
          "Produce controlled CAPA drafts only.",
      },
      agent_definition: {
        version:
          "ag-intake-1.0.0",
        content:
          "Assist with intake analysis without approving records.",
      },
      output_contract: {
        version:
          "intake-output-1.0.0",
        content:
          "Return only the approved structured draft envelope.",
      },
    },
    maximum_prompt_characters:
      100_000,
    maximum_untrusted_block_characters:
      20_000,
  };
}

function expectReason(
  input: CapaPromptConfigurationInput,
  reason: string,
): void {
  expect(
    () =>
      createCapaPromptConfiguration(
        input,
      ),
  ).toThrowError(
    expect.objectContaining({
      name:
        "CapaPromptConfigurationError",
      reason_code: reason,
    }),
  );
}

describe(
  "controlled CAPA prompt configuration",
  () => {
    it(
      "validates and freezes an exact configuration snapshot",
      () => {
        const configuration =
          createCapaPromptConfiguration(
            validInput(),
          );

        expect(configuration).toMatchObject({
          registry_version:
            "capa-ai-registry-1.0.0",
          agent_id: "AG-INTAKE",
          agent_version:
            "ag-intake-1.0.0",
          allowed_workflow_states: [
            "S10",
          ],
          allowed_operations: [
            "draft_intake_analysis",
          ],
        });

        expect(
          Object.isFrozen(configuration),
        ).toBe(true);
        expect(
          Object.isFrozen(
            configuration
              .component_versions,
          ),
        ).toBe(true);
        expect(
          Object.isFrozen(
            configuration
              .allowed_workflow_states,
          ),
        ).toBe(true);
        expect(
          Object.isFrozen(
            configuration
              .controlled_instructions,
          ),
        ).toBe(true);

        for (
          const name
          of CAPA_CONTROLLED_INSTRUCTION_NAMES
        ) {
          expect(
            Object.isFrozen(
              configuration
                .controlled_instructions[
                  name
                ],
            ),
          ).toBe(true);
        }
      },
    );

    it.each([
      "",
      "latest",
      "bad version",
      "x".repeat(129),
    ])(
      "rejects registry version %j",
      (registryVersion) => {
        expectReason(
          {
            ...validInput(),
            registry_version:
              registryVersion,
          },
          "INVALID_REGISTRY_VERSION",
        );
      },
    );

    it.each([
      "",
      "AG INTAKE",
      "1-AGENT",
      "x".repeat(129),
    ])(
      "rejects agent identifier %j",
      (agentId) => {
        expectReason(
          {
            ...validInput(),
            agent_id: agentId,
          },
          "INVALID_AGENT_ID",
        );
      },
    );

    it(
      "rejects an implicit agent version",
      () => {
        expectReason(
          {
            ...validInput(),
            agent_version: "latest",
          },
          "INVALID_COMPONENT_VERSION",
        );
      },
    );

    it(
      "rejects an implicit component version",
      () => {
        const input = validInput();

        expectReason(
          {
            ...input,
            component_versions: {
              ...input.component_versions,
              model_profile_version:
                "latest",
            },
          },
          "INVALID_COMPONENT_VERSION",
        );
      },
    );

    it(
      "rejects a mismatched agent version",
      () => {
        expectReason(
          {
            ...validInput(),
            agent_version:
              "ag-intake-2.0.0",
          },
          "AGENT_VERSION_MISMATCH",
        );
      },
    );

    it.each([
      {
        states: [],
      },
      {
        states: ["S10", "S10"],
      },
      {
        states: ["S999"],
      },
    ])(
      "rejects workflow-state allowlist $states",
      ({ states }) => {
        expectReason(
          {
            ...validInput(),
            allowed_workflow_states:
              states,
          },
          "INVALID_WORKFLOW_STATE_ALLOWLIST",
        );
      },
    );

    it.each([
      {
        operations: [],
      },
      {
        operations: [
          "draft_intake_analysis",
          "draft_intake_analysis",
        ],
      },
      {
        operations: [
          "invalid operation",
        ],
      },
    ])(
      "rejects operation allowlist $operations",
      ({ operations }) => {
        expectReason(
          {
            ...validInput(),
            allowed_operations:
              operations,
          },
          "INVALID_OPERATION_ALLOWLIST",
        );
      },
    );

    it.each([
      {
        version: "latest",
        content: "Controlled text.",
      },
      {
        version:
          "platform-policy-1.0.0",
        content: "   ",
      },
      {
        version:
          "platform-policy-1.0.0",
        content: "unsafe\u0000text",
      },
      {
        version:
          "platform-policy-1.0.0",
        content: "x".repeat(32_001),
      },
    ])(
      "rejects malformed controlled instruction %#",
      (instruction) => {
        const input = validInput();

        expectReason(
          {
            ...input,
            controlled_instructions: {
              ...input
                .controlled_instructions,
              platform_system_policy:
                instruction,
            },
          },
          "INVALID_CONTROLLED_INSTRUCTION",
        );
      },
    );

    it.each([
      {
        maximum_prompt_characters: 0,
        maximum_untrusted_block_characters:
          1,
      },
      {
        maximum_prompt_characters:
          200_001,
        maximum_untrusted_block_characters:
          1,
      },
      {
        maximum_prompt_characters:
          100,
        maximum_untrusted_block_characters:
          101,
      },
      {
        maximum_prompt_characters:
          100.5,
        maximum_untrusted_block_characters:
          50,
      },
      {
        maximum_prompt_characters:
          100,
        maximum_untrusted_block_characters:
          50.5,
      },
    ])(
      "rejects unsafe prompt limits %#",
      (limits) => {
        expectReason(
          {
            ...validInput(),
            ...limits,
          },
          "INVALID_PROMPT_SIZE_LIMIT",
        );
      },
    );

    it(
      "provides a stable named error",
      () => {
        const error =
          new CapaPromptConfigurationError(
            "INVALID_AGENT_ID",
          );

        expect(error.name).toBe(
          "CapaPromptConfigurationError",
        );
        expect(error.reason_code).toBe(
          "INVALID_AGENT_ID",
        );
        expect(error.message).toContain(
          "INVALID_AGENT_ID",
        );
      },
    );
  },
);
