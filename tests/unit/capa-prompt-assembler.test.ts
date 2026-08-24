import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaPromptAssemblyRequest,
} from "../../lib/capa/ai/capa-prompt-contract";

import {
  CapaPromptAssemblyError,
  assembleCapaPrompt,
} from "../../lib/capa/ai/capa-prompt-assembler";

import {
  createCapaPromptConfiguration,
  type CapaPromptConfigurationInput,
} from "../../lib/capa/ai/capa-prompt-configuration";

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000";

function configurationInput():
  CapaPromptConfigurationInput {
  return {
    registry_version: "registry-1.0.0",
    agent_id: "AG-INTAKE",
    agent_version: "agent-1.0.0",
    component_versions: {
      assembly_version: "assembly-1.0.0",
      platform_policy_version:
        "platform-1.0.0",
      product_policy_version:
        "product-1.0.0",
      agent_version: "agent-1.0.0",
      workflow_context_version:
        "workflow-1.0.0",
      authorization_context_version:
        "authorization-1.0.0",
      case_context_schema_version:
        "case-context-1.0.0",
      retrieval_policy_version:
        "retrieval-1.0.0",
      tool_policy_version:
        "tools-1.0.0",
      output_schema_version:
        "output-1.0.0",
      model_profile_version:
        "model-1.0.0",
      evaluation_suite_version:
        "evaluation-1.0.0",
    },
    allowed_workflow_states: ["S10"],
    allowed_operations: [
      "draft_intake_analysis",
    ],
    controlled_instructions: {
      platform_system_policy: {
        version: "platform-1.0.0",
        content: "Platform policy.",
      },
      product_policy: {
        version: "product-1.0.0",
        content: "Product policy.",
      },
      agent_definition: {
        version: "agent-1.0.0",
        content: "Agent definition.",
      },
      output_contract: {
        version: "output-1.0.0",
        content: "Output contract.",
      },
    },
    maximum_prompt_characters: 50_000,
    maximum_untrusted_block_characters:
      2_000,
  };
}

function request():
  CapaPromptAssemblyRequest {
  const versions =
    configurationInput()
      .component_versions;

  return {
    scope: {
      organization_id:
        ORGANIZATION_ID as never,
      capa_case_id:
        "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as never,
      case_version_id:
        "a65d17e5-4688-4412-aa08-f2832b37f671" as never,
      record_version: 2,
      workflow_state: "S10",
    },
    trace: {
      run_id:
        "098c6760-7c3a-4de2-92fa-cd45f46c2321" as never,
      prompt_package_id:
        "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as never,
      request_id:
        "c206f86c-2ba7-490e-bbfd-e31f562c4f30" as never,
      correlation_id:
        "98e82790-e9f9-4b3d-a7eb-ed0e99c3d444" as never,
      assembled_at:
        "2026-08-24T10:00:00.000Z" as never,
    },
    agent: {
      agent_id: "AG-INTAKE" as never,
      agent_version:
        "agent-1.0.0" as never,
      output_type:
        "CAPA_INTAKE_DRAFT" as never,
    },
    authorization: {
      user_id:
        "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23" as never,
      active_role_ids: [
        "CAPA_OWNER" as never,
      ],
      relied_on_role_assignment_ids: [
        "c0cf1844-61b9-432b-8355-f6c13fe48e67",
      ],
      authorized_operation:
        "draft_intake_analysis" as never,
      authorization_policy_version:
        "authorization-1.0.0" as never,
    },
    component_versions:
      versions as never,
    minimum_case_context: [
      {
        field_code:
          "INITIATING_EVENT" as never,
        value: {
          zeta: "last",
          alpha: "first",
        },
        source_object_id:
          "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
        source_object_version_id:
          "a65d17e5-4688-4412-aa08-f2832b37f671",
      },
    ],
    retrieved_passages: [
      {
        organization_id:
          ORGANIZATION_ID as never,
        collection_id:
          "collection-1" as never,
        source_id: "source-1" as never,
        source_version:
          "source-1.0.0" as never,
        passage_id:
          "passage-1" as never,
        source_status: "approved",
        source_type:
          "CUSTOMER_PROCEDURE" as never,
        title: "CAPA procedure",
        precise_locator: "Section 4.2",
        retrieved_at:
          "2026-08-24T09:59:00.000Z" as never,
        text: {
          trust: "untrusted_data",
          content:
            "The procedure requires documented triage.",
          provenance_type:
            "retrieved_passage",
        },
      },
    ],
    user_request: {
      trust: "untrusted_data",
      content:
        "Draft intake analysis questions.",
      provenance_type: "user_request",
    },
    tool_results: [
      {
        tool_id: "CASE_READER" as never,
        tool_version:
          "case-reader-1.0.0" as never,
        invocation_id:
          "invocation-1" as never,
        status: "succeeded",
        result: {
          trust: "untrusted_data",
          content: "No duplicate was found.",
          provenance_type: "tool_result",
        },
      },
    ],
  };
}

function expectReason(
  changed: CapaPromptAssemblyRequest,
  reason: string,
  configurationOverride =
    configurationInput(),
): void {
  const configuration =
    createCapaPromptConfiguration(
      configurationOverride,
    );

  expect(
    () =>
      assembleCapaPrompt(
        configuration,
        changed,
      ),
  ).toThrowError(
    expect.objectContaining({
      name: "CapaPromptAssemblyError",
      reason_code: reason,
    }),
  );
}

