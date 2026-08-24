import type {
  AuditEvent,
  AuditEventId,
  ControlledCode,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";

import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

import type {
  CapaToolAuditRecord,
  CapaToolAuditRecorder,
} from "./capa-tool-gateway";

export interface CapaToolAuditRecorderDependencies {
  readonly transaction_manager:
    TransactionManager;
  readonly audit_repository:
    AuditRepository;
  readonly generate_audit_event_id:
    () => AuditEventId;
  readonly now: () => Date;
  readonly audit_schema_version: string;
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function trace(
  record: CapaToolAuditRecord,
): RequestTrace {
  return {
    request_id:
      record.request_id as never,
    correlation_id:
      record.correlation_id as never,
    ...(record.idempotency_key === undefined
      ? {}
      : {
          idempotency_key:
            record.idempotency_key as never,
        }),
  };
}

/**
 * Persists minimized tool-attempt metadata through the existing append-only
 * audit and transaction boundaries. Tool input and output are excluded.
 */
export class RepositoryCapaToolAuditRecorder
  implements CapaToolAuditRecorder {
  constructor(
    private readonly dependencies:
      CapaToolAuditRecorderDependencies,
  ) {}

  async record(
    record: CapaToolAuditRecord,
  ): Promise<void> {
    const requestTrace = trace(record);
    const eventId =
      this.dependencies
        .generate_audit_event_id();
    const occurredAt =
      this.dependencies.now()
        .toISOString() as IsoDateTime;
    const aggregateId =
      record.capa_case_id ??
      record.request_id;

    await this.dependencies
      .transaction_manager
      .runInTransaction(
        requestTrace,
        async (transaction) => {
          const event: AuditEvent = {
            organization_id:
              record.organization_id as never,
            ...requestTrace,
            event_id: eventId,
            event_type:
              controlled(
                "CAPA_TOOL_EXECUTION",
              ),
            schema_version:
              this.dependencies
                .audit_schema_version,
            aggregate_type:
              controlled(
                record.capa_case_id ===
                  undefined
                  ? "CAPA_TOOL_REQUEST"
                  : "CAPA_CASE",
              ),
            aggregate_id: aggregateId,
            actor: {
              actor_type: "agent",
              actor_id: record.agent_id,
              actor_version:
                record.agent_version,
            },
            occurred_at: occurredAt,
            action:
              controlled(
                "CAPA_TOOL_EXECUTE",
              ),
            target: {
              object_type:
                controlled("CAPA_TOOL"),
              object_id: record.tool_id,
              object_version_id:
                record.tool_version,
            },
            outcome: record.status,
            reason: record.reason_code,
            configuration_versions: {
              tool_version:
                record.tool_version,
              agent_version:
                record.agent_version,
              tool_registry_version:
                record.tool_registry_version,
              agent_registry_version:
                record.agent_registry_version,
              audit_schema_version:
                this.dependencies
                  .audit_schema_version,
            },
            metadata: {
              tool_execution_status:
                record.status,
              tool_execution_reason_code:
                record.reason_code,
            },
          };

          const result =
            await this.dependencies
              .audit_repository
              .appendEvent(
                transaction,
                event,
              );

          if (result.status === "conflict") {
            throw new Error(
              "CAPA tool audit-event identity conflict.",
            );
          }
        },
      );
  }
}
