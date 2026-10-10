import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import { createAcceptedExecutionFinalizer } from "@/lib/agent-runtime/accepted-execution-finalization";
import type { AcceptedRequestExecutionIdentity } from "@/lib/agent-runtime/execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const RUN_DATABASE_TESTS = process.env.AGENT_EXECUTION_FINALIZATION_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.AGENT_EXECUTION_FINALIZATION_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";
const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

function requireIsolatedLocalDatabase(connectionString: string): void {
  const parsed = new URL(connectionString);
  if (!(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:")
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || !["57222", "57242"].includes(parsed.port)
    || parsed.pathname !== "/postgres") {
    throw new Error("Execution finalization tests may use only isolated loopback PostgreSQL ports 57222 or 57242.");
  }
}

function handoff(): PlannedExecutionHandoff {
  const objective = "Return the durable test answer.";
  const steps = [{ id: "answer", capability: "standard" as const, dependsOn: [] as string[], inputs: [{ source: "user" as const }], expectedOutput: "text" as const }];
  const candidate = { objective, steps, status: "validated" as const };
  const checked = validateIntelligencePlan(candidate);
  if (!checked.valid) throw new Error(checked.errors.join("; "));
  return {
    version: 1,
    objective,
    plan: candidate,
    orderedStepIds: checked.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 1,
      capabilityIds: ["standard"],
      modelPlanningAllowed: false,
      maxModelCalls: 0,
      maxRepairAttempts: 0,
      attachmentContextAllowed: false,
      handoffVersion: 1,
    },
  };
}

