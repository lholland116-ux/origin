import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import type { AcceptedRequestExecutionIdentity, ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const ENABLED = process.env.TRUSTED_EXECUTION_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.TRUSTED_EXECUTION_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57222/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;

function requireIsolatedDatabase(connectionString: string): void {
  const parsed = new URL(connectionString);
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.port === "57222" && parsed.pathname === "/postgres")) {
    throw new Error("Trusted execution persistence tests are restricted to isolated loopback PostgreSQL port 57222.");
  }
}

function makeHandoff(capability: "image_generation" | "document_generation", objective: string): PlannedExecutionHandoff {
  const candidate = {
    objective,
    steps: [{ id: "trusted-step", capability, dependsOn: [], inputs: [{ source: "user" as const }],
      expectedOutput: capability === "image_generation" ? "image" as const : "document" as const }],
    status: "validated" as const,
  };
  const checked = validateIntelligencePlan(candidate);
  if (!checked.valid) throw new Error(checked.errors.join("; "));
  return {
    version: 1,
    objective,
    plan: candidate,
    orderedStepIds: checked.orderedStepIds,
    plannerSource: "deterministic",
    governance: { maxSteps: 1, capabilityIds: [capability], modelPlanningAllowed: false,
      maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
  };
}

describeDatabase("trusted execution persistence PostgreSQL boundary (isolated local database only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  let runtime: DurableXStateExecutionRuntime;
  async function prepare(
    capability: "image_generation" | "document_generation",
    userId = randomUUID(),
    options: { plan?: "free" | "pro"; reasoningMode?: "instant" | "medium" | "high" } = {},
  ) {
    const conversationId = randomUUID();
    const idempotencyKey = randomUUID();
    const requestFingerprint = "a".repeat(64);
    await sql`INSERT INTO auth.users (id, aud, role, email) VALUES
      (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@trusted-execution.test`}) ON CONFLICT DO NOTHING`;
    if (options.plan === "pro") await sql`UPDATE public.profiles SET plan = 'pro' WHERE id = ${userId}::uuid`;
    await sql`INSERT INTO public.conversations (id,user_id,title) VALUES (${conversationId}::uuid,${userId}::uuid,'trusted execution test')`;
    const objective = capability === "image_generation" ? "Make a test image" : "Create a test PDF document";
    const [acceptedRow] = await sql<{ result: Record<string, unknown> }[]>`
      SELECT public.accept_agent_request(
        ${userId}::uuid, ${conversationId}::uuid, ${idempotencyKey}, ${requestFingerprint},
        ${sql.json({ routingMode: "auto", reasoningMode: options.reasoningMode ?? "medium" })}::jsonb,
        ${objective}, ARRAY[]::uuid[], '[]'::jsonb,
        ${new Date().toISOString().slice(0,10)}::date, 100, 100
      ) AS result`;
    const accepted = acceptedRow!.result;
    const identity: AcceptedRequestExecutionIdentity = {
      requestId: accepted.requestId as string,
      userId: accepted.userId as string,
      conversationId: accepted.conversationId as string,
      userMessageId: accepted.userMessageId as string,
      assistantMessageId: accepted.assistantMessageId as string,
      idempotencyKey,
      requestFingerprint,
    };
    const binding = { requestId: identity.requestId, userId, conversationId,
      userMessageId: identity.userMessageId, assistantMessageId: identity.assistantMessageId };
    const associated = await runtime.associateAcceptedRequest(makeHandoff(capability, objective), {
      authenticatedUserId: userId, conversationId, requestMessageBinding: binding, userInput: objective,
    }, identity);
    if (associated.kind !== "associated") throw new Error(`Association failed: ${associated.kind}`);
    const claimed = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() });
    if (claimed.status !== "claimed" || claimed.stepId !== "trusted-step") throw new Error(`Work claim failed: ${claimed.status}`);

    const runActor = createExecutionRunLifecycle();
    runActor.start();
    const stepActor = createExecutionStepLifecycle();
    const envelope = (stepSnapshot = stepActor.getPersistedSnapshot()): ExecutionSnapshotEnvelope => ({
      version: 1,
      runtimeVersion: 1,
      snapshot: { run: runActor.getPersistedSnapshot(), steps: { "trusted-step": stepSnapshot } },
    });
    const running = await store.saveRunState({ runId: associated.runId, userId, expectedRevision: claimed.snapshotRevision,
      status: "running", snapshot: envelope(), startedAt: new Date().toISOString(), workClaim: claimed.claim });
    if (running.status !== "saved") throw new Error(`Run start failed: ${running.status}`);
    stepActor.start();
    const step = await store.claimStep({ runId: associated.runId, userId, stepId: "trusted-step",
      expectedRevision: running.snapshotRevision, snapshot: envelope(), startedAt: new Date().toISOString(), workClaim: claimed.claim });
    if (step.status !== "claimed") throw new Error(`Step claim failed: ${step.status}`);
    runActor.stop();
    stepActor.stop();
    return { runId: associated.runId, userId, conversationId, identity, executionKey: step.executionKey, claim: claimed.claim };
  }

  async function resolve(input: Awaited<ReturnType<typeof prepare>>) {
    const [row] = await sql<{ subject: unknown }[]>`
      SELECT to_jsonb(subject) AS subject FROM public.resolve_trusted_agent_execution_subject(
        ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
        ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint, false
      ) AS subject`;
    return row?.subject;
  }

  async function reserveImage(input: Awaited<ReturnType<typeof prepare>>) {
    const [row] = await sql<{ attempt_id: string }[]>`
      SELECT public.reserve_trusted_image_generation_quota(
        ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
        ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint
      ) AS attempt_id`;
    return row!.attempt_id;
  }

  async function seedSucceededImageUsage(
    input: Awaited<ReturnType<typeof prepare>>,
    plan: "free" | "pro",
    count: number,
    daysAgo: number,
  ) {
    await sql`INSERT INTO public.image_generation_attempts (
      user_id, conversation_id, plan_snapshot, status, reserved_at, expires_at,
      provider_started_at, completed_at, provider, model, estimated_cost_microusd
    )
    SELECT ${input.userId}::uuid, ${input.conversationId}::uuid,
      ${plan}::text, 'succeeded',
      pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => ${daysAgo}::integer, hours => 2),
      pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => ${daysAgo}::integer, hours => 1),
      pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => ${daysAgo}::integer, mins => 45),
      pg_catalog.clock_timestamp() - pg_catalog.make_interval(days => ${daysAgo}::integer, mins => 30),
      'replicate', 'flux-schnell', 3000
    FROM pg_catalog.generate_series(1, ${count}::integer)`;
  }

  beforeAll(async () => {
    if (!ENABLED) return;
    requireIsolatedDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 12 });
    await sql`SELECT 1`;
    // The isolated database-only harness has no Storage API to provision its private bucket.
    await sql`INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
      VALUES ('chat-images', 'chat-images', false, 10485760, ARRAY['image/png','image/jpeg','image/webp'])
      ON CONFLICT (id) DO NOTHING`;
    store = new SupabaseExecutionStore(sql);
    runtime = new DurableXStateExecutionRuntime({ store,
      executor: { execute: async () => { throw new Error("Provider execution is forbidden in this test."); } },
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
    });
  });

  afterAll(async () => {
    if (!ENABLED || !sql) return;
    // The entire database/Storage catalog is a disposable project owned by this test gate.
    await sql.end();
  });

  it("derives a valid subject from acceptance and an active fenced claim, and denies forged/stale identities", async () => {
    const input = await prepare("image_generation");
    expect(await resolve(input)).toMatchObject({ user_id: input.userId,
      request_id: input.identity.requestId, conversation_id: input.conversationId,
      user_message_id: input.identity.userMessageId, assistant_message_id: input.identity.assistantMessageId,
      capability_id: "image_generation", execution_key: input.executionKey });

    await expect(sql`SELECT public.resolve_trusted_agent_execution_subject(
      ${input.runId}::uuid, 'trusted-step', ${randomUUID()}::uuid,
      ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint, false
    )`).rejects.toThrow();
    await expect(sql`SELECT public.resolve_trusted_agent_execution_subject(
      ${randomUUID()}::uuid, 'trusted-step', ${input.executionKey}::uuid,
      ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint, false
    )`).rejects.toThrow();
    await expect(sql`SELECT public.resolve_trusted_agent_execution_subject(
      ${input.runId}::uuid, 'forged-step', ${input.executionKey}::uuid,
      ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint, false
    )`).rejects.toThrow();
    await expect(sql`SELECT public.resolve_trusted_agent_execution_subject(
      ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
      ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration + 1}::bigint, false
    )`).rejects.toThrow();
    await sql`UPDATE public.execution_run_work_state SET lease_until = pg_catalog.clock_timestamp() - interval '1 second'
      WHERE run_id = ${input.runId}::uuid`;
    await expect(resolve(input)).rejects.toThrow();
    const [attempts] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.image_generation_attempts
      WHERE execution_run_id = ${input.runId}::uuid`;
    expect(attempts!.count).toBe(0);
  });

  it("rejects a claim after its owner releases it", async () => {
    const input = await prepare("image_generation");
    // Model a released claim-history record directly: this step is already
    // running, so the production release RPC correctly refuses that boundary.
    await sql`UPDATE public.execution_work_claim_history
      SET status = 'released', ended_at = pg_catalog.clock_timestamp()
      WHERE claim_id = ${input.claim.claimId}::uuid
        AND fencing_generation = ${input.claim.fencingGeneration}::bigint`;
    await expect(resolve(input)).rejects.toThrow();
    await expect(reserveImage(input)).rejects.toThrow();
    const [attempts] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count
      FROM public.image_generation_attempts WHERE execution_run_id = ${input.runId}::uuid`;
    expect(attempts!.count).toBe(0);
  });

  it("atomically de-duplicates concurrent image quota reservations and requires cost admission before provider start", async () => {
    const input = await prepare("image_generation");
    const connections = [postgres(DATABASE_URL, { prepare: false, max: 1 }), postgres(DATABASE_URL, { prepare: false, max: 1 })];
    try {
      const reserveOn = (connection: postgres.Sql) => connection<{ attempt_id: string }[]>`
        SELECT public.reserve_trusted_image_generation_quota(
          ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
          ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint
        ) AS attempt_id`;
      const [first, second] = await Promise.all(connections.map(reserveOn));
      expect(first[0]!.attempt_id).toBe(second[0]!.attempt_id);
      const attemptId = first[0]!.attempt_id;
      const [count] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.image_generation_attempts
        WHERE execution_run_id = ${input.runId}::uuid`;
      expect(count!.count).toBe(1);
      await expect(sql`SELECT public.start_trusted_image_generation_attempt(
        ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
        ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
        ${attemptId}::uuid, 'replicate', 'flux-schnell')`).rejects.toThrow(/PROVIDER_COST_ADMISSION_REQUIRED/);

      const [admissionRow] = await sql<{ result: Record<string, unknown> }[]>`
        SELECT public.admit_agent_provider_cost(${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
          1::smallint, 1::smallint, 'image_generation', 'replicate', 'flux-schnell',
          NULL::integer, NULL::integer, 1::smallint) AS result`;
      const admission = admissionRow!.result;
      expect(admission.may_dispatch).toBe(true);
      const [started] = await sql<{ started: boolean }[]>`SELECT public.start_trusted_image_generation_attempt(
        ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
        ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
        ${attemptId}::uuid, 'replicate', 'flux-schnell') AS started`;
      expect(started!.started).toBe(true);
      await sql`SELECT public.begin_agent_provider_cost_dispatch(${admission.admission_id as string}::uuid)`;

      const imagePath = `generated/${input.userId}/${input.conversationId}/${randomUUID()}.png`;
      await sql`INSERT INTO storage.objects (bucket_id, name, metadata)
        VALUES ('chat-images', ${imagePath}, ${sql.json({ mimetype: "image/png", size: 3 })}::jsonb)`;
      const [completed] = await sql<{ generated_image_id: string }[]>`
        SELECT generated_image_id FROM public.complete_trusted_image_generation(
          ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
          ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
          ${attemptId}::uuid, 'mock prompt', ${imagePath}, 'image/png', 'replicate', 'flux-schnell')`;
      const [replayed] = await sql<{ generated_image_id: string }[]>`
        SELECT generated_image_id FROM public.complete_trusted_image_generation(
          ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
          ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
          ${attemptId}::uuid, 'mock prompt', ${imagePath}, 'image/png', 'replicate', 'flux-schnell')`;
      expect(replayed!.generated_image_id).toBe(completed!.generated_image_id);
      const [images] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.message_generated_images
        WHERE user_id = ${input.userId}::uuid AND conversation_id = ${input.conversationId}::uuid`;
      expect(images!.count).toBe(1);
      const [messages] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.messages
        WHERE conversation_id = ${input.conversationId}::uuid`;
      expect(messages!.count).toBe(2);
    } finally {
      await Promise.all(connections.map((connection) => connection.end()));
    }
  });

  it("preserves the existing Free/Pro daily and monthly image quota rules", async () => {
    const freeDaily = await prepare("image_generation");
    await seedSucceededImageUsage(freeDaily, "free", 2, 0);
    await reserveImage(freeDaily);
    const freeDailyNext = await prepare("image_generation", freeDaily.userId);
    await expect(reserveImage(freeDailyNext)).rejects.toThrow(/IMAGE_DAILY_LIMIT_REACHED/);

    const freeMonthly = await prepare("image_generation");
    await seedSucceededImageUsage(freeMonthly, "free", 20, 2);
    await reserveImage(freeMonthly);
    const freeMonthlyNext = await prepare("image_generation", freeMonthly.userId);
    await expect(reserveImage(freeMonthlyNext)).rejects.toThrow(/IMAGE_MONTHLY_LIMIT_REACHED/);

    const proDaily = await prepare("image_generation", randomUUID(), { plan: "pro" });
    await seedSucceededImageUsage(proDaily, "pro", 19, 0);
    await reserveImage(proDaily);
    const proDailyNext = await prepare("image_generation", proDaily.userId);
    await expect(reserveImage(proDailyNext)).rejects.toThrow(/IMAGE_DAILY_LIMIT_REACHED/);

    const proMonthly = await prepare("image_generation", randomUUID(), { plan: "pro" });
    await seedSucceededImageUsage(proMonthly, "pro", 199, 2);
    await reserveImage(proMonthly);
    const proMonthlyNext = await prepare("image_generation", proMonthly.userId);
    await expect(reserveImage(proMonthlyNext)).rejects.toThrow(/IMAGE_MONTHLY_LIMIT_REACHED/);
  });

  it("persists documents only to the accepted assistant message and is idempotent", async () => {
    const input = await prepare("document_generation");
    const documentId = randomUUID();
    const filename = "result.txt";
    const storagePath = `${input.userId}/${input.conversationId}/generated/${documentId}/${filename}`;
    await sql`INSERT INTO storage.objects (bucket_id, name, metadata)
      VALUES ('documents', ${storagePath}, ${sql.json({ mimetype: "text/plain", size: 3 })}::jsonb)`;

    await expect(sql`SELECT * FROM public.persist_trusted_generated_document_for_execution(
      ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
      ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
      ${documentId}::uuid, ${`other-user/${input.conversationId}/generated/${documentId}/${filename}`},
      ${filename}, 'txt', 'text/plain', 3, 'simple-document')`).rejects.toThrow(/INVALID_GENERATED_DOCUMENT_PATH/);
    const [saved] = await sql<{ was_existing: boolean; generated_document_id: string }[]>`
      SELECT generated_document_id, was_existing FROM public.persist_trusted_generated_document_for_execution(
        ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
        ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
        ${documentId}::uuid, ${storagePath}, ${filename}, 'txt', 'text/plain', 3, 'simple-document')`;
    const replayDocumentId = randomUUID();
    const replayStoragePath = `${input.userId}/${input.conversationId}/generated/${replayDocumentId}/${filename}`;
    await sql`INSERT INTO storage.objects (bucket_id, name, metadata)
      VALUES ('documents', ${replayStoragePath}, ${sql.json({ mimetype: "text/plain", size: 3 })}::jsonb)`;
    const [replay] = await sql<{ was_existing: boolean; generated_document_id: string }[]>`
      SELECT generated_document_id, was_existing FROM public.persist_trusted_generated_document_for_execution(
        ${input.runId}::uuid, 'trusted-step', ${input.executionKey}::uuid,
        ${input.claim.claimId}::uuid, ${input.claim.fencingGeneration}::bigint,
        ${replayDocumentId}::uuid, ${replayStoragePath}, ${filename}, 'txt', 'text/plain', 3, 'simple-document')`;
    expect(saved!.was_existing).toBe(false);
    expect(replay).toMatchObject({ was_existing: true, generated_document_id: documentId });
    const [messages] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.messages
      WHERE conversation_id = ${input.conversationId}::uuid`;
    expect(messages!.count).toBe(2);
  });

  it("enforces pause before subsequent privileged persistence operations", async () => {
    const input = await prepare("image_generation");
    const paused = await store.pauseRun({ runId: input.runId, userId: input.userId, actorUserId: input.userId,
      expectedControlRevision: 0, createdAt: new Date().toISOString() });
    expect(paused.status).toBe("pause_requested");
    await expect(reserveImage(input)).rejects.toThrow();
    const [count] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count FROM public.image_generation_attempts
      WHERE execution_run_id = ${input.runId}::uuid`;
    expect(count!.count).toBe(0);
  });

  it("rechecks current subscription reasoning entitlement and account disablement", async () => {
    const downgraded = await prepare("image_generation", randomUUID(), { plan: "pro", reasoningMode: "high" });
    await sql`UPDATE public.profiles SET plan = 'free' WHERE id = ${downgraded.userId}::uuid`;
    await expect(resolve(downgraded)).rejects.toThrow();
    const [attemptsAfterDowngrade] = await sql<{ count: number }[]>`SELECT count(*)::integer AS count
      FROM public.image_generation_attempts WHERE execution_run_id = ${downgraded.runId}::uuid`;
    expect(attemptsAfterDowngrade!.count).toBe(0);

    const disabled = await prepare("image_generation");
    await sql`UPDATE auth.users SET banned_until = pg_catalog.clock_timestamp() + interval '1 day'
      WHERE id = ${disabled.userId}::uuid`;
    await expect(resolve(disabled)).rejects.toThrow();
  });
});
