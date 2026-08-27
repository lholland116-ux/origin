import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import type postgres from "postgres";

import type {
  AuditEventId,
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
} from "../../capa/domain/capa-types";

import type {
  CapaIntakeAdvisoryProposal,
  CapaIntakeAdvisoryResponse,
} from "../../capa/ai/capa-intake-advisory-contract";

import type {
  CapaAiOutputReviewId,
  CapaAiOutputReviewRecord,
} from "../../capa/ai/capa-ai-output-review-contract";

import {
  constructCapaAiOutputReview,
} from "../../capa/ai/capa-ai-output-review-validator";

import type {
  AppendCapaAiOutputReviewResult,
  CapaAiOutputReviewPersistenceInput,
  CapaAiOutputReviewRepository,
  CapaAiOutputReviewRequestFingerprint,
  CapaAiOutputReviewRecordFingerprint,
  PersistedCapaAiOutputReview,
} from "../repositories/capa-ai-output-review-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

type Row =
  postgres.Row &
  Readonly<Record<string, unknown>>;

type QuerySql =
  postgres.Sql |
  postgres.TransactionSql;

const SHA256_PATTERN =
  /^[0-9a-f]{64}$/;

export class SupabaseCapaAiOutputReviewRepositoryError
  extends Error {
  constructor(
    message =
      "The governed CAPA AI-output human review repository operation failed.",
  ) {
    super(message);
    this.name =
      "SupabaseCapaAiOutputReviewRepositoryError";
  }
}

function fail(): never {
  throw new SupabaseCapaAiOutputReviewRepositoryError();
}

function requiredString(
  value: unknown,
): string {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    fail();
  }

  return value;
}

function nullableString(
  value: unknown,
): string | null {
  if (value === null) {
    return null;
  }

  return requiredString(value);
}

function positiveSafeInteger(
  value: unknown,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : (
          typeof value === "string" &&
          /^[1-9][0-9]*$/.test(value)
        )
        ? Number(value)
        : Number.NaN;

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1
  ) {
    fail();
  }

  return parsed;
}

function iso(
  value: unknown,
): IsoDateTime {
  const date =
    value instanceof Date
      ? value
      : (
          typeof value === "string"
            ? new Date(value)
            : new Date(Number.NaN)
        );

  if (Number.isNaN(date.getTime())) {
    fail();
  }

  return date.toISOString() as IsoDateTime;
}

function jsonObject(
  value: unknown,
): Readonly<Record<string, unknown>> {
  if (
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    fail();
  }

  return value as
    Readonly<Record<string, unknown>>;
}

function databaseJson(
  value: unknown,
): postgres.JSONValue {
  const serialized =
    JSON.stringify(value);

  if (serialized === undefined) {
    fail();
  }

  return JSON.parse(
    serialized,
  ) as postgres.JSONValue;
}

function sha256(
  value: unknown,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify(value),
      "utf8",
    )
    .digest("hex");
}

function requireDigest(
  value: unknown,
): string {
  const digest =
    requiredString(value);

  if (!SHA256_PATTERN.test(digest)) {
    fail();
  }

  return digest;
}

