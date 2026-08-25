import {
  describe,
  expect,
  it,
} from "vitest";

import {
  validateCapaIntakeAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-intake-advisory-output-validator";

function validOutput():
  Record<string, unknown> {
  return {
    proposal: {
      problem_statement_draft:
        "A training-record discrepancy was detected during controlled verification.",
      scope_dimensions: [
        "training record",
      ],
      missing_dimensions: ["extent"],
      containment_risk_questions: [
        "Is immediate containment required?",
      ],
      investigation_questions: [
        "How was the discrepancy detected?",
      ],
    },
    assumptions: [
      "The record is a training artifact.",
    ],
    missing_information: ["extent"],
    conflicts_and_alternatives: [],
    uncertainty_and_limitations: [
      "No supporting evidence was supplied.",
    ],
    human_action_required: [
      "Review and edit this advisory draft.",
    ],
    warnings: [],
  };
}

function expectReason(
  operation: () => unknown,
  reasonCode: string,
): void {
  expect(operation).toThrowError(
    expect.objectContaining({
      name:
        "CapaIntakeAdvisoryOutputValidationError",
      reason_code: reasonCode,
    }),
  );
}

describe(
  "CAPA intake advisory output validation",
  () => {
    it("validates and freezes the exact advisory output", () => {
      const result =
        validateCapaIntakeAdvisoryModelOutput(
          JSON.stringify(validOutput()),
        );

      expect(
        result.proposal
          .problem_statement_draft,
      ).toContain("training-record");
      expect(Object.isFrozen(result)).toBe(true);
      expect(
        Object.isFrozen(result.proposal),
      ).toBe(true);
      expect(
        Object.isFrozen(result.assumptions),
      ).toBe(true);
    });

    for (const invalid of [
      "",
      "   ",
    ]) {
      it("rejects empty model output", () => {
        expectReason(
          () =>
            validateCapaIntakeAdvisoryModelOutput(
              invalid,
            ),
          "EMPTY_MODEL_OUTPUT",
        );
      });
    }

    it("rejects oversized model output", () => {
      expectReason(
        () =>
          validateCapaIntakeAdvisoryModelOutput(
            "x".repeat(30_001),
          ),
        "MODEL_OUTPUT_TOO_LARGE",
      );
    });

    it("rejects malformed JSON", () => {
      expectReason(
        () =>
          validateCapaIntakeAdvisoryModelOutput(
            "not-json",
          ),
        "MODEL_OUTPUT_NOT_JSON",
      );
    });

    for (const invalid of [
      "null",
      "[]",
      '"text"',
    ]) {
      it(`rejects non-object JSON ${invalid}`, () => {
        expectReason(
          () =>
            validateCapaIntakeAdvisoryModelOutput(
              invalid,
            ),
          "MODEL_OUTPUT_NOT_OBJECT",
        );
      });
    }

    for (const field of [
      "approved",
      "disposition",
      "workflow_state",
      "model",
      "tool_calls",
      "citations",
    ]) {
      it(`rejects unsupported authority field ${field}`, () => {
        const output = validOutput();
        output[field] = true;

        expectReason(
          () =>
            validateCapaIntakeAdvisoryModelOutput(
              JSON.stringify(output),
            ),
          "UNSUPPORTED_MODEL_OUTPUT_FIELD",
        );
      });
    }

    it("rejects missing top-level fields", () => {
      const output = validOutput();
      delete output.warnings;

      expectReason(
        () =>
          validateCapaIntakeAdvisoryModelOutput(
            JSON.stringify(output),
          ),
        "MISSING_MODEL_OUTPUT_FIELD",
      );
    });

    for (const field of [
      "approval",
      "risk_acceptance",
      "next_state",
    ]) {
      it(`rejects unsupported proposal field ${field}`, () => {
        const output = validOutput();
        const proposal = output.proposal as
          Record<string, unknown>;
        proposal[field] = "not permitted";

        expectReason(
          () =>
            validateCapaIntakeAdvisoryModelOutput(
              JSON.stringify(output),
            ),
          "UNSUPPORTED_MODEL_OUTPUT_FIELD",
        );
      });
    }

    it("rejects non-object proposal", () => {
      const output = validOutput();
      output.proposal = "draft";

      expectReason(
        () =>
          validateCapaIntakeAdvisoryModelOutput(
            JSON.stringify(output),
          ),
        "INVALID_PROPOSAL",
      );
    });

    it("rejects blank problem statement", () => {
      const output = validOutput();
      const proposal = output.proposal as
        Record<string, unknown>;
      proposal.problem_statement_draft =
        "   ";

      expectReason(
        () =>
          validateCapaIntakeAdvisoryModelOutput(
            JSON.stringify(output),
          ),
        "INVALID_OUTPUT_TEXT",
      );
    });

    it("rejects oversized problem statement", () => {
      const output = validOutput();
      const proposal = output.proposal as
        Record<string, unknown>;
      proposal.problem_statement_draft =
        "x".repeat(4_001);

      expectReason(
        () =>
          validateCapaIntakeAdvisoryModelOutput(
            JSON.stringify(output),
          ),
        "INVALID_OUTPUT_TEXT",
      );
    });

    for (const invalid of [
      "not-an-array",
      [1],
      [""],
      ["x".repeat(1_001)],
      Array.from({ length: 21 }, () => "item"),
    ]) {
      it("rejects invalid output lists", () => {
        const output = validOutput();
        output.assumptions = invalid;

        expectReason(
          () =>
            validateCapaIntakeAdvisoryModelOutput(
              JSON.stringify(output),
            ),
          Array.isArray(invalid) &&
            invalid.length > 0 &&
            invalid.length <= 20
            ? "INVALID_OUTPUT_TEXT"
            : "INVALID_OUTPUT_LIST",
        );
      });
    }

    for (const claim of [
      "The CAPA is approved.",
      "This record has been closed.",
      "The workflow was transitioned.",
    ]) {
      it(`rejects prohibited authority claim: ${claim}`, () => {
        const output = validOutput();
        output.warnings = [claim];

        expectReason(
          () =>
            validateCapaIntakeAdvisoryModelOutput(
              JSON.stringify(output),
            ),
          "PROHIBITED_AUTHORITY_CLAIM",
        );
      });
    }

    it("permits questions about required human approval", () => {
      const output = validOutput();
      output.human_action_required = [
        "Which authorized human must approve the final disposition?",
      ];

      expect(
        validateCapaIntakeAdvisoryModelOutput(
          JSON.stringify(output),
        ).human_action_required,
      ).toEqual([
        "Which authorized human must approve the final disposition?",
      ]);
    });
  },
);
