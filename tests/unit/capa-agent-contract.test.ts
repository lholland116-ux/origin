import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_AGENT_IDS,
  CAPA_AGENT_OPERATIONS,
  CAPA_AGENT_OUTPUT_FIELDS,
  CAPA_AGENT_PROHIBITIONS,
  CAPA_AGENT_STATUSES,
  CAPA_AGENT_TOOL_IDS,
} from "../../lib/capa/ai/capa-agent-contract";

describe(
  "controlled CAPA agent contract",
  () => {
    it(
      "defines the approved logical agent catalog",
      () => {
        expect(CAPA_AGENT_IDS).toEqual([
          "AG-CAPA-ORCH",
          "AG-INTAKE",
          "AG-PLAN",
          "AG-EVID",
          "AG-RCA",
          "AG-ACTION",
          "AG-IMPLEMENT",
          "AG-EFFECT",
          "AG-REVIEW",
          "AG-REPORT",
          "AG-REOPEN",
        ]);
      },
    );

    it(
      "defines only controlled lifecycle statuses",
      () => {
        expect(
          CAPA_AGENT_STATUSES,
        ).toEqual([
          "draft",
          "evaluation",
          "approved",
          "retired",
          "blocked",
        ]);
      },
    );

    it(
      "defines controlled unique operations",
      () => {
        expect(
          CAPA_AGENT_OPERATIONS,
        ).toContain("analyze_containment_impact_risk");
        expect(
          new Set(
            CAPA_AGENT_OPERATIONS,
          ).size,
        ).toBe(
          CAPA_AGENT_OPERATIONS.length,
        );
      },
    );

    it(
      "defines the approved tool registry vocabulary",
      () => {
        expect(
          CAPA_AGENT_TOOL_IDS,
        ).toEqual([
          "TOOL-CASE-READ",
          "TOOL-EVIDENCE-READ",
          "TOOL-RETRIEVE",
          "TOOL-STRUCTURED-DRAFT",
          "TOOL-FILE-EXTRACT-READ",
          "TOOL-CALCULATE",
          "TOOL-REPORT-DRAFT",
          "TOOL-FEEDBACK",
        ]);
      },
    );

    it(
      "makes human and regulatory authority explicitly prohibited",
      () => {
        expect(
          CAPA_AGENT_PROHIBITIONS,
        ).toEqual(
          expect.arrayContaining([
            "APPROVE_GATE",
            "TRANSITION_WORKFLOW",
            "CLOSE_CASE",
            "CANCEL_CASE",
            "REOPEN_CASE",
            "CHOOSE_REENTRY",
            "DETERMINE_PRODUCT_RELEASE",
            "DETERMINE_PATIENT_TREATMENT",
            "DETERMINE_RECALL_OR_FIELD_ACTION",
            "DETERMINE_REGULATORY_REPORTABILITY",
            "SUBMIT_EXTERNALLY",
            "SIGN_CONTROLLED_RECORD",
          ]),
        );
      },
    );

    it(
      "includes the required AG-INTAKE proposal fields",
      () => {
        expect(
          CAPA_AGENT_OUTPUT_FIELDS,
        ).toEqual(
          expect.arrayContaining([
            "problem_statement_draft",
            "scope_dimensions",
            "missing_dimensions",
            "containment_risk_questions",
            "assumptions",
          ]),
        );
      },
    );
  },
);