function reviewFromRow(
  row: Row,
): PersistedCapaAiOutputReview {
  const actorType =
    requiredString(
      row.reviewed_by_actor_type,
    );

  if (actorType !== "human") {
    fail();
  }

  const actorVersion =
    nullableString(
      row.reviewed_by_actor_version,
    );

  const humanRevision =
    row.human_revision === null
      ? null
      : row.human_revision as
          CapaIntakeAdvisoryProposal;

  const reconstructed =
    constructCapaAiOutputReview({
      review_id:
        requiredString(
          row.review_id,
        ) as CapaAiOutputReviewId,

      organization_id:
        requiredString(
          row.organization_id,
        ) as OrganizationId,

      output_id:
        requiredString(
          row.output_id,
        ) as
          CapaIntakeAdvisoryResponse["output_id"],

      capa_case_id:
        requiredString(
          row.capa_case_id,
        ) as CapaCaseId,

      case_version_id:
        requiredString(
          row.case_version_id,
        ) as CapaCaseVersionId,

      record_version:
        positiveSafeInteger(
          row.record_version,
        ),

      decision:
        requiredString(
          row.decision,
        ) as
          CapaAiOutputReviewRecord["decision"],

      rationale:
        nullableString(
          row.rationale,
        ),

      human_revision:
        humanRevision,

      reviewed_at:
        iso(row.reviewed_at),

      reviewed_by: {
        actor_type: "human",
        actor_id:
          requiredString(
            row.reviewed_by_actor_id,
          ),
        ...(actorVersion === null
          ? {}
          : {
              actor_version:
                actorVersion,
            }),
      },

      review_policy_version:
        requiredString(
          row.review_policy_version,
        ) as
          CapaAiOutputReviewRecord[
            "review_policy_version"
          ],

      request_id:
        requiredString(
          row.request_id,
        ) as RequestId,

      correlation_id:
        requiredString(
          row.correlation_id,
        ) as CorrelationId,

      idempotency_key:
        requiredString(
          row.idempotency_key,
        ) as IdempotencyKey,
    });

  if (
    row.workflow_mutated !== false ||
    row.controlled_record_mutated !==
      false ||
    row.gate_approved !== false
  ) {
    fail();
  }

  const storedRecord =
    jsonObject(
      row.review_record,
    );

  if (
    !isDeepStrictEqual(
      storedRecord,
      reconstructed,
    )
  ) {
    fail();
  }

  const requestFingerprint =
    requireDigest(
      row.request_fingerprint,
    ) as CapaAiOutputReviewRequestFingerprint;

  const recordFingerprint =
    requireDigest(
      row.record_fingerprint,
    ) as CapaAiOutputReviewRecordFingerprint;

  if (
    requiredString(
      row.record_fingerprint_algorithm,
    ) !== "sha256"
  ) {
    fail();
  }

  return Object.freeze({
    review: reconstructed,
    request_fingerprint:
      requestFingerprint,
    audit_event_id:
      requiredString(
        row.audit_event_id,
      ) as AuditEventId,
    record_fingerprint:
      recordFingerprint,
  });
}

async function findByReviewId(
  sql: QuerySql,
  organizationId:
    OrganizationId,
  reviewId:
    CapaAiOutputReviewId,
): Promise<PersistedCapaAiOutputReview | null> {
  const rows =
    await sql<Row[]>`
      select *
      from public.capa_ai_output_reviews
      where organization_id =
          ${organizationId}
        and review_id =
          ${reviewId}
      limit 2
    `;

  if (rows.length > 1) {
    fail();
  }

  return rows[0] === undefined
    ? null
    : reviewFromRow(rows[0]);
}

async function findByIdempotencyKey(
  sql: QuerySql,
  organizationId:
    OrganizationId,
  idempotencyKey:
    IdempotencyKey,
): Promise<PersistedCapaAiOutputReview | null> {
  const rows =
    await sql<Row[]>`
      select *
      from public.capa_ai_output_reviews
      where organization_id =
          ${organizationId}
        and idempotency_key =
          ${idempotencyKey}
      limit 2
    `;

  if (rows.length > 1) {
    fail();
  }

  return rows[0] === undefined
    ? null
    : reviewFromRow(rows[0]);
}

async function findByAuditEventId(
  sql: QuerySql,
  organizationId:
    OrganizationId,
  auditEventId:
    AuditEventId,
): Promise<PersistedCapaAiOutputReview | null> {
  const rows =
    await sql<Row[]>`
      select *
      from public.capa_ai_output_reviews
      where organization_id =
          ${organizationId}
        and audit_event_id =
          ${auditEventId}
      limit 2
    `;

  if (rows.length > 1) {
    fail();
  }

  return rows[0] === undefined
    ? null
    : reviewFromRow(rows[0]);
}

async function resolveExistingConflict(
  sql: QuerySql,
  input:
    CapaAiOutputReviewPersistenceInput,
): Promise<
  Exclude<
    AppendCapaAiOutputReviewResult,
    {
      readonly status:
        | "saved"
        | "case_changed"
        | "output_not_found_or_not_authorized"
        | "output_not_reviewable";
    }
  > | null
