import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_INTAKE_ADVISORY_OUTPUT,
  CAPA_INTAKE_ADVISORY_PROPOSAL_FIELDS,
  CAPA_INTAKE_ADVISORY_STATUSES,
} from "../../lib/capa/ai/capa-intake-advisory-contract";

describe(
  "CAPA intake advisory contract",
  () => {
    it("publishes the controlled advisory operation", () => {
      expect(
        CAPA_INTAKE_ADVISORY_OUTPUT,
      ).toBe("intake_analysis");
    });

    it("publishes only the approved intake proposal fields", () => {
      expect(
        CAPA_INTAKE_ADVISORY_PROPOSAL_FIELDS,
      ).toEqual([
        "problem_statement_draft",
        "scope_dimensions",
        "missing_dimensions",
        "containment_risk_questions",
        "investigation_questions",
      ]);
    });

    it("does not publish an approval status", () => {
      expect(
        CAPA_INTAKE_ADVISORY_STATUSES,
      ).toEqual([
        "completed_draft",
        "validation_failed",
        "service_failed",
      ]);
      expect(
        CAPA_INTAKE_ADVISORY_STATUSES,
      ).not.toContain("approved");
    });
  },
);
