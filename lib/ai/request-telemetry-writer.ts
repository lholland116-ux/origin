import type { AiRequestTelemetryRecord } from "@/lib/ai/request-telemetry";
import type { Database } from "@/lib/database.types";
import { createAdminClient } from "@/lib/supabase/admin";

export const AI_REQUEST_TELEMETRY_WRITE_TIMEOUT_MS = 200;

type AiRequestTelemetryWriteFailure =
  | "admin_client_unavailable"
  | "database_error"
  | "timeout"
  | "unexpected_error";

type AiRequestTelemetryInsert =
  Database["public"]["Tables"]["ai_request_telemetry"]["Insert"];

function logWriteSkipped(reason: AiRequestTelemetryWriteFailure): void {
  try {
    console.warn("[ai_request_telemetry] write_skipped", { reason });
  } catch {
    // Logging must not affect the caller's primary request.
  }
}

function toInsertPayload(
  record: AiRequestTelemetryRecord,
): AiRequestTelemetryInsert {
  return {
    route: record.route,
    attempt_kind: record.attemptKind,
    model: record.model,
    reasoning_effort: record.reasoningEffort,
    plan: record.plan,
    outcome: record.outcome,
    latency_ms: record.latencyMs,
    had_image: record.hadImage,
    input_tokens: record.inputTokens,
    cached_input_tokens: record.cachedInputTokens,
    output_tokens: record.outputTokens,
    reasoning_tokens: record.reasoningTokens,
    total_tokens: record.totalTokens,
  };
}

/**
 * Persists privacy-minimized AI request telemetry without allowing telemetry
 * availability to affect the primary request.
 */
export async function writeAiRequestTelemetry(
  record: AiRequestTelemetryRecord,
): Promise<void> {
  let admin: ReturnType<typeof createAdminClient>;

  try {
    admin = createAdminClient();
  } catch {
    logWriteSkipped("admin_client_unavailable");
    return;
  }

  let payload: AiRequestTelemetryInsert;

  try {
    payload = toInsertPayload(record);
  } catch {
    logWriteSkipped("unexpected_error");
    return;
  }

  try {
    const controller = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const timeoutOutcome = new Promise<AiRequestTelemetryWriteFailure>(
      (resolve) => {
        timeoutId = setTimeout(() => {
          timedOut = true;
          controller.abort();
          resolve("timeout");
        }, AI_REQUEST_TELEMETRY_WRITE_TIMEOUT_MS);
      },
    );

    // Convert every late success or rejection into an observed outcome before
    // racing it, so an abandoned database promise cannot reject unhandled.
    const insertOutcome = Promise.resolve()
      .then(async () => {
        const { error } = await admin
          .from("ai_request_telemetry")
          .insert(payload)
          .abortSignal(controller.signal);

        if (timedOut) return "timeout" as const;
        return error ? ("database_error" as const) : null;
      })
      .catch(() => (timedOut ? "timeout" : "unexpected_error"));

    const outcome = await Promise.race([insertOutcome, timeoutOutcome]);

    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }

    if (outcome !== null) {
      logWriteSkipped(outcome);
    }
  } catch {
    logWriteSkipped("unexpected_error");
  }
}
