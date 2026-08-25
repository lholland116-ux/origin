import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CapaIntakeAdvisoryValidationError,
  validateCapaIntakeAdvisoryBrowserRequest,
} from "../../lib/capa/ai/capa-intake-advisory-validator";

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaIntakeAdvisoryValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "CAPA intake advisory browser validation",
  () => {
    it("constructs an immutable default advisory request", () => {
      const request =
        validateCapaIntakeAdvisoryBrowserRequest({});

      expect(request).toEqual({
        requested_output:
          "intake_analysis",
        focus: null,
      });
      expect(Object.isFrozen(request)).toBe(true);
    });

    it("normalizes an optional untrusted human focus", () => {
      expect(
        validateCapaIntakeAdvisoryBrowserRequest({
          focus:
            "  Review containment questions.  ",
        }),
      ).toEqual({
        requested_output:
          "intake_analysis",
        focus:
          "Review containment questions.",
      });
    });

    it("treats blank focus as absent", () => {
      expect(
        validateCapaIntakeAdvisoryBrowserRequest({
          focus: "   ",
        }).focus,
      ).toBeNull();
    });

    for (const invalid of [
      null,
      [],
      "focus",
      1,
      true,
    ]) {
      it(`rejects non-object input ${String(invalid)}`, () => {
        expectReason(
          () =>
            validateCapaIntakeAdvisoryBrowserRequest(
              invalid,
            ),
          "INVALID_ADVISORY_INPUT",
        );
      });
    }

    for (const invalidFocus of [
      1,
      false,
      [],
      {},
      null,
    ]) {
      it("rejects a non-string focus", () => {
        expectReason(
          () =>
            validateCapaIntakeAdvisoryBrowserRequest({
              focus: invalidFocus,
            }),
          "INVALID_ADVISORY_INPUT",
        );
      });
    }

    for (const authorityField of [
      "organization_id",
      "active_role_ids",
      "workflow_state",
      "agent_id",
      "agent_version",
      "model",
      "tool_ids",
      "collection_id",
      "retrieval_policy",
      "prompt",
      "case_context",
    ]) {
      it(`rejects browser authority field ${authorityField}`, () => {
        expectReason(
          () =>
            validateCapaIntakeAdvisoryBrowserRequest({
              [authorityField]: "browser-value",
            }),
          "UNSUPPORTED_ADVISORY_INPUT_FIELD",
        );
      });
    }

    it("rejects an oversized focus", () => {
      expectReason(
        () =>
          validateCapaIntakeAdvisoryBrowserRequest({
            focus: "x".repeat(1_001),
          }),
        "ADVISORY_FOCUS_TOO_LONG",
      );
    });

    it("publishes a controlled validation error", () => {
      const error =
        new CapaIntakeAdvisoryValidationError(
          "INVALID_ADVISORY_INPUT",
        );

      expect(error.message).toBe(
        "The governed CAPA intake advisory request is invalid.",
      );
      expect(error.reason_code).toBe(
        "INVALID_ADVISORY_INPUT",
      );
    });
  },
);