> {
  const byIdempotency =
    await findByIdempotencyKey(
      sql,
      input.review.organization_id,
      input.review.idempotency_key,
    );

  if (byIdempotency !== null) {
    if (
      byIdempotency
        .request_fingerprint ===
      input.request_fingerprint
    ) {
      return {
        status: "already_recorded",
        record:
          byIdempotency,
      };
    }

    return {
      status: "conflict",
      reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      record:
        byIdempotency,
    };
  }

  const byReviewId =
    await findByReviewId(
      sql,
      input.review.organization_id,
      input.review.review_id,
    );

  if (byReviewId !== null) {
    return {
      status: "conflict",
      reason_code:
        "REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
      record:
        byReviewId,
    };
  }

  const byAuditEventId =
    await findByAuditEventId(
      sql,
      input.review.organization_id,
      input.audit_event_id,
    );

  if (byAuditEventId !== null) {
    return {
      status: "conflict",
      reason_code:
        "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_REVIEW",
      record:
        byAuditEventId,
    };
  }

  return null;
}

function validatePersistenceInput(
  transaction:
    TransactionContext,
  input:
    CapaAiOutputReviewPersistenceInput,
): void {
  if (
    transaction.request_trace
      .request_id !==
      input.review.request_id ||
    transaction.request_trace
      .correlation_id !==
      input.review.correlation_id ||
    transaction.request_trace
      .idempotency_key !==
      input.review.idempotency_key
  ) {
    fail();
  }

  requireDigest(
    input.request_fingerprint,
  );

  requireDigest(
    input.record_fingerprint,
  );

  const validated =
    constructCapaAiOutputReview({
      review_id:
        input.review.review_id,
      organization_id:
        input.review.organization_id,
      output_id:
        input.review.output_id,
      capa_case_id:
        input.review.capa_case_id,
      case_version_id:
        input.review.case_version_id,
      record_version:
        input.review.record_version,
      decision:
        input.review.decision,
      rationale:
        input.review.rationale,
      human_revision:
        input.review.human_revision,
      reviewed_at:
        input.review.reviewed_at,
      reviewed_by:
        input.review.reviewed_by,
      review_policy_version:
        input.review
          .review_policy_version,
      request_id:
        input.review.request_id,
      correlation_id:
        input.review.correlation_id,
      idempotency_key:
        input.review.idempotency_key,
    });

  if (
    !isDeepStrictEqual(
      validated,
      input.review,
    )
  ) {
    fail();
  }

  if (
    sha256(input.review) !==
      input.record_fingerprint
  ) {
    fail();
  }
}

