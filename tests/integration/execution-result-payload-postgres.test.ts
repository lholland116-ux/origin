import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlanStep } from "@/lib/ai/intelligence-plan";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import {
  MAX_DURABLE_RESULT_PAYLOAD_BYTES,
  executionResultJsonBytes,
} from "@/lib/agent-runtime/result-payload-contract";
import type { CreateDurableExecutionRunInput, ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import type { ExecutionRunStatus, ExecutionStepResult } from "@/lib/agent-runtime/runtime-contracts";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const RUN_DATABASE_TESTS = process.env.EXECUTION_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.EXECUTION_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";
const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

function requireIsolatedLocalDatabase(connectionString: string): void {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("Execution result-payload tests require a local PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || parsed.port !== "57242" || parsed.pathname !== "/postgres") {
    throw new Error("Execution result-payload tests are restricted to the targeted isolated local database on port 57242.");
  }
}

describeDatabase("durable execution result payloads (isolated local PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const userId = randomUUID();
  const otherUserId = randomUUID();
  const conversationId = randomUUID();

  function snapshot(stepId: string, state: "pending" | "running" | "succeeded"): ExecutionSnapshotEnvelope {
    const run = createExecutionRunLifecycle();
    const step = createExecutionStepLifecycle();
    if (state !== "pending") run.start();
    if (state === "running") step.start();
    if (state === "succeeded") { step.start(); step.succeed(); run.succeed(); }
    return { version: 1, runtimeVersion: 1, snapshot: { run: run.getPersistedSnapshot(), steps: { [stepId]: step.getPersistedSnapshot() } } };
  }

  function createInput(runId: string, capabilityId: PlanStep["capability"], expectedOutput: NonNullable<PlanStep["expectedOutput"]>, stepId = "payload-step"): CreateDurableExecutionRunInput {
    const step: PlanStep = { id: stepId, capability: capabilityId, dependsOn: [], inputs: [{ source: "user" }], expectedOutput };
    return {
      id: runId,
      userId,
      handoffVersion: 1,
      idempotencyKey: `payload-${runId}`,
      requestFingerprint: "a".repeat(64),
      executionPlan: {
        version: 1,
        steps: [step],
        orderedStepIds: [stepId],
        plannerSource: "deterministic",
        governance: { maxSteps: 1, capabilityIds: [capabilityId], modelPlanningAllowed: false, maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: false, handoffVersion: 1 },
      },
      runtimeContext: {
        conversationId,
        requestMessageBinding: { requestId: randomUUID(), userId, conversationId, userMessageId: randomUUID(), assistantMessageId: randomUUID() },
        userInput: "qualification only",
        attachments: [],
        resourceReferences: [],
      },
      snapshot: snapshot(stepId, "pending"),
      steps: [{ stepId, capabilityId, dependencyIds: [], executionKey: randomUUID() }],
      createdAt: new Date().toISOString(),
    };
  }

  async function prepareRunning(input: CreateDurableExecutionRunInput) {
    expect((await store.createRun(input)).status).toBe("created");
    const started = await store.saveRunState({ runId: input.id, userId, expectedRevision: 0, status: "running", snapshot: snapshot(input.steps[0]!.stepId, "running"), startedAt: new Date().toISOString() });
    expect(started.status).toBe("saved");
    const claimed = await store.claimStep({ runId: input.id, userId, stepId: input.steps[0]!.stepId, expectedRevision: 1, snapshot: snapshot(input.steps[0]!.stepId, "running"), startedAt: new Date().toISOString() });
    expect(claimed.status).toBe("claimed");
  }

  async function checkpoint(input: CreateDurableExecutionRunInput, result: ExecutionStepResult, runStatus: ExecutionRunStatus = "succeeded") {
    return store.checkpoint({
      runId: input.id,
      userId,
      expectedRevision: 2,
      runStatus,
      snapshot: snapshot(input.steps[0]!.stepId, "succeeded"),
      updates: [{ stepId: input.steps[0]!.stepId, status: "succeeded", result, completedAt: new Date().toISOString() }],
      completedAt: new Date().toISOString(),
    });
  }

  beforeAll(async () => {
    requireIsolatedLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
    await sql`SELECT 1`;
    await sql`INSERT INTO auth.users (id, aud, role, email) VALUES
      (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@result-payload.test`}),
      (${otherUserId}::uuid, 'authenticated', 'authenticated', ${`${otherUserId}@result-payload.test`})`;
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid OR id = ${otherUserId}::uuid`;
    await sql.end();
  });

  it("round-trips large Standard, Web Search, and CJK File Context results through bounded references", async () => {
    const cases: Array<{ capability: PlanStep["capability"]; output: NonNullable<PlanStep["expectedOutput"]>; result: ExecutionStepResult }> = [
      { capability: "standard", output: "text", result: { kind: "text", value: { reply: "standard answer ".repeat(5_000), measurements: [] } } },
      { capability: "web_search", output: "search_results", result: { kind: "search_results", value: { reply: "web answer ".repeat(6_000), sources: [{ title: "Evidence", url: "https://example.test", snippet: "metadata preserved" }], webSearchCalls: 2 } } },
      { capability: "file_analysis", output: "structured_data", result: { kind: "structured_data", value: { kind: "file_context", extractedText: "漢".repeat(22_000) } } },
    ];

    for (const item of cases) {
      const input = createInput(randomUUID(), item.capability, item.output);
      await prepareRunning(input);
      expect(executionResultJsonBytes(item.result)).toBeGreaterThan(65_536);
      expect(await checkpoint(input, item.result)).toMatchObject({ status: "saved", snapshotRevision: 3 });
      const loaded = await store.getRun({ runId: input.id, userId });
      expect(loaded?.steps[0]?.result).toEqual(item.result);
      const rows = await sql`SELECT steps.result_payload_id,
          octet_length(steps.result_envelope::text) AS envelope_bytes,
          payload.serialized_size_bytes, payload.result_kind
        FROM public.execution_steps AS steps
        JOIN public.execution_step_result_payloads AS payload
          ON payload.id = steps.result_payload_id
          AND payload.run_id = steps.run_id AND payload.user_id = steps.user_id AND payload.step_id = steps.step_id
        WHERE steps.run_id = ${input.id}::uuid AND steps.user_id = ${userId}::uuid`;
      expect(rows).toHaveLength(1);
      expect(Number(rows[0]!.envelope_bytes)).toBeLessThanOrEqual(65_536);
      expect(Number(rows[0]!.serialized_size_bytes)).toBe(executionResultJsonBytes(item.result));
      expect(rows[0]!.result_kind).toBe(item.result.kind);

      const replay = await store.checkpoint({ runId: input.id, userId, expectedRevision: 2, runStatus: "succeeded",
        snapshot: snapshot(input.steps[0]!.stepId, "succeeded"),
        updates: [{ stepId: input.steps[0]!.stepId, status: "succeeded", result: item.result, completedAt: new Date().toISOString() }] });
      expect(replay).toEqual({ status: "saved", snapshotRevision: 3 });
      const count = await sql`SELECT count(*)::integer AS count FROM public.execution_step_result_payloads WHERE run_id = ${input.id}::uuid`;
      expect(count[0]!.count).toBe(1);
    }
  });

  it("keeps small results inline, accepts the exact maximum, and rejects over-limit results without partial writes", async () => {
    const smallInput = createInput(randomUUID(), "standard", "text");
    const smallResult: ExecutionStepResult = { kind: "text", value: { reply: "small" } };
    await prepareRunning(smallInput);
    expect(await checkpoint(smallInput, smallResult)).toMatchObject({ status: "saved" });
    const inline = await sql`SELECT result_payload_id, result_envelope FROM public.execution_steps WHERE run_id = ${smallInput.id}::uuid`;
    expect(inline[0]!.result_payload_id).toBeNull();
    expect(inline[0]!.result_envelope).toEqual(smallResult);

    const emptyResult = { kind: "text", value: "" };
    const maximumResult: ExecutionStepResult = {
      kind: "text",
      value: "x".repeat(MAX_DURABLE_RESULT_PAYLOAD_BYTES - executionResultJsonBytes(emptyResult)!),
    };
    expect(executionResultJsonBytes(maximumResult)).toBe(MAX_DURABLE_RESULT_PAYLOAD_BYTES);
    const maximumInput = createInput(randomUUID(), "standard", "text");
    await prepareRunning(maximumInput);
    expect(await checkpoint(maximumInput, maximumResult)).toMatchObject({ status: "saved" });
    expect((await store.getRun({ runId: maximumInput.id, userId }))?.steps[0]?.result).toEqual(maximumResult);

    const tooLargeInput = createInput(randomUUID(), "standard", "text");
    await prepareRunning(tooLargeInput);
    const tooLargeResult: ExecutionStepResult = { kind: "text", value: `${maximumResult.value as string}x` };
    expect(await checkpoint(tooLargeInput, tooLargeResult)).toEqual({ status: "result_too_large" });
    const untouched = await sql`SELECT status, result_payload_id, result_envelope FROM public.execution_steps WHERE run_id = ${tooLargeInput.id}::uuid`;
    expect(untouched[0]).toMatchObject({ status: "running", result_payload_id: null, result_envelope: null });
  });

  it("rolls payload and step writes back together if the run checkpoint fails", async () => {
    const input = createInput(randomUUID(), "standard", "text");
    await prepareRunning(input);
    const result: ExecutionStepResult = { kind: "text", value: "rollback payload ".repeat(5_000) };
    await expect(store.checkpoint({
      runId: input.id,
      userId,
      expectedRevision: 2,
      runStatus: "not_a_status" as ExecutionRunStatus,
      snapshot: snapshot(input.steps[0]!.stepId, "succeeded"),
      updates: [{ stepId: input.steps[0]!.stepId, status: "succeeded", result, completedAt: new Date().toISOString() }],
      completedAt: new Date().toISOString(),
    })).rejects.toThrow();
    const after = await sql`SELECT status, result_payload_id, result_envelope FROM public.execution_steps WHERE run_id = ${input.id}::uuid`;
    const payloads = await sql`SELECT count(*)::integer AS count FROM public.execution_step_result_payloads WHERE run_id = ${input.id}::uuid`;
    expect(after[0]).toMatchObject({ status: "running", result_payload_id: null, result_envelope: null });
    expect(payloads[0]!.count).toBe(0);
  });

  it("denies direct authenticated lookup, preserves immutability, and cascades with its run", async () => {
    const input = createInput(randomUUID(), "standard", "text");
    await prepareRunning(input);
    const result: ExecutionStepResult = { kind: "text", value: "owned payload ".repeat(5_000) };
    await checkpoint(input, result);
    const rows = await sql`SELECT result_payload_id FROM public.execution_steps WHERE run_id = ${input.id}::uuid`;
    const payloadId = rows[0]!.result_payload_id as string;

    const ownerRead = sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
      await tx`SELECT count(*)::integer FROM public.execution_step_result_payloads WHERE id = ${payloadId}::uuid`;
    });
    const otherRead = sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${otherUserId}, true)`;
      await tx`SELECT count(*)::integer FROM public.execution_step_result_payloads WHERE id = ${payloadId}::uuid`;
    });
    await expect(ownerRead).rejects.toThrow("permission denied");
    await expect(otherRead).rejects.toThrow("permission denied");
    await expect(sql`UPDATE public.execution_step_result_payloads SET payload = '{}'::jsonb WHERE id = ${payloadId}::uuid`)
      .rejects.toThrow("Execution result payloads are immutable");
    await sql`DELETE FROM public.execution_runs WHERE id = ${input.id}::uuid AND user_id = ${userId}::uuid`;
    const remaining = await sql`SELECT count(*)::integer AS count FROM public.execution_step_result_payloads WHERE id = ${payloadId}::uuid`;
    expect(remaining[0]!.count).toBe(0);
  });

  it("fails closed for altered byte, integrity, kind, or payload-identity reference metadata", async () => {
    const input = createInput(randomUUID(), "standard", "text");
    await prepareRunning(input);
    const result: ExecutionStepResult = { kind: "text", value: "tamper target ".repeat(5_000) };
    await checkpoint(input, result);
    const payloadId = (await sql`SELECT result_payload_id FROM public.execution_steps WHERE run_id = ${input.id}::uuid`)[0]!.result_payload_id as string;

    await sql`UPDATE public.execution_steps SET result_envelope = jsonb_set(
      result_envelope, '{value,byteLength}', to_jsonb((result_envelope -> 'value' ->> 'byteLength')::integer + 1)
    ) WHERE run_id = ${input.id}::uuid`;
    await expect(store.getRun({ runId: input.id, userId })).rejects.toThrow("invalid result-payload reference");

    await sql`UPDATE public.execution_steps SET result_envelope = jsonb_set(
      result_envelope, '{value,sha256}', to_jsonb(repeat('f', 64))
    ) WHERE run_id = ${input.id}::uuid`;
    await expect(store.getRun({ runId: input.id, userId })).rejects.toThrow("invalid result-payload reference");

    await sql`UPDATE public.execution_steps SET result_envelope = jsonb_set(
      jsonb_set(result_envelope, '{kind}', '"image"'::jsonb), '{value,resultKind}', '"image"'::jsonb
    ) WHERE run_id = ${input.id}::uuid`;
    await expect(store.getRun({ runId: input.id, userId })).rejects.toThrow("invalid result-payload reference");

    await expect(sql`UPDATE public.execution_steps SET result_envelope = jsonb_set(
      result_envelope, '{value,payloadId}', to_jsonb(${randomUUID()}::text)
    ) WHERE run_id = ${input.id}::uuid`).rejects.toThrow();
    const linked = await sql`SELECT result_payload_id FROM public.execution_steps WHERE run_id = ${input.id}::uuid`;
    expect(linked[0]!.result_payload_id).toBe(payloadId);
  });

  it("rejects relinking a payload UUID to another run and source step", async () => {
    const source = createInput(randomUUID(), "standard", "text");
    await prepareRunning(source);
    await checkpoint(source, { kind: "text", value: "run-scoped payload ".repeat(5_000) });
    const payloadId = (await sql`SELECT result_payload_id FROM public.execution_steps WHERE run_id = ${source.id}::uuid`)[0]!.result_payload_id as string;

    await sql`INSERT INTO public.execution_steps (
      run_id, user_id, step_id, capability_id, dependency_ids, status, started_at, execution_key
    ) VALUES (
      ${source.id}::uuid, ${userId}::uuid, 'same-run-other-step', 'standard', ARRAY['payload-step'], 'running', now(), ${randomUUID()}::uuid
    )`;
    await expect(sql.begin(async (tx) => {
      await tx`UPDATE public.execution_steps SET status = 'succeeded', completed_at = now(),
        result_payload_id = ${payloadId}::uuid,
        result_envelope = ${tx.json({ kind: "text", value: {
          storage: "payload_ref", payloadId, resultKind: "text", byteLength: 1, sha256: "a".repeat(64),
        } })}::jsonb
        WHERE run_id = ${source.id}::uuid AND user_id = ${userId}::uuid AND step_id = 'same-run-other-step'`;
    })).rejects.toThrow();
    const sameRunUnchanged = await sql`SELECT status, result_payload_id, result_envelope FROM public.execution_steps
      WHERE run_id = ${source.id}::uuid AND step_id = 'same-run-other-step'`;
    expect(sameRunUnchanged[0]).toMatchObject({ status: "running", result_payload_id: null, result_envelope: null });

    const otherRun = createInput(randomUUID(), "standard", "text");
    await prepareRunning(otherRun);
    await expect(sql.begin(async (tx) => {
      await tx`UPDATE public.execution_steps SET status = 'succeeded', completed_at = now(),
        result_payload_id = ${payloadId}::uuid,
        result_envelope = ${tx.json({ kind: "text", value: {
          storage: "payload_ref", payloadId, resultKind: "text", byteLength: 1, sha256: "a".repeat(64),
        } })}::jsonb
        WHERE run_id = ${otherRun.id}::uuid AND user_id = ${userId}::uuid AND step_id = 'payload-step'`;
    })).rejects.toThrow();

    const untouched = await sql`SELECT status, result_payload_id, result_envelope FROM public.execution_steps
      WHERE run_id = ${otherRun.id}::uuid AND step_id = 'payload-step'`;
    expect(untouched[0]).toMatchObject({ status: "running", result_payload_id: null, result_envelope: null });
  });
});
