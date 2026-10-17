import { createHash } from "node:crypto";

import type { AuditEvent, AuditEventId, ControlledCode, RequestTrace } from "../capa/domain/capa-types";
import type { AuditRepository } from "../database/repositories/audit-repository";
import type { QualityDataDatasetSnapshot, QualityDataRepository } from "../database/repositories/quality-data-repository";
import type { TransactionContext, TransactionManager } from "../database/transactions";
import type { CapaRequestContext } from "../security/supabase-capa-context";
import { isHumanPrincipal, isSessionActive } from "../security/auth-context";
import type { QualityDataIngestionAuthorizer, QualityDataReadAuthorizer } from "./quality-data-authorization";
import type { QualityDataIngestionCommand, QualityDataIngestionReceipt } from "./quality-data-contract";
import { deriveQualityDataIntegrityOutcomes, QualityDataContractError, validateQualityDataIngestionCommand } from "./quality-data-validator";

export type QualityDataServiceFailure =
  | "INVALID_REQUEST"
  | "NOT_AUTHORIZED"
  | "IDEMPOTENCY_CONFLICT"
  | "SOURCE_CONFLICT"
  | "DATASET_CONFLICT"
  | "PERSISTENCE_FAILED";

export class QualityDataServiceError extends Error {
  constructor(readonly reason_code: QualityDataServiceFailure) {
    super("The quality-data operation could not be completed.");
    this.name = "QualityDataServiceError";
  }
}

export type QualityDataIngestionResult =
  | { readonly status: "accepted" | "already_registered"; readonly receipt: QualityDataIngestionReceipt }
  | { readonly status: "invalid_request"; readonly reason_code: string }
  | { readonly status: "denied"; readonly reason_code: string }
  | { readonly status: "conflict"; readonly reason_code: string };

export interface QualityDataServiceDependencies {
  readonly repository: QualityDataRepository;
  readonly audit_repository: AuditRepository;
  readonly transaction_manager: TransactionManager;
  readonly authorizer: QualityDataIngestionAuthorizer & QualityDataReadAuthorizer;
  readonly ids: { readonly event_id: () => AuditEventId; readonly uuid: () => string };
  readonly clock: { readonly now: () => Date };
}

function isoNow(value: Date): string {
  if (!Number.isFinite(value.getTime())) {
    throw new QualityDataServiceError("PERSISTENCE_FAILED");
  }
  return value.toISOString();
}

