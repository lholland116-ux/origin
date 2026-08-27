import {
  createHash,
} from "node:crypto";

import type {
  ActorReference,
  AuditEvent,
  AuditEventId,
  ControlledCode,
  IdempotencyKey,
  IsoDateTime,
  RequestTrace,
} from "../domain/capa-types";

import type {
  CapaIntakeAdvisoryResponse,
} from "../ai/capa-intake-advisory-contract";

import {
  CAPA_AI_OUTPUT_REVIEW_POLICY_VERSION,
  type CapaAiOutputReviewBrowserRequest,
  type CapaAiOutputReviewId,
  type CapaAiOutputReviewRecord,
} from "../ai/capa-ai-output-review-contract";

import {
  constructCapaAiOutputReview,
} from "../ai/capa-ai-output-review-validator";

import type {
  CapaAiOutputHumanReviewAuthorizer,
} from "../authorization/capa-ai-output-review-authorizer";

import type {
  AuditRepository,
} from "../../database/repositories/audit-repository";

import type {
  CapaAiOutputReviewRepository,
  CapaAiOutputReviewRequestFingerprint,
  CapaAiOutputReviewRecordFingerprint,
  PersistedCapaAiOutputReview,
} from "../../database/repositories/capa-ai-output-review-repository";

import type {
  TransactionManager,
} from "../../database/transactions";

import type {
  TenantContext,
} from "../../security/tenant-context";

import type {
  CreateCapaClock,
} from "./create-capa";

import {
  AuditEventAppendConflictError,
} from "./create-capa";

/**
 * Governed human disposition of one immutable CAPA AI advisory output.
 *
 * Accept, reject and revise are review dispositions only. This operation
 * never approves a CAPA gate, transitions workflow, creates a controlled
 * CAPA version, or overwrites the governed AI output.
 *
 * Traceability:
 * URS-AI-003
 * SRS-REV-001 through SRS-REV-006
 * SRS-AC-003
 * HRUI-D-001 through HRUI-D-008
 * HF-01, HF-02, HF-04, HF-07
 */

const OPERATION_CODE =
  "REVIEW_CAPA_AI_OUTPUT";

const AUDIT_EVENT_TYPE =
  "EVT-AI-OUTPUT-REVIEWED";

const AGGREGATE_TYPE =
  "CAPA_CASE";

const REVIEW_OBJECT_TYPE =
  "CAPA_AI_OUTPUT_REVIEW";

const FINGERPRINT_VERSION =
  "review-capa-ai-output-fingerprint-1";

const IDEMPOTENCY_KEY_MAXIMUM_LENGTH =
  128;

export interface ReviewCapaAiOutputIdGenerator {
  generateReviewId():
    CapaAiOutputReviewId;

  generateAuditEventId():
    AuditEventId;
}

export interface ReviewCapaAiOutputConfiguration {
  readonly audit_schema_version:
    string;
}

export interface ReviewCapaAiOutputCommand {
  readonly tenant:
    TenantContext;

  readonly capa_case_id:
    CapaAiOutputReviewRecord["capa_case_id"];

  readonly output_id:
    CapaIntakeAdvisoryResponse["output_id"];

  /**
   * Trusted server-resolved human identity.
   *
   * A route handler must never populate this field from an ordinary browser
   * request body.
   */
  readonly reviewed_by:
    ActorReference & {
      readonly actor_type: "human";
    };

  readonly review:
    CapaAiOutputReviewBrowserRequest;

  readonly request_trace:
    RequestTrace;
}

export interface ReviewCapaAiOutputDependencies {
  readonly transaction_manager:
    TransactionManager;

  readonly review_repository:
    CapaAiOutputReviewRepository;

  /**
   * Mandatory policy-backed human-review authorization.
   *
   * Authorization must succeed before any transaction is opened.
   */
  readonly authorizer:
    CapaAiOutputHumanReviewAuthorizer;

  readonly audit_repository:
    AuditRepository;