describe(
  "deterministic CAPA prompt assembly",
  () => {
    it(
      "assembles the exact governed ten-layer package",
      () => {
        const configuration =
          createCapaPromptConfiguration(
            configurationInput(),
          );

        const first = assembleCapaPrompt(
          configuration,
          request(),
        );
        const second = assembleCapaPrompt(
          configuration,
          request(),
        );

        expect(second).toEqual(first);
        expect(first.layers).toHaveLength(10);
        expect(
          first.layers.map((layer) =>
            layer.name,
          ),
        ).toEqual([
          "platform_system_policy",
          "product_policy",
          "agent_definition",
          "workflow_context",
          "authorization_context",
          "minimum_case_context",
          "retrieved_sources",
          "user_request",
          "tool_results",
          "output_contract",
        ]);
        expect(
          first.layers.map((layer) =>
            layer.position,
          ),
        ).toEqual([
          1, 2, 3, 4, 5,
          6, 7, 8, 9, 10,
        ]);
        expect(
          first.layers.map((layer) =>
            layer.trust,
          ),
        ).toEqual([
          "trusted_control",
          "trusted_control",
          "trusted_control",
          "trusted_server_context",
          "trusted_server_context",
          "trusted_server_context",
          "untrusted_data",
          "untrusted_data",
          "untrusted_data",
          "trusted_control",
        ]);
        expect(first.reduction_applied)
          .toBe(false);
        expect(Object.isFrozen(first))
          .toBe(true);
        expect(Object.isFrozen(first.layers))
          .toBe(true);
      },
    );

    it(
      "canonicalizes dynamic object keys",
      () => {
        const packageResult =
          assembleCapaPrompt(
            createCapaPromptConfiguration(
              configurationInput(),
            ),
            request(),
          );

        const serialized = JSON.stringify(
          packageResult.layers[5].content,
        );

        expect(
          serialized.indexOf("alpha"),
        ).toBeLessThan(
          serialized.indexOf("zeta"),
        );
      },
    );

    it(
      "rejects invalid controlled scope",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            scope: {
              ...input.scope,
              capa_case_id:
                "not-a-uuid" as never,
            },
          },
          "INVALID_SCOPE",
        );
      },
    );

    it(
      "rejects a component-version mismatch",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            component_versions: {
              ...input.component_versions,
              model_profile_version:
                "model-2.0.0" as never,
            },
          },
          "CONFIGURATION_MISMATCH",
        );
      },
    );

    it(
      "rejects an ineligible agent",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            agent: {
              ...input.agent,
              agent_id:
                "AG-OTHER" as never,
            },
          },
          "AGENT_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "rejects an ineligible workflow state",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            scope: {
              ...input.scope,
              workflow_state: "S20",
            },
          },
          "WORKFLOW_STATE_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "rejects an unauthorized operation",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            authorization: {
              ...input.authorization,
              authorized_operation:
                "approve_case" as never,
            },
          },
          "OPERATION_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "rejects a cross-organization passage",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            retrieved_passages: [
              {
                ...input
                  .retrieved_passages[0]!,
                organization_id:
                  "6ba7b810-9dad-41d1-80b4-00c04fd430c8" as never,
              },
            ],
          },
          "CROSS_ORGANIZATION_SOURCE",
        );
      },
    );

    it(
      "rejects mislabeled untrusted content",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            user_request: {
              ...input.user_request,
              provenance_type:
                "tool_result",
            },
          },
          "INVALID_UNTRUSTED_CONTENT",
        );
      },
    );

    it(
      "rejects an oversized untrusted block",
      () => {
        const input = request();
        expectReason(
          {
            ...input,
            user_request: {
              ...input.user_request,
              content: "x".repeat(2_001),
            },
          },
          "UNTRUSTED_CONTENT_LIMIT_EXCEEDED",
        );
      },
    );

    it.each([
      Number.NaN,
      Number.POSITIVE_INFINITY,
      undefined,
      new Date(
        "2026-08-24T10:00:00.000Z",
      ),
    ])(
      "rejects unsupported context value %#",
      (value) => {
        const input = request();
        expectReason(
          {
            ...input,
            minimum_case_context: [
              {
                ...input
                  .minimum_case_context[0]!,
                value,
              },
            ],
          },
          "UNSUPPORTED_CONTEXT_VALUE",
        );
      },
    );

    it(
      "fails instead of truncating prompt overflow",
      () => {
        const input = request();
        expectReason(
          input,
          "PROMPT_LIMIT_EXCEEDED",
          {
            ...configurationInput(),
            maximum_prompt_characters:
              100,
            maximum_untrusted_block_characters:
              50,
          },
        );
      },
    );

    it(
      "provides a stable controlled error",
      () => {
        const error =
          new CapaPromptAssemblyError(
            "INVALID_SCOPE",
          );

        expect(error.name).toBe(
          "CapaPromptAssemblyError",
        );
        expect(error.reason_code).toBe(
          "INVALID_SCOPE",
        );
        expect(error.message).toContain(
          "INVALID_SCOPE",
        );
      },
    );
  },
);