export class SupabaseCapaAiOutputReviewRepository
  implements CapaAiOutputReviewRepository {
  constructor(
    private readonly sql:
      postgres.Sql,
  ) {}

  async appendReview(
    transaction:
      TransactionContext,
    input:
      CapaAiOutputReviewPersistenceInput,
  ): Promise<AppendCapaAiOutputReviewResult> {
    const sql =
      requireSupabaseTransaction(
        transaction,
      );

    validatePersistenceInput(
      transaction,
      input,
    );

    /*
     * Resolve a committed retry before evaluating current CAPA state.
     *
     * This is deliberate: an exact retry of an already committed human
     * review remains idempotently successful even if the CAPA subsequently
     * advanced to another version.
     */
    const prior =
      await resolveExistingConflict(
        sql,
        input,
      );

    if (prior !== null) {
      return prior;
    }

    const outputRows =
      await sql<Row[]>`
        select
          organization_id,
          output_id,
          capa_case_id,
          case_version_id,
          record_version,
          status,
          proposal,
          advisory_only,
          workflow_mutated,
          human_acceptance_required
        from public.capa_ai_outputs
        where organization_id =
            ${input.review.organization_id}
          and output_id =
            ${input.review.output_id}
        limit 2
      `;

    if (outputRows.length > 1) {
      fail();
    }

    const output =
      outputRows[0];

    if (output === undefined) {
      return {
        status:
          "output_not_found_or_not_authorized",
      };
    }

    if (
      requiredString(
        output.capa_case_id,
      ) !==
        input.review.capa_case_id ||
      requiredString(
        output.case_version_id,
      ) !==
        input.review.case_version_id ||
      positiveSafeInteger(
        output.record_version,
      ) !==
        input.review.record_version ||
      requiredString(
        output.status,
      ) !== "completed_draft" ||
      output.proposal === null ||
      output.advisory_only !== true ||
      output.workflow_mutated !== false ||
      output.human_acceptance_required !==
        true
    ) {
      return {
        status:
          "output_not_reviewable",
      };
    }

    /*
     * Lock the aggregate and verify that the exact CAPA snapshot reviewed
     * by the human is still current.
     */
    const caseRows =
      await sql<Row[]>`
        select
          current_version_id,
          record_version,
          status
        from public.capa_cases
        where organization_id =
            ${input.review.organization_id}
          and capa_case_id =
            ${input.review.capa_case_id}
        for update
      `;

    if (caseRows.length > 1) {
      fail();
    }

    const currentCase =
      caseRows[0];

    if (
      currentCase === undefined ||
      requiredString(
        currentCase.current_version_id,
      ) !==
        input.review.case_version_id ||
      positiveSafeInteger(
        currentCase.record_version,
      ) !==
        input.review.record_version ||
      requiredString(
        currentCase.status,
      ) !== "S10"
    ) {
      return {
        status: "case_changed",
      };
    }

    const insertedRows =
      await sql<Row[]>`
        insert into
          public.capa_ai_output_reviews (
            organization_id,
            review_id,
            output_id,
            capa_case_id,
            case_version_id,
            record_version,
            output_status,
            decision,
            rationale,
            human_revision,
            reviewed_at,
            reviewed_by_actor_type,
            reviewed_by_actor_id,
            reviewed_by_actor_version,
            review_policy_version,
            request_id,
            correlation_id,
            idempotency_key,
            request_fingerprint,
            audit_event_id,
            review_record,
            record_fingerprint_algorithm,
            record_fingerprint,
            workflow_mutated,
            controlled_record_mutated,
            gate_approved
          )
        values (
          ${input.review.organization_id},
          ${input.review.review_id},
          ${input.review.output_id},
          ${input.review.capa_case_id},
          ${input.review.case_version_id},
          ${input.review.record_version},
          'completed_draft',
          ${input.review.decision},
          ${input.review.rationale},
          ${
            input.review.human_revision ===
              null
              ? null
              : sql.json(
                  databaseJson(
                    input.review
                      .human_revision,
                  ),
                )
          },
          ${input.review.reviewed_at},
          ${input.review.reviewed_by.actor_type},
          ${input.review.reviewed_by.actor_id},
          ${
            input.review.reviewed_by
              .actor_version ?? null
          },
          ${input.review.review_policy_version},
          ${input.review.request_id},
          ${input.review.correlation_id},
          ${input.review.idempotency_key},
          ${input.request_fingerprint},
          ${input.audit_event_id},
          ${sql.json(
            databaseJson(
              input.review,
            ),
          )},
          'sha256',
          ${input.record_fingerprint},
          ${input.review.workflow_mutated},
          ${input.review.controlled_record_mutated},
          ${input.review.gate_approved}
        )
        on conflict
        do nothing
        returning *
      `;

    if (insertedRows.length === 1) {
      return {
        status: "saved",
        record:
          reviewFromRow(
            insertedRows[0],
          ),
      };
    }

    if (insertedRows.length !== 0) {
      fail();
    }

    /*
     * A concurrent transaction may have claimed one of the immutable
     * identities after our pre-check. Resolve it deterministically.
     */
    const concurrent =
      await resolveExistingConflict(
        sql,
        input,
      );

    if (concurrent !== null) {
      return concurrent;
    }

    fail();
  }

  async findReviewById(
    organizationId:
      OrganizationId,
    reviewId:
      CapaAiOutputReviewId,
  ): Promise<PersistedCapaAiOutputReview | null> {
    return findByReviewId(
      this.sql,
      organizationId,
      reviewId,
    );
  }

  async listReviewsForOutput(
    organizationId:
      OrganizationId,
    outputId:
      CapaIntakeAdvisoryResponse["output_id"],
  ): Promise<
    readonly PersistedCapaAiOutputReview[]
  > {
    const rows =
      await this.sql<Row[]>`
        select *
        from public.capa_ai_output_reviews
        where organization_id =
            ${organizationId}
          and output_id =
            ${outputId}
        order by
          reviewed_at asc,
          review_id asc
      `;

    return Object.freeze(
      rows.map(
        reviewFromRow,
      ),
    );
  }
}

export function createSupabaseCapaAiOutputReviewRepository(
  sql:
    postgres.Sql,
): SupabaseCapaAiOutputReviewRepository {
  return new SupabaseCapaAiOutputReviewRepository(
    sql,
  );
}
