import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_SCOPE_SCHEMA_VERSION,
  CAPA_SCOPE_SECTION_TYPE,
  validateCapaScopeContent,
} from "../../lib/capa/domain/capa-scope";

function validScope() {
  return {
    problem_statement:
      "Thread depth is below the drawing requirement on sampled units.",
    scope_dimensions: {
      what:
        "Primary-port thread depth",
      where:
        "Machining operation 40",
      when:
        "2026-08-28 production",
      extent:
        "12 of 50 sampled units",
      detection_method:
        "Final dimensional inspection",
    },
    included_scope: [
      "Batch under investigation",
    ],
    exclusions: [
      {
        subject:
          "Earlier verified lot",
        rationale:
          "Independent records show a different setup and conforming results.",
      },
    ],
    extent_summary: {
      magnitude:
        "12 nonconforming sampled units",
      frequency:
        "12 of 50 sampled",
      trend: null,
      affected_population:
        "Batch population not yet fully determined",
    },
    applicability_statement:
      "CAPA investigation remains applicable.",
    source_reference:
      "NCR-2026-0042",
    evidence_references: [
      "inspection-record-001",
    ],
    unresolved_scope_gaps: [
      "Total potentially affected lot quantity remains to be confirmed.",
    ],
  };
}

describe(
  "controlled CAPA scope contract",
  () => {
    it(
      "exposes stable controlled identifiers",
      () => {
        expect(
          CAPA_SCOPE_SECTION_TYPE,
        ).toBe("CAPA.SCOPE");

        expect(
          CAPA_SCOPE_SCHEMA_VERSION,
        ).toBe(
          "capa-scope-1.0.0",
        );
      },
    );

    it(
      "accepts a complete structured scope record",
      () => {
        const result =
          validateCapaScopeContent(
            validScope(),
          );

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            result.value
              .scope_dimensions.what,
          ).toBe(
            "Primary-port thread depth",
          );

          expect(
            result.value.exclusions,
          ).toHaveLength(1);
        }
      },
    );

    it(
      "allows structurally valid incomplete working scope",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            problem_statement: null,
            scope_dimensions: {
              what: null,
              where: null,
              when: null,
              extent: null,
              detection_method: null,
            },
            included_scope: [],
            unresolved_scope_gaps: [
              "Problem definition remains incomplete.",
            ],
          });

        expect(result.status)
          .toBe("valid");
      },
    );

    it(
      "requires rationale for every explicit exclusion",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            exclusions: [
              {
                subject: "Lot 2",
                rationale: " ",
              },
            ],
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_SCOPE_EXCLUSIONS",
        });
      },
    );

    it(
      "rejects whitespace-normalization ambiguity",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            problem_statement:
              "  untrimmed",
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_PROBLEM_STATEMENT",
        });
      },
    );

    it(
      "rejects undeclared fields rather than silently persisting them",
      () => {
        const result =
          validateCapaScopeContent({
            ...validScope(),
            ai_approved: true,
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_SCOPE_FIELDS",
        });
      },
    );
  },
);
