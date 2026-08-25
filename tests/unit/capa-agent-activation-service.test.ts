import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  RoleId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaAgentEligibilityRequest,
} from "../../lib/capa/ai/capa-agent-contract";

import {
  createCapaAgentActivationService,
} from "../../lib/capa/ai/capa-agent-activation-service";

import {
  createInitialCapaAgentRegistry,
  type CapaAgentRegistry,
} from "../../lib/capa/ai/capa-agent-registry";

function intakeRequest():
  CapaAgentEligibilityRequest {
  return {
    agent_id: "AG-INTAKE",
    agent_version:
      "ag-intake-1.0.0" as never,
    workflow_state: "S10",
    operation:
      "draft_intake_analysis",
    active_role_ids: [
      "CAPA_OWNER" as RoleId,
    ],
    requested_tool_ids: [
      "TOOL-CASE-READ",
      "TOOL-RETRIEVE",
      "TOOL-STRUCTURED-DRAFT",
    ],
    output_schema_version:
      "capa-intake-draft-output-1.0.0" as never,
  };
}

describe(
  "controlled CAPA agent activation service",
  () => {
    it(
      "exposes the exact immutable registry version",
      () => {
        const service =
          createCapaAgentActivationService();

        expect(service.registry_version)
          .toBe(
            "capa-agent-registry-1.0.0",
          );
        expect(Object.isFrozen(service))
          .toBe(true);
      },
    );

    it(
      "returns the exact approved intake definition for an eligible request",
      () => {
        const service =
          createCapaAgentActivationService();

        const result = service.evaluate(
          intakeRequest(),
        );

        expect(result).toMatchObject({
          eligible: true,
          reason_code:
            "AGENT_ELIGIBLE",
          definition: {
            logical_agent_id:
              "AG-INTAKE",
            agent_version:
              "ag-intake-1.0.0",
            status: "approved",
          },
        });
      },
    );

    it(
      "denies an evaluation-only specialist",
      () => {
        const service =
          createCapaAgentActivationService();

        const result = service.evaluate({
          ...intakeRequest(),
          agent_id: "AG-RCA",
          agent_version:
            "ag-rca-1.0.0" as never,
          workflow_state: "S40",
          operation:
            "facilitate_root_cause",
          output_schema_version:
            "capa_root_cause_draft-1.0.0" as never,
        });

        expect(result).toEqual({
          eligible: false,
          reason_code:
            "AGENT_VERSION_NOT_APPROVED",
        });
      },
    );

    it(
      "delegates every request to one supplied registry snapshot",
      () => {
        const initial =
          createInitialCapaAgentRegistry();
        const findExact = vi.fn(
          initial.findExact.bind(initial),
        );
        const registry: CapaAgentRegistry = {
          registry_version:
            initial.registry_version,
          listAgentIds:
            initial.listAgentIds.bind(
              initial,
            ),
          findExact,
        };
        const service =
          createCapaAgentActivationService(
            registry,
          );

        service.evaluate(intakeRequest());

        expect(findExact).toHaveBeenCalledOnce();
        expect(findExact).toHaveBeenCalledWith(
          "AG-INTAKE",
          "ag-intake-1.0.0",
        );
      },
    );

    it(
      "does not expose model, tool or workflow execution methods",
      () => {
        const service =
          createCapaAgentActivationService();

        expect(service).not.toHaveProperty(
          "invoke",
        );
        expect(service).not.toHaveProperty(
          "executeTool",
        );
        expect(service).not.toHaveProperty(
          "transitionWorkflow",
        );
        expect(service).not.toHaveProperty(
          "approve",
        );
      },
    );
  },
);
