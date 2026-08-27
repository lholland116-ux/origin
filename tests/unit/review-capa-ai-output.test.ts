import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  AuditEvent,
  AuditEventId,
  AuditEventId as DomainAuditEventId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

import type {
  CapaAiOutputReviewBrowserRequest,
  CapaAiOutputReviewId,
} from "../../lib/capa/ai/capa-ai-output-review-contract";

import type {
  CapaAiOutputHumanReviewAuthorizer,
} from "../../lib/capa/authorization/capa-ai-output-review-authorizer";

import {
  ReviewCapaAiOutputAuditIntegrityError,
  ReviewCapaAiOutputIdempotencyConfigurationError,
  ReviewCapaAiOutputIdentityConflictError,
  reviewCapaAiOutput,
  type ReviewCapaAiOutputCommand,
  type ReviewCapaAiOutputIdGenerator,
} from "../../lib/capa/application/review-capa-ai-output";

import {
  AuditEventAppendConflictError,
  type CreateCapaClock,
} from "../../lib/capa/application/create-capa";

import type {
  AppendAuditEventResult,
  AuditEventPage,
  AuditEventQuery,
  AuditRepository,
} from "../../lib/database/repositories/audit-repository";

import type {
  AppendCapaAiOutputReviewResult,
  CapaAiOutputReviewPersistenceInput,
  CapaAiOutputReviewRepository,
  PersistedCapaAiOutputReview,
} from "../../lib/database/repositories/capa-ai-output-review-repository";

import type {
  TransactionContext,
  TransactionId,
  TransactionManager,
  TransactionWork,
} from "../../lib/database/transactions";

import type {
  TenantContext,
} from "../../lib/security/tenant-context";

const ORG =
  "10000000-0000-4000-8000-000000000001" as OrganizationId;

const CASE_ID =
  "20000000-0000-4000-8000-000000000001" as
    ReviewCapaAiOutputCommand["capa_case_id"];

const CASE_VERSION_ID =
  "30000000-0000-4000-8000-000000000001" as
    CapaAiOutputReviewBrowserRequest["expected_case_version_id"];

const REVIEWER_ID =
  "40000000-0000-4000-8000-000000000001";

const REQUEST_ID =
  "50000000-0000-4000-8000-000000000001" as
    RequestTrace["request_id"];

const CORRELATION_ID =
  "60000000-0000-4000-8000-000000000001" as
    RequestTrace["correlation_id"];

const OUTPUT_ID =
  "70000000-0000-4000-8000-000000000001" as
    CapaIntakeAdvisoryResponse["output_id"];

const REVIEW_ID =
  "80000000-0000-4000-8000-000000000001" as
    CapaAiOutputReviewId;

const AUDIT_EVENT_ID =
  "90000000-0000-4000-8000-000000000001" as AuditEventId;

const OTHER_AUDIT_EVENT_ID =
  "90000000-0000-4000-8000-000000000002" as DomainAuditEventId;

const IDEMPOTENCY_KEY =
  "review-intake-output-001" as IdempotencyKey;

const TENANT = Object.freeze({
  organization_id: ORG,
}) as TenantContext;

const BASE_REVIEW =
  Object.freeze({
    decision:
      "accept",
    rationale:
      "Reviewed against the submitted intake snapshot.",
    human_revision:
      null,
    expected_case_version_id:
      CASE_VERSION_ID,
    expected_record_version:
      2,
  }) satisfies CapaAiOutputReviewBrowserRequest;

function command(
  review:
    CapaAiOutputReviewBrowserRequest =
      BASE_REVIEW,
  trace:
    RequestTrace = {
      request_id:
        REQUEST_ID,
      correlation_id:
        CORRELATION_ID,
      idempotency_key:
        IDEMPOTENCY_KEY,
    },
): ReviewCapaAiOutputCommand {
  return {
    tenant:
      TENANT,
    capa_case_id:
      CASE_ID,
    output_id:
      OUTPUT_ID,
    reviewed_by: {
      actor_type:
        "human",
      actor_id:
        REVIEWER_ID,
    },
    review,
    request_trace:
      trace,
  };
}

class FixedClock
  implements CreateCapaClock {
  now(): Date {
    return new Date(
      "2026-08-26T18:00:00.000Z",
    );
  }
}

class FixedIdGenerator
  implements ReviewCapaAiOutputIdGenerator {
  generateReviewId():
    CapaAiOutputReviewId {
    return REVIEW_ID;
  }

  generateAuditEventId():
    AuditEventId {
    return AUDIT_EVENT_ID;
  }
}

