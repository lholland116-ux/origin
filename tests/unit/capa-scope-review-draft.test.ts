import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildCapaScopeReviewSubmission,
  EMPTY_CAPA_SCOPE_REVIEW_DRAFT,
  type CapaScopeReviewDraft,
} from "../../app/capa/capa-scope-review-draft";

function validDraft():
  CapaScopeReviewDraft {
  return {
    ...EMPTY_CAPA_SCOPE_REVIEW_DRAFT,

    problemStatement:
      "Seal failures were observed during final inspection.",

    what:
      "Seal integrity failures",

    where:
      "Packaging line 2",

    when:
      "August 2026",

    detectionMethod:
      "Final inspection",

    affectedScopeRows:
      [
        "product | Device family A",
        "process | Packaging line 2",
      ].join("\n"),

    includedScope:
      [
        "Device family A",
        "Packaging line 2",
      ].join("\n"),

    exclusionRows:
      "Device family B | No related failures identified",

    magnitude:
      "12 affected units",

    frequency:
      "12 of 2,400 units",

    priority:
      "High",

    targetDateRows:
      "Investigation target | 2026-09-30",

    applicabilityDecision:
      "capa_applicable",

    applicabilityRationale:
      "The recurring quality-system issue requires corrective action.",

    sourceReference:
      "NCR-2026-104",

    evidenceReferences:
      [
        "NCR-2026-104",
        "Inspection lot 26A17",
      ].join("\n"),

    escalationRows:
      "Regulatory assessment | RA-2026-18 | resolved | No field action required",

    approvalRationale:
      "The problem, affected scope, extent, timing, applicability, and required escalation have been reviewed.",
  };
}

describe(
  "CAPA scope review draft",
  () => {
    it(
      "builds the complete controlled scope content",
      () => {
        const result =
          buildCapaScopeReviewSubmission(
            validDraft(),
          );

        expect(result.valid)
          .toBe(true);

        if (!result.valid) {
          throw new Error(
            result.message,
          );
        }

        expect(
          result.submission.scope,
        ).toEqual({
          problem_statement:
            "Seal failures were observed during final inspection.",

          scope_dimensions: {
            what:
              "Seal integrity failures",
            where:
              "Packaging line 2",
            when:
              "August 2026",
            extent:
              null,
            detection_method:
              "Final inspection",
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
                "Packaging line 2",
            },
          ],

          included_scope: [
            "Device family A",
            "Packaging line 2",
          ],

          exclusions: [
            {
              subject:
                "Device family B",
              rationale:
                "No related failures identified",
            },
          ],

          extent_summary: {
            magnitude:
              "12 affected units",
            frequency:
              "12 of 2,400 units",
            trend:
              null,
            affected_population:
              null,
          },

          priority:
            "High",

          target_dates: [
            {
              label:
                "Investigation target",
              target_date:
                "2026-09-30",
            },
          ],

          applicability: {
            decision:
              "capa_applicable",
            rationale:
              "The recurring quality-system issue requires corrective action.",
          },

          source_reference:
            "NCR-2026-104",

          evidence_references: [
            "NCR-2026-104",
            "Inspection lot 26A17",
          ],

          unresolved_scope_gaps: [],

          required_escalations: [
            {
              process:
                "Regulatory assessment",
              reference:
                "RA-2026-18",
              status:
                "resolved",
              rationale:
                "No field action required",
            },
          ],
        });

        expect(
          result.submission
            .approvalRationale,
        ).toBe(
          "The problem, affected scope, extent, timing, applicability, and required escalation have been reviewed.",
        );
      },
    );

    it.each([
      [
        "problemStatement",
        {
          problemStatement: "",
        },
      ],
      [
        "affectedScopeRows",
        {
          affectedScopeRows: "",
        },
      ],
      [
        "includedScope",
        {
          includedScope: "",
        },
      ],
      [
        "scope",
        {
          magnitude: "",
          frequency: "",
          trend: "",
          affectedPopulation: "",
        },
      ],
      [
        "priority",
        {
          priority: "",
        },
      ],
      [
        "targetDateRows",
        {
          targetDateRows: "",
        },
      ],
      [
        "applicabilityDecision",
        {
          applicabilityDecision:
            "pending" as const,
        },
      ],
      [
        "applicabilityRationale",
        {
          applicabilityRationale: "",
        },
      ],
      [
        "sourceReference",
        {
          sourceReference: "",
        },
      ],
      [
        "unresolvedScopeGaps",
        {
          unresolvedScopeGaps:
            "Supplier population remains unknown",
        },
      ],
      [
        "approvalRationale",
        {
          approvalRationale: "",
        },
      ],
    ] as const)(
      "blocks incomplete G-01 prerequisite field %s",
      (
        expectedField,
        change,
      ) => {
        const result =
          buildCapaScopeReviewSubmission({
            ...validDraft(),
            ...change,
          });

        expect(result.valid)
          .toBe(false);

        if (result.valid) {
          throw new Error(
            "Expected blocked scope review.",
          );
        }

        expect(
          result.field,
        ).toBe(
          expectedField,
        );
      },
    );

    it(
      "rejects malformed affected-scope rows",
      () => {
        const result =
          buildCapaScopeReviewSubmission({
            ...validDraft(),

            affectedScopeRows:
              "invalid-type | Device A",
          });

        expect(result)
          .toMatchObject({
            valid: false,
            field:
              "affectedScopeRows",
          });
      },
    );

    it(
      "rejects malformed target dates",
      () => {
        const result =
          buildCapaScopeReviewSubmission({
            ...validDraft(),

            targetDateRows:
              "Target | 2026-02-31",
          });

        expect(result)
          .toMatchObject({
            valid: false,
            field:
              "targetDateRows",
          });
      },
    );

    it(
      "blocks open required escalation",
      () => {
        const result =
          buildCapaScopeReviewSubmission({
            ...validDraft(),

            escalationRows:
              "Regulatory assessment | RA-1 | open | Pending review",
          });

        expect(result)
          .toMatchObject({
            valid: false,
            field:
              "escalationRows",
          });
      },
    );

    it(
      "allows no optional exclusions or escalations",
      () => {
        const result =
          buildCapaScopeReviewSubmission({
            ...validDraft(),

            exclusionRows: "",
            escalationRows: "",
            evidenceReferences: "",
          });

        expect(result.valid)
          .toBe(true);

        if (!result.valid) {
          return;
        }

        expect(
          result.submission
            .scope.exclusions,
        ).toEqual([]);

        expect(
          result.submission
            .scope.required_escalations,
        ).toEqual([]);

        expect(
          result.submission
            .scope.evidence_references,
        ).toEqual([]);
      },
    );
  },
);
