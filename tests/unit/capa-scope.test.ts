import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_SCOPE_SCHEMA_VERSION,
  CAPA_SCOPE_SECTION_TYPE,
  evaluateCapaScopeGatePrerequisites,
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

    affected_scope_elements: [
      {
        element_type:
          "product",
        value:
          "Device family A",
      },
      {
        element_type:
          "process",
        value:
          "Machining operation 40",
      },
    ],

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
        "Batch population under investigation",
    },

    priority:
      "High",

    target_dates: [
      {
        label:
          "Investigation target",
        target_date:
          "2026-09-15",
      },
    ],

    applicability: {
      decision:
        "capa_applicable",
      rationale:
        "A systemic investigation is required.",
    },

    source_reference:
      "NCR-2026-0042",

    evidence_references: [
      "inspection-record-001",
    ],

    unresolved_scope_gaps: [],

    required_escalations: [
      {
        process:
          "Regulatory assessment",
        reference:
          "RA-2026-001",
        status:
          "resolved",
        rationale:
          "Qualified regulatory review completed before G-01.",
      },
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
          "capa-scope-1.1.0",
        );
      },
    );

    it(
      "accepts a complete structured S10 scope record",
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
              .affected_scope_elements,
          ).toHaveLength(2);

          expect(
            result.value.applicability
              ?.decision,
          ).toBe(
            "capa_applicable",
          );
        }
      },
    );

    it(
      "allows structurally valid incomplete working scope without calling it adequate",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            problem_statement: null,
            affected_scope_elements: [],
            included_scope: [],
            extent_summary: {
              magnitude: null,
              frequency: null,
              trend: null,
              affected_population: null,
            },
            scope_dimensions: {
              what: null,
              where: null,
              when: null,
              extent: null,
              detection_method: null,
            },
            priority: null,
            target_dates: [],
            applicability: null,
            source_reference: null,
            unresolved_scope_gaps: [
              "Problem definition remains incomplete.",
            ],
          });

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            evaluateCapaScopeGatePrerequisites(
              result.value,
            ).status,
          ).toBe("blocked");
        }
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
      "rejects duplicate structured scope elements",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            affected_scope_elements: [
              value
                .affected_scope_elements[0],
              value
                .affected_scope_elements[0],
            ],
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_AFFECTED_SCOPE_ELEMENTS",
        });
      },
    );

    it(
      "rejects invalid target dates",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            target_dates: [
              {
                label:
                  "Investigation target",
                target_date:
                  "2026-02-31",
              },
            ],
          });

        expect(result).toEqual({
          status: "invalid",
          reason_code:
            "INVALID_TARGET_DATES",
        });
      },
    );

    it(
      "meets deterministic G-01 prerequisites without representing human approval",
      () => {
        const result =
          validateCapaScopeContent(
            validScope(),
          );

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            evaluateCapaScopeGatePrerequisites(
              result.value,
            ),
          ).toEqual({
            status:
              "prerequisites_met",
          });
        }
      },
    );

    it(
      "blocks G-01 prerequisites when CAPA applicability is not confirmed",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            applicability: {
              decision: "pending",
              rationale:
                "Quality review remains open.",
            },
          });

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            evaluateCapaScopeGatePrerequisites(
              result.value,
            ),
          ).toEqual({
            status: "blocked",
            blocker_codes: [
              "CAPA_APPLICABILITY_NOT_CONFIRMED",
            ],
          });
        }
      },
    );

    it(
      "blocks unresolved scope gaps and required escalations",
      () => {
        const value = validScope();

        const result =
          validateCapaScopeContent({
            ...value,
            unresolved_scope_gaps: [
              "Potential supplier scope remains unresolved.",
            ],
            required_escalations: [
              {
                process:
                  "Regulatory assessment",
                reference:
                  "RA-2026-002",
                status: "open",
                rationale:
                  "Assessment is required before G-01.",
              },
            ],
          });

        expect(result.status)
          .toBe("valid");

        if (result.status === "valid") {
          expect(
            evaluateCapaScopeGatePrerequisites(
              result.value,
            ),
          ).toEqual({
            status: "blocked",
            blocker_codes: [
              "UNRESOLVED_SCOPE_GAPS",
              "UNRESOLVED_REQUIRED_ESCALATION",
            ],
          });
        }
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