class TestTransactionManager
  implements TransactionManager {
  calls = 0;
  committed = false;
  rolled_back = false;
  transaction:
    TransactionContext | null =
      null;

  async runInTransaction<Result>(
    requestTrace:
      RequestTrace,
    work:
      TransactionWork<Result>,
  ): Promise<Result> {
    this.calls += 1;

    const transaction =
      Object.freeze({
        transaction_id:
          "transaction-001" as
            TransactionId,
        started_at:
          "2026-08-26T18:00:00.000Z" as IsoDateTime,
        request_trace:
          requestTrace,
      });

    this.transaction =
      transaction;

    try {
      const result =
        await work(
          transaction,
        );

      this.committed =
        true;

      return result;
    } catch (error) {
      this.rolled_back =
        true;

      throw error;
    }
  }
}

type ReviewHandler = (
  transaction:
    TransactionContext,
  input:
    CapaAiOutputReviewPersistenceInput,
) =>
  Promise<AppendCapaAiOutputReviewResult>;

class TestReviewRepository
  implements CapaAiOutputReviewRepository {
  readonly transactions:
    TransactionContext[] = [];

  readonly inputs:
    CapaAiOutputReviewPersistenceInput[] =
      [];

  constructor(
    private readonly handler:
      ReviewHandler,
  ) {}

  async appendReview(
    transaction:
      TransactionContext,
    input:
      CapaAiOutputReviewPersistenceInput,
  ): Promise<AppendCapaAiOutputReviewResult> {
    this.transactions.push(
      transaction,
    );

    this.inputs.push(
      input,
    );

    return this.handler(
      transaction,
      input,
    );
  }

  async findReviewById():
    Promise<PersistedCapaAiOutputReview | null> {
    return null;
  }

  async listReviewsForOutput():
    Promise<
      readonly PersistedCapaAiOutputReview[]
    > {
    return Object.freeze([]);
  }
}

type AuditHandler = (
  transaction:
    TransactionContext,
  event:
    AuditEvent,
) =>
  Promise<AppendAuditEventResult>;

class TestAuditRepository
  implements AuditRepository {
  readonly transactions:
    TransactionContext[] = [];

  readonly events:
    AuditEvent[] = [];

  constructor(
    private readonly handler:
      AuditHandler,
  ) {}

  async appendEvent(
    transaction:
      TransactionContext,
    event:
      AuditEvent,
  ): Promise<AppendAuditEventResult> {
    this.transactions.push(
      transaction,
    );

    this.events.push(
      event,
    );

    return this.handler(
      transaction,
      event,
    );
  }

  async findEventById():
    Promise<AuditEvent | null> {
    return null;
  }

  async listEventsForAggregate(
    _query:
      AuditEventQuery,
  ): Promise<AuditEventPage> {
    return {
      events:
        Object.freeze([]),
    };
  }
}

function persisted(
  input:
    CapaAiOutputReviewPersistenceInput,
): PersistedCapaAiOutputReview {
  return Object.freeze({
    review:
      input.review,
    request_fingerprint:
      input.request_fingerprint,
    audit_event_id:
      input.audit_event_id,
    record_fingerprint:
      input.record_fingerprint,
  });
}

class TestAuthorizer
  implements CapaAiOutputHumanReviewAuthorizer {
  calls = 0;

  constructor(
    private readonly result:
      boolean = true,
    private readonly shouldThrow:
      boolean = false,
  ) {}

  async authorizeAiOutputReview():
    Promise<boolean> {
    this.calls += 1;

    if (this.shouldThrow) {
      throw new Error(
        "Authorization evaluation failed.",
      );
    }

    return this.result;
  }
}

function dependencies(
  transactionManager:
    TestTransactionManager,
  reviewRepository:
    TestReviewRepository,
  auditRepository:
    TestAuditRepository,
  authorizer:
    CapaAiOutputHumanReviewAuthorizer =
      new TestAuthorizer(),
) {
  return {
    transaction_manager:
      transactionManager,
    review_repository:
      reviewRepository,
    authorizer,
    audit_repository:
      auditRepository,
    id_generator:
      new FixedIdGenerator(),
    clock:
      new FixedClock(),
    configuration: {
      audit_schema_version:
        "capa-audit-1.0.0",
    },
  };
}

