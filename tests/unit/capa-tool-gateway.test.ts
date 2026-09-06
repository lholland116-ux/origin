import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  CapaCaseId,
  CorrelationId,
  OrganizationId,
  RequestId,
  RoleId,
} from "../../lib/capa/domain/capa-types";

import {
  createCapaAgentActivationService,
} from "../../lib/capa/ai/capa-agent-activation-service";

import type {
  CapaToolAdapter,
} from "../../lib/capa/ai/capa-tool-contract";

import type {
  CapaToolAuthorizationRequest,
} from "../../lib/capa/ai/capa-tool-authorization";

import {
  createCapaToolGateway,
  type CapaToolGatewayDependencies,
} from "../../lib/capa/ai/capa-tool-gateway";

import {
  createInitialCapaToolRegistry,
} from "../../lib/capa/ai/capa-tool-registry";

const ORGANIZATION =
  "550e8400-e29b-41d4-a716-446655440000" as
    OrganizationId;

function request():
  CapaToolAuthorizationRequest {
  return {
    execution_request: {
      organization_id: ORGANIZATION,
      resource_organization_id:
        ORGANIZATION,
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
      },
    },
    agent_eligibility_request: {
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
    },
  };
}

function adapter(
  execute = vi.fn(async () => ({
    capa_case_id:
      "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
  })),
): CapaToolAdapter {
  return {
    tool_id: "TOOL-CASE-READ",
    tool_version:
      "tool-case-read-1.0.0" as never,
    execute,
  };
}

function harness(
  overrides: Partial<
    CapaToolGatewayDependencies
  > = {},
) {
  const controlledAdapter = adapter();
  const audit = vi.fn(async () => {});
  const dependencies:
    CapaToolGatewayDependencies = {
      tool_registry:
        createInitialCapaToolRegistry(),
      agent_activation_service:
        createCapaAgentActivationService(),
      adapter_registry: {
        findExact() {
          return controlledAdapter;
        },
      },
      payload_validator: {
        validateInput() {
          return true;
        },
        validateOutput() {
          return true;
        },
      },
      audit_recorder: {
        record: audit,
      },
      ...overrides,
    };

  return {
    gateway:
      createCapaToolGateway(
        dependencies,
      ),
    adapter: controlledAdapter,
    audit,
  };
}

