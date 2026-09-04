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

function planRequest():
  CapaAgentEligibilityRequest {
  return {
    agent_id: "AG-PLAN",
    agent_version:
      "ag-plan-1.0.0" as never,
    workflow_state: "S30",
    operation:
      "draft_investigation_plan",
    active_role_ids: [
      "CAPA_OWNER" as RoleId,
    ],
    requested_tool_ids: [
      "TOOL-CASE-READ",
      "TOOL-STRUCTURED-DRAFT",
      "TOOL-FEEDBACK",
    ],
    output_schema_version:
      "capa_investigation_plan_draft-1.0.0" as never,
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

        expect(
          createInitialCapaAgentRegistry().findExact(
            "AG-RCA",
            "ag-rca-1.0.0",
          )?.status,
        ).toBe("evaluation");

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

    it("activates the exact approved AG-PLAN S30 request", () => {
      const result = createCapaAgentActivationService().evaluate(
        planRequest(),
      );

      expect(result).toMatchObject({
        eligible: true,
        reason_code: "AGENT_ELIGIBLE",
        definition: {
          logical_agent_id: "AG-PLAN",
          agent_version: "ag-plan-1.0.0",
          status: "approved",
          eligible_states: ["S30"],
          allowed_operations: ["draft_investigation_plan"],
          allowed_requester_roles: ["CAPA_OWNER", "CAPA_CONTRIBUTOR"],
          allowed_tools: [
            "TOOL-CASE-READ",
            "TOOL-STRUCTURED-DRAFT",
            "TOOL-FEEDBACK",
          ],
          output_schema_version: "capa_investigation_plan_draft-1.0.0",
        },
      });
    });

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

    it("activates the exact approved S20 containment capability", () => {
      const result = createCapaAgentActivationService().evaluate({ ...intakeRequest(), workflow_state: "S20", operation: "analyze_containment_impact_risk", requested_tool_ids: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"], output_schema_version: "capa-containment-risk-advisory-1.0.0" as never });
      expect(result).toMatchObject({ eligible: true, reason_code: "AGENT_ELIGIBLE", definition: { logical_agent_id: "AG-INTAKE", agent_version: "ag-intake-1.0.0" } });
    });

    it("rejects S20 intake-operation cross-binding", () => {
      const result = createCapaAgentActivationService().evaluate({ ...intakeRequest(), workflow_state: "S20", operation: "draft_intake_analysis" });
      expect(result.reason_code).toBe("OPERATION_NOT_ELIGIBLE");
    });
  },
);
