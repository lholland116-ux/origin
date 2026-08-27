import {
  describe,
  expect,
  it,
} from "vitest";

import {
  parseCapaAiOutputReviewFailure,
  parseCapaAiOutputReviewSuccess,
} from "../../app/capa/capa-ai-output-review-client";

import type {
  CapaIntakeAdvisorySnapshot,
} from "../../app/capa/capa-intake-advisory-snapshot";

const CASE_ID =
  "10000000-0000-4000-8000-000000000001";

const CASE_VERSION_ID =
  "20000000-0000-4000-8000-000000000001";

const OUTPUT_ID =
  "30000000-0000-4000-8000-000000000001";

const REVIEW_ID =
  "40000000-0000-4000-8000-000000000001";

const AUDIT_EVENT_ID =
  "50000000-0000-4000-8000-000000000001";

const CORRELATION_ID =
  "60000000-0000-4000-8000-000000000001";

const SNAPSHOT:
  CapaIntakeAdvisorySnapshot =
  Object.freeze({
    capaCaseId:
      CASE_ID,

    caseVersionId:
      CASE_VERSION_ID,

    recordVersion:
      2,
  });

function responseBody() {
  return {
    ai_output_review: {
      review_id:
        REVIEW_ID,

      output_id:
        OUTPUT_ID,

      capa_case_id:
        CASE_ID,

      case_version_id:
        CASE_VERSION_ID,

      record_version:
        2,

      decision:
        "accept",

      reviewed_at:
        "2026-08-27T11:00:00.000Z",

      workflow_mutated:
        false,

      controlled_record_mutated:
        false,

      gate_approved:
        false,
    },

    audit_event_id:
      AUDIT_EVENT_ID,

    replayed:
      false,

    correlation_id:
      CORRELATION_ID,
  };
}

describe(
  "CAPA AI-output review browser response parser",
  () => {
    it(
      "accepts a review bound to the exact displayed advisory snapshot",
      () => {
        const result =
          parseCapaAiOutputReviewSuccess(
            responseBody(),
            {
              capaCaseId:
                CASE_ID,

              outputId:
                OUTPUT_ID,

              snapshot:
                SNAPSHOT,
            },
          );

        expect(result).toEqual({
          reviewId:
            REVIEW_ID,

          decision:
            "accept",

          reviewedAt:
            "2026-08-27T11:00:00.000Z",

          auditEventId:
            AUDIT_EVENT_ID,

          replayed:
            false,

          correlationId:
            CORRELATION_ID,
        });
      },
    );

    it(
      "accepts an exact idempotent replay",
      () => {
        const body = {
          ...responseBody(),
          replayed:
            true,
        };

        expect(
          parseCapaAiOutputReviewSuccess(
            body,
            {
              capaCaseId:
                CASE_ID,

              outputId:
                OUTPUT_ID,

              snapshot:
                SNAPSHOT,
            },
          ),
        ).toMatchObject({
          replayed:
            true,
        });
      },
    );

    it(
      "rejects a response for a different AI output",
      () => {
        expect(
          parseCapaAiOutputReviewSuccess(
            {
              ...responseBody(),

              ai_output_review: {
                ...responseBody()
                  .ai_output_review,

                output_id:
                  "70000000-0000-4000-8000-000000000001",
              },
            },
            {
              capaCaseId:
                CASE_ID,

              outputId:
                OUTPUT_ID,

              snapshot:
                SNAPSHOT,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects a response bound to a different CAPA version",
      () => {
        expect(
          parseCapaAiOutputReviewSuccess(
            {
              ...responseBody(),

              ai_output_review: {
                ...responseBody()
                  .ai_output_review,

                record_version:
                  3,
              },
            },
            {
              capaCaseId:
                CASE_ID,

              outputId:
                OUTPUT_ID,

              snapshot:
                SNAPSHOT,
            },
          ),
        ).toBeNull();
      },
    );

    it(
      "rejects a review that claims workflow mutation",
      () => {
        expect(
          parseCapaAiOutputReviewSuccess(
            {
              ...responseBody(),

              ai_output_review: {
                ...responseBody()
                  .ai_output_review,

                workflow_mutated:
                  true,
              },
            },
            {
              capaCaseId:
                CASE_ID,

              outputId:
                OUTPUT_ID,

              snapshot:
                SNAPSHOT,
            },
          ),
        ).toBeNull();
      },
    );

    it.each([
      [
        403,
        "CAPA_AI_OUTPUT_REVIEW_ACCESS_DENIED",
        "authorization_denied",
      ],
      [
        404,
        "CAPA_AI_OUTPUT_NOT_FOUND",
        "not_found",
      ],
      [
        409,
        "CAPA_AI_OUTPUT_NOT_REVIEWABLE",
        "not_reviewable",
      ],
      [
        409,
        "CAPA_AI_OUTPUT_REVIEW_STALE",
        "stale",
      ],
      [
        409,
        "CAPA_AI_OUTPUT_REVIEW_IDEMPOTENCY_CONFLICT",
        "idempotency_conflict",
      ],
      [
        401,
        "UNAUTHORIZED",
        "authentication",
      ],
    ] as const)(
      "classifies HTTP %s / %s as %s",
      (
        status,
        code,
        expectedKind,
      ) => {
        const result =
          parseCapaAiOutputReviewFailure(
            status,
            {
              error: {
                code,

                message:
                  "Controlled error.",

                correlation_id:
                  CORRELATION_ID,
              },
            },
          );

        expect(result).toEqual({
          kind:
            expectedKind,

          message:
            "Controlled error.",

          correlationId:
            CORRELATION_ID,
        });
      },
    );

    it(
      "fails safely for an unknown server failure",
      () => {
        expect(
          parseCapaAiOutputReviewFailure(
            500,
            null,
          ),
        ).toEqual({
          kind:
            "unexpected",

          message:
            "The CAPA AI-output review could not be recorded.",

          correlationId:
            null,
        });
      },
    );
  },
);
