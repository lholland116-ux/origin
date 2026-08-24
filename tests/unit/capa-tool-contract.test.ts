import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_TOOL_CAPABILITY_CLASSES,
  CAPA_TOOL_DATA_CLASSES,
  CAPA_TOOL_EXECUTION_REASON_CODES,
  CAPA_TOOL_STATUSES,
  type CapaToolDefinition,
  type CapaToolExecutionResult,
} from "../../lib/capa/ai/capa-tool-contract";

import {
  CAPA_AGENT_TOOL_IDS,
} from "../../lib/capa/ai/capa-agent-contract";

describe(
  "governed CAPA tool contract",
  () => {
    it(
      "defines controlled lifecycle statuses",
      () => {
        expect(CAPA_TOOL_STATUSES).toEqual([
          "draft",
          "evaluation",
          "approved",
          "retired",
          "blocked",
        ]);
      },
    );

    it(
      "limits capability classes to non-workflow behavior",
      () => {
        expect(
          CAPA_TOOL_CAPABILITY_CLASSES,
        ).toEqual([
          "read_only",
          "deterministic_compute",
          "controlled_draft",
        ]);

        expect(
          CAPA_TOOL_CAPABILITY_CLASSES,
        ).not.toContain("workflow_mutation");
        expect(
          CAPA_TOOL_CAPABILITY_CLASSES,
        ).not.toContain("external_action");
        expect(
          CAPA_TOOL_CAPABILITY_CLASSES,
        ).not.toContain("approval");
      },
    );

    it(
      "defines explicit governed data classes",
      () => {
        expect(CAPA_TOOL_DATA_CLASSES)
          .toEqual([
            "authorized_case_data",
            "authorized_evidence",
            "governed_knowledge",
            "derived_non_authoritative",
          ]);
      },
    );

    it(
      "retains only the eight approved tool identities",
      () => {
        expect(CAPA_AGENT_TOOL_IDS)
          .toEqual([
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
      "requires every definition to prohibit direct mutations and external side effects",
      () => {
        const definition = {
          direct_case_mutation: false,
          external_side_effects: false,
          audit_required: true,
          tenant_scope_required: true,
        } satisfies Pick<
          CapaToolDefinition,
          | "direct_case_mutation"
          | "external_side_effects"
          | "audit_required"
          | "tenant_scope_required"
        >;

        expect(definition).toEqual({
          direct_case_mutation: false,
          external_side_effects: false,
          audit_required: true,
          tenant_scope_required: true,
        });
      },
    );

    it(
      "defines stable fail-closed execution reasons",
      () => {
        expect(
          CAPA_TOOL_EXECUTION_REASON_CODES,
        ).toContain(
          "TENANT_SCOPE_DENIED",
        );
        expect(
          CAPA_TOOL_EXECUTION_REASON_CODES,
        ).toContain(
          "AGENT_TOOL_NOT_ALLOWED",
        );
        expect(
          CAPA_TOOL_EXECUTION_REASON_CODES,
        ).toContain(
          "OUTPUT_VALIDATION_FAILED",
        );
        expect(
          CAPA_TOOL_EXECUTION_REASON_CODES,
        ).not.toContain(
          "WORKFLOW_TRANSITION_SUCCEEDED",
        );
      },
    );

    it(
      "keeps successful output explicitly non-authoritative",
      () => {
        const result = {
          status: "succeeded",
          reason_code:
            "TOOL_EXECUTION_SUCCEEDED",
          output: {
            value: "draft",
          },
          receipt: {
            output_data_class:
              "derived_non_authoritative",
          },
        } as unknown as
          CapaToolExecutionResult;

        expect(result.status).toBe(
          "succeeded",
        );
        expect(result).not.toHaveProperty(
          "approved",
        );
        expect(result).not.toHaveProperty(
          "workflow_transition",
        );
        expect(result).not.toHaveProperty(
          "compliance_determination",
        );
      },
    );
  },
);
