import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type OpenAI from "openai";

import {
  CAPA_CONTAINMENT_RISK_ADVISORY_JSON_SCHEMA,
  CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-containment-risk-advisory-model-generator";

import {
  OpenAICapaContainmentRiskAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/openai-capa-containment-risk-advisory-structured-model-client";

function harness() {
  const create = vi.fn();

  const client = {
    responses: {
      create,
    },
  } as unknown as Pick<OpenAI, "responses">;

  return { client, create };
}

function input() {
  return {
    model_profile_version:
      CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE.profile_version,
    prompt: "CONTROLLED S20 CONTAINMENT-RISK ADVISORY PROMPT",
    output_schema_name:
      CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_CONTAINMENT_RISK_ADVISORY_JSON_SCHEMA,
    maximum_output_characters:
      CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE.maximum_output_characters,
    store: false as const,
  };
}

function adapter(test: ReturnType<typeof harness>) {
  return new OpenAICapaContainmentRiskAdvisoryStructuredModelClient(
    test.client,
    { model: "gpt-5.6" },
  );
}

const validOutput = JSON.stringify({
  proposal: {
    missing_risk_inputs: [],
    missing_impact_dimensions: [],
    human_review_questions: ["Is additional evidence required?"],
    evidence_provenance_gaps: [],
  },
  assumptions: [],
  uncertainty_and_limitations: [],
  citations: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
});

describe(
  "OpenAI CAPA containment-risk advisory structured model client",
  () => {
    it("uses strict S20 Structured Outputs and returns output text unchanged", async () => {
      const test = harness();
      test.create.mockResolvedValue({ output_text: validOutput });

      const result = await adapter(test).generateStructured(input());

      expect(test.create).toHaveBeenCalledTimes(1);
      expect(test.create).toHaveBeenCalledWith({
        model: "gpt-5.6",
        input: "CONTROLLED S20 CONTAINMENT-RISK ADVISORY PROMPT",
        store: false,
        text: {
          format: {
            type: "json_schema",
            name: "capa_containment_risk_advisory_1_0_0",
            schema: CAPA_CONTAINMENT_RISK_ADVISORY_JSON_SCHEMA,
            strict: true,
          },
        },
      });
      expect(result.output_text).toBe(validOutput);
      expect(Object.isFrozen(result)).toBe(true);
    });

    it("normalizes provider failures without exposing provider details", async () => {
      const test = harness();
      test.create.mockRejectedValue(
        new Error("provider-secret request-id api-key"),
      );

      await expect(adapter(test).generateStructured(input())).rejects.toMatchObject({
        name: "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError",
        message: "The governed CAPA structured model operation failed.",
      });
    });

    it.each([
      ["empty", "   "],
      [
        "oversized",
        "x".repeat(
          CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE.maximum_output_characters +
            1,
        ),
      ],
    ])("rejects %s provider output", async (_name, output) => {
      const test = harness();
      test.create.mockResolvedValue({ output_text: output });

      await expect(adapter(test).generateStructured(input())).rejects.toMatchObject({
        name: "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError",
      });
    });

    it.each([
      ["model profile", { model_profile_version: "wrong-profile" }],
      ["schema name", { output_schema_name: "wrong-schema" }],
      [
        "maximum output size",
        {
          maximum_output_characters:
            CAPA_CONTAINMENT_RISK_ADVISORY_MODEL_PROFILE.maximum_output_characters -
            1,
        },
      ],
      ["storage", { store: true }],
      ["empty prompt", { prompt: "  " }],
    ] as const)("rejects an uncontrolled %s before calling OpenAI", async (_name, override) => {
      const test = harness();

      await expect(
        adapter(test).generateStructured({
          ...input(),
          ...override,
        } as never),
      ).rejects.toMatchObject({
        name: "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError",
      });
      expect(test.create).not.toHaveBeenCalled();
    });

    it.each(["", "   ", "x".repeat(129)])(
      "rejects invalid server model configuration (%s)",
      (model) => {
        const test = harness();

        expect(
          () =>
            new OpenAICapaContainmentRiskAdvisoryStructuredModelClient(
              test.client,
              { model },
            ),
        ).toThrow(
          expect.objectContaining({
            name: "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError",
          }),
        );
      },
    );

    it("rejects an unserializable schema before provider execution", async () => {
      const test = harness();
      const circular: Record<string, unknown> = {};
      circular.self = circular;

      await expect(
        adapter(test).generateStructured({
          ...input(),
          output_schema: circular,
        } as never),
      ).rejects.toMatchObject({
        name: "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError",
      });
      expect(test.create).not.toHaveBeenCalled();
    });

    it("rejects a malformed schema value before provider execution", async () => {
      const test = harness();

      await expect(
        adapter(test).generateStructured({
          ...input(),
          output_schema: null,
        } as never),
      ).rejects.toMatchObject({
        name: "OpenAICapaContainmentRiskAdvisoryStructuredModelClientError",
      });
      expect(test.create).not.toHaveBeenCalled();
    });
  },
);
