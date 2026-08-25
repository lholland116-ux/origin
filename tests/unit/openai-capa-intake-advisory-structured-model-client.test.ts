import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type OpenAI from "openai";

import {
  CAPA_INTAKE_ADVISORY_JSON_SCHEMA,
  CAPA_INTAKE_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-intake-advisory-model-generator";

import {
  OpenAICapaIntakeAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/openai-capa-intake-advisory-structured-model-client";

function harness() {
  const create = vi.fn();

  const client = {
    responses: {
      create,
    },
  } as unknown as Pick<
    OpenAI,
    "responses"
  >;

  return {
    client,
    create,
  };
}

function input() {
  return {
    model_profile_version:
      CAPA_INTAKE_ADVISORY_MODEL_PROFILE
        .profile_version,

    prompt:
      "CONTROLLED CAPA ADVISORY PROMPT",

    output_schema_name:
      CAPA_INTAKE_ADVISORY_MODEL_PROFILE
        .output_schema_name,

    output_schema:
      CAPA_INTAKE_ADVISORY_JSON_SCHEMA,

    maximum_output_characters:
      CAPA_INTAKE_ADVISORY_MODEL_PROFILE
        .maximum_output_characters,

    store: false as const,
  };
}

describe(
  "OpenAI CAPA intake advisory structured model client",
  () => {
    it("uses the server-controlled model and strict Structured Outputs", async () => {
      const test = harness();

      test.create.mockResolvedValue({
        output_text:
          '{"proposal":{"problem_statement_draft":"draft","scope_dimensions":[],"missing_dimensions":[],"containment_risk_questions":[],"investigation_questions":[]},"assumptions":[],"missing_information":[],"conflicts_and_alternatives":[],"uncertainty_and_limitations":[],"human_action_required":[],"warnings":[]}',
      });

      const adapter =
        new OpenAICapaIntakeAdvisoryStructuredModelClient(
          test.client,
          {
            model: "gpt-5.6",
          },
        );

      const result =
        await adapter.generateStructured(
          input(),
        );

      expect(
        test.create,
      ).toHaveBeenCalledTimes(1);

      expect(
        test.create,
      ).toHaveBeenCalledWith({
        model: "gpt-5.6",

        input:
          "CONTROLLED CAPA ADVISORY PROMPT",

        store: false,

        text: {
          format: {
            type: "json_schema",

            name:
              "capa_intake_advisory_1_0_0",

            schema:
              CAPA_INTAKE_ADVISORY_JSON_SCHEMA,

            strict: true,
          },
        },
      });

      expect(
        result.output_text,
      ).toContain(
        '"problem_statement_draft":"draft"',
      );
    });

    it("normalizes provider failures", async () => {
      const test = harness();

      test.create.mockRejectedValue(
        new Error(
          "provider-secret-detail",
        ),
      );

      const adapter =
        new OpenAICapaIntakeAdvisoryStructuredModelClient(
          test.client,
          {
            model: "gpt-5.6",
          },
        );

      await expect(
        adapter.generateStructured(
          input(),
        ),
      ).rejects.toMatchObject({
        name:
          "OpenAICapaIntakeAdvisoryStructuredModelClientError",

        message:
          "The governed CAPA structured model operation failed.",
      });
    });

    it("rejects empty provider output", async () => {
      const test = harness();

      test.create.mockResolvedValue({
        output_text: "   ",
      });

      const adapter =
        new OpenAICapaIntakeAdvisoryStructuredModelClient(
          test.client,
          {
            model: "gpt-5.6",
          },
        );

      await expect(
        adapter.generateStructured(
          input(),
        ),
      ).rejects.toMatchObject({
        name:
          "OpenAICapaIntakeAdvisoryStructuredModelClientError",
      });
    });

    it("rejects provider output beyond the governed character limit", async () => {
      const test = harness();

      test.create.mockResolvedValue({
        output_text:
          "x".repeat(
            CAPA_INTAKE_ADVISORY_MODEL_PROFILE
              .maximum_output_characters +
              1,
          ),
      });

      const adapter =
        new OpenAICapaIntakeAdvisoryStructuredModelClient(
          test.client,
          {
            model: "gpt-5.6",
          },
        );

      await expect(
        adapter.generateStructured(
          input(),
        ),
      ).rejects.toMatchObject({
        name:
          "OpenAICapaIntakeAdvisoryStructuredModelClientError",
      });
    });

    it("rejects uncontrolled invocation settings before calling OpenAI", async () => {
      const test = harness();

      const adapter =
        new OpenAICapaIntakeAdvisoryStructuredModelClient(
          test.client,
          {
            model: "gpt-5.6",
          },
        );

      await expect(
        adapter.generateStructured({
          ...input(),

          model_profile_version:
            "uncontrolled-profile",
        } as never),
      ).rejects.toMatchObject({
        name:
          "OpenAICapaIntakeAdvisoryStructuredModelClientError",
      });

      expect(
        test.create,
      ).not.toHaveBeenCalled();
    });

    it("rejects an invalid server model configuration", () => {
      const test = harness();

      expect(
        () =>
          new OpenAICapaIntakeAdvisoryStructuredModelClient(
            test.client,
            {
              model: "   ",
            },
          ),
      ).toThrow(
        expect.objectContaining({
          name:
            "OpenAICapaIntakeAdvisoryStructuredModelClientError",
        }),
      );
    });
  },
);