  readonly id_generator:
    ReviewCapaAiOutputIdGenerator;

  readonly clock:
    CreateCapaClock;

  readonly configuration:
    ReviewCapaAiOutputConfiguration;
}

interface CompletedReview {
  readonly review:
    CapaAiOutputReviewRecord;

  readonly audit_event_id:
    AuditEventId;
}

export type ReviewCapaAiOutputResult =
  | {
      readonly status:
        "authorization_denied";

      readonly reason_code:
        "HUMAN_REVIEW_NOT_AUTHORIZED";
    }
  | ({
      readonly status:
        "reviewed";
    } & CompletedReview)
  | ({
      readonly status:
        "already_reviewed";
    } & CompletedReview)
  | {
      readonly status:
        "idempotency_conflict";

      readonly reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST";
    }
  | {
      readonly status:
        "output_not_found_or_not_authorized";
    }
  | {
      readonly status:
        "output_not_reviewable";
    }
  | {
      readonly status:
        "concurrency_conflict";

      readonly reason_code:
        "CAPA_SNAPSHOT_CHANGED";
    };

export class ReviewCapaAiOutputIdempotencyConfigurationError
  extends Error {
  constructor() {
    super(
      "CAPA AI-output review requires a valid idempotency key.",
    );

    this.name =
      "ReviewCapaAiOutputIdempotencyConfigurationError";
  }
}

export class ReviewCapaAiOutputIdentityConflictError
  extends Error {
  constructor() {
    super(
      "A server-generated CAPA AI-output review identity conflicted with existing immutable data.",
    );

    this.name =
      "ReviewCapaAiOutputIdentityConflictError";
  }
}

export class ReviewCapaAiOutputAuditIntegrityError
  extends Error {
  constructor() {
    super(
      "The CAPA AI-output review audit event did not match the committed review operation.",
    );

    this.name =
      "ReviewCapaAiOutputAuditIntegrityError";
  }
}

function controlled(
  value: string,
): ControlledCode {
  return value as ControlledCode;
}

function iso(
  value: Date,
): IsoDateTime {
  return value.toISOString() as IsoDateTime;
}

function requireIdempotencyKey(
  trace:
    RequestTrace,
): IdempotencyKey {
  const key =
    trace.idempotency_key;

  if (
    typeof key !== "string" ||
    key.length === 0 ||
    key.length >
      IDEMPOTENCY_KEY_MAXIMUM_LENGTH ||
    key.trim() !== key
  ) {
    throw new ReviewCapaAiOutputIdempotencyConfigurationError();
  }

  return key;
}

function requestFingerprint(
  dependencies:
    ReviewCapaAiOutputDependencies,
  command:
    ReviewCapaAiOutputCommand,
): CapaAiOutputReviewRequestFingerprint {
  const canonicalRequest = {
    fingerprint_version:
      FINGERPRINT_VERSION,

    organization_id:
      command.tenant.organization_id,

    capa_case_id:
      command.capa_case_id,

    output_id:
      command.output_id,

    operation_code:
      OPERATION_CODE,

    expected_case_version_id:
      command.review
        .expected_case_version_id,

    expected_record_version:
      command.review
        .expected_record_version,

    decision:
      command.review.decision,

    rationale:
      command.review.rationale ??
        null,

    human_revision:
      command.review
        .human_revision ??
        null,

    reviewed_by: {
      actor_type:
        command.reviewed_by.actor_type,

      actor_id:
        command.reviewed_by.actor_id,

      actor_version:
        command.reviewed_by
          .actor_version ??
          null,
    },

    configuration: {
      review_policy_version:
        CAPA_AI_OUTPUT_REVIEW_POLICY_VERSION,

      audit_schema_version:
        dependencies.configuration
          .audit_schema_version,
    },
  };

  return createHash("sha256")
    .update(
      JSON.stringify(
        canonicalRequest,
      ),
      "utf8",
    )
    .digest("hex") as
      CapaAiOutputReviewRequestFingerprint;
}

