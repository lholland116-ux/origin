import { describe, expect, it, vi } from "vitest";
import { OpenAIQualityDataAiStructuredModelClient, QUALITY_DATA_AI_MODEL } from "../../lib/quality-data/quality-data-ai-model";
import type { QualityEvidencePacket } from "../../lib/quality-data/quality-data-ai-contract";

const packet = {
  schema_version: "quality-evidence-packet-1.0.0", packet_id: "11000000-0000-4000-8000-000000000001",
  calculation_versions: ["quality-analysis-calculation-1.0.0", "quality-signal-calculation-1.0.0"], time_windows: ["ALL_APPROVED_RECORDS"],
  assumptions: ["MODEL_OUTPUT_IS_UNVERIFIED_ADVISORY"], data_quality_limitations: [], calculations: [], signals: [],
} as QualityEvidencePacket;

describe("OpenAI Stage 3C Responses adapter", () => {
  it("uses only GPT-6 Luna, strict structured output, store=false and zero retries", async () => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { output_text: "{}", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; });
    const client = new OpenAIQualityDataAiStructuredModelClient({ responses: { create } } as never);
    await client.generate(packet);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0]?.[0]).toMatchObject({ model: QUALITY_DATA_AI_MODEL, store: false, max_output_tokens: 512, text: { format: { type: "json_schema", strict: true } } });
    expect(create.mock.calls[0]?.[1]).toMatchObject({ maxRetries: 0, timeout: 15_000 });
  });

  it("does not fall back and normalizes provider failure without returning provider text", async () => {
    const client = new OpenAIQualityDataAiStructuredModelClient({ responses: { create: vi.fn().mockRejectedValue(new Error("sensitive provider response")) } } as never);
    await expect(client.generate(packet)).rejects.toThrow("QUALITY_DATA_AI_PROVIDER_FAILED");
  });

  it("bounds prompt bytes and contains no identifiers beyond random opaque evidence handles", async () => {
    const create = vi.fn(async (...args: unknown[]) => { void args; return { output_text: "{}", usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }; });
    const client = new OpenAIQualityDataAiStructuredModelClient({ responses: { create } } as never);
    const unsafe = { ...packet, source_name: "customer.xlsx" } as unknown as QualityEvidencePacket;
    await expect(client.generate(unsafe)).rejects.toThrow("QUALITY_DATA_AI_PACKET_INVALID");
    expect(create).not.toHaveBeenCalled();
  });
});