function requestFingerprint(command: QualityDataIngestionCommand): string {
  const value = {
    idempotency_key: command.idempotency_key,
    source: {
      ...command.source,
      source_bytes: undefined,
    },
    dataset: command.dataset,
    records: command.records,
  };
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function auditEvent(input: {
  readonly event_id: AuditEventId;
  readonly organization_id: string;
  readonly uploader_user_id: string;
  readonly trace: RequestTrace;
  readonly receipt: QualityDataIngestionReceipt;
  readonly occurred_at: string;
  readonly schema_version: string;
}): AuditEvent {
  return {
    event_id: input.event_id,
    organization_id: input.organization_id as AuditEvent["organization_id"],
    event_type: "QUALITY_DATA_INGESTION_RECORDED" as ControlledCode,
    schema_version: "quality-data-audit-1.0.0",
    aggregate_type: "QUALITY_DATASET" as ControlledCode,
    aggregate_id: input.receipt.dataset_id,
    actor: {
      actor_type: "human",
      actor_id: input.uploader_user_id,
    },
    occurred_at: input.occurred_at as AuditEvent["occurred_at"],
    request_id: input.trace.request_id,
    correlation_id: input.trace.correlation_id,
    ...(input.trace.idempotency_key === undefined ? {} : { idempotency_key: input.trace.idempotency_key }),
    action: "QUALITY_DATA_INGESTED" as ControlledCode,
    target: {
      object_type: "QUALITY_DATASET_VERSION" as ControlledCode,
      object_id: input.receipt.dataset_version_id,
      object_version_id: input.receipt.dataset_version_id,
    },
    outcome: "succeeded",
    configuration_versions: {
      quality_data_contract: "quality-data-foundation-1.0.0",
      dataset_schema: input.schema_version,
    },
    metadata: {
      ingestion_job_id: input.receipt.ingestion_job_id,
      source_id: input.receipt.source_id,
      source_version_id: input.receipt.source_version_id,
      dataset_id: input.receipt.dataset_id,
      dataset_version_id: input.receipt.dataset_version_id,
      record_count: input.receipt.record_count,
      field_count: input.receipt.field_count,
      review_state: "review_required",
      human_evidence_verification: false,
    },
  };
}

async function appendAudit(
  repository: AuditRepository,
  transaction: TransactionContext,
  event: AuditEvent,
): Promise<void> {
  const result = await repository.appendEvent(transaction, event);
  if (result.status === "conflict") {
    throw new QualityDataServiceError("PERSISTENCE_FAILED");
  }
}

/** Authorized metadata and typed-data persistence; it performs no parsing or AI analysis. */
export async function ingestQualityData(
  dependencies: QualityDataServiceDependencies,
  context: CapaRequestContext,
  trace: RequestTrace,
  input: unknown,
): Promise<QualityDataIngestionResult> {
  let now: Date;
  try {
    now = dependencies.clock.now();
  } catch {
    throw new QualityDataServiceError("PERSISTENCE_FAILED");
  }
  if (!Number.isFinite(now.getTime())) {
    throw new QualityDataServiceError("PERSISTENCE_FAILED");
  }

  const authorization = await dependencies.authorizer.authorize(context, now);
  if (!authorization.allowed) {
    return { status: "denied", reason_code: authorization.reason_code };
  }

  let command: QualityDataIngestionCommand;
  try {
    command = validateQualityDataIngestionCommand(input, authorization.organization_id);
  } catch (error) {
    if (error instanceof QualityDataContractError) {
      return { status: "invalid_request", reason_code: error.reason_code };
    }
    return { status: "invalid_request", reason_code: "INVALID_QUALITY_DATA_CONTRACT" };
  }

  if (
    trace.idempotency_key === undefined ||
    trace.idempotency_key !== command.idempotency_key
  ) {
    return { status: "invalid_request", reason_code: "IDEMPOTENCY_KEY_MISMATCH" };
  }

  const occurredAt = isoNow(now);
  try {
    return await dependencies.transaction_manager.runInTransaction(
      trace,
      async (transaction) => {
        const persisted = await dependencies.repository.persistIngestion(transaction, {
          organization_id: authorization.organization_id,
          membership_id: authorization.membership_id,
          uploader_user_id: authorization.uploader_user_id,
          request_id: trace.request_id,
          correlation_id: trace.correlation_id,
          idempotency_key: command.idempotency_key,
          request_fingerprint: requestFingerprint(command),
          command,
          validation_outcomes: deriveQualityDataIntegrityOutcomes(command),
          now: occurredAt,
          create_uuid: dependencies.ids.uuid,
        });

        if (persisted.status === "unauthorized") {
          return { status: "denied", reason_code: "QUALITY_DATA_PERMISSION_DENIED" } as const;
        }
        if (persisted.status === "conflict") {
          const reason_code = persisted.reason_code === "IDEMPOTENCY_KEY_REUSED"
            ? "IDEMPOTENCY_CONFLICT"
            : persisted.reason_code === "SOURCE_IDENTITY_CONFLICT" || persisted.reason_code === "SOURCE_VERSION_CONFLICT"
              ? "SOURCE_CONFLICT"
              : "DATASET_CONFLICT";
          return { status: "conflict", reason_code } as const;
        }
        if (persisted.status === "inserted") {
          const event = auditEvent({
            event_id: dependencies.ids.event_id(),
            organization_id: authorization.organization_id,
            uploader_user_id: authorization.uploader_user_id,
            trace,
            receipt: persisted.receipt,
            occurred_at: occurredAt,
            schema_version: command.dataset.schema_version,
          });
          await appendAudit(dependencies.audit_repository, transaction, event);
        }
        return {
          status: persisted.status === "inserted" ? "accepted" : "already_registered",
          receipt: persisted.receipt,
        } as const;
      },
    );
  } catch (error) {
    if (error instanceof QualityDataServiceError) throw error;
    // Database exception details can contain user-supplied values. Keep only
    // a fixed safe category at this boundary.
    throw new QualityDataServiceError("PERSISTENCE_FAILED");
  }
}

export type QualityDataReadResult =
  | { readonly status: "found"; readonly snapshot: QualityDataDatasetSnapshot }
  | { readonly status: "not_found_or_not_authorized" };

export async function readQualityDatasetVersion(
  dependencies: Pick<QualityDataServiceDependencies, "repository" | "clock" | "authorizer">,
  context: CapaRequestContext,
  datasetVersionId: string,
): Promise<QualityDataReadResult> {
  let now: Date;
  try {
    now = dependencies.clock.now();
  } catch {
    return { status: "not_found_or_not_authorized" };
  }
  if (
    !isHumanPrincipal(context.authentication) ||
    !isSessionActive(context.authentication, now) ||
    context.owner_user_id !== context.authentication.principal.user_id ||
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(datasetVersionId)
  ) {
    return { status: "not_found_or_not_authorized" };
  }

  const authorization = await dependencies.authorizer.authorizeRead(context, now);
  if (!authorization.allowed) {
    return { status: "not_found_or_not_authorized" };
  }

  const snapshot = await dependencies.repository.findDatasetVersion({
    organization_id: authorization.organization_id,
    user_id: authorization.uploader_user_id,
    membership_id: authorization.membership_id,
    now: now.toISOString(),
  }, datasetVersionId);
  return snapshot === null
    ? { status: "not_found_or_not_authorized" }
    : { status: "found", snapshot };
}
