import { createHash } from "node:crypto";

import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type postgres from "postgres";

import type {
  AuditEventId,
  CorrelationId,
  IdempotencyKey,
  OrganizationId,
  RequestId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

import type {
  CapaAiOutputReviewId,
  CapaAiOutputReviewRecord,
} from "../../lib/capa/ai/capa-ai-output-review-contract";

import {
  constructCapaAiOutputReview,
} from "../../lib/capa/ai/capa-ai-output-review-validator";

import type {
  CapaAiOutputReviewRequestFingerprint,
  CapaAiOutputReviewRecordFingerprint,
} from "../../lib/database/repositories/capa-ai-output-review-repository";

import {
  SupabaseCapaAiOutputReviewRepository,
} from "../../lib/database/supabase/supabase-capa-ai-output-review-repository";

import {
  SupabaseTransactionManager,
} from "../../lib/database/supabase/supabase-transactions";

function harness() {
  const calls: {
    query: string;
    values: readonly unknown[];
  }[] = [];

  const responses: unknown[] = [];

  const tagged = vi.fn(
    async (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => {
      calls.push({
        query: strings
          .join("?")
          .replace(/\s+/g, " ")
          .trim(),
        values,
      });

      return responses.shift() ?? [];
    },
  );

  const transaction =
    Object.assign(
      tagged,
      {
        json: (value: unknown) => value,
      },
    );

  const sql =
    Object.assign(
      tagged,
      {
        json: (value: unknown) => value,

        begin: vi.fn(
          async (
            _options: string,
            work: (
              value:
                postgres.TransactionSql,
            ) => Promise<unknown>,
          ) =>
            work(
              transaction as unknown as
                postgres.TransactionSql,
            ),
        ),
      },
    ) as unknown as postgres.Sql;

  return {
    sql,
    calls,

    enqueue(
      ...values: unknown[]
    ) {
      responses.push(...values);
    },
  };
}

const ORG =
  "10000000-0000-4000-8000-000000000001" as OrganizationId;

const CASE_ID =
  "20000000-0000-4000-8000-000000000001" as CapaAiOutputReviewRecord["capa_case_id"];

const CASE_VERSION_ID =
  "30000000-0000-4000-8000-000000000001" as CapaAiOutputReviewRecord["case_version_id"];

const REVIEWER_ID =
  "40000000-0000-4000-8000-000000000001";

const REQUEST_ID =
  "50000000-0000-4000-8000-000000000001" as RequestId;

const CORRELATION_ID =
  "60000000-0000-4000-8000-000000000001" as CorrelationId;

const OUTPUT_ID =
  "70000000-0000-4000-8000-000000000001" as CapaIntakeAdvisoryResponse["output_id"];

const REVIEW_ID =
  "80000000-0000-4000-8000-000000000001" as CapaAiOutputReviewId;

const OTHER_REVIEW_ID =
  "80000000-0000-4000-8000-000000000002" as CapaAiOutputReviewId;

const AUDIT_EVENT_ID =
  "90000000-0000-4000-8000-000000000001" as AuditEventId;

const IDEMPOTENCY_KEY =
  "review-intake-output-001" as IdempotencyKey;

const OTHER_IDEMPOTENCY_KEY =
  "review-intake-output-002" as IdempotencyKey;

const REQUEST_FINGERPRINT =
  "a".repeat(64) as CapaAiOutputReviewRequestFingerprint;

const DIFFERENT_REQUEST_FINGERPRINT =
  "b".repeat(64) as CapaAiOutputReviewRequestFingerprint;

const PROPOSAL = Object.freeze({
  problem_statement_draft:
    "A controlled intake draft.",
  scope_dimensions: Object.freeze([
    "training record",
  ]),
  missing_dimensions: Object.freeze([
    "extent",
  ]),
  containment_risk_questions:
    Object.freeze([
      "Is immediate containment required?",
    ]),
  investigation_questions:
    Object.freeze([
      "How was the discrepancy detected?",
    ]),
});

function sha256(
  value: unknown,
): CapaAiOutputReviewRecordFingerprint {
  return createHash("sha256")
    .update(
      JSON.stringify(value),
      "utf8",
    )
    .digest("hex") as
      CapaAiOutputReviewRecordFingerprint;
}

function makeReview(
  options: {
    readonly review_id?:
      CapaAiOutputReviewId;
    readonly idempotency_key?:
      IdempotencyKey;
  } = {},
): CapaAiOutputReviewRecord {
  return constructCapaAiOutputReview({
    review_id:
      options.review_id ??
        REVIEW_ID,

    organization_id:
      ORG,

    output_id:
      OUTPUT_ID,

    capa_case_id:
      CASE_ID,

    case_version_id:
      CASE_VERSION_ID,

    record_version: 2,

    decision:
      "accept",

    rationale:
      "Reviewed against the submitted intake snapshot.",

    human_revision:
      null,

    reviewed_at:
      "2026-08-26T18:00:00.000Z" as CapaAiOutputReviewRecord["reviewed_at"],

    reviewed_by: {
      actor_type:
        "human",
      actor_id:
        REVIEWER_ID,
    },

    request_id:
      REQUEST_ID,

    correlation_id:
      CORRELATION_ID,

    idempotency_key:
      options.idempotency_key ??
        IDEMPOTENCY_KEY,
  });
}

function persistedRow(
  review:
    CapaAiOutputReviewRecord,
  options: {
    readonly request_fingerprint?:
      CapaAiOutputReviewRequestFingerprint;
    readonly audit_event_id?:
      AuditEventId;
  } = {},
) {
  return {
    organization_id:
      review.organization_id,
    review_id:
      review.review_id,
    output_id:
      review.output_id,
    capa_case_id:
      review.capa_case_id,
    case_version_id:
      review.case_version_id,
    record_version:
      review.record_version,
    output_status:
      "completed_draft",
    decision:
      review.decision,
    rationale:
      review.rationale,
    human_revision:
      review.human_revision,
    reviewed_at:
      review.reviewed_at,
    reviewed_by_actor_type:
      review.reviewed_by.actor_type,
    reviewed_by_actor_id:
      review.reviewed_by.actor_id,
    reviewed_by_actor_version:
      review.reviewed_by.actor_version ??
        null,
    review_policy_version:
      review.review_policy_version,
    request_id:
      review.request_id,
    correlation_id:
      review.correlation_id,
    idempotency_key:
      review.idempotency_key,
    request_fingerprint:
      options.request_fingerprint ??
        REQUEST_FINGERPRINT,
    audit_event_id:
      options.audit_event_id ??
        AUDIT_EVENT_ID,
    review_record:
      review,
    record_fingerprint_algorithm:
      "sha256",
    record_fingerprint:
      sha256(review),
    workflow_mutated:
      false,
    controlled_record_mutated:
      false,
    gate_approved:
      false,
  };
}

function outputRow(
  overrides: {
    readonly status?: string;
    readonly proposal?: unknown;
  } = {},
) {
  return {
    organization_id:
      ORG,
    output_id:
      OUTPUT_ID,
    capa_case_id:
      CASE_ID,
    case_version_id:
      CASE_VERSION_ID,
    record_version: 2,
    status:
      overrides.status ??
        "completed_draft",
    proposal:
      overrides.proposal === undefined
        ? PROPOSAL
        : overrides.proposal,
    advisory_only:
      true,
    workflow_mutated:
      false,
    human_acceptance_required:
      true,
  };
}

function currentCaseRow(
  overrides: {
    readonly current_version_id?: string;
    readonly record_version?: number;
    readonly status?: string;
  } = {},
) {
  return {
    current_version_id:
      overrides.current_version_id ??
        CASE_VERSION_ID,
    record_version:
      overrides.record_version ??
        2,
    status:
      overrides.status ??
        "S10",
  };
}

function persistenceInput(
  review:
    CapaAiOutputReviewRecord,
) {
  return {
    review,
    request_fingerprint:
      REQUEST_FINGERPRINT,
    audit_event_id:
      AUDIT_EVENT_ID,
    record_fingerprint:
      sha256(review),
  };
}

async function appendWithHarness(
  test:
    ReturnType<typeof harness>,
  review:
    CapaAiOutputReviewRecord =
      makeReview(),
) {
  const repository =
    new SupabaseCapaAiOutputReviewRepository(
      test.sql,
    );

  const manager =
    new SupabaseTransactionManager(
      test.sql,
    );

  return manager.runInTransaction(
    {
      request_id:
        REQUEST_ID,
      correlation_id:
        CORRELATION_ID,
      idempotency_key:
        review.idempotency_key,
    },
    (transaction) =>
      repository.appendReview(
        transaction,
        persistenceInput(
          review,
        ),
      ),
  );
}

describe(
  "SupabaseCapaAiOutputReviewRepository",
  () => {
    it("appends a new immutable human review against the exact current CAPA snapshot", async () => {
      const test =
        harness();

      const review =
        makeReview();

      test.enqueue(
        [],
        [],
        [],
        [outputRow()],
        [currentCaseRow()],
        [persistedRow(review)],
      );

      const result =
        await appendWithHarness(
          test,
          review,
        );

      expect(
        result.status,
      ).toBe("saved");

      expect(
        test.calls,
      ).toHaveLength(6);

      expect(
        test.calls[3]?.query,
      ).toContain(
        "from public.capa_ai_outputs",
      );

      expect(
        test.calls[4]?.query,
      ).toContain(
        "for update",
      );

      expect(
        test.calls[5]?.query,
      ).toContain(
        "insert into public.capa_ai_output_reviews",
      );

      expect(
        test.calls[5]?.query,
      ).toContain(
        "on conflict do nothing",
      );

      expect(
        test.calls.some(
          (call) =>
            /^update\b/i.test(
              call.query,
            ),
        ),
      ).toBe(false);

      expect(
        test.calls.some(
          (call) =>
            call.query.includes(
              "capa_case_versions",
            ),
        ),
      ).toBe(false);
    });

    it("returns already_recorded for an exact committed idempotent retry", async () => {
      const test =
        harness();

      const review =
        makeReview();

      test.enqueue([
        persistedRow(
          review,
        ),
      ]);

      const result =
        await appendWithHarness(
          test,
          review,
        );

      expect(
        result.status,
      ).toBe(
        "already_recorded",
      );

      expect(
        test.calls,
      ).toHaveLength(1);

      expect(
        test.calls[0]?.query,
      ).toContain(
        "idempotency_key",
      );

      expect(
        test.calls.some(
          (call) =>
            call.query.includes(
              "insert into public.capa_ai_output_reviews",
            ),
        ),
      ).toBe(false);
    });

    it("fails closed when an idempotency key is reused with a different request fingerprint", async () => {
      const test =
        harness();

      const review =
        makeReview();

      test.enqueue([
        persistedRow(
          review,
          {
            request_fingerprint:
              DIFFERENT_REQUEST_FINGERPRINT,
          },
        ),
      ]);

      const result =
        await appendWithHarness(
          test,
          review,
        );

      expect(result).toMatchObject({
        status:
          "conflict",
        reason_code:
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      });

      expect(
        test.calls,
      ).toHaveLength(1);
    });

    it("fails closed when a review identity is reused with different immutable content", async () => {
      const test =
        harness();

      const existingReview =
        makeReview({
          review_id:
            REVIEW_ID,
          idempotency_key:
            OTHER_IDEMPOTENCY_KEY,
        });

      test.enqueue(
        [],
        [
          persistedRow(
            existingReview,
          ),
        ],
      );

      const result =
        await appendWithHarness(
          test,
          makeReview(),
        );

      expect(result).toMatchObject({
        status:
          "conflict",
        reason_code:
          "REVIEW_ID_REUSED_WITH_DIFFERENT_CONTENT",
      });

      expect(
        test.calls,
      ).toHaveLength(2);
    });

    it("fails closed when an audit-event identity is reused by another review", async () => {
      const test =
        harness();

      const existingReview =
        makeReview({
          review_id:
            OTHER_REVIEW_ID,
          idempotency_key:
            OTHER_IDEMPOTENCY_KEY,
        });

      test.enqueue(
        [],
        [],
        [
          persistedRow(
            existingReview,
            {
              audit_event_id:
                AUDIT_EVENT_ID,
            },
          ),
        ],
      );

      const result =
        await appendWithHarness(
          test,
          makeReview(),
        );

      expect(result).toMatchObject({
        status:
          "conflict",
        reason_code:
          "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_REVIEW",
      });

      expect(
        test.calls,
      ).toHaveLength(3);
    });

    it("does not disclose whether a missing AI output belongs to another tenant", async () => {
      const test =
        harness();

      test.enqueue(
        [],
        [],
        [],
        [],
      );

      const result =
        await appendWithHarness(
          test,
        );

      expect(result).toEqual({
        status:
          "output_not_found_or_not_authorized",
      });

      expect(
        test.calls.some(
          (call) =>
            call.query.includes(
              "insert into public.capa_ai_output_reviews",
            ),
        ),
      ).toBe(false);
    });

    it("rejects an AI output that is not a completed reviewable draft", async () => {
      const test =
        harness();

      test.enqueue(
        [],
        [],
        [],
        [
          outputRow({
            status:
              "validation_failed",
            proposal:
              null,
          }),
        ],
      );

      const result =
        await appendWithHarness(
          test,
        );

      expect(result).toEqual({
        status:
          "output_not_reviewable",
      });

      expect(
        test.calls,
      ).toHaveLength(4);
    });

    it("rejects a stale CAPA snapshot before inserting the human review", async () => {
      const test =
        harness();

      test.enqueue(
        [],
        [],
        [],
        [outputRow()],
        [
          currentCaseRow({
            record_version: 3,
          }),
        ],
      );

      const result =
        await appendWithHarness(
          test,
        );

      expect(result).toEqual({
        status:
          "case_changed",
      });

      expect(
        test.calls[4]?.query,
      ).toContain(
        "for update",
      );

      expect(
        test.calls.some(
          (call) =>
            call.query.includes(
              "insert into public.capa_ai_output_reviews",
            ),
        ),
      ).toBe(false);
    });

    it("rejects request-trace mismatch before issuing SQL", async () => {
      const test =
        harness();

      const review =
        makeReview();

      const repository =
        new SupabaseCapaAiOutputReviewRepository(
          test.sql,
        );

      const manager =
        new SupabaseTransactionManager(
          test.sql,
        );

      await expect(
        manager.runInTransaction(
          {
            request_id:
              "50000000-0000-4000-8000-000000000099" as RequestId,
            correlation_id:
              CORRELATION_ID,
            idempotency_key:
              IDEMPOTENCY_KEY,
          },
          (transaction) =>
            repository.appendReview(
              transaction,
              persistenceInput(
                review,
              ),
            ),
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseCapaAiOutputReviewRepositoryError",
      });

      expect(
        test.calls,
      ).toHaveLength(0);
    });

    it("rejects a manufactured transaction context", async () => {
      const test =
        harness();

      const repository =
        new SupabaseCapaAiOutputReviewRepository(
          test.sql,
        );

      const review =
        makeReview();

      await expect(
        repository.appendReview(
          {
            transaction_id:
              "fake-transaction",
            started_at:
              "2026-08-26T18:00:00.000Z",
            request_trace: {
              request_id:
                REQUEST_ID,
              correlation_id:
                CORRELATION_ID,
              idempotency_key:
                IDEMPOTENCY_KEY,
            },
          } as Parameters<
            typeof repository.appendReview
          >[0],
          persistenceInput(
            review,
          ),
        ),
      ).rejects.toMatchObject({
        name:
          "SupabaseTransactionContextError",
      });

      expect(
        test.calls,
      ).toHaveLength(0);
    });
  },
);