describe(
  "reviewCapaAiOutput",
  () => {
    it("denies human review before opening a transaction when authorization is denied", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async () => {
            throw new Error(
              "Review repository must not execute.",
            );
          },
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit repository must not execute.",
            );
          },
        );

      const authorizer =
        new TestAuthorizer(
          false,
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
            authorizer,
          ),
          command(),
        );

      expect(result).toEqual({
        status:
          "authorization_denied",
        reason_code:
          "HUMAN_REVIEW_NOT_AUTHORIZED",
      });

      expect(
        authorizer.calls,
      ).toBe(1);

      expect(
        manager.calls,
      ).toBe(0);

      expect(
        reviewRepository.inputs,
      ).toHaveLength(0);

      expect(
        auditRepository.events,
      ).toHaveLength(0);
    });

    it("fails closed before opening a transaction when authorization evaluation throws", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async () => {
            throw new Error(
              "Review repository must not execute.",
            );
          },
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit repository must not execute.",
            );
          },
        );

      const authorizer =
        new TestAuthorizer(
          false,
          true,
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
            authorizer,
          ),
          command(),
        );

      expect(result).toEqual({
        status:
          "authorization_denied",
        reason_code:
          "HUMAN_REVIEW_NOT_AUTHORIZED",
      });

      expect(
        authorizer.calls,
      ).toBe(1);

      expect(
        manager.calls,
      ).toBe(0);

      expect(
        reviewRepository.inputs,
      ).toHaveLength(0);

      expect(
        auditRepository.events,
      ).toHaveLength(0);
    });

    it("records the human review and attributable audit event in the same transaction", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => ({
            status:
              "saved",
            record:
              persisted(input),
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async (
            _transaction,
            event,
          ) => ({
            status:
              "appended",
            event_id:
              event.event_id,
          }),
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        );

      expect(
        result.status,
      ).toBe("reviewed");

      expect(
        manager.committed,
      ).toBe(true);

      expect(
        manager.rolled_back,
      ).toBe(false);

      expect(
        reviewRepository.transactions,
      ).toHaveLength(1);

      expect(
        auditRepository.transactions,
      ).toHaveLength(1);

      expect(
        reviewRepository
          .transactions[0],
      ).toBe(
        auditRepository
          .transactions[0],
      );

      const event =
        auditRepository.events[0];

      expect(event).toBeDefined();

      expect(event).toMatchObject({
        event_type:
          "EVT-AI-OUTPUT-REVIEWED",
        aggregate_type:
          "CAPA_CASE",
        aggregate_id:
          CASE_ID,
        aggregate_version:
          2,
        action:
          "REVIEW_CAPA_AI_OUTPUT",
        outcome:
          "succeeded",
        actor: {
          actor_type:
            "human",
          actor_id:
            REVIEWER_ID,
        },
        metadata: {
          output_id:
            OUTPUT_ID,
          decision:
            "accept",
          advisory_only_review:
            true,
          workflow_mutated:
            false,
          controlled_record_mutated:
            false,
          gate_approved:
            false,
        },
      });
    });

    it("returns the committed review on an exact retry without appending another audit event", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => ({
            status:
              "already_recorded",
            record:
              persisted(input),
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit append must not execute for replay.",
            );
          },
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        );

      expect(
        result.status,
      ).toBe(
        "already_reviewed",
      );

      expect(
        auditRepository.events,
      ).toHaveLength(0);

      expect(
        manager.committed,
      ).toBe(true);
    });

    it("maps request-key reuse with different content to a controlled idempotency conflict", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => ({
            status:
              "conflict",
            reason_code:
              "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
            record:
              persisted(input),
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit must not execute.",
            );
          },
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        );

      expect(result).toEqual({
        status:
          "idempotency_conflict",
        reason_code:
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      });

      expect(
        auditRepository.events,
      ).toHaveLength(0);
    });

    it("maps a stale CAPA snapshot to a concurrency conflict", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async () => ({
            status:
              "case_changed",
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit must not execute.",
            );
          },
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        );

      expect(result).toEqual({
        status:
          "concurrency_conflict",
        reason_code:
          "CAPA_SNAPSHOT_CHANGED",
      });

      expect(
        auditRepository.events,
      ).toHaveLength(0);
    });

    it("does not distinguish a missing output from unauthorized tenant scope", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async () => ({
            status:
              "output_not_found_or_not_authorized",
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit must not execute.",
            );
          },
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        );

      expect(result).toEqual({
        status:
          "output_not_found_or_not_authorized",
      });
    });

    it("rejects an AI output that is not reviewable without writing audit evidence", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async () => ({
            status:
              "output_not_reviewable",
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit must not execute.",
            );
          },
        );

      const result =
        await reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        );

      expect(result).toEqual({
        status:
          "output_not_reviewable",
      });

      expect(
        auditRepository.events,
      ).toHaveLength(0);
    });

    it("fails closed on immutable review identity conflict", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => ({
            status:
              "conflict",
            reason_code:
              "REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
            record:
              persisted(input),
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => ({
            status:
              "appended",
            event_id:
              AUDIT_EVENT_ID,
          }),
        );

      await expect(
        reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        ),
      ).rejects.toBeInstanceOf(
        ReviewCapaAiOutputIdentityConflictError,
      );

      expect(
        auditRepository.events,
      ).toHaveLength(0);

      expect(
        manager.rolled_back,
      ).toBe(true);
    });

    it("rejects the transaction when the audit append conflicts after the review write", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => ({
            status:
              "saved",
            record:
              persisted(input),
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async (
            _transaction,
            event,
          ) => ({
            status:
              "conflict",
            event_id:
              event.event_id,
            reason_code:
              "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
          }),
        );

      await expect(
        reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        ),
      ).rejects.toBeInstanceOf(
        AuditEventAppendConflictError,
      );

      expect(
        reviewRepository.inputs,
      ).toHaveLength(1);

      expect(
        auditRepository.events,
      ).toHaveLength(1);

      expect(
        manager.committed,
      ).toBe(false);

      expect(
        manager.rolled_back,
      ).toBe(true);
    });

    it("fails closed when the audit repository returns the wrong event identity", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => ({
            status:
              "saved",
            record:
              persisted(input),
          }),
        );

      const auditRepository =
        new TestAuditRepository(
          async () => ({
            status:
              "appended",
            event_id:
              OTHER_AUDIT_EVENT_ID,
          }),
        );

      await expect(
        reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(),
        ),
      ).rejects.toBeInstanceOf(
        ReviewCapaAiOutputAuditIntegrityError,
      );

      expect(
        manager.rolled_back,
      ).toBe(true);
    });

    it("requires a valid request idempotency key before opening a transaction", async () => {
      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async () => {
            throw new Error(
              "Repository must not execute.",
            );
          },
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit must not execute.",
            );
          },
        );

      await expect(
        reviewCapaAiOutput(
          dependencies(
            manager,
            reviewRepository,
            auditRepository,
          ),
          command(
            BASE_REVIEW,
            {
              request_id:
                REQUEST_ID,
              correlation_id:
                CORRELATION_ID,
            },
          ),
        ),
      ).rejects.toBeInstanceOf(
        ReviewCapaAiOutputIdempotencyConfigurationError,
      );

      expect(
        manager.calls,
      ).toBe(0);

      expect(
        reviewRepository.inputs,
      ).toHaveLength(0);
    });

    it("uses a stable semantic fingerprint and changes it when review content changes", async () => {
      const fingerprints:
        string[] = [];

      const manager =
        new TestTransactionManager();

      const reviewRepository =
        new TestReviewRepository(
          async (
            _transaction,
            input,
          ) => {
            fingerprints.push(
              input.request_fingerprint,
            );

            return {
              status:
                "output_not_reviewable",
            };
          },
        );

      const auditRepository =
        new TestAuditRepository(
          async () => {
            throw new Error(
              "Audit must not execute.",
            );
          },
        );

      const deps =
        dependencies(
          manager,
          reviewRepository,
          auditRepository,
        );

      await reviewCapaAiOutput(
        deps,
        command(),
      );

      await reviewCapaAiOutput(
        deps,
        command(),
      );

      await reviewCapaAiOutput(
        deps,
        command({
          ...BASE_REVIEW,
          rationale:
            "A materially different human review rationale.",
        }),
      );

      expect(
        fingerprints,
      ).toHaveLength(3);

      expect(
        fingerprints[0],
      ).toBe(
        fingerprints[1],
      );

      expect(
        fingerprints[2],
      ).not.toBe(
        fingerprints[0],
      );

      for (
        const fingerprint
        of fingerprints
      ) {
        expect(
          fingerprint,
        ).toMatch(
          /^[0-9a-f]{64}$/,
        );
      }
    });
  },
);
