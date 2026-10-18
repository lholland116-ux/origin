import { createAdminClient } from "../supabase/admin";
import type { QualityDataAiTelemetryRecord } from "./quality-data-ai-service";

const WRITE_TIMEOUT_MS = 200;

/** Writes only operational metadata. Failure is intentionally non-fatal and never logs request data. */
export async function writeQualityDataAiTelemetry(record: QualityDataAiTelemetryRecord): Promise<void> {
  try {
    const client = createAdminClient();
    const controller = new AbortController();
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(() => { timedOut = true; controller.abort(); resolve(); }, WRITE_TIMEOUT_MS);
    });
    const write = Promise.resolve().then(async () => {
      await client.from("quality_data_ai_interpretation_telemetry").insert({
        request_id: record.request_id, correlation_id: record.correlation_id, model: record.model,
        outcome: record.outcome, latency_ms: record.latency_ms, input_tokens: record.input_tokens,
        output_tokens: record.output_tokens, total_tokens: record.total_tokens,
        estimated_cost_nano_usd: record.estimated_cost_nano_usd === null ? null : Number(record.estimated_cost_nano_usd),
        pricing_version: record.pricing_version,
      }).abortSignal(controller.signal);
    }).catch(() => undefined);
    await Promise.race([write, timeout]);
    if (timer !== undefined) clearTimeout(timer);
    void timedOut;
  } catch {
    // No packet, narrative, source reference, tenant or user information is logged.
  }
}
