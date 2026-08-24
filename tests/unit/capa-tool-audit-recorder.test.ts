import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type {
  AuditEvent,
  AuditEventId,
  IsoDateTime,
} from "../../lib/capa/domain/capa-types";

import type {
  TransactionContext,
  TransactionManager,
} from "../../lib/database/transactions";

import type {
  AuditRepository,
} from "../../lib/database/repositories/audit-repository";

import {
  RepositoryCapaToolAuditRecorder,
} from "../../lib/capa/ai/capa-tool-audit-recorder";

import type {
  CapaToolAuditRecord,
} from "../../lib/capa/ai/capa-tool-gateway";

const EVENT_ID =
  "bed889a5-8a47-4dd8-bebf-f79f31b795e7" as
    AuditEventId;

const NOW = new Date(
  "2026-08-24T12:15:00.000Z",
);

function record(
  overrides: Partial<CapaToolAuditRecord> = {},
): CapaToolAuditRecord {
  return {
    organization_id:
      "550e8400-e29b-41d4-a716-446655440000",
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
    idempotency_key:
      "tool-read-001",
    status: "succeeded",
    reason_code:
      "TOOL_EXECUTION_SUCCEEDED",
    tool_registry_version:
      "capa-tool-registry-1.0.0",
    agent_registry_version:
      "capa-agent-registry-1.0.0",
    ...overrides,
  };
}

function harness(
  appendResult: {
    readonly status:
      | "appended"
      | "already_recorded"
      | "conflict";
  } = { status: "appended" },
) {
  const transaction = {
    transaction_id: "transaction-1",
    started_at:
      NOW.toISOString() as IsoDateTime,
    request_trace: {} as never,
  } as unknown as
    TransactionContext;
  const runInTransaction = vi.fn(
    async (
      _trace: unknown,
      work: (
        value: TransactionContext,
      ) => Promise<unknown>,
    ) =>
      work(transaction),
  );
  const appendEvent = vi.fn(
    async (
      _transaction: TransactionContext,
      _event: AuditEvent,
    ) => ({
      ...appendResult,
      event_id: EVENT_ID,
      ...(appendResult.status === "conflict"
        ? {
            reason_code:
              "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT" as const,
          }
        : {}),
    }),
  );
  const recorder =
    new RepositoryCapaToolAuditRecorder({
      transaction_manager: {
        runInTransaction,
      } as TransactionManager,
      audit_repository: {
        appendEvent,
      } as unknown as AuditRepository,
      generate_audit_event_id() {
        return EVENT_ID;
      },
      now() {
        return NOW;
      },
      audit_schema_version:
        "audit-schema-1.0.0",
    });

  return {
    recorder,
    runInTransaction,
    appendEvent,
    transaction,
  };
}

describe(
  "repository CAPA tool audit recorder",
  () => {
    it(
      "appends minimized tool metadata inside one transaction",
      async () => {
        const test = harness();

        await test.recorder.record(record());

        expect(test.runInTransaction)
          .toHaveBeenCalledWith(
            {
              request_id:
                "098c6760-7c3a-4de2-92fa-cd45f46c2321",
              correlation_id:
                "55633f2e-eb6a-4dc6-840f-d4be782f9f23",
              idempotency_key:
                "tool-read-001",
            },
            expect.any(Function),
          );
        expect(test.appendEvent)
          .toHaveBeenCalledWith(
            test.transaction,
            expect.objectContaining({
              event_id: EVENT_ID,
              event_type:
                "CAPA_TOOL_EXECUTION",
              aggregate_type:
                "CAPA_CASE",
              aggregate_id:
                "3d1e7eb7-3e24-4483-b934-1c59ff78cc90",
              actor: {
                actor_type: "agent",
                actor_id: "AG-INTAKE",
                actor_version:
                  "ag-intake-1.0.0",
              },
              action:
                "CAPA_TOOL_EXECUTE",
              outcome: "succeeded",
              reason:
                "TOOL_EXECUTION_SUCCEEDED",
              metadata: {
                tool_execution_status:
                  "succeeded",
                tool_execution_reason_code:
                  "TOOL_EXECUTION_SUCCEEDED",
              },
            }),
          );

        const event =
          test.appendEvent.mock.calls[0]?.[1];
        expect(event).not.toHaveProperty(
          "input",
        );
        expect(event).not.toHaveProperty(
          "output",
        );
      },
    );

    it(
      "uses the request as aggregate when no case identity exists",
      async () => {
        const test = harness();

        await test.recorder.record(
          record({
            capa_case_id: undefined,
            idempotency_key: undefined,
          }),
        );

        expect(test.appendEvent)
          .toHaveBeenCalledWith(
            test.transaction,
            expect.objectContaining({
              aggregate_type:
                "CAPA_TOOL_REQUEST",
              aggregate_id:
                "098c6760-7c3a-4de2-92fa-cd45f46c2321",
            }),
          );
      },
    );

    it(
      "accepts an exact idempotent prior audit append",
      async () => {
        const test = harness({
          status: "already_recorded",
        });

        await expect(
          test.recorder.record(record()),
        ).resolves.toBeUndefined();
      },
    );

    it(
      "fails closed for an audit-event identity conflict",
      async () => {
        const test = harness({
          status: "conflict",
        });

        await expect(
          test.recorder.record(record()),
        ).rejects.toThrow(
          "CAPA tool audit-event identity conflict.",
        );
      },
    );
  },
);
