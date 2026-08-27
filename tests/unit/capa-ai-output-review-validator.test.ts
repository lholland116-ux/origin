import {
  describe,
  expect,
  it,
} from "vitest";

import type {
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
} from "../../lib/capa/domain/capa-types";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

import type {
  CapaAiOutputReviewId,
} from "../../lib/capa/ai/capa-ai-output-review-contract";

import {
  CapaAiOutputReviewValidationError,
  constructCapaAiOutputReview,
} from "../../lib/capa/ai/capa-ai-output-review-validator";

const HUMAN_REVISION = Object.freeze({
  problem_statement_draft:
    "Human-revised problem statement.",

  scope_dimensions:
    Object.freeze([
      "Product family",
    ]),

  missing_dimensions:
    Object.freeze([
      "Confirmed lot range",
    ]),

  containment_risk_questions:
    Object.freeze([
      "Has affected inventory been contained?",
    ]),

  investigation_questions:
    Object.freeze([
      "What evidence confirms the failure mechanism?",
    ]),
});

function validInput() {
  return {
    review_id:
      "10000000-0000-4000-8000-000000000001" as CapaAiOutputReviewId,
    organization_id:
      "20000000-0000-4000-8000-000000000001" as OrganizationId,
    output_id:
      "30000000-0000-4000-8000-000000000001" as CapaIntakeAdvisoryResponse["output_id"],
    capa_case_id:
      "40000000-0000-4000-8000-000000000001" as CapaCaseId,
    case_version_id:
      "50000000-0000-4000-8000-000000000001" as CapaCaseVersionId,
    record_version: 2,
    decision:
      "accept" as const,
    rationale: null,
    human_revision: null,
    reviewed_at:
      "2026-08-26T16:00:00.000Z" as IsoDateTime,
    reviewed_by: {
      actor_type:
        "human" as const,
      actor_id:
        "60000000-0000-4000-8000-000000000001",
    },
    request_id:
      "70000000-0000-4000-8000-000000000001" as RequestId,
    correlation_id:
      "80000000-0000-4000-8000-000000000001" as CorrelationId,
    idempotency_key:
      "review-request-001" as IdempotencyKey,
  } as const;
}

function expectReason(
  run: () => unknown,
  reasonCode: string,
): void {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(
      CapaAiOutputReviewValidationError,
    );

    expect(
      (
        error as
          CapaAiOutputReviewValidationError
      ).reason_code,
    ).toBe(reasonCode);

    return;
  }

  throw new Error(
    "Expected governed review validation to fail.",
  );
}

describe(
  "CAPA AI-output human review validator",
  () => {
    it(
      "constructs immutable accept review without approving or mutating CAPA",
      () => {
        const review =
          constructCapaAiOutputReview(
            validInput(),
          );

        expect(review.decision)
          .toBe("accept");

        expect(review.workflow_mutated)
          .toBe(false);

        expect(
          review.controlled_record_mutated,
        ).toBe(false);

        expect(review.gate_approved)
          .toBe(false);

        expect(
          review.human_revision,
        ).toBeNull();

        expect(Object.isFrozen(review))
          .toBe(true);

        expect(
          Object.isFrozen(
            review.reviewed_by,
          ),
        ).toBe(true);
      },
    );

    it(
      "requires rationale for rejection",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              decision: "reject",
            }),
          "RATIONALE_REQUIRED",
        );
      },
    );

    it(
      "rejects human revision on rejection",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              decision: "reject",
              rationale:
                "The AI proposal is not acceptable.",
              human_revision:
                HUMAN_REVISION,
            }),
          "HUMAN_REVISION_NOT_PERMITTED",
        );
      },
    );

    it(
      "requires rationale and human revision for revise",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              decision: "revise",
            }),
          "RATIONALE_REQUIRED",
        );

        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              decision: "revise",
              rationale:
                "Substantive human changes are required.",
            }),
          "HUMAN_REVISION_REQUIRED",
        );
      },
    );

    it(
      "preserves a complete immutable human revision",
      () => {
        const review =
          constructCapaAiOutputReview({
            ...validInput(),
            decision: "revise",
            rationale:
              "The AI proposal requires human correction.",
            human_revision:
              HUMAN_REVISION,
          });

        expect(review.decision)
          .toBe("revise");

        expect(review.human_revision)
          .toEqual(HUMAN_REVISION);

        expect(
          Object.isFrozen(
            review.human_revision,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            review.human_revision
              ?.scope_dimensions,
          ),
        ).toBe(true);
      },
    );

    it(
      "forbids human revision on accept",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              human_revision:
                HUMAN_REVISION,
            }),
          "HUMAN_REVISION_NOT_PERMITTED",
        );
      },
    );

    it(
      "requires a human reviewer",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              reviewed_by: {
                actor_type: "agent",
                actor_id:
                  "AG-INTAKE",
              },
            }),
          "HUMAN_REVIEW_REQUIRED",
        );
      },
    );

    it(
      "requires a positive safe record version",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              record_version: 0,
            }),
          "INVALID_RECORD_VERSION",
        );
      },
    );

    it(
      "rejects malformed or incomplete human revision",
      () => {
        expectReason(
          () =>
            constructCapaAiOutputReview({
              ...validInput(),
              decision: "revise",
              rationale:
                "A human revision is required.",
              human_revision: {
                ...HUMAN_REVISION,
                problem_statement_draft:
                  "",
              },
            }),
          "INVALID_HUMAN_REVISION",
        );
      },
    );
  },
);
