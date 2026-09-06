import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaPromptAssemblyRequest,
} from "../../lib/capa/ai/capa-prompt-contract";

import {
  createCapaPromptAssemblyService,
} from "../../lib/capa/ai/capa-prompt-service";

function request():
  CapaPromptAssemblyRequest {
  const service =
    createCapaPromptAssemblyService();

  return {
    scope: {
      organization_id:
        "550e8400-e29b-41d4-a716-446655440000" as never,
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
      agent_id:
        service.configuration
          .agent_id,
      agent_version:
        service.configuration
          .agent_version,
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
        "policy-1.0.0" as never,
    },
    component_versions:
      service.configuration
        .component_versions,
    minimum_case_context: [
      {
        field_code:
          "INITIATING_EVENT" as never,
        value:
          "Seal defects exceeded the alert threshold.",
        source_object_id:
          "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
        source_object_version_id:
          "a65d17e5-4688-4412-aa08-f2832b37f671",
      },
    ],
    retrieved_passages: [],
    user_request: {
      trust: "untrusted_data",
      content:
        "Help draft intake analysis questions.",
      provenance_type: "user_request",
    },
    tool_results: [],
  };
}

describe(
  "CAPA prompt-assembly service",
  () => {
    it(
      "exposes the exact approved initial configuration",
      () => {
        const service =
          createCapaPromptAssemblyService();

        expect(
          service.configuration,
        ).toMatchObject({
          registry_version:
            "capa-agent-registry-1.2.0",
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
          Object.isFrozen(
            service.configuration,
          ),
        ).toBe(true);
      },
    );

    it(
      "assembles, revalidates and renders without invoking a model",
      () => {
        const service =
          createCapaPromptAssemblyService();

        const result =
          service.assemble(request());

        expect(
          result.prompt_package.layers,
        ).toHaveLength(10);
        expect(
          result.rendered_prompt.blocks,
        ).toHaveLength(10);
        expect(
          result.prompt_package
            .reduction_applied,
        ).toBe(false);
        expect(Object.isFrozen(result))
          .toBe(true);
      },
    );

    it(
      "propagates controlled eligibility failure",
      () => {
        const service =
          createCapaPromptAssemblyService();
        const valid = request();

        expect(
          () =>
            service.assemble({
              ...valid,
              scope: {
                ...valid.scope,
                workflow_state: "S20",
              },
            }),
        ).toThrowError(
          expect.objectContaining({
            reason_code:
              "WORKFLOW_STATE_NOT_ELIGIBLE",
          }),
        );
      },
    );
  },
);
