import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createActivationBackedCapaIntakeAdvisoryAgentGate,
} from "../../lib/capa/ai/capa-intake-advisory-agent-gate";

import {
  CAPA_INTAKE_ADVISORY_AGENT,
  CAPA_INTAKE_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-intake-advisory-service";

import type {
  CapaAgentActivationService,
} from "../../lib/capa/ai/capa-agent-activation-service";

describe(
  "CAPA intake advisory agent gate",
  () => {
    it(
      "maps trusted advisory context to the controlled activation request",
      () => {
        const evaluate =
          vi.fn().mockReturnValue({
            eligible: true,
            reason_code:
              "AGENT_ELIGIBLE",
            definition: {},
          });

        const activationService = {
          registry_version:
            "capa-agent-registry-1.0.0",
          evaluate,
        } as unknown as
          CapaAgentActivationService;

        const gate =
          createActivationBackedCapaIntakeAdvisoryAgentGate(
            activationService,
          );

        const result =
          gate.evaluate({
            context: {
              organization_id:
                "10000000-0000-4000-8000-000000000001",
              capa_case_id:
                "20000000-0000-4000-8000-000000000001",
              case_version_id:
                "30000000-0000-4000-8000-000000000001",
              record_version: 2,
              workflow_state: "S10",
              user_id:
                "40000000-0000-4000-8000-000000000001",
              active_role_ids: [
                "CAPA_OWNER",
              ],
              minimum_case_context: [],
            } as never,

            agent:
              CAPA_INTAKE_ADVISORY_AGENT,

            operation:
              CAPA_INTAKE_ADVISORY_OPERATION,
          });

        expect(result).toBe(true);

        expect(evaluate)
          .toHaveBeenCalledExactlyOnceWith({
            agent_id: "AG-INTAKE",
            agent_version:
              "ag-intake-1.0.0",
            workflow_state: "S10",
            operation:
              "draft_intake_analysis",
            active_role_ids: [
              "CAPA_OWNER",
            ],
            requested_tool_ids: [
              "TOOL-CASE-READ",
              "TOOL-RETRIEVE",
              "TOOL-STRUCTURED-DRAFT",
            ],
            output_schema_version:
              "capa-intake-draft-output-1.0.0",
          });
      },
    );

    it(
      "fails closed when controlled activation rejects the agent",
      () => {
        const activationService = {
          registry_version:
            "capa-agent-registry-1.0.0",

          evaluate: vi.fn()
            .mockReturnValue({
              eligible: false,
              reason_code:
                "REQUESTER_ROLE_NOT_ELIGIBLE",
            }),
        } as unknown as
          CapaAgentActivationService;

        const gate =
          createActivationBackedCapaIntakeAdvisoryAgentGate(
            activationService,
          );

        expect(
          gate.evaluate({
            context: {
              workflow_state: "S10",
              active_role_ids: [],
            } as never,

            agent:
              CAPA_INTAKE_ADVISORY_AGENT,

            operation:
              CAPA_INTAKE_ADVISORY_OPERATION,
          }),
        ).toBe(false);
      },
    );
  },
);
