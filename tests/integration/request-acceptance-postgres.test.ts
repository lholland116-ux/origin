import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const RUN_DATABASE_TESTS = process.env.AGENT_REQUEST_ACCEPTANCE_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.AGENT_REQUEST_ACCEPTANCE_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";

function requireIsolatedLocalDatabase(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Agent request acceptance integration requires a local PostgreSQL URL.");
  }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && ["57222", "57242"].includes(parsed.port)
    && parsed.pathname === "/postgres")) {
    throw new Error("Agent request acceptance tests may run only against isolated loopback PostgreSQL ports 57222 or 57242.");
  }
}

const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

describeDatabase("Agent request acceptance (isolated local PostgreSQL only)", () => {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const planRaceUserId = randomUUID();
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  const planRaceConversationId = randomUUID();
  const usageDate = new Date().toISOString().slice(0, 10);
  let sql: postgres.Sql;

  async function accept(options: {
    readonly userId?: string;
    readonly conversationId?: string;
    readonly key?: string;
    readonly fingerprint?: string;
    readonly message?: string;
    readonly freeLimit?: number;
    readonly proLimit?: number;
  } = {}, database: postgres.Sql = sql) {
    const [result] = await database<{ result: Record<string, unknown> }[]>`
      SELECT public.accept_agent_request(
        ${options.userId ?? userId}::uuid,
        ${options.conversationId ?? conversationId}::uuid,
        ${options.key ?? randomUUID()},
        ${options.fingerprint ?? "a".repeat(64)},
        ${database.json({ routingMode: "auto" })}::jsonb,
        ${options.message ?? "Analyze the uploaded report."},
        ARRAY[]::uuid[],
        '[]'::jsonb,
        ${usageDate}::date,
        ${options.freeLimit ?? 100},
        ${options.proLimit ?? 100}
      ) AS result
    `;
    return result.result;
  }

  beforeAll(async () => {
    if (!RUN_DATABASE_TESTS) return;
    requireIsolatedLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 10 });
    await sql`SELECT 1`;
    await sql`
      INSERT INTO auth.users (id, aud, role, email) VALUES
        (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@acceptance.test`}),
        (${otherUserId}::uuid, 'authenticated', 'authenticated', ${`${otherUserId}@acceptance.test`}),
        (${planRaceUserId}::uuid, 'authenticated', 'authenticated', ${`${planRaceUserId}@acceptance.test`})
    `;
    await sql`
      INSERT INTO public.conversations (id, user_id, title) VALUES
        (${conversationId}::uuid, ${userId}::uuid, 'Acceptance owner'),
        (${otherConversationId}::uuid, ${otherUserId}::uuid, 'Acceptance other'),
        (${planRaceConversationId}::uuid, ${planRaceUserId}::uuid, 'Acceptance plan race')
    `;
  });

  afterAll(async () => {
    if (!RUN_DATABASE_TESTS || !sql) return;
    await sql`DELETE FROM public.usage WHERE user_id IN (${userId}::uuid, ${otherUserId}::uuid, ${planRaceUserId}::uuid)`;
    await sql`DELETE FROM auth.users WHERE id IN (${userId}::uuid, ${otherUserId}::uuid, ${planRaceUserId}::uuid)`;
    await sql.end();
  });

  it("serializes simultaneous identical submissions into one acceptance, reservation, and message pair", async () => {
    const key = randomUUID();
    const results = await Promise.all(Array.from({ length: 12 }, () => accept({ key })));
    expect(results.every((result) => result.kind === "accepted")).toBe(true);
    expect(new Set(results.map((result) => result.requestId)).size).toBe(1);
    expect(new Set(results.map((result) => result.userMessageId)).size).toBe(1);
    expect(new Set(results.map((result) => result.assistantMessageId)).size).toBe(1);
    expect(results.filter((result) => result.replayed === false)).toHaveLength(1);
    expect(results.filter((result) => result.replayed === true)).toHaveLength(11);

    const [counts] = await sql<{ acceptance_count: number; usage_count: number; message_count: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM public.agent_request_acceptances WHERE user_id = ${userId}::uuid AND idempotency_key = ${key}) AS acceptance_count,
        (SELECT message_count FROM public.usage WHERE user_id = ${userId}::uuid AND date = ${usageDate}::date) AS usage_count,
        (SELECT count(*)::integer FROM public.messages WHERE id IN (
          SELECT user_message_id FROM public.agent_request_acceptances WHERE user_id = ${userId}::uuid AND idempotency_key = ${key}
          UNION ALL
          SELECT assistant_message_id FROM public.agent_request_acceptances WHERE user_id = ${userId}::uuid AND idempotency_key = ${key}
        )) AS message_count
    `;
    expect(counts).toEqual({ acceptance_count: 1, usage_count: 1, message_count: 2 });
  });

  it("rejects a conflicting fingerprint without new messages or quota and enforces owner isolation", async () => {
    const key = randomUUID();
    const first = await accept({ key });
    await expect(accept({ key, fingerprint: "b".repeat(64), message: "Conflicting request." }))
      .rejects.toThrow(/REQUEST_IDEMPOTENCY_CONFLICT/);
    await expect(accept({ key: randomUUID(), conversationId: otherConversationId }))
      .rejects.toThrow(/CONVERSATION_NOT_FOUND/);

    const [row] = await sql<{ count: number; usage_count: number }[]>`
      SELECT
        (SELECT count(*)::integer FROM public.agent_request_acceptances WHERE user_id = ${userId}::uuid AND idempotency_key = ${key}) AS count,
        (SELECT message_count FROM public.usage WHERE user_id = ${userId}::uuid AND date = ${usageDate}::date) AS usage_count
    `;
    expect(row.count).toBe(1);
    expect(row.usage_count).toBe(2);
    expect(first.kind).toBe("accepted");
  });

  it("preserves the accepted key and binding across client recreation for later run association", async () => {
    const key = randomUUID();
    const accepted = await accept({ key });
    const restartedClient = postgres(DATABASE_URL, { prepare: false, max: 1 });
    try {
      const [persisted] = await restartedClient<{
        request_id: string;
        user_message_id: string;
        assistant_message_id: string;
        idempotency_key: string;
        request_fingerprint: string;
      }[]>`
        SELECT request_id, user_message_id, assistant_message_id, idempotency_key, request_fingerprint
        FROM public.agent_request_acceptances WHERE user_id = ${userId}::uuid AND idempotency_key = ${key}
      `;
      expect(persisted).toMatchObject({
        request_id: accepted.requestId,
        user_message_id: accepted.userMessageId,
        assistant_message_id: accepted.assistantMessageId,
        idempotency_key: key,
        request_fingerprint: "a".repeat(64),
      });
      const replay = await accept({ key }, restartedClient);
      expect(replay).toMatchObject({
        kind: "accepted",
        replayed: true,
        requestId: accepted.requestId,
        userMessageId: accepted.userMessageId,
        assistantMessageId: accepted.assistantMessageId,
        idempotencyKey: accepted.idempotencyKey,
      });
    } finally {
      await restartedClient.end();
    }
  });

  it("never exceeds the quota under concurrent distinct requests", async () => {
    await sql`
      INSERT INTO public.usage (user_id, date, message_count)
      VALUES (${userId}::uuid, ${usageDate}::date, 0)
      ON CONFLICT (user_id, date) DO UPDATE SET message_count = 0
    `;
    const results = await Promise.all(Array.from({ length: 8 }, () => accept({ freeLimit: 2 })));
    expect(results.filter((result) => result.kind === "accepted")).toHaveLength(2);
    expect(results.filter((result) => result.kind === "limit_reached")).toHaveLength(6);
    const [usage] = await sql<{ message_count: number }[]>`
      SELECT message_count FROM public.usage WHERE user_id = ${userId}::uuid AND date = ${usageDate}::date
    `;
    expect(usage.message_count).toBe(2);
  });

  it("serializes the quota decision with concurrent entitlement plan changes", async () => {
    await sql`UPDATE public.profiles SET plan = 'pro' WHERE id = ${planRaceUserId}::uuid`;
    await sql`INSERT INTO public.usage (user_id, date, message_count)
      VALUES (${planRaceUserId}::uuid, ${usageDate}::date, 2)`;

    const lockClient = postgres(DATABASE_URL, { prepare: false, max: 1 });
    let releasePlanUpdate!: () => void;
    let signalPlanUpdated!: () => void;
    const planUpdateHeld = new Promise<void>((resolve) => { releasePlanUpdate = resolve; });
    const planUpdated = new Promise<void>((resolve) => { signalPlanUpdated = resolve; });
    const downgrade = lockClient.begin(async (tx) => {
      await tx`UPDATE public.profiles SET plan = 'free' WHERE id = ${planRaceUserId}::uuid`;
      signalPlanUpdated();
      await planUpdateHeld;
    });

    try {
      await planUpdated;
      const outcome = accept({
        userId: planRaceUserId,
        conversationId: planRaceConversationId,
        key: randomUUID(),
        freeLimit: 2,
        proLimit: 3,
      }).then(
        (result) => ({ result, error: null as unknown }),
        (error: unknown) => ({ result: null, error }),
      );

      let blockedOnPlanRow = false;
      for (let attempt = 0; attempt < 50; attempt += 1) {
        const [activity] = await sql<{ waiting: boolean }[]>`
          SELECT EXISTS (
            SELECT 1 FROM pg_catalog.pg_stat_activity
            WHERE datname = current_database()
              AND wait_event_type = 'Lock'
              AND query LIKE '%accept_agent_request%'
          ) AS waiting
        `;
        if (activity.waiting) {
          blockedOnPlanRow = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      releasePlanUpdate();
      await downgrade;
      const completed = await outcome;
      expect(blockedOnPlanRow).toBe(true);
      expect(completed.error).toBeNull();
      expect(completed.result).toMatchObject({ kind: "limit_reached", messageCount: 2 });
      const [usage] = await sql<{ message_count: number }[]>`
        SELECT message_count FROM public.usage WHERE user_id = ${planRaceUserId}::uuid AND date = ${usageDate}::date
      `;
      expect(usage.message_count).toBe(2);
    } finally {
      releasePlanUpdate();
      await downgrade.catch(() => undefined);
      await lockClient.end();
    }
  });
});
