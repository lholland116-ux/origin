import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";

import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-active-advisory-model-profile";
import {
  OpenAICapaInvestigationActiveAdvisoryStructuredModelClient,
} from "../../lib/capa/ai/openai-capa-investigation-active-advisory-structured-model-client";

function harness() {
  const create = vi.fn();
  const client = { responses: { create } } as unknown as Pick<OpenAI, "responses">;
  return { client, create };
}

function input() {
  return {
    prompt: "CONTROLLED S40 INVESTIGATION-ACTIVE PROMPT",
    model_profile_version:
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version,
    output_schema_name:
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
    maximum_output_characters:
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE
        .maximum_output_characters,
    store: false as const,
  };
}

function adapter(test: ReturnType<typeof harness>) {
  return new OpenAICapaInvestigationActiveAdvisoryStructuredModelClient(
    test.client,
    { model: "gpt-5.6" },
  );
}

describe("OpenAI S40 investigation-active structured model client", () => {
  it("sends strict structured output with provider storage disabled", async () => {
    const test = harness();
    test.create.mockResolvedValue({ output_text: "{}" });

    await expect(adapter(test).generateStructured(input())).resolves.toEqual({
      output_text: "{}",
    });
    expect(test.create).toHaveBeenCalledWith({
      model: "gpt-5.6",
      input: "CONTROLLED S40 INVESTIGATION-ACTIVE PROMPT",
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "capa_investigation_active_advisory_1_0_0",
          schema: CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
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
      await expect(
        adapter(test).generateStructured({ ...input(), ...override } as never),
      ).rejects.toMatchObject({
        name: "OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError",
      });
      expect(test.create).not.toHaveBeenCalled();
    }
  });

  it("normalizes provider failures and rejects malformed provider output", async () => {
    for (const output of [undefined, null, 1, " "]) {
      const test = harness();
      test.create.mockResolvedValue({ output_text: output });
      await expect(adapter(test).generateStructured(input())).rejects.toMatchObject({
        name: "OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError",
      });
    }

    const providerFailure = harness();
    providerFailure.create.mockRejectedValue(new Error("provider secret"));
    await expect(
      adapter(providerFailure).generateStructured(input()),
    ).rejects.toMatchObject({
      name: "OpenAICapaInvestigationActiveAdvisoryStructuredModelClientError",
      message: "The governed CAPA structured model operation failed.",
    });
  });
});