describe(
  "governed CAPA tool gateway",
  () => {
    it(
      "executes, validates, audits and releases an authorized output",
      async () => {
        const test = harness();

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result).toMatchObject({
          status: "succeeded",
          reason_code:
            "TOOL_EXECUTION_SUCCEEDED",
          output: {
            capa_case_id:
              "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
          },
          receipt: {
            tool_id: "TOOL-CASE-READ",
            tool_version:
              "tool-case-read-1.0.0",
            agent_id: "AG-INTAKE",
            organization_id:
              ORGANIZATION,
            output_data_class:
              "authorized_case_data",
            audit_required: true,
          },
        });
        expect(test.adapter.execute)
          .toHaveBeenCalledOnce();
        expect(test.audit)
          .toHaveBeenCalledOnce();
        expect(Object.isFrozen(result))
          .toBe(true);
        if (result.status === "succeeded") {
          expect(Object.isFrozen(result.output))
            .toBe(true);
          expect(Object.isFrozen(result.receipt))
            .toBe(true);
        }
      },
    );

    it(
      "denies before resolving or executing an adapter",
      async () => {
        const findExact = vi.fn();
        const test = harness({
          adapter_registry: {
            findExact,
          },
        });
        const original = request();
        const denied = {
          ...original,
          execution_request: {
            ...original.execution_request,
            resource_organization_id:
              "660e8400-e29b-41d4-a716-446655440000" as
                OrganizationId,
          },
        };

        const result =
          await test.gateway.execute(denied);

        expect(result).toEqual({
          status: "denied",
          reason_code:
            "TENANT_SCOPE_DENIED",
        });
        expect(findExact)
          .not.toHaveBeenCalled();
        expect(test.audit)
          .toHaveBeenCalledOnce();
      },
    );

    it(
      "returns blocked when the controlled tool lifecycle blocks execution",
      async () => {
        const initialRegistry =
          createInitialCapaToolRegistry();
        const test = harness({
          tool_registry: {
            registry_version:
              initialRegistry.registry_version,
            listToolIds() {
              return initialRegistry
                .listToolIds();
            },
            findExact(toolId, version) {
              const definition =
                initialRegistry.findExact(
                  toolId,
                  version,
                );

              return definition === null
                ? null
                : {
                    ...definition,
                    status:
                      "blocked" as const,
                  };
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result).toEqual({
          status: "blocked",
          reason_code:
            "TOOL_BLOCKED_OR_RETIRED",
        });
        expect(test.adapter.execute)
          .not.toHaveBeenCalled();
        expect(test.audit)
          .toHaveBeenCalledOnce();
      },
    );

    it(
      "blocks invalid input before adapter resolution",
      async () => {
        const findExact = vi.fn();
        const test = harness({
          adapter_registry: {
            findExact,
          },
          payload_validator: {
            validateInput() {
              return false;
            },
            validateOutput() {
              return true;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "INPUT_VALIDATION_FAILED",
        );
        expect(result.status).toBe("blocked");
        expect(findExact)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "fails closed when input validation throws",
      async () => {
        const test = harness({
          payload_validator: {
            validateInput() {
              throw new Error("validator failure");
            },
            validateOutput() {
              return true;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "INPUT_VALIDATION_FAILED",
        );
      },
    );

    it(
      "fails when the exact adapter is unavailable",
      async () => {
        const test = harness({
          adapter_registry: {
            findExact() {
              return null;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "EXECUTION_FAILED",
        );
      },
    );

    it(
      "rejects an adapter tool-identity mismatch",
      async () => {
        const mismatched = {
          ...adapter(),
          tool_id:
            "TOOL-RETRIEVE" as const,
        };
        const test = harness({
          adapter_registry: {
            findExact() {
              return mismatched;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "EXECUTION_FAILED",
        );
        expect(mismatched.execute)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "rejects an adapter identity mismatch",
      async () => {
        const mismatched = {
          ...adapter(),
          tool_version:
            "tool-case-read-2.0.0" as never,
        };
        const test = harness({
          adapter_registry: {
            findExact() {
              return mismatched;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "EXECUTION_FAILED",
        );
        expect(mismatched.execute)
          .not.toHaveBeenCalled();
      },
    );

    it(
      "returns a controlled timeout for an adapter that does not settle",
      async () => {
        const initial =
          createInitialCapaToolRegistry();
        const shortRegistry = {
          registry_version:
            initial.registry_version,
          listToolIds:
            initial.listToolIds.bind(initial),
          findExact(toolId, version) {
            const item = initial.findExact(
              toolId,
              version,
            );
            return item === null
              ? null
              : {
                  ...item,
                  maximum_execution_ms: 1,
                };
          },
        } satisfies CapaToolGatewayDependencies[
          "tool_registry"
        ];
        const pending:
          CapaToolAdapter = {
            tool_id:
              "TOOL-CASE-READ",
            tool_version:
              "tool-case-read-1.0.0" as never,
            execute: vi.fn(
              () => new Promise<
                Readonly<
                  Record<string, unknown>
                >
              >(() => {}),
            ),
          };
        const test = harness({
          tool_registry: shortRegistry,
          adapter_registry: {
            findExact() {
              return pending;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result).toEqual({
          status: "failed",
          reason_code:
            "EXECUTION_TIMEOUT",
        });
      },
    );

    it(
      "converts a synchronous adapter exception into a controlled failure",
      async () => {
        const synchronous:
          CapaToolAdapter = {
            tool_id:
              "TOOL-CASE-READ",
            tool_version:
              "tool-case-read-1.0.0" as never,
            execute: vi.fn(() => {
              throw new Error(
                "synchronous failure",
              );
            }),
          };
        const test = harness({
          adapter_registry: {
            findExact() {
              return synchronous;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "EXECUTION_FAILED",
        );
      },
    );

    it(
      "converts an adapter exception into a controlled failure",
      async () => {
        const failing = adapter(
          vi.fn(async () => {
            throw new Error("sensitive failure");
          }),
        );
        const test = harness({
          adapter_registry: {
            findExact() {
              return failing;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result).toEqual({
          status: "failed",
          reason_code:
            "EXECUTION_FAILED",
        });
        expect(JSON.stringify(result))
          .not.toContain("sensitive failure");
      },
    );

    it(
      "rejects invalid output before release",
      async () => {
        const test = harness({
          payload_validator: {
            validateInput() {
              return true;
            },
            validateOutput() {
              return false;
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result).toEqual({
          status: "failed",
          reason_code:
            "OUTPUT_VALIDATION_FAILED",
        });
        expect(result).not.toHaveProperty(
          "output",
        );
      },
    );

    it(
      "fails closed when output validation throws",
      async () => {
        const test = harness({
          payload_validator: {
            validateInput() {
              return true;
            },
            validateOutput() {
              throw new Error("validator failure");
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result.reason_code).toBe(
          "OUTPUT_VALIDATION_FAILED",
        );
      },
    );

    it(
      "does not release successful output when audit recording fails",
      async () => {
        const test = harness({
          audit_recorder: {
            async record() {
              throw new Error("audit unavailable");
            },
          },
        });

        const result =
          await test.gateway.execute(
            request(),
          );

        expect(result).toEqual({
          status: "failed",
          reason_code:
            "EXECUTION_FAILED",
        });
        expect(result).not.toHaveProperty(
          "output",
        );
      },
    );

    it(
      "records optional idempotency metadata without a case identity",
      async () => {
        const test = harness();
        const original = request();
        const withoutCase = {
          ...original,
          execution_request: {
            ...original.execution_request,
            capa_case_id: undefined,
            request_trace: {
              ...original.execution_request
                .request_trace,
              idempotency_key:
                "tool-idempotency-001" as never,
            },
          },
        };

        await test.gateway.execute(
          withoutCase,
        );

        expect(test.audit)
          .toHaveBeenCalledWith(
            expect.objectContaining({
              idempotency_key:
                "tool-idempotency-001",
            }),
          );
        expect(test.audit)
          .toHaveBeenCalledWith(
            expect.not.objectContaining({
              capa_case_id:
                expect.anything(),
            }),
          );
      },
    );

    it(
      "records minimized trace and registry metadata",
      async () => {
        const test = harness();

        await test.gateway.execute(request());

        expect(test.audit)
          .toHaveBeenCalledWith({
            organization_id: ORGANIZATION,
            capa_case_id:
              "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
            tool_id: "TOOL-CASE-READ",
            tool_version:
              "tool-case-read-1.0.0",
            agent_id: "AG-INTAKE",
            agent_version:
              "ag-intake-1.0.0",
            request_id:
              "098c6760-7c3a-4de2-92fa-cd45f46c2321",
            correlation_id:
              "55633f2e-eb6a-4dc6-840f-d4be782f9f23",
            status: "succeeded",
            reason_code:
              "TOOL_EXECUTION_SUCCEEDED",
            tool_registry_version:
              "capa-tool-registry-1.0.0",
            agent_registry_version:
              "capa-agent-registry-1.2.0",
          });
      },
    );

    it(
      "exposes no direct workflow or approval methods",
      () => {
        const test = harness();

        expect(test.gateway)
          .not.toHaveProperty(
            "transitionWorkflow",
          );
        expect(test.gateway)
          .not.toHaveProperty("approve");
        expect(test.gateway)
          .not.toHaveProperty("closeCase");
      },
    );
  },
);