function recordFingerprint(
  review:
    CapaAiOutputReviewRecord,
): CapaAiOutputReviewRecordFingerprint {
  return createHash("sha256")
    .update(
      JSON.stringify(review),
      "utf8",
    )
    .digest("hex") as
      CapaAiOutputReviewRecordFingerprint;
}

function persistedCompletion(
  record:
    PersistedCapaAiOutputReview,
): CompletedReview {
  return {
    review:
      record.review,

    audit_event_id:
      record.audit_event_id,
  };
}

function buildAuditEvent(
  dependencies:
    ReviewCapaAiOutputDependencies,
  command:
    ReviewCapaAiOutputCommand,
  review:
    CapaAiOutputReviewRecord,
  auditEventId:
    AuditEventId,
): AuditEvent {
  return {
    organization_id:
      review.organization_id,

    event_id:
      auditEventId,

    event_type:
      controlled(
        AUDIT_EVENT_TYPE,
      ),

    schema_version:
      dependencies.configuration
        .audit_schema_version,

    aggregate_type:
      controlled(
        AGGREGATE_TYPE,
      ),

    aggregate_id:
      review.capa_case_id,

    aggregate_version:
      review.record_version,

    actor:
      review.reviewed_by,

    occurred_at:
      review.reviewed_at,

    request_id:
      command.request_trace
        .request_id,

    correlation_id:
      command.request_trace
        .correlation_id,

    idempotency_key:
      review.idempotency_key,

    action:
      controlled(
        OPERATION_CODE,
      ),

    target: {
      object_type:
        controlled(
          REVIEW_OBJECT_TYPE,
        ),

      object_id:
        review.review_id,
    },

    outcome:
      "succeeded",

    configuration_versions: {
      review_policy:
        review.review_policy_version,

      audit_schema:
        dependencies.configuration
          .audit_schema_version,
    },

    metadata: {
      capa_case_id:
        review.capa_case_id,

      case_version_id:
        review.case_version_id,

      record_version:
        review.record_version,

      output_id:
        review.output_id,

      review_id:
        review.review_id,

      decision:
        review.decision,

      advisory_only_review:
        true,

      workflow_mutated:
        false,

      controlled_record_mutated:
        false,

      gate_approved:
        false,
    },
  };
}

