import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CAPA_AI_OUTPUT_STATUSES,
  CAPA_PROMPT_LAYER_ORDER,
  CAPA_PROMPT_TRUST_LEVELS,
} from "../../lib/capa/ai/capa-prompt-contract";

describe(
  "CAPA controlled prompt contract",
  () => {
    it(
      "fixes the approved ten-layer assembly order",
      () => {
        expect(
          CAPA_PROMPT_LAYER_ORDER,
        ).toEqual([
          "platform_system_policy",
          "product_policy",
          "agent_definition",
          "workflow_context",
          "authorization_context",
          "minimum_case_context",
          "retrieved_sources",
          "user_request",
          "tool_results",
          "output_contract",
        ]);

        expect(
          CAPA_PROMPT_LAYER_ORDER,
        ).toHaveLength(10);
      },
    );

    it(
      "defines explicit trust classifications",
      () => {
        expect(
          CAPA_PROMPT_TRUST_LEVELS,
        ).toEqual([
          "trusted_control",
          "trusted_server_context",
          "untrusted_data",
        ]);
      },
    );

    it(
      "excludes approval and false-success statuses",
      () => {
        expect(
          CAPA_AI_OUTPUT_STATUSES,
        ).toEqual([
          "completed_draft",
          "validation_failed",
          "service_failed",
        ]);

        expect(
          CAPA_AI_OUTPUT_STATUSES,
        ).not.toContain("approved");

        expect(
          CAPA_AI_OUTPUT_STATUSES,
        ).not.toContain("completed");
      },
    );
  },
);
