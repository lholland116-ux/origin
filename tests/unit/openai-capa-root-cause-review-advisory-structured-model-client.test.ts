import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-model-generator";
import {
  OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError,
  OpenAICapaRootCauseReviewAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/openai-capa-root-cause-review-advisory-structured-model-client";

function harness() {
  const create = vi.fn();
  const client = { responses: { create } } as unknown as Pick<OpenAI, "responses">;
  return { client, create };
}

function input() {
  return {
    prompt: "CONTROLLED S50 ROOT-CAUSE REVIEW PROMPT",
    model_profile_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
    output_schema_name: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
    maximum_output_characters: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
    store: false as const,
  };
}

function adapter(test: ReturnType<typeof harness>) {
  return new OpenAICapaRootCauseReviewAdvisoryStructuredModelClient(
    test.client,
    { model: "gpt-5.6" },
  );
}

describe("OpenAI S50 root-cause review structured model client", () => {
  it("sends strict structured output with provider storage disabled", async () => {
    const test = harness();
    test.create.mockResolvedValue({ output_text: "{}" });

    await expect(adapter(test).generateStructured(input())).resolves.toEqual({ output_text: "{}" });
    expect(test.create).toHaveBeenCalledWith({
      model: "gpt-5.6",
      input: "CONTROLLED S50 ROOT-CAUSE REVIEW PROMPT",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
          schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
          strict: true,
        },
      },
    });
  });

  it("fails closed before provider execution for controlled input mismatches", async () => {
    for (const override of [
      { model_profile_version: "wrong" },
      { output_schema_name: "wrong" },
      { maximum_output_characters: 1 },
      { store: true },
      { prompt: " " },
      { output_schema: { type: "object" } },
    ]) {
      const test = harness();
      await expect(adapter(test).generateStructured({ ...input(), ...override } as never)).rejects.toMatchObject({
        name: "OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError",
      });
      expect(test.create).not.toHaveBeenCalled();
    }
  });

  it("normalizes provider failures and rejects malformed provider output", async () => {
    for (const output of [undefined, null, 1, " "]) {
      const test = harness();
      test.create.mockResolvedValue({ output_text: output });
      await expect(adapter(test).generateStructured(input())).rejects.toMatchObject({
        name: "OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError",
      });
    }

    const providerFailure = harness();
    providerFailure.create.mockRejectedValue(new Error("provider secret"));
    await expect(adapter(providerFailure).generateStructured(input())).rejects.toMatchObject({
      name: "OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError",
      message: "The governed CAPA structured model operation failed.",
    });
  });

  it("fails closed when provider output exceeds the governed size limit without leaking provider details", async () => {
    const test = harness();
    test.create.mockResolvedValue({
      output_text: "provider-output-secret-" + "x".repeat(
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
      ),
    });

    await expect(adapter(test).generateStructured(input())).rejects.toBeInstanceOf(
      OpenAICapaRootCauseReviewAdvisoryStructuredModelClientError,
    );
    await expect(adapter(test).generateStructured(input())).rejects.toMatchObject({
      message: "The governed CAPA structured model operation failed.",
    });
  });

  it("rejects invalid model configuration without provider access", () => {
    const test = harness();
    expect(() => new OpenAICapaRootCauseReviewAdvisoryStructuredModelClient(test.client, { model: " " })).toThrow(
      "The governed CAPA structured model operation failed.",
    );
  });
});