describeDatabase("accepted execution finalization (isolated local PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  const usageDate = new Date().toISOString().slice(0, 10);

  async function accept(owner = userId, conversation = owner === userId ? conversationId : otherConversationId) {
    const idempotencyKey = randomUUID();
    const requestFingerprint = randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64);
    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      SELECT public.accept_agent_request(
        ${owner}::uuid, ${conversation}::uuid, ${idempotencyKey}, ${requestFingerprint},
        ${sql.json({ routingMode: "auto" })}::jsonb, 'Return the durable test answer.',
        ARRAY[]::uuid[], '[]'::jsonb, ${usageDate}::date, 100, 100
      ) AS result`;
    const payload = row!.result;
    return {
      identity: {
        requestId: payload.requestId as string,
        userId: payload.userId as string,
        conversationId: payload.conversationId as string,
        userMessageId: payload.userMessageId as string,
        assistantMessageId: payload.assistantMessageId as string,
        idempotencyKey,
        requestFingerprint,
      } satisfies AcceptedRequestExecutionIdentity,
      usageDate,
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
      userInput: "Return the durable test answer.",
    };
  }

  function engine(identity: AcceptedRequestExecutionIdentity) {
    const execute = vi.fn(async () => ({
      kind: "text" as const,
      value: {
        kind: "standard_operation" as const,
        requestId: identity.requestId,
        userId: identity.userId,
        conversationId: identity.conversationId,
        reply: "Persisted completion text.",
        model: "test-model",
        reasoningEffort: "medium" as const,
        measurements: [],
      },
    }));
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: { execute },
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
    });
    return { runtime, execute };
  }

  async function complete(identity: AcceptedRequestExecutionIdentity) {
    const runtimeEngine = engine(identity);
    const associated = await runtimeEngine.runtime.associateAcceptedRequest(handoff(), runtimeInput(identity), identity);
    if (associated.kind !== "associated") throw new Error("Test association failed.");
    const outcome = await runtimeEngine.runtime.resume({ runId: associated.runId, authenticatedUserId: identity.userId });
    expect(outcome.kind).toBe("succeeded");
    expect(runtimeEngine.execute).toHaveBeenCalledOnce();
    return { runId: associated.runId, execute: runtimeEngine.execute };
  }

  function finalizer(database: postgres.Sql = sql, executionStore: SupabaseExecutionStore = store) {
    return createAcceptedExecutionFinalizer({
      loadAcceptedRun: (runId) => executionStore.getAcceptedRunForFinalization({ runId }),
      finalizeAtomically: async ({ runId, finalText }) => {
        const [row] = await database<{ result: unknown }[]>`
          SELECT public.finalize_accepted_agent_execution(${runId}::uuid, ${finalText}) AS result`;
        return row!.result;
      },
      listPendingRunIds: async (limit) => {
        const rows = await database<{ run_id: string }[]>`
          SELECT * FROM public.list_pending_agent_execution_finalizations(${limit})`;
        return rows.map((row) => row.run_id);
      },
    });
  }

  beforeAll(async () => {
    if (!RUN_DATABASE_TESTS) return;
    requireIsolatedLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 12 });
    await sql`SELECT 1`;
    await sql`INSERT INTO auth.users (id, aud, role, email) VALUES
      (${userId}::uuid,'authenticated','authenticated',${`${userId}@finalization.test`}),
      (${otherUserId}::uuid,'authenticated','authenticated',${`${otherUserId}@finalization.test`})`;
    await sql`INSERT INTO public.conversations (id,user_id,title) VALUES
      (${conversationId}::uuid,${userId}::uuid,'Finalization owner'),
      (${otherConversationId}::uuid,${otherUserId}::uuid,'Finalization other')`;
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    if (!RUN_DATABASE_TESTS || !sql) return;
    await sql`DELETE FROM auth.users WHERE id IN (${userId}::uuid, ${otherUserId}::uuid)`;
    await sql.end();
  });

  it("finalizes once to the accepted destination, replays after lost acknowledgement, and does not re-charge or write artifacts", async () => {
    const accepted = await accept();
    const run = await complete(accepted.identity);
    const usageBefore = await sql<{ message_count: number }[]>`
      SELECT message_count FROM public.usage WHERE user_id=${userId}::uuid AND date=${usageDate}::date`;
    const pending = await finalizer().listPendingRunIds();
    expect(pending).toContain(run.runId);

    const operation = finalizer();
    const [first, simultaneous] = await Promise.all([
      operation.finalize(run.runId), operation.finalize(run.runId),
    ]);
    expect([first.status, simultaneous.status].sort()).toEqual(["finalized", "replayed"]);
    expect(first.assistantMessageId ?? simultaneous.assistantMessageId).toBe(accepted.identity.assistantMessageId);
    expect(await operation.finalize(run.runId)).toEqual({
      status: "replayed", assistantMessageId: accepted.identity.assistantMessageId,
    });

    const messageRows = await sql<{ id: string; content: string; count: number }[]>`
      SELECT message.id, message.content,
        (SELECT count(*)::integer FROM public.messages AS same
         WHERE same.user_id=${userId}::uuid AND same.conversation_id=${conversationId}::uuid
           AND same.role='assistant' AND same.id=${accepted.identity.assistantMessageId}::uuid) AS count
      FROM public.messages AS message WHERE message.id=${accepted.identity.assistantMessageId}::uuid`;
    expect(messageRows).toEqual([{ id: accepted.identity.assistantMessageId, content: "Persisted completion text.", count: 1 }]);
    const receiptRows = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM public.execution_run_finalizations WHERE run_id=${run.runId}::uuid`;
    expect(receiptRows[0]!.count).toBe(1);
    const usageAfter = await sql<{ message_count: number }[]>`
      SELECT message_count FROM public.usage WHERE user_id=${userId}::uuid AND date=${usageDate}::date`;
    expect(usageAfter).toEqual(usageBefore);
    expect(await operation.listPendingRunIds()).not.toContain(run.runId);
    expect(run.execute).toHaveBeenCalledOnce();

    await expect(sql`
      SELECT public.finalize_accepted_agent_execution(${run.runId}::uuid, 'A conflicting completion.')
    `).rejects.toThrow("AGENT_EXECUTION_FINALIZATION_CONFLICT");
    await expect(sql`
      UPDATE public.execution_run_finalizations SET completion_sha256=${"d".repeat(64)}
      WHERE run_id=${run.runId}::uuid
    `).rejects.toThrow("Execution finalization receipts are immutable");
  });

  it("serializes concurrent finalization attempts to one durable receipt and one assistant response", async () => {
    const accepted = await accept();
    const run = await complete(accepted.identity);
    const competingClient = postgres(DATABASE_URL, { prepare: false, max: 2 });
    try {
      const competingStore = new SupabaseExecutionStore(competingClient);
      const results = await Promise.all([
        finalizer().finalize(run.runId),
        finalizer(competingClient, competingStore).finalize(run.runId),
      ]);
      expect(results.map((result) => result.status).sort()).toEqual(["finalized", "replayed"]);
      expect(results.every((result) => result.assistantMessageId === accepted.identity.assistantMessageId)).toBe(true);

      const [messages] = await sql<{ count: number; content: string }[]>`
        SELECT count(*)::integer AS count, max(content) AS content FROM public.messages
        WHERE id=${accepted.identity.assistantMessageId}::uuid AND role='assistant'`;
      expect(messages).toEqual({ count: 1, content: "Persisted completion text." });
      const [receipts] = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM public.execution_run_finalizations WHERE run_id=${run.runId}::uuid`;
      expect(receipts!.count).toBe(1);
    } finally {
      await competingClient.end();
    }
  });

  it("does not finalize pending runs or a completed run with pending approval/control state", async () => {
    const pendingAcceptance = await accept();
    const pendingAssociation = await engine(pendingAcceptance.identity).runtime.associateAcceptedRequest(
      handoff(), runtimeInput(pendingAcceptance.identity), pendingAcceptance.identity,
    );
    expect(pendingAssociation.kind).toBe("associated");
    if (pendingAssociation.kind !== "associated") return;
    await expect(sql`
      SELECT public.finalize_accepted_agent_execution(${pendingAssociation.runId}::uuid, 'Not yet complete.')
    `).rejects.toThrow("AGENT_EXECUTION_NOT_FINALIZABLE");

    const approvalAcceptance = await accept();
    const approvalRun = await complete(approvalAcceptance.identity);
    const persistedApprovalRun = await store.getAcceptedRunForFinalization({ runId: approvalRun.runId });
    await sql`INSERT INTO public.execution_human_approval_checkpoints (
      id, run_id, user_id, step_id, plan_fingerprint, step_fingerprint, source
    ) VALUES (
      ${randomUUID()}::uuid, ${approvalRun.runId}::uuid, ${approvalAcceptance.identity.userId}::uuid,
      'answer', ${persistedApprovalRun!.requestFingerprint}, ${"c".repeat(64)}, 'runtime_policy'
    )`;
    await expect(sql`
      SELECT public.finalize_accepted_agent_execution(${approvalRun.runId}::uuid, 'Persisted completion text.')
    `).rejects.toThrow("AGENT_EXECUTION_APPROVAL_PENDING");

    const accepted = await accept();
    const run = await complete(accepted.identity);
    await sql`UPDATE public.execution_runs SET control_state='paused' WHERE id=${run.runId}::uuid`;
    await expect(sql`
      SELECT public.finalize_accepted_agent_execution(${run.runId}::uuid, 'Persisted completion text.')
    `).rejects.toThrow("AGENT_EXECUTION_NOT_FINALIZABLE");
  });

  it("rejects a completion when the bound assistant destination has foreign content", async () => {
    const accepted = await accept();
    const run = await complete(accepted.identity);
    await sql`UPDATE public.messages SET content='[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:foreign:binding]]'
      WHERE id=${accepted.identity.assistantMessageId}::uuid`;
    await expect(sql`
      SELECT public.finalize_accepted_agent_execution(${run.runId}::uuid, 'Persisted completion text.')
    `).rejects.toThrow("AGENT_EXECUTION_FINALIZATION_CONFLICT");
    expect(await finalizer().listPendingRunIds()).toContain(run.runId);
  });

  it("does not accept a foreign owner's run as the supplied completion identity", async () => {
    const own = await accept(userId, conversationId);
    const other = await accept(otherUserId, otherConversationId);
    const ownRun = await complete(own.identity);
    const otherRun = await complete(other.identity);
    expect(await store.getAcceptedRunForFinalization({ runId: ownRun.runId })).toMatchObject({ userId });
    expect(await store.getAcceptedRunForFinalization({ runId: otherRun.runId })).toMatchObject({ userId: otherUserId });
    // The privileged operation takes only a run ID and derives the foreign
    // owner/binding internally; callers cannot supply or swap the destination.
    expect(await finalizer().finalize(otherRun.runId)).toEqual({
      status: "finalized", assistantMessageId: other.identity.assistantMessageId,
    });
    const otherMessage = await sql<{ content: string }[]>`
      SELECT content FROM public.messages WHERE id=${other.identity.assistantMessageId}::uuid`;
    expect(otherMessage[0]!.content).toBe("Persisted completion text.");
    expect(ownRun.execute).toHaveBeenCalledOnce();
  });
});
