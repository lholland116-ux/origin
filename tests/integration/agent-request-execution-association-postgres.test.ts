import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import type { CapabilityExecutionInput } from "@/lib/agent-runtime/capability-executor";
import type { AcceptedRequestExecutionIdentity } from "@/lib/agent-runtime/execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";
import { createTrustedExecutionWorker } from "@/lib/agent-runtime/trusted-execution-worker";
import { createAcceptedExecutionFinalizer } from "@/lib/agent-runtime/accepted-execution-finalization";
import type { ExecutionStepResult } from "@/lib/agent-runtime/runtime-contracts";

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

function qualityAnalysisPlan(): PlannedExecutionHandoff {
  const steps = [
    { id: "file-analysis", capability: "file_analysis" as const, dependsOn: [] as string[],
      inputs: [{ source: "attachment" as const, output: "file" as const }], expectedOutput: "structured_data" as const },
    { id: "synthesis", capability: "standard" as const, dependsOn: ["file-analysis"], inputs: [
      { source: "user" as const }, { source: "step" as const, stepId: "file-analysis", output: "structured_data" as const },
    ], expectedOutput: "text" as const },
    { id: "document", capability: "document_generation" as const, dependsOn: ["synthesis"],
      inputs: [{ source: "step" as const, stepId: "synthesis", output: "text" as const }], expectedOutput: "document" as const },
  ];
  const objective = "Analyze the supplied quality report and prepare a concise document.";
  const candidate = { objective, steps, status: "validated" as const };
  const checked = validateIntelligencePlan(candidate);
  if (!checked.valid) throw new Error(checked.errors.join("; "));
  return {
    version: 1, objective, plan: candidate, orderedStepIds: checked.orderedStepIds,
    plannerSource: "deterministic",
    governance: { maxSteps: 3, capabilityIds: ["document_generation", "file_analysis", "standard"],
      modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0,
      attachmentContextAllowed: true, handoffVersion: 1 },
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
    readonly documentIds?: readonly string[];
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
        ${[...(options.documentIds ?? [])]}::uuid[],
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
    await sql.unsafe("DELETE FROM public.documents WHERE user_id IN ($1::uuid,$2::uuid)", [userId, otherUserId]);
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

  it("looks up only the durable run whose complete accepted identity matches", async () => {
    const accepted = await accept();
    expect(await store.lookupAcceptedRequestRun(accepted.identity)).toEqual({ status: "not_found" });
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    expect(associated.kind).toBe("associated");
    if (associated.kind !== "associated") return;
    const found = await store.lookupAcceptedRequestRun(accepted.identity);
    expect(found).toMatchObject({ status: "found", run: {
      id: associated.runId,
      acceptedRequestId: accepted.identity.requestId,
      acceptanceFingerprint: accepted.identity.requestFingerprint,
      executionPlan: { steps: [{ id: "synthesis" }, { id: "document" }] },
    } });
    expect(await store.lookupAcceptedRequestRun({ ...accepted.identity, userId: otherUserId })).toEqual({ status: "conflict" });
    expect(await store.lookupAcceptedRequestRun({ ...accepted.identity, userMessageId: randomUUID() })).toEqual({ status: "conflict" });
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

  it("discovers only bounded accepted work and classifies association orphans without replay", async () => {
    const orphan = await accept();
    const orphaned = await store.listOrphanedAcceptedRequests({ limit: 100 });
    expect(orphaned.length).toBeLessThanOrEqual(100);
    expect(orphaned).toContainEqual(expect.objectContaining({
      requestId: orphan.identity.requestId,
      classification: "association_recovery_blocked",
    }));
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(orphan.identity), orphan.identity);
    expect(associated.kind).toBe("associated");
    expect(await store.listOrphanedAcceptedRequests({ limit: 100 })).not.toContainEqual(expect.objectContaining({ requestId: orphan.identity.requestId }));
    if (associated.kind !== "associated") return;

    const first = await store.discoverExecutionWork({ limit: 1 });
    const repeated = await store.discoverExecutionWork({ limit: 100 });
    expect(first.length).toBeLessThanOrEqual(1);
    expect(repeated).toContainEqual(expect.objectContaining({ runId: associated.runId, stepId: "synthesis", kind: "runnable" }));
    expect(repeated).toEqual(await store.discoverExecutionWork({ limit: 100 }));
    const rows = await sql.unsafe(
      "SELECT count(*)::integer AS count FROM public.execution_work_claim_history WHERE run_id=$1::uuid",
      [associated.runId],
    ) as Array<{ count: number }>;
    expect(rows[0]!.count).toBe(0);
  });

  it("serializes concurrent claimers and recovers a lost claim acknowledgement by identity", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    const claimIds = [randomUUID(), randomUUID()];
    const independentClient = postgres(DATABASE_URL, { prepare: false, max: 1 });
    let results: Awaited<ReturnType<SupabaseExecutionStore["claimExecutionWork"]>>[];
    try {
      const independentStore = new SupabaseExecutionStore(independentClient);
      results = await Promise.all([
        store.claimExecutionWork({ runId: associated.runId, claimId: claimIds[0]! }),
        independentStore.claimExecutionWork({ runId: associated.runId, claimId: claimIds[1]! }),
      ]);
    } finally {
      await independentClient.end();
    }
    expect(results.filter((result) => result.status === "claimed")).toHaveLength(1);
    expect(results.filter((result) => result.status === "busy")).toHaveLength(1);
    const winner = results.find((result) => result.status === "claimed");
    if (winner?.status !== "claimed") return;
    const restartedClient = postgres(DATABASE_URL, { prepare: false, max: 1 });
    let replay: Awaited<ReturnType<SupabaseExecutionStore["claimExecutionWork"]>>;
    try {
      replay = await new SupabaseExecutionStore(restartedClient).claimExecutionWork({ runId: associated.runId, claimId: winner.claim.claimId });
    } finally {
      await restartedClient.end();
    }
    expect(replay).toMatchObject({ status: "claimed", claim: winner.claim, stepId: winner.stepId, snapshotRevision: winner.snapshotRevision });
    const claims = await sql.unsafe(
      "SELECT count(*)::integer AS count, max(fencing_generation)::integer AS generation FROM public.execution_work_claim_history WHERE run_id=$1::uuid",
      [associated.runId],
    ) as Array<{ count: number; generation: number }>;
    expect(claims[0]).toEqual({ count: 1, generation: 1 });

    const parallelAcceptance = await accept();
    const parallelRun = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(parallelAcceptance.identity), parallelAcceptance.identity);
    const otherAccepted = await accept();
    const otherRun = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(otherAccepted.identity), otherAccepted.identity);
    if (parallelRun.kind !== "associated" || otherRun.kind !== "associated") throw new Error("Expected parallel run fixtures.");
    const parallel = await Promise.all([
      store.claimExecutionWork({ runId: parallelRun.runId, claimId: randomUUID() }),
      store.claimExecutionWork({ runId: otherRun.runId, claimId: randomUUID() }),
    ]);
    expect(parallel.every((result) => result.status === "claimed")).toBe(true);
  });

  it("uses database-time leases and fencing to reject stale writes after reclaim", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    const old = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID(), leaseSeconds: 30 });
    if (old.status !== "claimed") throw new Error("Expected first claim.");
    expect(await store.renewExecutionWorkClaim({ runId: associated.runId, claim: old.claim })).toMatchObject({ status: "renewed" });
    await sql`UPDATE public.execution_run_work_state SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_work_claim_history SET lease_until=clock_timestamp()-interval '1 second' WHERE claim_id=${old.claim.claimId}::uuid`;
    const replacement = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() });
    if (replacement.status !== "claimed") throw new Error("Expected reclaimed work.");
    expect(replacement.claim.fencingGeneration).toBe(old.claim.fencingGeneration + 1);
    expect(await store.renewExecutionWorkClaim({ runId: associated.runId, claim: old.claim })).toEqual({ status: "stale_claim" });
    expect(await store.releaseExecutionWorkClaim({ runId: associated.runId, claim: old.claim, expectedRevision: 0 })).toEqual({ status: "stale_claim" });

    const pending = await store.getRun({ runId: associated.runId, userId });
    if (!pending) throw new Error("Expected run fixture.");
    const write = {
      runId: associated.runId,
      userId,
      expectedRevision: pending.snapshotRevision,
      status: "running" as const,
      snapshot: pending.snapshot,
      startedAt: new Date().toISOString(),
    };
    expect(await store.saveRunState(write)).toMatchObject({ status: "conflict" });
    expect(await store.saveRunState({ ...write, workClaim: old.claim })).toMatchObject({ status: "conflict" });
    const currentWrite = await store.saveRunState({ ...write, workClaim: replacement.claim });
    expect(currentWrite.status).toBe("saved");
    if (currentWrite.status !== "saved") return;
    expect(await store.releaseExecutionWorkClaim({ runId: associated.runId, claim: replacement.claim, expectedRevision: 0 })).toEqual({ status: "revision_conflict" });
    expect(await store.releaseExecutionWorkClaim({ runId: associated.runId, claim: replacement.claim, expectedRevision: currentWrite.snapshotRevision })).toEqual({ status: "released" });
  });

  it("does not renew or advance work after a human pause", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    const claim = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() });
    if (claim.status !== "claimed") throw new Error("Expected claimed run fixture.");
    const paused = await store.pauseRun({
      runId: associated.runId, userId, expectedControlRevision: 0,
      actorUserId: userId, createdAt: new Date().toISOString(),
    });
    expect(paused.status).toBe("paused");
    expect(await store.renewExecutionWorkClaim({ runId: associated.runId, claim: claim.claim })).toEqual({ status: "ineligible" });
    expect(await store.saveRunState({
      runId: associated.runId, userId, expectedRevision: 0, status: "running",
      snapshot: (await store.getRun({ runId: associated.runId, userId }))!.snapshot,
      startedAt: new Date().toISOString(), workClaim: claim.claim,
    })).toMatchObject({ status: "conflict" });
    expect(await store.releaseExecutionWorkClaim({ runId: associated.runId, claim: claim.claim, expectedRevision: 0 })).toEqual({ status: "released" });

    const stoppedAcceptance = await accept();
    const stoppedRun = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(stoppedAcceptance.identity), stoppedAcceptance.identity);
    if (stoppedRun.kind !== "associated") throw new Error("Expected stopped run fixture.");
    const stoppedClaim = await store.claimExecutionWork({ runId: stoppedRun.runId, claimId: randomUUID() });
    if (stoppedClaim.status !== "claimed") throw new Error("Expected claim before stop.");
    expect(await store.stopRun({
      runId: stoppedRun.runId, userId, expectedControlRevision: 0,
      actorUserId: userId, createdAt: new Date().toISOString(),
    })).toMatchObject({ status: "stopped" });
    expect(await store.renewExecutionWorkClaim({ runId: stoppedRun.runId, claim: stoppedClaim.claim })).toEqual({ status: "ineligible" });
    expect(await store.releaseExecutionWorkClaim({ runId: stoppedRun.runId, claim: stoppedClaim.claim, expectedRevision: 0 })).toEqual({ status: "released" });
  });

  it("classifies an expired in-flight provider boundary as recovery-required, never runnable", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    const claim = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() });
    if (claim.status !== "claimed") throw new Error("Expected claimed run fixture.");
    await sql`UPDATE public.execution_runs SET status='running',started_at=clock_timestamp() WHERE id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_steps SET status='running',started_at=clock_timestamp() WHERE run_id=${associated.runId}::uuid AND step_id='synthesis'`;
    const step = (await store.getRun({ runId: associated.runId, userId }))?.steps.find((item) => item.stepId === "synthesis");
    if (!step) throw new Error("Expected in-flight step fixture.");
    const admitted = await sql`
      SELECT public.admit_agent_provider_cost(
        ${associated.runId}::uuid, 'synthesis', ${step.executionKey}::uuid,
        1::smallint, 1::smallint, 'standard', 'openai', 'gpt-6-luna', 10, 32, NULL::smallint
      ) AS result
    ` as Array<{ result: { admission_id: string } }>;
    const admissionId = admitted[0]?.result.admission_id;
    if (!admissionId) throw new Error("Expected durable test admission.");
    await sql`UPDATE public.execution_run_work_state SET lease_until=clock_timestamp()-interval '1 second' WHERE run_id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_work_claim_history SET lease_until=clock_timestamp()-interval '1 second' WHERE claim_id=${claim.claim.claimId}::uuid`;
    await expect(sql`
      SELECT public.admit_agent_provider_cost(
        ${associated.runId}::uuid, 'synthesis', ${step.executionKey}::uuid,
        1::smallint, 2::smallint, 'standard', 'openai', 'gpt-6-luna', 10, 32, NULL::smallint
      )
    `).rejects.toThrow("AGENT_PROVIDER_COST_WORK_CLAIM_STALE");
    await expect(sql`SELECT public.begin_agent_provider_cost_dispatch(${admissionId}::uuid)`)
      .rejects.toThrow("AGENT_PROVIDER_COST_WORK_CLAIM_STALE");
    const admissions = await sql`SELECT count(*)::integer AS count, max(status) AS status,
      max(reservation_nano_usd)::text AS reservation FROM public.agent_provider_cost_admissions WHERE run_id=${associated.runId}::uuid` as Array<{ count: number; status: string; reservation: string }>;
    expect(admissions[0]).toMatchObject({ count: 1, status: "admitted" });
    expect(BigInt(admissions[0]!.reservation)).toBeGreaterThan(BigInt(0));
    expect(await store.discoverExecutionWork({ limit: 20 })).toContainEqual(expect.objectContaining({
      runId: associated.runId, stepId: "synthesis", kind: "recovery_required",
    }));
    expect(await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() })).toEqual({ status: "recovery_required" });
    expect(await store.discoverExecutionWork({ limit: 20 })).not.toContainEqual(expect.objectContaining({ runId: associated.runId, kind: "runnable" }));
  });

  it("discovers explicitly due retries without changing the cost or attempt ledgers", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    await sql`UPDATE public.execution_runs SET status='running',started_at=clock_timestamp() WHERE id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_steps SET status='running',started_at=clock_timestamp() WHERE run_id=${associated.runId}::uuid AND step_id='synthesis'`;
    await sql`UPDATE public.execution_steps SET status='retry_pending',next_retry_at=clock_timestamp()-interval '1 second' WHERE run_id=${associated.runId}::uuid AND step_id='synthesis'`;
    expect(await store.discoverExecutionWork({ limit: 100 })).toContainEqual(expect.objectContaining({
      runId: associated.runId, stepId: "synthesis", kind: "runnable",
    }));
    const claim = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() });
    if (claim.status !== "claimed") throw new Error("Expected safe retry to be claimable.");
    const before = await sql`SELECT count(*)::integer AS count FROM public.agent_provider_cost_admissions WHERE run_id=${associated.runId}::uuid` as Array<{ count: number }>;
    expect(before[0]!.count).toBe(0);
    expect((await store.getRun({ runId: associated.runId, userId }))?.steps.find((step) => step.stepId === "synthesis")?.attempt).toBe(1);
  });

  it("blocks pending approval and capability-denied runs from discovery and claims", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    await sql`INSERT INTO public.execution_human_approval_checkpoints (
      run_id,user_id,step_id,plan_fingerprint,step_fingerprint,source
    ) VALUES (${associated.runId}::uuid,${userId}::uuid,'synthesis',${associated.planFingerprint},${"e".repeat(64)},'runtime_policy')`;
    expect(await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() })).toEqual({ status: "ineligible" });

    const deniedAcceptance = await accept();
    const deniedRun = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(deniedAcceptance.identity), deniedAcceptance.identity);
    if (deniedRun.kind !== "associated") throw new Error("Expected associated denied-capability fixture.");
    await sql`UPDATE public.execution_steps SET capability_id='web_search' WHERE run_id=${deniedRun.runId}::uuid AND step_id='synthesis'`;
    expect(await store.claimExecutionWork({ runId: deniedRun.runId, claimId: randomUUID() })).toEqual({ status: "ineligible" });
    expect(await store.discoverExecutionWork({ limit: 100 })).not.toContainEqual(expect.objectContaining({ runId: deniedRun.runId }));
  });

  it("keeps completed finalization work out of execution claims", async () => {
    const accepted = await accept();
    const associated = await makeRuntime(store).runtime.associateAcceptedRequest(plan(), runtimeInput(accepted.identity), accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated run fixture.");
    await sql`UPDATE public.execution_runs SET status='running',started_at=clock_timestamp() WHERE id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_steps SET status='running',started_at=clock_timestamp() WHERE run_id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_steps SET status='succeeded',completed_at=clock_timestamp(),result_envelope='{"kind":"text","value":{"text":"done"}}'::jsonb WHERE run_id=${associated.runId}::uuid`;
    await sql`UPDATE public.execution_runs SET status='succeeded',completed_at=clock_timestamp() WHERE id=${associated.runId}::uuid`;
    const pendingFinalizations = await sql`SELECT run_id FROM public.list_pending_agent_execution_finalizations(100)` as Array<{ run_id: string }>;
    expect(pendingFinalizations.some((row) => row.run_id === associated.runId)).toBe(true);
    await sql`INSERT INTO public.execution_run_finalizations (
      run_id,user_id,request_id,conversation_id,user_message_id,assistant_message_id,completion_sha256
    ) VALUES (
      ${associated.runId}::uuid,${userId}::uuid,${accepted.identity.requestId}::uuid,
      ${accepted.identity.conversationId}::uuid,${accepted.identity.userMessageId}::uuid,
      ${accepted.identity.assistantMessageId}::uuid,${"a".repeat(64)}
    )`;
    const finalized = await sql`SELECT run_id FROM public.list_pending_agent_execution_finalizations(100)` as Array<{ run_id: string }>;
    expect(finalized.some((row) => row.run_id === associated.runId)).toBe(false);
    expect(await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() })).toEqual({ status: "ineligible" });
    expect(await store.discoverExecutionWork({ limit: 100 })).not.toContainEqual(expect.objectContaining({ runId: associated.runId }));
  });

  it("advances File Analysis → Standard → Document in successive fenced slices and finalizes the original message once", async () => {
    const documentId = randomUUID();
    await sql`INSERT INTO public.documents (
      id,user_id,conversation_id,file_name,mime_type,size_bytes,storage_path,extracted_text,extraction_status
    ) VALUES (
      ${documentId}::uuid,${userId}::uuid,${conversationId}::uuid,'quality.txt','text/plain',12,
      ${`qualification/${documentId}.txt`},'Accepted quality evidence for qualification.','ready'
    )`;
    const accepted = await accept({ documentIds: [documentId], message: "Analyze the quality report and prepare a report." });
    const runtimeInputForRun: ExecutionRuntimeInput = {
      ...runtimeInput(accepted.identity),
      attachments: [{ id: documentId, kind: "file" }],
      resourceReferences: [documentId],
      userInput: "Analyze the quality report and prepare a report.",
    };
    const calls: CapabilityExecutionInput[] = [];
    const trustedSubject = Object.freeze({ assertCurrent: async () => true }) as never;
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: { execute: async (input): Promise<ExecutionStepResult> => {
        calls.push(input);
        if (input.capabilityId === "file_analysis") return {
          kind: "structured_data",
          value: { kind: "file_context", userId, conversationId,
            documents: [{ documentId, fileName: "quality.txt", mimeType: "text/plain", sizeBytes: 12,
              extractedText: "Accepted quality evidence for qualification." }] },
        };
        if (input.capabilityId === "standard") return {
          kind: "text",
          value: { kind: "standard_operation", requestId: accepted.identity.requestId, userId, conversationId,
            reply: "Quality findings are documented.", model: "mock-standard", reasoningEffort: "medium", measurements: [] },
        };
        return {
          kind: "document",
          value: { kind: "generated_document", artifactId: randomUUID(), conversationId,
            messageId: accepted.identity.assistantMessageId, filename: "quality-report.pdf", format: "pdf",
            mimeType: "application/pdf", sizeBytes: 128, createdAt: new Date().toISOString() },
        };
      } },
      authorizer: { authorize: async () => ({ allowed: false }) },
      requestMessageBindingValidator: { validate: async () => true },
      createExecutionId: randomUUID,
      createExecutionKey: randomUUID,
      now: () => new Date(),
      resolveTrustedExecutionSubject: async () => trustedSubject,
      createTrustedBackgroundAuthorizer: () => ({ authorize: async () => ({ allowed: true }) }),
    });
    const associated = await runtime.associateAcceptedRequest(qualityAnalysisPlan(), runtimeInputForRun, accepted.identity);
    if (associated.kind !== "associated") throw new Error("Expected associated worker run.");

    // Test fixtures from earlier assertions are isolated from the one candidate for this worker sequence.
    await sql`UPDATE public.execution_run_work_state SET available_at=clock_timestamp()+interval '1 day'
      WHERE run_id<>${associated.runId}::uuid AND claim_id IS NULL AND recovery_state='ready'`;
    const finalizer = createAcceptedExecutionFinalizer({
      loadAcceptedRun: (runId) => store.getAcceptedRunForFinalization({ runId }),
      finalizeAtomically: async ({ runId, finalText }) => {
        const [row] = await sql<{ result: unknown }[]>`SELECT public.finalize_accepted_agent_execution(
          ${runId}::uuid,${finalText}
        ) AS result`;
        return row!.result;
      },
      listPendingRunIds: async (limit) => {
        const rows = await sql<{ run_id: string }[]>`SELECT run_id FROM public.list_pending_agent_execution_finalizations(${limit})`;
        return rows.map((row) => row.run_id);
      },
    });
    const worker = createTrustedExecutionWorker({ store, runtime, listPendingFinalizationRunIds: finalizer.listPendingRunIds,
      finalizeAcceptedExecution: finalizer.finalize, createClaimId: randomUUID });

    expect(await worker.runOnce()).toMatchObject({ status: "bounded_yield", runId: associated.runId, stepId: "file-analysis", capability: "file_analysis" });
    expect(await worker.runOnce()).toMatchObject({ status: "bounded_yield", runId: associated.runId, stepId: "synthesis", capability: "standard" });
    expect(await worker.runOnce()).toMatchObject({ status: "step_completed", runId: associated.runId, stepId: "document", capability: "document_generation" });
    expect(calls.map(({ stepId, capabilityId }) => [stepId, capabilityId])).toEqual([
      ["file-analysis", "file_analysis"], ["synthesis", "standard"], ["document", "document_generation"],
    ]);
    expect(calls[1]?.inputs).toContainEqual(expect.objectContaining({ source: "step", stepId: "file-analysis" }));
    expect(calls[2]?.inputs).toContainEqual(expect.objectContaining({ source: "step", stepId: "synthesis" }));
    expect(calls.every((call) => call.context.trustedExecutionSubject === trustedSubject)).toBe(true);
    expect((await store.getRun({ runId: associated.runId, userId }))?.steps).toMatchObject([
      { status: "succeeded" }, { status: "succeeded" }, { status: "succeeded" },
    ]);

    expect(await worker.runOnce()).toMatchObject({ status: "finalization_completed", runId: associated.runId });
    const finalized = await sql<{ content: string }[]>`SELECT content FROM public.messages WHERE id=${accepted.identity.assistantMessageId}::uuid`;
    expect(finalized[0]?.content).toBe("Your requested document is ready.");
    const receipts = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.execution_run_finalizations WHERE run_id=${associated.runId}::uuid`;
    expect(receipts[0]?.count).toBe(1);
    expect(await worker.runOnce()).toMatchObject({ status: "no_work" });
    expect(calls).toHaveLength(3);
    // Storage upload and metadata use the already-qualified claim-bound 3D.2A path; this test mocks that adapter boundary.
  });
});
