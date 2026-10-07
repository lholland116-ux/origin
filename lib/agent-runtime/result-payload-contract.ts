import { createHash } from "node:crypto";
import { z } from "zod";
import type { CapabilityOutputKind } from "@/lib/ai/capability-registry";

/** Existing PostgreSQL execution_steps.result_envelope limit; it remains unchanged. */
export const MAX_INLINE_RESULT_ENVELOPE_BYTES = 65_536;

/**
 * V1 payload bound. Standard permits 200,000 UTF-16 code units; JSON string
 * escaping can expand each code unit to six ASCII bytes (1,200,000 bytes).
 * The extra 110,720 bytes cover the bounded operation metadata and JSONB
 * serialization overhead. Web Search and File Context contracts are smaller.
 */
export const MAX_DURABLE_RESULT_PAYLOAD_BYTES = 1_310_720;

/** JSONB text adds whitespace around object/array separators; cap that representation separately. */
export const MAX_DURABLE_RESULT_JSONB_BYTES = MAX_DURABLE_RESULT_PAYLOAD_BYTES * 2;

export function resultStorageMode(databaseJsonBytes: number): "inline" | "reference" | "too_large" {
  if (!Number.isSafeInteger(databaseJsonBytes) || databaseJsonBytes < 1
    || databaseJsonBytes > MAX_DURABLE_RESULT_JSONB_BYTES) return "too_large";
  return databaseJsonBytes <= MAX_INLINE_RESULT_ENVELOPE_BYTES ? "inline" : "reference";
}

const outputKinds = ["text", "search_results", "image", "structured_data", "artifact", "document"] as const satisfies readonly CapabilityOutputKind[];

export const durablePayloadReferenceSchema = z.object({
  storage: z.literal("payload_ref"),
  payloadId: z.string().uuid(),
  resultKind: z.enum(outputKinds),
  byteLength: z.number().int().positive().max(MAX_DURABLE_RESULT_PAYLOAD_BYTES),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type DurablePayloadReference = z.infer<typeof durablePayloadReferenceSchema>;

export function executionResultJsonBytes(value: unknown): number | null {
  try {
    const serialized = JSON.stringify(value);
    return serialized === undefined ? null : new TextEncoder().encode(serialized).byteLength;
  } catch {
    return null;
  }
}

export function canonicalExecutionJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalExecutionJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalExecutionJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export function executionResultSha256(value: unknown): string {
  return createHash("sha256").update(canonicalExecutionJson(value)).digest("hex");
}

export function executionResultsEqual(left: unknown, right: unknown): boolean {
  return canonicalExecutionJson(left) === canonicalExecutionJson(right);
}
