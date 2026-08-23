import type postgres from "postgres";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  ControlledCode,
  IdempotencyKey,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  CapaWorkflowRequestFingerprint,
  ClaimCapaWorkflowOperationResult,
} from "../repositories/capa-workflow-idempotency-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

/**
 * Durable transaction-bound CAPA workflow-idempotency adapter.
 *
 * The initial INSERT may wait for a concurrent transaction holding the same
 * organization-local key. If no row is inserted, the following SELECT uses a
 * new READ COMMITTED statement snapshot and resolves the committed binding.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FINGERPRINT_PATTERN =
  /^[0-9a-f]{64}$/;

const CONTROLLED_OPERATION_PATTERN =
  /^[A-Za-z][A-Za-z0-9._:-]*$/;

const MAXIMUM_IDEMPOTENCY_KEY_LENGTH =
  128;

const MAXIMUM_OPERATION_CODE_LENGTH =
  64;

interface WorkflowClaimRow
  extends postgres.Row {
  readonly organization_id: string;
  readonly idempotency_key: string;
  readonly operation_code: string;
  readonly request_fingerprint: string;
  readonly capa_case_id: string;
  readonly source_case_version_id: string;
  readonly resulting_case_version_id: string;
  readonly audit_event_id: string;
}

export class CapaWorkflowIdempotencyError
  extends Error {
  constructor(
    message =
      "The CAPA workflow idempotency claim could not be resolved.",
  ) {
    super(message);
    this.name =
      "CapaWorkflowIdempotencyError";
  }
}

export class CapaWorkflowIdempotencyConfigurationError
  extends CapaWorkflowIdempotencyError {
  constructor(message: string) {
    super(message);
    this.name =
      "CapaWorkflowIdempotencyConfigurationError";
  }
}

function requireUuid(
  value: string,
  fieldName: string,
): void {
  if (!UUID_PATTERN.test(value)) {
    throw new CapaWorkflowIdempotencyConfigurationError(
      `${fieldName} must be a valid UUID.`,
    );
  }
}

function validateRecord(
  record:
    CapaWorkflowIdempotencyRecord,
): void {
  requireUuid(
    record.organization_id,
    "organization_id",
  );
  requireUuid(
    record.capa_case_id,
    "capa_case_id",
  );
  requireUuid(
    record.source_case_version_id,
    "source_case_version_id",
  );
  requireUuid(
    record.resulting_case_version_id,
    "resulting_case_version_id",
  );
  requireUuid(
    record.audit_event_id,
    "audit_event_id",
  );

  if (
    record.idempotency_key.length < 1 ||
    record.idempotency_key.length >
      MAXIMUM_IDEMPOTENCY_KEY_LENGTH ||
    record.idempotency_key !==
      record.idempotency_key.trim()
  ) {
    throw new CapaWorkflowIdempotencyConfigurationError(
      "idempotency_key must contain 1 through 128 characters without surrounding whitespace.",
    );
  }

  if (
    record.operation_code.length < 1 ||
    record.operation_code.length >
      MAXIMUM_OPERATION_CODE_LENGTH ||
    !CONTROLLED_OPERATION_PATTERN.test(
      record.operation_code,
    )
  ) {
    throw new CapaWorkflowIdempotencyConfigurationError(
      "operation_code must be a valid controlled code containing at most 64 characters.",
    );
  }

  if (
    !FINGERPRINT_PATTERN.test(
      record.request_fingerprint,
    )
  ) {
    throw new CapaWorkflowIdempotencyConfigurationError(
      "request_fingerprint must be a lowercase hexadecimal SHA-256 digest.",
    );
  }

  if (
    record.source_case_version_id ===
    record.resulting_case_version_id
  ) {
    throw new CapaWorkflowIdempotencyConfigurationError(
      "source_case_version_id and resulting_case_version_id must be distinct.",
    );
  }
}

function mappedRow(
  value: unknown,
): CapaWorkflowIdempotencyRecord {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new CapaWorkflowIdempotencyError(
      "The CAPA workflow idempotency repository returned an invalid row.",
    );
  }

  const row = value as
    Partial<WorkflowClaimRow>;

  if (
    typeof row.organization_id !==
      "string" ||
    typeof row.idempotency_key !==
      "string" ||
    typeof row.operation_code !==
      "string" ||
    typeof row.request_fingerprint !==
      "string" ||
    typeof row.capa_case_id !==
      "string" ||
    typeof row.source_case_version_id !==
      "string" ||
    typeof row.resulting_case_version_id !==
      "string" ||
    typeof row.audit_event_id !==
      "string"
  ) {
    throw new CapaWorkflowIdempotencyError(
      "The CAPA workflow idempotency repository returned an invalid row.",
    );
  }

  const mapped:
    CapaWorkflowIdempotencyRecord = {
    organization_id:
      row.organization_id as
        OrganizationId,
    idempotency_key:
      row.idempotency_key as
        IdempotencyKey,
    operation_code:
      row.operation_code as
        ControlledCode,
    request_fingerprint:
      row.request_fingerprint as
        CapaWorkflowRequestFingerprint,
    capa_case_id:
      row.capa_case_id as
        CapaCaseId,
    source_case_version_id:
      row.source_case_version_id as
        CapaCaseVersionId,
    resulting_case_version_id:
      row.resulting_case_version_id as
        CapaCaseVersionId,
    audit_event_id:
      row.audit_event_id as
        AuditEventId,
  };

  validateRecord(mapped);
  return mapped;
}

function requireSingleRow(
  rows: readonly unknown[],
): CapaWorkflowIdempotencyRecord {
  if (
    rows.length !== 1 ||
    rows[0] === undefined
  ) {
    throw new CapaWorkflowIdempotencyError(
      "The CAPA workflow idempotency repository returned an unexpected result.",
    );
  }

  return mappedRow(rows[0]);
}

export class SupabaseCapaWorkflowIdempotencyRepository
  implements CapaWorkflowIdempotencyRepository
{
  async claimWorkflowOperation(
    transaction: TransactionContext,
    record:
      CapaWorkflowIdempotencyRecord,
  ): Promise<ClaimCapaWorkflowOperationResult> {
    const sql =
      requireSupabaseTransaction(
        transaction,
      );

    validateRecord(record);

    const insertedRows =
      await sql<WorkflowClaimRow[]>`
        insert into
          public.capa_workflow_idempotency (
            organization_id,
            idempotency_key,
            operation_code,
            request_fingerprint,
            capa_case_id,
            source_case_version_id,
            resulting_case_version_id,
            audit_event_id
          )
        values (
          ${record.organization_id},
          ${record.idempotency_key},
          ${record.operation_code},
          ${record.request_fingerprint},
          ${record.capa_case_id},
          ${record.source_case_version_id},
          ${record.resulting_case_version_id},
          ${record.audit_event_id}
        )
        on conflict (
          organization_id,
          idempotency_key
        )
        do nothing
        returning
          organization_id,
          idempotency_key,
          operation_code,
          request_fingerprint,
          capa_case_id,
          source_case_version_id,
          resulting_case_version_id,
          audit_event_id
      `;

    if (insertedRows.length === 1) {
      return {
        status: "claimed",
        record:
          requireSingleRow(
            insertedRows,
          ),
      };
    }

    if (insertedRows.length !== 0) {
      throw new CapaWorkflowIdempotencyError(
        "The CAPA workflow idempotency repository returned an unexpected result.",
      );
    }

    const existingRows =
      await sql<WorkflowClaimRow[]>`
        select
          organization_id,
          idempotency_key,
          operation_code,
          request_fingerprint,
          capa_case_id,
          source_case_version_id,
          resulting_case_version_id,
          audit_event_id
        from
          public.capa_workflow_idempotency
        where
          organization_id =
            ${record.organization_id}
          and idempotency_key =
            ${record.idempotency_key}
        limit 1
      `;

    const existing =
      requireSingleRow(existingRows);

    if (
      existing.operation_code !==
        record.operation_code ||
      existing.request_fingerprint !==
        record.request_fingerprint
    ) {
      return {
        status: "conflict",
        record: existing,
        reason_code:
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      };
    }

    return {
      status:
        "already_claimed",
      record: existing,
    };
  }
}
