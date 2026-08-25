import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaCaseId,
  CorrelationId,
  IdempotencyKey,
  OrganizationId,
  RequestId,
  RoleId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaAgentEligibilityRequest,
} from "../../lib/capa/ai/capa-agent-contract";

import {
  createCapaAgentActivationService,
} from "../../lib/capa/ai/capa-agent-activation-service";

import type {
  CapaToolDefinition,
  CapaToolExecutionRequest,
} from "../../lib/capa/ai/capa-tool-contract";

import {
  authorizeCapaToolExecution,
  type CapaToolAuthorizationRequest,
} from "../../lib/capa/ai/capa-tool-authorization";

import {
  createInitialCapaToolRegistry,
  type CapaToolRegistry,
} from "../../lib/capa/ai/capa-tool-registry";

const ORGANIZATION_A =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

const ORGANIZATION_B =
  "660e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

function eligibility(
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
    ],
    output_schema_version:
      "capa-intake-draft-output-1.0.0" as never,
    ...overrides,
  };
}

function execution(
  overrides: Partial<
    CapaToolExecutionRequest
  > = {},
): CapaToolExecutionRequest {
  return {
    organization_id: ORGANIZATION_A,
    resource_organization_id:
      ORGANIZATION_A,
    capa_case_id:
      "3d1e7eb7-3e24-4483-b934-1c59ff78cc90" as
        CapaCaseId,
    tool_id: "TOOL-CASE-READ",
    tool_version:
      "tool-case-read-1.0.0" as never,
    agent_id: "AG-INTAKE",
    agent_version:
      "ag-intake-1.0.0" as never,
    workflow_state: "S10",
    operation:
      "draft_intake_analysis",
    input_schema_version:
      "tool-case-read-input-1.0.0" as never,
    expected_output_schema_version:
      "tool-case-read-output-1.0.0" as never,
    input_data_class:
      "authorized_case_data",
    input: {
      include_sections: true,
    },
    request_trace: {
      request_id:
        "098c6760-7c3a-4de2-92fa-cd45f46c2321" as
          RequestId,
      correlation_id:
        "55633f2e-eb6a-4dc6-840f-d4be782f9f23" as
          CorrelationId,
      idempotency_key:
        "tool-request-001" as
          IdempotencyKey,
    },
    ...overrides,
  };
}

function request(
  executionOverrides: Partial<
    CapaToolExecutionRequest
  > = {},
  eligibilityOverrides: Partial<
    CapaAgentEligibilityRequest
  > = {},
): CapaToolAuthorizationRequest {
  return {
    execution_request:
      execution(executionOverrides),
    agent_eligibility_request:
      eligibility(
        eligibilityOverrides,
      ),
  };
}

function registryWithStatus(
  status: CapaToolDefinition["status"],
): CapaToolRegistry {
  const initial =
    createInitialCapaToolRegistry();

  return {
    registry_version:
      initial.registry_version,
    listToolIds() {
      return initial.listToolIds();
    },
    findExact(toolId, version) {
      const item = initial.findExact(
        toolId,
        version,
      );

      return item === null
        ? null
        : {
            ...item,
            status,
          };
    },
  };
}

function registryWithDefinition(
  changes: Partial<CapaToolDefinition>,
): CapaToolRegistry {
  const initial =
    createInitialCapaToolRegistry();

  return {
    registry_version:
      initial.registry_version,
    listToolIds() {
      return initial.listToolIds();
    },
    findExact(toolId, version) {
      const item = initial.findExact(
        toolId,
        version,
      );

      return item === null
        ? null
        : {
            ...item,
            ...changes,
          };
    },
  };
}

function authorize(
  value: CapaToolAuthorizationRequest,
  registry: CapaToolRegistry =
    createInitialCapaToolRegistry(),
) {
  return authorizeCapaToolExecution(
    registry,
    createCapaAgentActivationService(),
    value,
  );
}

