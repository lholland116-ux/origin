import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import type { AcceptedRequestExecutionIdentity } from "@/lib/agent-runtime/execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const RUN_DATABASE_TESTS = process.env.AGENT_REQUEST_ACCEPTANCE_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.AGENT_REQUEST_ACCEPTANCE_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";

function requireIsolatedLocalDatabase(connectionString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error("Execution-association integration requires a local PostgreSQL URL.");
  }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && ["57222", "57242"].includes(parsed.port)
    && parsed.pathname === "/postgres")) {
    throw new Error("Execution-association tests may run only against isolated loopback PostgreSQL ports 57222 or 57242.");
  }
}

const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

function plan(variant = "first"): PlannedExecutionHandoff {
  const steps = variant === "first"
    ? [
        { id: "synthesis", capability: "standard" as const, dependsOn: [] as string[], inputs: [{ source: "user" as const }], expectedOutput: "text" as const },
        { id: "document", capability: "document_generation" as const, dependsOn: ["synthesis"], inputs: [{ source: "step" as const, stepId: "synthesis", output: "text" as const }], expectedOutput: "document" as const },
      ]
    : [
        { id: "answer", capability: "standard" as const, dependsOn: [] as string[], inputs: [{ source: "user" as const }], expectedOutput: "text" as const },
        { id: "artifact", capability: "document_generation" as const, dependsOn: ["answer"], inputs: [{ source: "step" as const, stepId: "answer", output: "text" as const }], expectedOutput: "document" as const },
      ];
  const objective = "Create a concise report.";
  const candidate = { objective, steps, status: "validated" as const };
  const checked = validateIntelligencePlan(candidate);
  if (!checked.valid) throw new Error(checked.errors.join("; "));
  const capabilities = [...new Set(steps.map((step) => step.capability))].sort() as PlannedExecutionHandoff["governance"]["capabilityIds"];
  return {
    version: 1,
    objective,
    plan: candidate,
    orderedStepIds: checked.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 6,
      capabilityIds: capabilities,
      modelPlanningAllowed: true,
      maxModelCalls: 2,
      maxRepairAttempts: 1,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

function makeRuntime(store: SupabaseExecutionStore, runId: () => string = randomUUID, stepKey: () => string = randomUUID) {
  const execute = vi.fn(async () => ({ kind: "text" as const, value: { text: "mock" } }));
  const runtime = new DurableXStateExecutionRuntime({
    store,
    executor: { execute },
    authorizer: { authorize: async () => ({ allowed: true }) },
    requestMessageBindingValidator: { validate: async () => true },
    createExecutionId: runId,
    createExecutionKey: stepKey,
    now: () => new Date("2026-10-08T12:00:00.000Z"),
  });
  return { runtime, execute };
}

describeDatabase("accepted request execution association (isolated local PostgreSQL only)", () => {
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  const usageDate = new Date().toISOString().slice(0, 10);
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;

  async function accept(options: {
    readonly key?: string;
    readonly fingerprint?: string;
    readonly conversation?: string;
    readonly message?: string;
  } = {}, database: postgres.Sql = sql) {
    const key = options.key ?? randomUUID();
    const fingerprint = options.fingerprint ?? "a".repeat(64);
    const [row] = await database<{ result: Record<string, unknown> }[]>`
      SELECT public.accept_agent_request(
        ${userId}::uuid,
        ${options.conversation ?? conversationId}::uuid,
        ${key},
        ${fingerprint},
        ${database.json({ routingMode: "auto" })}::jsonb,
        ${options.message ?? "Create a concise report."},
        ARRAY[]::uuid[],
        '[]'::jsonb,
        ${usageDate}::date,
        100,
        100
      ) AS result
    `;
    const payload = row!.result;
    return {
      payload,
      identity: {
        requestId: payload.requestId as string,
        userId: payload.userId as string,
        conversationId: payload.conversationId as string,
        userMessageId: payload.userMessageId as string,
        assistantMessageId: payload.assistantMessageId as string,
        idempotencyKey: payload.idempotencyKey as string,
        requestFingerprint: fingerprint,
      } satisfies AcceptedRequestExecutionIdentity,
    };
  }

  function runtimeInput(identity: AcceptedRequestExecutionIdentity): ExecutionRuntimeInput {
    return {
      authenticatedUserId: identity.userId,
      conversationId: identity.conversationId,
      requestMessageBinding: {
        requestId: identity.requestId,
        userId: identity.userId,
        conversationId: identity.conversationId,
        userMessageId: identity.userMessageId,
        assistantMessageId: identity.assistantMessageId,
      },
      userInput: "Create a concise report.",
    };
  }

  beforeAll(async () => {
    if (!RUN_DATABASE_TESTS) return;
    requireIsolatedLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 16 });
    await sql.unsafe("SELECT 1");
    await sql.unsafe(
      "INSERT INTO auth.users (id,aud,role,email) VALUES ($1::uuid,'authenticated','authenticated',$2),($3::uuid,'authenticated','authenticated',$4)",
      [userId, userId + "@association.test", otherUserId, otherUserId + "@association.test"],
    );
    await sql.unsafe(
      "INSERT INTO public.conversations (id,user_id,title) VALUES ($1::uuid,$2::uuid,'Association owner'),($3::uuid,$4::uuid,'Association other')",
      [conversationId, userId, otherConversationId, otherUserId],
    );
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    if (!RUN_DATABASE_TESTS || !sql) return;
    await sql.unsafe("DELETE FROM auth.users WHERE id IN ($1::uuid,$2::uuid)", [userId, otherUserId]);
    await sql.end();
  });

  it("creates a pending run without provider dispatch and replay preserves the original plan", async () => {
    const accepted = await accept();
    const engine = makeRuntime(store);
    const first = await engine.runtime.associateAcceptedRequest(plan("first"), runtimeInput(accepted.identity), accepted.identity);
    const replanned = await engine.runtime.associateAcceptedRequest(plan("changed"), runtimeInput(accepted.identity), accepted.identity);
    expect(first).toMatchObject({ kind: "associated", status: "created" });
    expect(replanned).toMatchObject({ kind: "associated", status: "existing" });
    if (first.kind !== "associated" || replanned.kind !== "associated") return;
    expect(replanned.runId).toBe(first.runId);
    expect(replanned.planFingerprint).toBe(first.planFingerprint);
    expect(engine.execute).not.toHaveBeenCalled();

    const persisted = await store.getRun({ runId: first.runId, userId });
    expect(persisted).toMatchObject({
      acceptedRequestId: accepted.identity.requestId,
      acceptanceFingerprint: accepted.identity.requestFingerprint,
      idempotencyKey: accepted.identity.idempotencyKey,
      requestFingerprint: first.planFingerprint,
      status: "pending",
    });
    expect(persisted?.steps.map((step) => step.stepId).sort()).toEqual(["document", "synthesis"]);
    expect(persisted?.steps.every((step) => step.status === "pending")).toBe(true);
  });

  it("converges twelve concurrent identical associations to exactly one run", async () => {
    const accepted = await accept();
    const engine = makeRuntime(store);
    const results = await Promise.all(Array.from({ length: 12 }, () =>
      engine.runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity)));
    const associated = results.filter((result) => result.kind === "associated");
    expect(associated).toHaveLength(12);
    expect(new Set(associated.map((result) => result.runId)).size).toBe(1);
    expect(associated.filter((result) => result.kind === "associated" && result.status === "created")).toHaveLength(1);
    expect(associated.filter((result) => result.kind === "associated" && result.status === "existing")).toHaveLength(11);
    const rows = await sql.unsafe(
      "SELECT count(*)::integer AS count FROM public.execution_runs WHERE accepted_request_id=$1::uuid",
      [accepted.identity.requestId],
    ) as Array<{ count: number }>;
    expect(rows[0]!.count).toBe(1);
    expect(engine.execute).not.toHaveBeenCalled();
  });

  it("rejects a mismatched acceptance fingerprint and forged message binding", async () => {
    const accepted = await accept();
    const engine = makeRuntime(store);
    const mismatchedIdentity = { ...accepted.identity, requestFingerprint: "b".repeat(64) };
    const mismatch = await engine.runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), mismatchedIdentity);
    const forgedIdentity = { ...accepted.identity, userMessageId: randomUUID() };
    const forged = await engine.runtime.associateAcceptedRequest(plan(), runtimeInput(forgedIdentity), forgedIdentity);
    expect(mismatch).toMatchObject({ kind: "rejected", failure: { code: "idempotency_conflict" } });
    expect(forged).toMatchObject({ kind: "rejected", failure: { code: "idempotency_conflict" } });
    const rows = await sql.unsafe(
      "SELECT count(*)::integer AS count FROM public.execution_runs WHERE accepted_request_id=$1::uuid",
      [accepted.identity.requestId],
    ) as Array<{ count: number }>;
    expect(rows[0]!.count).toBe(0);
  });

  it("rolls back a failed initial association and recovers by replaying the accepted request", async () => {
    const accepted = await accept();
    const failing = makeRuntime(store, randomUUID, () => "not-a-uuid");
    const failed = await failing.runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    expect(failed).toMatchObject({ kind: "rejected", failure: { code: "persistence_failed" } });
    const beforeRows = await sql.unsafe(
      "SELECT (SELECT count(*)::integer FROM public.execution_runs WHERE accepted_request_id=$1::uuid) AS runs,(SELECT count(*)::integer FROM public.agent_request_acceptances WHERE request_id=$1::uuid) AS acceptances",
      [accepted.identity.requestId],
    ) as Array<{ runs: number; acceptances: number }>;
    expect(beforeRows[0]).toEqual({ runs: 0, acceptances: 1 });

    const replay = await accept({ key: accepted.identity.idempotencyKey, fingerprint: accepted.identity.requestFingerprint });
    expect(replay.payload).toMatchObject({
      kind: "accepted",
      replayed: true,
      requestId: accepted.identity.requestId,
      userMessageId: accepted.identity.userMessageId,
      assistantMessageId: accepted.identity.assistantMessageId,
    });
    const recovered = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    expect(recovered).toMatchObject({ kind: "associated", status: "created" });
  });

  it("recovers a committed association after a lost acknowledgement and new client", async () => {
    const accepted = await accept();
    const firstStore = new SupabaseExecutionStore(sql);
    const original = firstStore.associateAcceptedRequest.bind(firstStore);
    firstStore.associateAcceptedRequest = async (input) => {
      await original(input);
      throw new Error("simulated lost acknowledgement after commit");
    };
    const lost = await makeRuntime(firstStore).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    expect(lost).toMatchObject({ kind: "rejected", failure: { code: "persistence_failed" } });

    const restartedClient = postgres(DATABASE_URL, { prepare: false, max: 1 });
    try {
      const restartedStore = new SupabaseExecutionStore(restartedClient);
      const recovered = await makeRuntime(restartedStore).runtime.associateAcceptedRequest(
        plan("changed"), runtimeInput(accepted.identity), accepted.identity,
      );
      expect(recovered).toMatchObject({ kind: "associated", status: "existing" });
      if (recovered.kind !== "associated") return;
      const persisted = await restartedStore.getRun({ runId: recovered.runId, userId });
      expect(persisted?.executionPlan.steps.map((step) => step.id)).toEqual(["synthesis", "document"]);
    } finally {
      await restartedClient.end();
    }
  });

  it("leaves an accepted request recoverable without another charge or message pair", async () => {
    const [usageBefore] = await sql.unsafe(
      "SELECT coalesce(message_count,0)::integer AS message_count FROM public.usage WHERE user_id=$1::uuid AND date=$2::date",
      [userId, usageDate],
    ) as Array<{ message_count: number }>;
    const accepted = await accept();
    const beforeRows = await sql.unsafe(
      "SELECT (SELECT count(*)::integer FROM public.execution_runs WHERE accepted_request_id=$1::uuid) AS run_count,(SELECT count(*)::integer FROM public.messages WHERE id IN ($2::uuid,$3::uuid)) AS messages,(SELECT message_count FROM public.usage WHERE user_id=$4::uuid AND date=$5::date) AS usage_count",
      [accepted.identity.requestId, accepted.identity.userMessageId, accepted.identity.assistantMessageId, userId, usageDate],
    ) as Array<{ run_count: number; messages: number; usage_count: number }>;
    expect(beforeRows[0]).toEqual({ run_count: 0, messages: 2, usage_count: (usageBefore?.message_count ?? 0) + 1 });
    const replay = await accept({ key: accepted.identity.idempotencyKey, fingerprint: accepted.identity.requestFingerprint });
    expect(replay.payload).toMatchObject({ kind: "accepted", replayed: true });
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    expect(associated).toMatchObject({ kind: "associated", status: "created" });
    const afterRows = await sql.unsafe(
      "SELECT (SELECT count(*)::integer FROM public.execution_runs WHERE accepted_request_id=$1::uuid) AS run_count,(SELECT count(*)::integer FROM public.messages WHERE id IN ($2::uuid,$3::uuid)) AS messages,(SELECT message_count FROM public.usage WHERE user_id=$4::uuid AND date=$5::date) AS usage_count",
      [accepted.identity.requestId, accepted.identity.userMessageId, accepted.identity.assistantMessageId, userId, usageDate],
    ) as Array<{ run_count: number; messages: number; usage_count: number }>;
    expect(afterRows[0]).toEqual({ run_count: 1, messages: 2, usage_count: (usageBefore?.message_count ?? 0) + 1 });
  });

  it("keeps the associated run owner-scoped", async () => {
    const accepted = await accept();
    const result = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    expect(result.kind).toBe("associated");
    if (result.kind !== "associated") return;
    expect(await store.getRun({ runId: result.runId, userId: otherUserId })).toBeNull();
  });
});
