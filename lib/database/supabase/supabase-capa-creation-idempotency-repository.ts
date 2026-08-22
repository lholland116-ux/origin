import type postgres from "postgres";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CapaSectionVersionId,
  IdempotencyKey,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaCreationIdempotencyRecord,
  CapaCreationIdempotencyRepository,
  CapaCreationRequestFingerprint,
  ClaimCapaCreationResult,
} from "../repositories/capa-creation-idempotency-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

/**
 * Durable transaction-bound CAPA creation-idempotency adapter.
 *
 * A newly inserted claim reserves the generated record identities before
 * case-number allocation. A conflicting INSERT may wait for another
 * transaction. When it returns no row, the subsequent SELECT receives a new
 * READ COMMITTED statement snapshot and resolves the committed authoritative
 * binding.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const FINGERPRINT_PATTERN =
  /^[0-9a-f]{64}$/;

const MAXIMUM_IDEMPOTENCY_KEY_LENGTH =
  128;

interface CreationClaimRow
  extends postgres.Row {
  readonly organization_id: string;
  readonly idempotency_key: string;
  readonly request_fingerprint: string;
  readonly capa_case_id: string;
  readonly case_version_id: string;
  readonly section_version_id: string;
  readonly audit_event_id: string;
}

export class CapaCreationIdempotencyError
  extends Error {
  constructor(
    message =
      "The CAPA creation idempotency claim could not be resolved.",
  ) {
    super(message);
    this.name =
      "CapaCreationIdempotencyError";
  }
}

export class CapaCreationIdempotencyConfigurationError
  extends CapaCreationIdempotencyError {
  constructor(message: string) {
    super(message);
    this.name =
      "CapaCreationIdempotencyConfigurationError";
  }
}

function requireUuid(
  value: string,
  fieldName: string,
): void {
  if (!UUID_PATTERN.test(value)) {
    throw new CapaCreationIdempotencyConfigurationError(
      `${fieldName} must be a valid UUID.`,
    );
  }
}

function validateRecord(
  record:
    CapaCreationIdempotencyRecord,
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
    record.case_version_id,
    "case_version_id",
  );
  requireUuid(
    record.section_version_id,
    "section_version_id",
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
    throw new CapaCreationIdempotencyConfigurationError(
      "idempotency_key must contain 1 through 128 characters without surrounding whitespace.",
    );
  }

  if (
    !FINGERPRINT_PATTERN.test(
      record.request_fingerprint,
    )
  ) {
    throw new CapaCreationIdempotencyConfigurationError(
      "request_fingerprint must be a lowercase hexadecimal SHA-256 digest.",
    );
  }
}

function mappedRow(
  value: unknown,
): CapaCreationIdempotencyRecord {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new CapaCreationIdempotencyError(
      "The CAPA creation idempotency repository returned an invalid row.",
    );
  }

  const row = value as
    Partial<CreationClaimRow>;

  if (
    typeof row.organization_id !==
      "string" ||
    typeof row.idempotency_key !==
      "string" ||
    typeof row.request_fingerprint !==
      "string" ||
    typeof row.capa_case_id !==
      "string" ||
    typeof row.case_version_id !==
      "string" ||
    typeof row.section_version_id !==
      "string" ||
    typeof row.audit_event_id !==
      "string"
  ) {
    throw new CapaCreationIdempotencyError(
      "The CAPA creation idempotency repository returned an invalid row.",
    );
  }

  const mapped: CapaCreationIdempotencyRecord = {
    organization_id:
      row.organization_id as OrganizationId,
    idempotency_key:
      row.idempotency_key as IdempotencyKey,
    request_fingerprint:
      row.request_fingerprint as
        CapaCreationRequestFingerprint,
    capa_case_id:
      row.capa_case_id as CapaCaseId,
    case_version_id:
      row.case_version_id as
        CapaCaseVersionId,
    section_version_id:
      row.section_version_id as
        CapaSectionVersionId,
    audit_event_id:
      row.audit_event_id as AuditEventId,
  };

  validateRecord(mapped);
  return mapped;
}

function requireSingleRow(
  rows: readonly unknown[],
): CapaCreationIdempotencyRecord {
  if (
    rows.length !== 1 ||
    rows[0] === undefined
  ) {
    throw new CapaCreationIdempotencyError(
      "The CAPA creation idempotency repository returned an unexpected result.",
    );
  }

  return mappedRow(rows[0]);
}

export class SupabaseCapaCreationIdempotencyRepository
  implements CapaCreationIdempotencyRepository
{
  async claimCreation(
    transaction: TransactionContext,
    record:
      CapaCreationIdempotencyRecord,
  ): Promise<ClaimCapaCreationResult> {
    const sql =
      requireSupabaseTransaction(
        transaction,
      );

    validateRecord(record);

    const insertedRows =
      await sql<CreationClaimRow[]>`
        insert into
          public.capa_creation_idempotency (
            organization_id,
            idempotency_key,
            request_fingerprint,
            capa_case_id,
            case_version_id,
            section_version_id,
            audit_event_id
          )
        values (
          ${record.organization_id},
          ${record.idempotency_key},
          ${record.request_fingerprint},
          ${record.capa_case_id},
          ${record.case_version_id},
          ${record.section_version_id},
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
          request_fingerprint,
          capa_case_id,
          case_version_id,
          section_version_id,
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
      throw new CapaCreationIdempotencyError(
        "The CAPA creation idempotency repository returned an unexpected result.",
      );
    }

    const existingRows =
      await sql<CreationClaimRow[]>`
        select
          organization_id,
          idempotency_key,
          request_fingerprint,
          capa_case_id,
          case_version_id,
          section_version_id,
          audit_event_id
        from
          public.capa_creation_idempotency
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
      status: "already_claimed",
      record: existing,
    };
  }
}