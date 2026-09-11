import { describe, expect, it } from "vitest";
import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
  validateCapaImplementationReviewDecision,
} from "../../lib/capa/domain/capa-implementation-review-decision";

const SOURCE = "20000000-0000-4000-8000-000000000001";
const BASELINE = "30000000-0000-4000-8000-000000000001";

function decision(overrides: Record<string, unknown> = {}) {
  return {
    schema_version:
      CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
    source_case_version_id: SOURCE,
    implementation_review_baseline_section_version_id:
      BASELINE,
    decision: "accept",
    rationale: "The implementation evidence is acceptable.",
    ...overrides,
  };
}

function invalid(
  result: { readonly status: string; readonly reason_code?: string },
  reason: string,
) {
  expect(result).toEqual({ status: "invalid", reason_code: reason });
}

describe("CAPA implementation-review decision contract", () => {
  it("accepts accept and return decisions", () => {
    expect(
      validateCapaImplementationReviewDecision(decision()),
    ).toMatchObject({ status: "valid" });
    expect(
      validateCapaImplementationReviewDecision(
        decision({
          decision: "return",
          rationale: "The implementation requires rework.",
        }),
      ),
    ).toMatchObject({ status: "valid" });
  });

  it.each([null, [], "decision", 42])(
    "rejects malformed non-object input: %s",
    (value) => {
      invalid(
        validateCapaImplementationReviewDecision(value),
        "INVALID_IMPLEMENTATION_REVIEW_DECISION_OBJECT",
      );
    },
  );

  it("rejects the wrong schema version and invalid UUID bindings", () => {
    invalid(
      validateCapaImplementationReviewDecision(
        decision({ schema_version: "wrong" }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION",
    );
    invalid(
      validateCapaImplementationReviewDecision(
        decision({ source_case_version_id: "not-a-uuid" }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_SOURCE_CASE_VERSION_ID",
    );
    invalid(
      validateCapaImplementationReviewDecision(
        decision({
          implementation_review_baseline_section_version_id:
            "not-a-uuid",
        }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_BASELINE_SECTION_VERSION_ID",
    );
  });

  it("rejects unsupported decisions and blank rationale", () => {
    invalid(
      validateCapaImplementationReviewDecision(
        decision({ decision: "defer" }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION",
    );
    invalid(
      validateCapaImplementationReviewDecision(
        decision({ rationale: "" }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_RATIONALE",
    );
    invalid(
      validateCapaImplementationReviewDecision(
        decision({ rationale: "   " }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_RATIONALE",
    );
  });

  it("rejects unknown fields and freezes the normalized valid value", () => {
    invalid(
      validateCapaImplementationReviewDecision(
        decision({ reviewer_id: SOURCE }),
      ),
      "INVALID_IMPLEMENTATION_REVIEW_DECISION_FIELDS",
    );
    const result = validateCapaImplementationReviewDecision(
      decision({ decision: "return" }),
    );
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(result.value).toEqual({
        schema_version:
          CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
        source_case_version_id: SOURCE,
        implementation_review_baseline_section_version_id:
          BASELINE,
        decision: "return",
        rationale: "The implementation evidence is acceptable.",
      });
    }
  });
});