export async function reviewCapaAiOutput(
  dependencies:
    ReviewCapaAiOutputDependencies,
  command:
    ReviewCapaAiOutputCommand,
): Promise<ReviewCapaAiOutputResult> {
  let authorized:
    boolean;

  try {
    authorized =
      await dependencies.authorizer
        .authorizeAiOutputReview({
          organization_id:
            command.tenant.organization_id,

          capa_case_id:
            command.capa_case_id,

          case_version_id:
            command.review
              .expected_case_version_id,

          record_version:
            command.review
              .expected_record_version,

          output_id:
            command.output_id,

          reviewer:
            command.reviewed_by,
        });
  } catch {
    authorized =
      false;
  }

  if (!authorized) {
    return {
      status:
        "authorization_denied",

      reason_code:
        "HUMAN_REVIEW_NOT_AUTHORIZED",
    };
  }

  const idempotencyKey =
    requireIdempotencyKey(
      command.request_trace,
    );

  const reviewedAt =
    iso(
      dependencies.clock.now(),
    );

  const reviewId =
    dependencies.id_generator
      .generateReviewId();

  const auditEventId =
    dependencies.id_generator
      .generateAuditEventId();

  const fingerprint =
    requestFingerprint(
      dependencies,
      command,
    );

  const review =
    constructCapaAiOutputReview({
      review_id:
        reviewId,

      organization_id:
        command.tenant.organization_id,

      output_id:
        command.output_id,

      capa_case_id:
        command.capa_case_id,

      case_version_id:
        command.review
          .expected_case_version_id,

      record_version:
        command.review
          .expected_record_version,

      decision:
        command.review.decision,

      rationale:
        command.review.rationale ??
          null,

      human_revision:
        command.review
          .human_revision ??
          null,

      reviewed_at:
        reviewedAt,

      reviewed_by:
        command.reviewed_by,

      review_policy_version:
        CAPA_AI_OUTPUT_REVIEW_POLICY_VERSION,

      request_id:
        command.request_trace
          .request_id,

      correlation_id:
        command.request_trace
          .correlation_id,

      idempotency_key:
        idempotencyKey,
    });

  const reviewRecordFingerprint =
    recordFingerprint(
      review,
    );

  const auditEvent =
    buildAuditEvent(
      dependencies,
      command,
      review,
      auditEventId,
    );

  const transactionResult =
    await dependencies
      .transaction_manager
      .runInTransaction(
        {
          request_id:
            command.request_trace
              .request_id,

          correlation_id:
            command.request_trace
              .correlation_id,

          idempotency_key:
            idempotencyKey,
        },

        async (transaction) => {
          const appendResult =
            await dependencies
              .review_repository
              .appendReview(
                transaction,
                {
                  review,

                  request_fingerprint:
                    fingerprint,

                  audit_event_id:
                    auditEventId,

                  record_fingerprint:
                    reviewRecordFingerprint,
                },
              );

          if (
            appendResult.status ===
            "already_recorded"
          ) {
            return {
              kind:
                "replay" as const,

              record:
                appendResult.record,
            };
          }

          if (
            appendResult.status ===
            "case_changed"
          ) {
            return {
              kind:
                "case_changed" as const,
            };
          }

          if (
            appendResult.status ===
            "output_not_found_or_not_authorized"
          ) {
            return {
              kind:
                "output_not_found_or_not_authorized" as const,
            };
          }

          if (
            appendResult.status ===
            "output_not_reviewable"
          ) {
            return {
              kind:
                "output_not_reviewable" as const,
            };
          }

          if (
            appendResult.status ===
            "conflict"
          ) {
            if (
              appendResult.reason_code ===
              "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST"
            ) {
              return {
                kind:
                  "idempotency_conflict" as const,
              };
            }

            throw new ReviewCapaAiOutputIdentityConflictError();
          }

          if (
            appendResult.record
              .audit_event_id !==
              auditEventId ||
            appendResult.record
              .review.review_id !==
              review.review_id
          ) {
            throw new ReviewCapaAiOutputAuditIntegrityError();
          }

          const auditResult =
            await dependencies
              .audit_repository
              .appendEvent(
                transaction,
                auditEvent,
              );

          if (
            auditResult.status ===
            "conflict"
          ) {
            throw new AuditEventAppendConflictError();
          }

          if (
            auditResult.event_id !==
            auditEventId
          ) {
            throw new ReviewCapaAiOutputAuditIntegrityError();
          }

          return {
            kind:
              "reviewed" as const,

            review:
              appendResult.record.review,

            audit_event_id:
              auditEventId,
          };
        },
      );

  if (
    transactionResult.kind ===
    "replay"
  ) {
    return {
      status:
        "already_reviewed",

      ...persistedCompletion(
        transactionResult.record,
      ),
    };
  }

  if (
    transactionResult.kind ===
    "idempotency_conflict"
  ) {
    return {
      status:
        "idempotency_conflict",

      reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    };
  }

  if (
    transactionResult.kind ===
    "case_changed"
  ) {
    return {
      status:
        "concurrency_conflict",

      reason_code:
        "CAPA_SNAPSHOT_CHANGED",
    };
  }

  if (
    transactionResult.kind ===
    "output_not_found_or_not_authorized"
  ) {
    return {
      status:
        "output_not_found_or_not_authorized",
    };
  }

  if (
    transactionResult.kind ===
    "output_not_reviewable"
  ) {
    return {
      status:
        "output_not_reviewable",
    };
  }

  return {
    status:
      "reviewed",

    review:
      transactionResult.review,

    audit_event_id:
      transactionResult.audit_event_id,
  };
}
