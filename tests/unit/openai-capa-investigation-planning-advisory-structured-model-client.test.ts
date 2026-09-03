import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-profile";
import {
  OpenAICapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/openai-capa-investigation-planning-advisory-structured-model-client";

function harness() {
  const create = vi.fn();
  const client = {
    responses: { create },
  } as unknown as Pick<OpenAI, "responses">;
  return { client, create };
}

function input() {
  return {
    prompt: "CONTROLLED S30 INVESTIGATION-PLANNING PROMPT",
    model_profile_version:
      CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version,
    output_schema_name:
      CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
    maximum_output_characters:
      CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
        .maximum_output_characters,
    store: false as const,
  };
}

function adapter(test: ReturnType<typeof harness>) {
  return new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClient(
    test.client,
    { model: "gpt-5.6" },
  );
}

const validOutput = JSON.stringify({
  proposal: {
    investigation_questions: [],
    evidence_requests: [],
    method_suggestions: [],
    dependencies: [],
    proposed_owner_role: [],
    gaps: [],
  },
  assumptions: [],
  uncertainty_and_limitations: [],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
});

describe("OpenAI S30 investigation-planning structured model client", () => {
  it("sends strict JSON Schema Structured Outputs without provider storage", async () => {
    const test = harness();
    test.create.mockResolvedValue({ output_text: validOutput });

    const result = await adapter(test).generateStructured(input());

    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.create).toHaveBeenCalledWith({
      model: "gpt-5.6",
      input: "CONTROLLED S30 INVESTIGATION-PLANNING PROMPT",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "capa_investigation_planning_advisory_1_0_0",
          schema: CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
          strict: true,
        },
      },
    });
    expect(result.output_text).toBe(validOutput);
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("rejects controlled configuration mismatches before provider execution", async () => {
    const mismatches = [
      ["model profile", { model_profile_version: "wrong-profile" }],
      ["schema name", { output_schema_name: "wrong-schema" }],
      [
        "maximum output size",
        {
          maximum_output_characters:
            CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
              .maximum_output_characters - 1,
        },
      ],
      ["storage", { store: true }],
      ["prompt", { prompt: "  " }],
      [
        "schema",
        {
          output_schema: {
            ...CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
            additionalProperties: true,
          },
        },
      ],
    ] as const;

    for (const [_name, override] of mismatches) {
      const test = harness();
      await expect(
        adapter(test).generateStructured({ ...input(), ...override } as never),
      ).rejects.toMatchObject({
        name:
          "OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError",
      });
      expect(test.create).not.toHaveBeenCalled();
    }
  });

  it("rejects missing, non-string, and oversized provider output", async () => {
    for (const output of [
      undefined,
      null,
      42,
      "   ",
      "x".repeat(
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
          .maximum_output_characters + 1,
      ),
    ]) {
      const test = harness();
      test.create.mockResolvedValue({ output_text: output });
      await expect(adapter(test).generateStructured(input())).rejects.toMatchObject(
        {
          name:
            "OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError",
        },
      );
    }
  });

  it("normalizes provider failures and invalid model configuration", async () => {
    const test = harness();
    test.create.mockRejectedValue(new Error("provider-secret request-id"));
    await expect(adapter(test).generateStructured(input())).rejects.toMatchObject(
      {
        name:
          "OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError",
        message: "The governed CAPA structured model operation failed.",
      },
    );

    expect(
      () =>
        new OpenAICapaInvestigationPlanningAdvisoryStructuredModelClient(
          test.client,
          { model: "" },
        ),
    ).toThrow(
      expect.objectContaining({
        name:
          "OpenAICapaInvestigationPlanningAdvisoryStructuredModelClientError",
      }),
    );
  });
});
