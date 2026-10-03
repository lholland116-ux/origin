import { summarizeAiTelemetry, type AiTelemetryAnalyticsRow, type AiTelemetrySummary } from "@/lib/ai/telemetry-analytics";
import type { AiTelemetryPricingEntry } from "@/lib/ai/telemetry-pricing";
import { createAdminClient } from "@/lib/supabase/admin";

if (typeof window !== "undefined") {
  throw new Error("AI telemetry operations are server-only");
}

export const AI_TELEMETRY_QUERY_PAGE_SIZE = 1000;
export const AI_TELEMETRY_MAX_ANALYTICS_ROWS = 50000;
export const AI_TELEMETRY_DEFAULT_RETENTION_DAYS = 90;
export const AI_TELEMETRY_DEFAULT_RETENTION_BATCH_SIZE = 1000;
export const AI_TELEMETRY_MAX_RETENTION_BATCH_SIZE = 5000;

const ANALYTICS_COLUMNS = "occurred_at,route,attempt_kind,model,reasoning_effort,plan,outcome,latency_ms,had_image,input_tokens,cached_input_tokens,output_tokens,reasoning_tokens,total_tokens";

export class AiTelemetryOperationsError extends Error {
  constructor(readonly code: "invalid_range" | "dataset_limit" | "database_error" | "invalid_retention") {
    super(code === "invalid_range" ? "Invalid telemetry time range." : code === "dataset_limit" ? "Telemetry analytics dataset exceeds the V1 limit." : code === "invalid_retention" ? "Invalid telemetry retention options." : "AI telemetry operation failed.");
    this.name = "AiTelemetryOperationsError";
  }
}

function validDate(date: Date): boolean {
  return Number.isFinite(date.valueOf());
}

function safeAdminClient() {
  try {
    return createAdminClient();
  } catch {
    throw new AiTelemetryOperationsError("database_error");
  }
}

export async function getAiTelemetrySummary(params: Readonly<{
  from: Date;
  to: Date;
  pricingSchedule?: readonly AiTelemetryPricingEntry[];
}>): Promise<AiTelemetrySummary> {
  if (!validDate(params.from) || !validDate(params.to) || params.from >= params.to) {
    throw new AiTelemetryOperationsError("invalid_range");
  }

  const admin = safeAdminClient();
  const rows: AiTelemetryAnalyticsRow[] = [];
  const from = params.from.toISOString();
  const to = params.to.toISOString();
  let offset = 0;

  while (true) {
    let result: { data: AiTelemetryAnalyticsRow[] | null; error: unknown };
    try {
      result = await admin
        .from("ai_request_telemetry")
        .select(ANALYTICS_COLUMNS)
        .gte("occurred_at", from)
        .lt("occurred_at", to)
        .order("occurred_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + AI_TELEMETRY_QUERY_PAGE_SIZE - 1);
    } catch {
      throw new AiTelemetryOperationsError("database_error");
    }
    if (result.error) throw new AiTelemetryOperationsError("database_error");
    const page = result.data ?? [];
    if (rows.length + page.length > AI_TELEMETRY_MAX_ANALYTICS_ROWS) {
      throw new AiTelemetryOperationsError("dataset_limit");
    }
    rows.push(...page);
    if (page.length < AI_TELEMETRY_QUERY_PAGE_SIZE) break;
    offset += page.length;
  }

  return summarizeAiTelemetry(rows, { pricingSchedule: params.pricingSchedule });
}

export async function deleteExpiredAiTelemetry(params: Readonly<{
  now?: Date;
  retentionDays?: number;
  batchSize?: number;
}> = {}): Promise<Readonly<{ deletedCount: number; cutoff: Date; hasMore: boolean }>> {
  const now = params.now ?? new Date();
  const retentionDays = params.retentionDays ?? AI_TELEMETRY_DEFAULT_RETENTION_DAYS;
  const batchSize = params.batchSize ?? AI_TELEMETRY_DEFAULT_RETENTION_BATCH_SIZE;
  if (
    !validDate(now) ||
    !Number.isInteger(retentionDays) ||
    retentionDays <= 0 ||
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > AI_TELEMETRY_MAX_RETENTION_BATCH_SIZE
  ) {
    throw new AiTelemetryOperationsError("invalid_retention");
  }

  const cutoff = new Date(now.valueOf() - retentionDays * 24 * 60 * 60 * 1000);
  const admin = safeAdminClient();
  let selection: { data: Array<{ id: number }> | null; error: unknown };
  try {
    selection = await admin
      .from("ai_request_telemetry")
      .select("id")
      .lt("occurred_at", cutoff.toISOString())
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .limit(batchSize + 1);
  } catch {
    throw new AiTelemetryOperationsError("database_error");
  }
  if (selection.error) throw new AiTelemetryOperationsError("database_error");

  const selected = selection.data ?? [];
  const ids = selected.slice(0, batchSize).map((row) => row.id);
  if (ids.length === 0) return { deletedCount: 0, cutoff, hasMore: false };

  let deletion: { error: unknown };
  try {
    deletion = await admin.from("ai_request_telemetry").delete().in("id", ids);
  } catch {
    throw new AiTelemetryOperationsError("database_error");
  }
  if (deletion.error) throw new AiTelemetryOperationsError("database_error");
  return { deletedCount: ids.length, cutoff, hasMore: selected.length > batchSize };
}
