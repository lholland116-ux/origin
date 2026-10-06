import type { AccountPlan, AccountPlanResolution } from "./account-plan";

export type DailyUsageReservation =
  | { readonly kind: "reserved"; readonly messageCount: number }
  | { readonly kind: "limit_reached"; readonly messageCount: number }
  | { readonly kind: "account_unavailable" }
  | { readonly kind: "storage_error" };

export interface DailyUsageRpcClient {
  rpc(
    functionName: "reserve_daily_usage",
    args: { p_user_id: string; p_date: string; p_limit: number },
  ): PromiseLike<{
    readonly data: unknown;
    readonly error: unknown | null;
  }>;
}

export type DailyUsageLimits = Readonly<Record<AccountPlan, number>>;

export function resolveDailyUsageLimits(
  env: Readonly<Record<string, string | undefined>> = process.env,
): DailyUsageLimits {
  return {
    free: parseLimit(env.FREE_DAILY_MESSAGE_LIMIT, 20),
    pro: parseLimit(env.PRO_DAILY_MESSAGE_LIMIT, 300),
  };
}

function parseLimit(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function utcUsageDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/**
 * One call reserves one accepted Standard/Web request atomically in PostgreSQL.
 * As in both current routes, a provider failure after reservation still consumes
 * that request; this helper never refunds. The caller must not perform a second
 * read/upsert reservation in either a runtime or capability service.
 */
export async function reserveDailyUsage(params: {
  readonly client: DailyUsageRpcClient;
  readonly userId: string;
  readonly account: AccountPlanResolution;
  readonly date?: string;
  readonly limits?: DailyUsageLimits;
  readonly enforceLimit?: boolean;
}): Promise<DailyUsageReservation> {
  if (params.account.kind !== "resolved") {
    return { kind: "account_unavailable" };
  }
  if (!isUuid(params.userId) || params.account.userId !== params.userId) {
    return { kind: "account_unavailable" };
  }

  const date = params.date ?? utcUsageDate();
  if (!isUtcDate(date)) return { kind: "storage_error" };

  const limits = params.limits ?? resolveDailyUsageLimits();
  const configuredLimit = limits[params.account.plan];
  if (!Number.isSafeInteger(configuredLimit) || configuredLimit <= 0) {
    return { kind: "storage_error" };
  }
  // The current routes bypass limit enforcement in development but still count requests.
  const limit = params.enforceLimit === false ? 2_147_483_647 : configuredLimit;

  let result: Awaited<ReturnType<DailyUsageRpcClient["rpc"]>>;
  try {
    result = await params.client.rpc("reserve_daily_usage", {
      p_user_id: params.userId,
      p_date: date,
      p_limit: limit,
    });
  } catch {
    return { kind: "storage_error" };
  }

  if (result.error) return { kind: "storage_error" };
  const row = Array.isArray(result.data) ? result.data[0] : null;
  if (
    typeof row !== "object" || row === null ||
    typeof row.allowed !== "boolean" ||
    !Number.isSafeInteger(row.message_count) || row.message_count < 0
  ) {
    return { kind: "storage_error" };
  }

  return row.allowed
    ? { kind: "reserved", messageCount: row.message_count }
    : { kind: "limit_reached", messageCount: row.message_count };
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isUtcDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const timestamp = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
}
