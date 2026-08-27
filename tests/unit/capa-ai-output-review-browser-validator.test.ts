import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CapaAiOutputReviewValidationError,
  validateCapaAiOutputReviewBrowserRequest,
} from "../../lib/capa/ai/capa-ai-output-review-validator";

const CASE_VERSION_ID =
  "50000000-0000-4000-8000-000000000001";

const HUMAN_REVISION =
  Object.freeze({
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

function expectReason(
  run: () => unknown,
  reasonCode: string,
): void {
  try {
    run();
  } catch (error) {
    expect(error)
      .toBeInstanceOf(
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
    "Expected browser review validation to fail.",
  );
}

describe(
  "CAPA AI-output browser review validator",
  () => {
    it(
      "accepts the minimum accept request and normalizes optional fields to null",
      () => {
        const result =
          validateCapaAiOutputReviewBrowserRequest({
            decision:
              "accept",

            expected_case_version_id:
              CASE_VERSION_ID,

            expected_record_version:
              2,
          });

        expect(result)
          .toEqual({
            decision:
              "accept",

            rationale:
              null,

            human_revision:
              null,

            expected_case_version_id:
              CASE_VERSION_ID,

            expected_record_version:
              2,
          });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);
      },
    );

    it(
      "allows an optional human rationale for accept",
      () => {
        const result =
          validateCapaAiOutputReviewBrowserRequest({
            decision:
              "accept",

            rationale:
              "Reviewed and acceptable for this advisory purpose.",

            expected_case_version_id:
              CASE_VERSION_ID,

            expected_record_version:
              2,
          });

        expect(
          result.rationale,
        ).toBe(
          "Reviewed and acceptable for this advisory purpose.",
        );
      },
    );

    it(
      "requires rationale for reject",
      () => {
        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "reject",

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,
            }),
          "RATIONALE_REQUIRED",
        );
      },
    );

    it(
      "accepts a complete revise request",
      () => {
        const result =
          validateCapaAiOutputReviewBrowserRequest({
            decision:
              "revise",

            rationale:
              "Substantive human corrections are required.",

            human_revision:
              HUMAN_REVISION,

            expected_case_version_id:
              CASE_VERSION_ID,

            expected_record_version:
              2,
          });

        expect(result.decision)
          .toBe("revise");

        expect(
          result.human_revision,
        ).toEqual(
          HUMAN_REVISION,
        );
      },
    );

    it(
      "requires human revision for revise",
      () => {
        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "revise",

              rationale:
                "Substantive human corrections are required.",

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,
            }),
          "HUMAN_REVISION_REQUIRED",
        );
      },
    );

    it(
      "forbids human revision for accept and reject",
      () => {
        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "accept",

              human_revision:
                HUMAN_REVISION,

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,
            }),
          "HUMAN_REVISION_NOT_PERMITTED",
        );

        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "reject",

              rationale:
                "The AI proposal is not acceptable.",

              human_revision:
                HUMAN_REVISION,

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,
            }),
          "HUMAN_REVISION_NOT_PERMITTED",
        );
      },
    );

    it(
      "rejects unexpected browser-controlled fields",
      () => {
        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "accept",

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,

              organization_id:
                "10000000-0000-4000-8000-000000000001",
            }),
          "INVALID_REVIEW_INPUT",
        );

        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "accept",

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,

              reviewed_by: {
                actor_type:
                  "human",

                actor_id:
                  "attacker-controlled-user",
              },
            }),
          "INVALID_REVIEW_INPUT",
        );
      },
    );

    it(
      "rejects malformed exact-version context and malformed human revision",
      () => {
        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "accept",

              expected_case_version_id:
                "not-a-uuid",

              expected_record_version:
                2,
            }),
          "INVALID_CASE_VERSION_ID",
        );

        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "accept",

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                0,
            }),
          "INVALID_RECORD_VERSION",
        );

        expectReason(
          () =>
            validateCapaAiOutputReviewBrowserRequest({
              decision:
                "revise",

              rationale:
                "A substantive human correction is required.",

              human_revision: {
                ...HUMAN_REVISION,

                problem_statement_draft:
                  "",
              },

              expected_case_version_id:
                CASE_VERSION_ID,

              expected_record_version:
                2,
            }),
          "INVALID_HUMAN_REVISION",
        );
      },
    );
  },
);