describe(
  "governed CAPA tool authorization",
  () => {
    it(
      "authorizes one exact tenant-scoped case read",
      () => {
        const result = authorize(request());

        expect(result).toMatchObject({
          authorized: true,
          reason_code:
            "TOOL_AUTHORIZED",
          tool_definition: {
            tool_id: "TOOL-CASE-READ",
            status: "approved",
          },
          agent_definition: {
            logical_agent_id:
              "AG-INTAKE",
            status: "approved",
          },
        });
        expect(Object.isFrozen(result))
          .toBe(true);
      },
    );

    it(
      "denies an unknown tool identity",
      () => {
        const result = authorize(
          request({
            tool_id:
              "TOOL-FORGED" as never,
          }),
        );

        expect(result.reason_code).toBe(
          "TOOL_NOT_FOUND",
        );
      },
    );

    it(
      "denies a non-exact tool version",
      () => {
        const result = authorize(
          request({
            tool_version:
              "tool-case-read-2.0.0" as never,
          }),
        );

        expect(result.reason_code).toBe(
          "TOOL_VERSION_NOT_APPROVED",
        );
      },
    );

    it.each([
      "draft",
      "evaluation",
    ] as const)(
      "denies a tool in %s status",
      (status) => {
        const result = authorize(
          request(),
          registryWithStatus(status),
        );

        expect(result.reason_code).toBe(
          "TOOL_VERSION_NOT_APPROVED",
        );
      },
    );

    it.each([
      "blocked",
      "retired",
    ] as const)(
      "denies a tool in %s status",
      (status) => {
        const result = authorize(
          request(),
          registryWithStatus(status),
        );

        expect(result.reason_code).toBe(
          "TOOL_BLOCKED_OR_RETIRED",
        );
      },
    );

    it(
      "denies cross-organization resource access before agent evaluation",
      () => {
        const result = authorize(
          request({
            resource_organization_id:
              ORGANIZATION_B,
          }),
        );

        expect(result.reason_code).toBe(
          "TENANT_SCOPE_DENIED",
        );
      },
    );

    it.each([
      {
        name: "agent identity",
        execution: {
          agent_id: "AG-EVID",
        },
      },
      {
        name: "agent version",
        execution: {
          agent_version:
            "ag-intake-2.0.0" as never,
        },
      },
      {
        name: "workflow state",
        execution: {
          workflow_state: "S20",
        },
      },
      {
        name: "operation",
        execution: {
          operation:
            "analyze_evidence",
        },
      },
    ] as const)(
      "denies conflicting $name facts",
      ({ execution: changes }) => {
        const result = authorize(
          request(
            changes as Partial<
              CapaToolExecutionRequest
            >,
          ),
        );

        expect(result.reason_code).toBe(
          "AGENT_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "denies a tool omitted from the agent eligibility request",
      () => {
        const result = authorize(
          request({}, {
            requested_tool_ids: [],
          }),
        );

        expect(result.reason_code).toBe(
          "AGENT_TOOL_NOT_ALLOWED",
        );
      },
    );

    it(
      "denies an ineligible agent role",
      () => {
        const result = authorize(
          request({}, {
            active_role_ids: [
              "CAPA_ORG_ADMIN" as RoleId,
            ],
          }),
        );

        expect(result.reason_code).toBe(
          "AGENT_NOT_ELIGIBLE",
        );
      },
    );

    it(
      "denies an agent-tool mapping absent from the agent definition",
      () => {
        const result = authorize(
          request({
            tool_id: "TOOL-CALCULATE",
            tool_version:
              "tool-calculate-1.0.0" as never,
          }, {
            requested_tool_ids: [
              "TOOL-CALCULATE",
            ],
          }),
          registryWithStatus("approved"),
        );

        expect(result.reason_code).toBe(
          "AGENT_TOOL_NOT_ALLOWED",
        );
      },
    );

    it(
      "denies an inconsistent tool-registry agent mapping after activation",
      () => {
        const result = authorize(
          request(),
          registryWithDefinition({
            allowed_agent_ids: [],
          }),
        );

        expect(result.reason_code).toBe(
          "AGENT_TOOL_NOT_ALLOWED",
        );
        expect(result.authorized).toBe(
          false,
        );
      },
    );

    it.each([
      {
        name: "input schema",
        execution: {
          input_schema_version:
            "tool-case-read-input-2.0.0" as never,
        },
        reason: "INPUT_SCHEMA_MISMATCH",
      },
      {
        name: "output schema",
        execution: {
          expected_output_schema_version:
            "tool-case-read-output-2.0.0" as never,
        },
        reason: "OUTPUT_SCHEMA_MISMATCH",
      },
      {
        name: "input data class",
        execution: {
          input_data_class:
            "authorized_evidence",
        },
        reason:
          "INPUT_DATA_CLASS_NOT_ALLOWED",
      },
    ] as const)(
      "denies a mismatched $name",
      ({ execution: changes, reason }) => {
        const result = authorize(
          request(
            changes as Partial<
              CapaToolExecutionRequest
            >,
          ),
        );

        expect(result.reason_code).toBe(
          reason,
        );
      },
    );

    it.each([
      {
        name: "workflow state",
        changes: {
          allowed_workflow_states: [
            "S20",
          ],
        },
        reason: "TOOL_STATE_NOT_ALLOWED",
      },
      {
        name: "operation",
        changes: {
          allowed_operations: [
            "analyze_evidence",
          ],
        },
        reason:
          "TOOL_OPERATION_NOT_ALLOWED",
      },
      {
        name: "input data class",
        changes: {
          permitted_input_data_classes: [
            "authorized_evidence",
          ],
        },
        reason:
          "INPUT_DATA_CLASS_NOT_ALLOWED",
      },
    ] as const)(
      "enforces the tool-definition $name restriction",
      ({ changes, reason }) => {
        const result = authorize(
          request(),
          registryWithDefinition(
            changes as Partial<
              CapaToolDefinition
            >,
          ),
        );

        expect(result.reason_code).toBe(
          reason,
        );
      },
    );

    it(
      "never returns execution or workflow authority",
      () => {
        const result = authorize(request());

        expect(result).not.toHaveProperty(
          "output",
        );
        expect(result).not.toHaveProperty(
          "executed",
        );
        expect(result).not.toHaveProperty(
          "workflow_transition",
        );
        expect(result).not.toHaveProperty(
          "approved",
        );
      },
    );
  },
);
