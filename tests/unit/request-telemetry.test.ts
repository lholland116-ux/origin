import { describe, expect, it } from "vitest";
import {
  isProviderReasoningEffort,
  mapOpenAIResponseUsage,
  PROVIDER_REASONING_EFFORTS,
  type AiRequestTelemetryRecord,
} from "@/lib/ai/request-telemetry";

describe("ProviderReasoningEffort", () => {
  it.each([
    "none",
    "low",
    "medium",
    "high",
    "xhigh",
    "max",
  ] as const)("accepts the frozen provider effort %s", (effort) => {
    expect(isProviderReasoningEffort(effort)).toBe(true);
  });

  it("defines exactly the supported provider effort domain", () => {
    expect(PROVIDER_REASONING_EFFORTS).toEqual([
      "none",
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
  });

  it.each(["minimal", "invalid", "", "Medium"])(
    "rejects unsupported provider effort %j",
    (effort) => {
      expect(isProviderReasoningEffort(effort)).toBe(false);
    },
  );
});

describe("mapOpenAIResponseUsage", () => {
  it("maps all OpenAI Responses usage fields", () => {
    expect(
      mapOpenAIResponseUsage({
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens: 80,
        output_tokens_details: { reasoning_tokens: 50 },
        total_tokens: 180,
      }),
    ).toEqual({
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 80,
      reasoningTokens: 50,
      totalTokens: 180,
    });
  });

  it("preserves zero token values", () => {
    expect(
      mapOpenAIResponseUsage({
        input_tokens: 0,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens: 0,
        output_tokens_details: { reasoning_tokens: 0 },
        total_tokens: 0,
      }),
    ).toEqual({
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      totalTokens: 0,
    });
  });

  it("uses null token fields when usage is missing", () => {
    expect(mapOpenAIResponseUsage(undefined)).toEqual({
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    });
    expect(mapOpenAIResponseUsage(null)).toEqual({
      inputTokens: null,
      cachedInputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      totalTokens: null,
    });
  });

  it("keeps cached input tokens null when their nested detail is missing", () => {
    expect(
      mapOpenAIResponseUsage({
        input_tokens: 100,
        output_tokens: 80,
        output_tokens_details: { reasoning_tokens: 50 },
        total_tokens: 180,
      }),
    ).toEqual({
      inputTokens: 100,
      cachedInputTokens: null,
      outputTokens: 80,
      reasoningTokens: 50,
      totalTokens: 180,
    });
  });

  it("keeps reasoning tokens null when their nested detail is missing", () => {
    expect(
      mapOpenAIResponseUsage({
        input_tokens: 100,
        input_tokens_details: { cached_tokens: 25 },
        output_tokens: 80,
        total_tokens: 180,
      }),
    ).toEqual({
      inputTokens: 100,
      cachedInputTokens: 25,
      outputTokens: 80,
      reasoningTokens: null,
      totalTokens: 180,
    });
  });
});

describe("AiRequestTelemetryRecord", () => {
  it("contains operational metadata and token counts only", () => {
    const record: AiRequestTelemetryRecord = {
      route: "standard",
      attemptKind: "primary",
      model: "gpt-5.6-luna",
      reasoningEffort: "max",
      plan: "free",
      outcome: "success",
      latencyMs: 250,
      hadImage: false,
      ...mapOpenAIResponseUsage(undefined),
    };

    expect(Object.keys(record).sort()).toEqual([
      "attemptKind",
      "cachedInputTokens",
      "hadImage",
      "inputTokens",
      "latencyMs",
      "model",
      "outcome",
      "outputTokens",
      "plan",
      "reasoningEffort",
      "reasoningTokens",
      "route",
      "totalTokens",
    ]);
  });
});
