import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  RoleId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaAgentDefinition,
  CapaAgentEligibilityRequest,
} from "../../lib/capa/ai/capa-agent-contract";

import {
  evaluateCapaAgentEligibility,
} from "../../lib/capa/ai/capa-agent-eligibility";

import {
  createInitialCapaAgentRegistry,
  type CapaAgentRegistry,
} from "../../lib/capa/ai/capa-agent-registry";

function request(
  overrides: Partial<
    CapaAgentEligibilityRequest
  > = {},
): CapaAgentEligibilityRequest {
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
    ...overrides,
  };
}

function registryWithStatus(
  status: CapaAgentDefinition["status"],
): CapaAgentRegistry {
  const original =
    createInitialCapaAgentRegistry();

  return {
    registry_version:
      original.registry_version,
    listAgentIds() {
      return original.listAgentIds();
    },
    findExact(agentId, version) {
      const definition =
        original.findExact(
          agentId,
          version,
        );

      return definition === null
        ? null
        : {
            ...definition,
            status,
          };
    },
  };
}

describe(
  "CAPA agent eligibility evaluation",
  () => {
    it(
      "allows the exact approved intake agent for an eligible request",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request(),
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
        expect(Object.isFrozen(result))
          .toBe(true);
      },
    );

    it(
      "denies an unknown logical agent before version evaluation",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              agent_id:
                "AG-FORGED" as never,
            }),
          );

        expect(result).toEqual({
          eligible: false,
          reason_code:
            "AGENT_NOT_FOUND",
        });
      },
    );

    it(
      "denies an unapproved exact version",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              agent_version:
                "ag-intake-2.0.0" as never,
            }),
          );

        expect(result.reason_code).toBe(
          "AGENT_VERSION_NOT_APPROVED",
        );
      },
    );

    it.each([
      "draft",
      "evaluation",
    ] as const)(
      "denies an agent in %s lifecycle status",
      (status) => {
        const result =
          evaluateCapaAgentEligibility(
            registryWithStatus(status),
            request(),
          );

        expect(result.reason_code).toBe(
          "AGENT_VERSION_NOT_APPROVED",
        );
      },
    );

    it.each([
      "blocked",
      "retired",
    ] as const)(
      "denies an agent in %s lifecycle status",
      (status) => {
        const result =
          evaluateCapaAgentEligibility(
            registryWithStatus(status),
            request(),
          );

        expect(result.reason_code).toBe(
          "AGENT_BLOCKED_OR_RETIRED",
        );
      },
    );

    it(
      "denies an ineligible workflow state",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              workflow_state: "S30",
            }),
          );

        expect(result.reason_code).toBe(
          "WORKFLOW_STATE_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "denies an unsupported operation",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              operation:
                "analyze_evidence",
            }),
          );

        expect(result.reason_code).toBe(
          "OPERATION_NOT_ELIGIBLE",
        );
      },
    );

    it.each([
      {
        name: "no active roles",
        roles: [] as readonly RoleId[],
      },
      {
        name: "organization administrator",
        roles: [
          "CAPA_ORG_ADMIN" as RoleId,
        ],
      },
      {
        name: "auditor",
        roles: [
          "CAPA_AUDITOR" as RoleId,
        ],
      },
    ])(
      "denies $name requester authority",
      ({ roles }) => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              active_role_ids: roles,
            }),
          );

        expect(result.reason_code).toBe(
          "REQUESTER_ROLE_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "fails closed for malformed active-role data",
      () => {
        const malformed = {
          ...request(),
          active_role_ids: undefined,
        } as unknown as
          CapaAgentEligibilityRequest;

        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            malformed,
          );

        expect(result.reason_code).toBe(
          "REQUESTER_ROLE_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "accepts any one eligible active requester role",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              active_role_ids: [
                "CAPA_AUDITOR" as RoleId,
                "CAPA_CONTRIBUTOR" as RoleId,
              ],
            }),
          );

        expect(result.reason_code).toBe(
          "AGENT_ELIGIBLE",
        );
      },
    );

    it(
      "denies the whole request when one requested tool is not allowed",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              requested_tool_ids: [
                "TOOL-CASE-READ",
                "TOOL-CALCULATE",
              ],
            }),
          );

        expect(result.reason_code).toBe(
          "TOOL_NOT_ALLOWED",
        );
      },
    );

    it(
      "permits an eligible request with no tools",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              requested_tool_ids: [],
            }),
          );

        expect(result.reason_code).toBe(
          "AGENT_ELIGIBLE",
        );
      },
    );

    it(
      "denies an output schema mismatch",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request({
              output_schema_version:
                "capa_intake_draft-2.0.0" as never,
            }),
          );

        expect(result.reason_code).toBe(
          "OUTPUT_SCHEMA_MISMATCH",
        );
      },
    );

    it(
      "evaluates lifecycle before workflow state",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            registryWithStatus("blocked"),
            request({
              workflow_state: "S30",
            }),
          );

        expect(result.reason_code).toBe(
          "AGENT_BLOCKED_OR_RETIRED",
        );
      },
    );

    it(
      "never returns execution or workflow authority",
      () => {
        const result =
          evaluateCapaAgentEligibility(
            createInitialCapaAgentRegistry(),
            request(),
          );

        expect(result).not.toHaveProperty(
          "executed",
        );
        expect(result).not.toHaveProperty(
          "authorized_workflow_action",
        );
        expect(result).not.toHaveProperty(
          "approved",
        );
      },
    );

    it("allows the bound S20 containment/risk capability for owner and contributor", () => {
      for (const role of ["CAPA_OWNER", "CAPA_CONTRIBUTOR"] as const) {
        const result = evaluateCapaAgentEligibility(createInitialCapaAgentRegistry(), request({ workflow_state: "S20", operation: "analyze_containment_impact_risk", active_role_ids: [role as RoleId], requested_tool_ids: ["TOOL-CASE-READ", "TOOL-STRUCTURED-DRAFT"], output_schema_version: "capa-containment-risk-advisory-1.0.0" as never }));
        expect(result.reason_code).toBe("AGENT_ELIGIBLE");
      }
    });

    it.each([
      ["S10 with S20 operation", { workflow_state: "S10", operation: "analyze_containment_impact_risk", output_schema_version: "capa-containment-risk-advisory-1.0.0" as never }],
      ["S20 with intake operation", { workflow_state: "S20", operation: "draft_intake_analysis" }],
      ["S20 with intake schema", { workflow_state: "S20", operation: "analyze_containment_impact_risk", output_schema_version: "capa-intake-draft-output-1.0.0" as never }],
      ["S10 with S20 schema", { workflow_state: "S10", output_schema_version: "capa-containment-risk-advisory-1.0.0" as never }],
      ["S20 retrieve tool", { workflow_state: "S20", operation: "analyze_containment_impact_risk", requested_tool_ids: ["TOOL-RETRIEVE"] }],
      ["S20 feedback tool", { workflow_state: "S20", operation: "analyze_containment_impact_risk", requested_tool_ids: ["TOOL-FEEDBACK"] }],
    ] as const)("denies capability cross-binding: %s", (_name, overrides) => {
      const result = evaluateCapaAgentEligibility(createInitialCapaAgentRegistry(), request(overrides));
      expect(result.reason_code).toMatch(/OPERATION_NOT_ELIGIBLE|OUTPUT_SCHEMA_MISMATCH|TOOL_NOT_ALLOWED/);
    });
  },
);
