import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildCapaAiOutputReviewRequest,
  createEmptyCapaAiOutputReviewDraft,
  type CapaAiOutputReviewDraft,
  type CapaAiOutputReviewHumanRevision,
} from "../../app/capa/capa-ai-output-review-client";

import type {
  CapaIntakeAdvisorySnapshot,
} from "../../app/capa/capa-intake-advisory-snapshot";

const SNAPSHOT:
  CapaIntakeAdvisorySnapshot =
  Object.freeze({
    capaCaseId:
      "10000000-0000-4000-8000-000000000001",

    caseVersionId:
      "20000000-0000-4000-8000-000000000001",

    recordVersion:
      2,
  });

const REVISION:
  CapaAiOutputReviewHumanRevision =
  Object.freeze({
    problem_statement_draft:
      "Human-authored replacement problem statement.",

    scope_dimensions:
      Object.freeze([
        "Affected sealing process",
      ]),

    missing_dimensions:
      Object.freeze([
        "Confirmed lot extent",
      ]),

    containment_risk_questions:
      Object.freeze([
        "Has affected product been contained?",
      ]),

    investigation_questions:
      Object.freeze([
        "What changed before the defect increase?",
      ]),
  });

function draft(
  overrides:
    Partial<CapaAiOutputReviewDraft>,
): CapaAiOutputReviewDraft {
  return {
    decision:
      null,

    rationale:
      "",

    humanRevision:
      null,

    ...overrides,
  };
}

describe(
  "CAPA AI-output review browser client contract",
  () => {
    it(
      "starts with no preselected human disposition",
      () => {
        expect(
          createEmptyCapaAiOutputReviewDraft(),
        ).toEqual({
          decision:
            null,

          rationale:
            "",

          humanRevision:
            null,
        });
      },
    );

    it(
      "requires an explicit human decision",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            createEmptyCapaAiOutputReviewDraft(),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "decision",
          },
        });
      },
    );

    it(
      "builds Accept with no rationale and no human revision",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "accept",
            }),
            SNAPSHOT,
          );

        expect(result).toEqual({
          valid:
            true,

          request: {
            decision:
              "accept",

            rationale:
              null,

            human_revision:
              null,

            expected_case_version_id:
              SNAPSHOT.caseVersionId,

            expected_record_version:
              2,
          },
        });
      },
    );

    it(
      "allows an optional Accept rationale and trims its boundary whitespace",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "accept",

              rationale:
                "  Reviewed against the submitted intake.  ",
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            true,

          request: {
            rationale:
              "Reviewed against the submitted intake.",
          },
        });
      },
    );

    it(
      "requires rationale for Reject",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "reject",
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "rationale",
          },
        });
      },
    );

    it(
      "builds a valid Reject request without human revision",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "reject",

              rationale:
                "The proposed problem statement is not supported by the intake evidence.",
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            true,

          request: {
            decision:
              "reject",

            human_revision:
              null,

            expected_case_version_id:
              SNAPSHOT.caseVersionId,

            expected_record_version:
              SNAPSHOT.recordVersion,
          },
        });
      },
    );

    it(
      "requires rationale for Revise",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "revise",

              humanRevision:
                REVISION,
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "rationale",
          },
        });
      },
    );

    it(
      "requires a complete human replacement for Revise",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "revise",

              rationale:
                "The human reviewer revised the proposed scope.",
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "human_revision",
          },
        });
      },
    );

    it(
      "builds Revise against the exact advisory snapshot",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "revise",

              rationale:
                "The human reviewer corrected the problem statement and scope.",

              humanRevision:
                REVISION,
            }),
            SNAPSHOT,
          );

        expect(result).toEqual({
          valid:
            true,

          request: {
            decision:
              "revise",

            rationale:
              "The human reviewer corrected the problem statement and scope.",

            human_revision:
              REVISION,

            expected_case_version_id:
              SNAPSHOT.caseVersionId,

            expected_record_version:
              SNAPSHOT.recordVersion,
          },
        });
      },
    );

    it.each([
      "a",
      "ab",
    ])(
      "rejects rationale shorter than three characters: %p",
      (rationale) => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "accept",

              rationale,
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "rationale",
          },
        });
      },
    );

    it(
      "rejects rationale longer than 4,000 characters",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "accept",

              rationale:
                "x".repeat(4_001),
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "rationale",
          },
        });
      },
    );

    it(
      "does not silently discard a stale human revision after switching to Accept",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "accept",

              humanRevision:
                REVISION,
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "human_revision",
          },
        });
      },
    );

    it(
      "rejects an invalid authoritative snapshot",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "accept",
            }),
            {
              ...SNAPSHOT,
              recordVersion:
                0,
            },
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "snapshot",
          },
        });
      },
    );

    it(
      "rejects invalid human replacement content",
      () => {
        const result =
          buildCapaAiOutputReviewRequest(
            draft({
              decision:
                "revise",

              rationale:
                "Human revision required.",

              humanRevision: {
                ...REVISION,

                problem_statement_draft:
                  " ",
              },
            }),
            SNAPSHOT,
          );

        expect(result).toMatchObject({
          valid:
            false,

          issue: {
            field:
              "human_revision",
          },
        });
      },
    );
  },
);
