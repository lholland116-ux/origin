import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { CapabilityExecutionInput, ExecutionRuntimeInput } from "@/lib/agent-runtime/capability-executor";
import type { AcceptedRequestExecutionIdentity } from "@/lib/agent-runtime/execution-store";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const RUN_DATABASE_TESTS = process.env.AGENT_PROVIDER_COST_DATABASE_TESTS === "true";
const PRESERVE_TEST_ROWS = process.env.AGENT_PROVIDER_COST_PRESERVE_TEST_ROWS === "true";
const DATABASE_URL = process.env.AGENT_PROVIDER_COST_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57222/postgres";
const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

function requireIsolatedLocalDatabase(connectionString: string): void {
  const parsed = new URL(connectionString);
  if (!(parsed.protocol === "postgres:" || parsed.protocol === "postgresql:")
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || !["57222", "57242"].includes(parsed.port) || parsed.pathname !== "/postgres") {
    throw new Error("Agent provider-cost integration tests are restricted to isolated loopback PostgreSQL ports 57222 or 57242.");
  }
}

function handoff(): PlannedExecutionHandoff {
  const objective = "Exercise provider cost admission without a provider call.";
  const candidate = {
    objective,
    steps: [{ id: "answer", capability: "standard" as const, dependsOn: [] as string[],
      inputs: [{ source: "user" as const }], expectedOutput: "text" as const }],
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

describeDatabase("durable provider cost admission (isolated local PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const userIds: string[] = [];

  async function acceptedRequest(userId: string = randomUUID()): Promise<{
    identity: AcceptedRequestExecutionIdentity;
    runtimeInput: ExecutionRuntimeInput;
  }> {
    const conversationId = randomUUID();
    if (!userIds.includes(userId)) userIds.push(userId);
    await sql`INSERT INTO auth.users (id, aud, role, email) VALUES
      (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@provider-cost.test`})
      ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO public.conversations (id, user_id, title)
      VALUES (${conversationId}::uuid, ${userId}::uuid, 'Provider cost test')`;
    const requestIdempotencyKey = randomUUID();
    const requestFingerprint = randomUUID().replaceAll("-", "").padEnd(64, "a").slice(0, 64);
    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      SELECT public.accept_agent_request(
        ${userId}::uuid, ${conversationId}::uuid, ${requestIdempotencyKey}, ${requestFingerprint},
        ${sql.json({ routingMode: "auto" })}::jsonb,
        'Exercise provider cost admission without a provider call.', ARRAY[]::uuid[], '[]'::jsonb,
        ${new Date().toISOString().slice(0, 10)}::date, 100, 100
      ) AS result`;
    const result = row!.result;
    const identity: AcceptedRequestExecutionIdentity = {
      requestId: result.requestId as string,
      userId: result.userId as string,
      conversationId: result.conversationId as string,
      userMessageId: result.userMessageId as string,
      assistantMessageId: result.assistantMessageId as string,
      idempotencyKey: requestIdempotencyKey,
      requestFingerprint,
    };
    return {
      identity,
      runtimeInput: {
        authenticatedUserId: userId,
        conversationId,
        requestMessageBinding: {
          requestId: identity.requestId,
          userId,
          conversationId,
          userMessageId: identity.userMessageId,
          assistantMessageId: identity.assistantMessageId,
        },
        userInput: "Exercise provider cost admission without a provider call.",
      },
    };
  }

  async function runWithActiveStep<T>(
    callback: (input: CapabilityExecutionInput) => Promise<T>,
    userId?: string,
    allowPaused = false,
  ): Promise<T> {
    const accepted = await acceptedRequest(userId);
    let callbackResult!: T;
    let callbackFailure = "";
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: {
        async execute(input) {
          try {
            callbackResult = await callback(input);
          } catch (error) {
            callbackFailure = error instanceof Error ? error.message : "unknown callback error";
            throw error;
          }
          return {
            kind: "text" as const,
            value: {
              kind: "standard_operation" as const,
              requestId: accepted.identity.requestId,
              userId: accepted.identity.userId,
              conversationId: accepted.identity.conversationId,
              reply: "No provider was called by this database test.",
              model: "qualification-test-model",
              reasoningEffort: "medium" as const,
              measurements: [],
            },
          };
        },
      },
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
    });
    const association = await runtime.associateAcceptedRequest(handoff(), accepted.runtimeInput, accepted.identity);
    if (association.kind !== "associated") throw new Error("Could not create accepted cost-test run.");
    const outcome = await runtime.resume({ runId: association.runId, authenticatedUserId: accepted.identity.userId });
    if (allowPaused && outcome.kind === "paused") return callbackResult;
    if (outcome.kind !== "succeeded") {
      const failureCode = "failure" in outcome ? outcome.failure.code : outcome.kind;
      throw new Error(`Isolated accepted execution failed: ${failureCode}; ${callbackFailure || "executor result rejected"}`);
    }
    return callbackResult;
  }

  async function admission(input: CapabilityExecutionInput, sequence = 1, inputTokens = 120) {
    const cost = input.context.providerCost;
    if (!cost) throw new Error("Accepted execution did not provide trusted provider-cost identity.");
    const [row] = await sql<{ result: Record<string, unknown> }[]>`
      SELECT public.admit_agent_provider_cost(
        ${cost.runId}::uuid, ${cost.stepId}, ${cost.attemptId}::uuid, ${cost.attemptNumber}::smallint,
        ${sequence}::smallint, ${cost.capabilityId}, 'openai', 'gpt-6-luna',
        ${inputTokens}::integer, 4096::integer, NULL::smallint
      ) AS result`;
    return { cost, result: row!.result };
  }

  async function tryAdmission(input: CapabilityExecutionInput, sequence = 1) {
    try {
      return { admitted: true as const, ...(await admission(input, sequence, 16000)) };
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown database error";
      return { admitted: false as const, message };
    }
  }

  async function releaseAdmission(admissionId: string, fingerprint: string) {
    await sql`SELECT public.settle_agent_provider_cost(
      ${admissionId}::uuid, 'no_charge', ${fingerprint},
      NULL, NULL, NULL, NULL, NULL, NULL, 'pre_dispatch_configuration_failure'
    )`;
  }

  beforeAll(async () => {
    if (!RUN_DATABASE_TESTS) return;
    requireIsolatedLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 12 });
    await sql`SELECT 1`;
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    if (!RUN_DATABASE_TESTS || !sql) return;
    if (!PRESERVE_TEST_ROWS) {
      for (const userId of userIds) await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    }
    await sql.end();
  });

  it("admits once, ignores an exact duplicate, and atomically denies duplicate concurrent dispatch", async () => {
    const result = await runWithActiveStep(async (input) => {
      const first = await admission(input);
      const duplicate = await admission(input);
      const admissionId = first.result.admission_id as string;
      let conflictingAdmissionRejected = false;
      try {
        await sql`SELECT public.admit_agent_provider_cost(
          ${first.cost.runId}::uuid, ${first.cost.stepId}, ${first.cost.attemptId}::uuid, ${first.cost.attemptNumber}::smallint,
          1::smallint, ${first.cost.capabilityId}, 'openai', 'gpt-6-luna',
          121::integer, 4096::integer, NULL::smallint
        )`;
      } catch (error) {
        conflictingAdmissionRejected = error instanceof Error && error.message.includes("AGENT_PROVIDER_COST_IDENTITY_CONFLICT");
      }
      const concurrent = await Promise.all([
        admission(input),
        admission(input),
      ]);
      const begin = await sql<{ result: Record<string, unknown> }[]>`
        SELECT public.begin_agent_provider_cost_dispatch(${admissionId}::uuid) AS result`;
      const duplicateBegin = await sql<{ result: Record<string, unknown> }[]>`
        SELECT public.begin_agent_provider_cost_dispatch(${admissionId}::uuid) AS result`;
      return { first, duplicate, conflictingAdmissionRejected, concurrent, begin: begin[0]!.result, duplicateBegin: duplicateBegin[0]!.result };
    });

    expect(result.first.result).toMatchObject({ status: "admitted", may_dispatch: true });
    expect(result.duplicate.result).toMatchObject({ status: "admitted", may_dispatch: false });
    expect(result.duplicate.result.admission_id).toBe(result.first.result.admission_id);
    expect(result.conflictingAdmissionRejected).toBe(true);
    expect(result.concurrent.map(({ result: item }) => item.may_dispatch)).toEqual([false, false]);
    expect(result.begin).toMatchObject({ status: "dispatched", may_dispatch: true });
    expect(result.duplicateBegin).toMatchObject({ status: "dispatched", may_dispatch: false });

    const [rows] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM public.agent_provider_cost_admissions
      WHERE id = ${result.first.result.admission_id as string}::uuid`;
    expect(rows!.count).toBe(1);
  });

  it("atomically enforces concurrent run, user/day, and global/day reservation limits", async () => {
    // A disposable version with tight ceilings makes lock contention observable
    // without hundreds of provider-cost rows. It is restored in finally.
    for (const userId of userIds) await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    userIds.length = 0;
    const [latestPolicy] = await sql<{ next_version: number }[]>`
      SELECT (COALESCE(MAX(version), 0) + 1)::integer AS next_version
      FROM public.agent_provider_cost_policies`;
    const testPolicyVersion = latestPolicy!.next_version;
    await sql`INSERT INTO public.agent_provider_cost_policies (
      version, max_run_nano_usd, max_user_day_nano_usd, max_global_day_nano_usd,
      max_input_tokens, max_output_tokens, max_openai_invocations, max_images, allowed_capabilities
    ) VALUES (
      ${testPolicyVersion}, 4100000, 4100000, 5000000, 16000, 4096, 2, 1,
      ARRAY['standard', 'file_analysis', 'document_generation', 'image_generation']::text[]
    )`;
    await sql`UPDATE public.agent_provider_cost_active_policy SET policy_version = ${testPolicyVersion} WHERE singleton`;
    const releasedIds: string[] = [];
    const releaseRecorded = async () => {
      for (const [index, admissionId] of releasedIds.entries()) {
        await releaseAdmission(admissionId, `${String(index + 1).padStart(64, "0")}`.slice(-64));
      }
      releasedIds.length = 0;
    };
    try {
      const sameRun = await runWithActiveStep(async (input) => Promise.all([
        tryAdmission(input, 1),
        tryAdmission(input, 2),
      ]));
      expect(sameRun.filter((attempt) => attempt.admitted)).toHaveLength(1);
      expect(sameRun.filter((attempt) => !attempt.admitted && attempt.message.includes("AGENT_PROVIDER_COST_RUN_BUDGET_EXHAUSTED"))).toHaveLength(1);
      releasedIds.push(sameRun.find((attempt) => attempt.admitted)!.result.admission_id as string);
      await releaseRecorded();

      const sharedUser = randomUUID();
      const userDay = await Promise.all([
        runWithActiveStep((input) => tryAdmission(input), sharedUser),
        runWithActiveStep((input) => tryAdmission(input), sharedUser),
      ]);
      expect(userDay.filter((attempt) => attempt.admitted)).toHaveLength(1);
      expect(userDay.filter((attempt) => !attempt.admitted && attempt.message.includes("AGENT_PROVIDER_COST_USER_DAY_BUDGET_EXHAUSTED"))).toHaveLength(1);
      releasedIds.push(userDay.find((attempt) => attempt.admitted)!.result.admission_id as string);
      await releaseRecorded();

      const globalDay = await Promise.all([
        runWithActiveStep((input) => tryAdmission(input)),
        runWithActiveStep((input) => tryAdmission(input)),
      ]);
      expect(globalDay.filter((attempt) => attempt.admitted)).toHaveLength(1);
      expect(globalDay.filter((attempt) => !attempt.admitted && attempt.message.includes("AGENT_PROVIDER_COST_GLOBAL_DAY_BUDGET_EXHAUSTED"))).toHaveLength(1);
      releasedIds.push(globalDay.find((attempt) => attempt.admitted)!.result.admission_id as string);
    } finally {
      await releaseRecorded();
      await sql`UPDATE public.agent_provider_cost_active_policy SET policy_version = 1 WHERE singleton`;
    }
  });

  it("rechecks a durable pause before cost admission and provider dispatch", async () => {
    const outcome = await runWithActiveStep(async (input) => {
      const context = input.context.providerCost;
      if (!context) throw new Error("Accepted execution did not provide trusted provider-cost identity.");
      const admitted = await admission(input);
      const pause = await store.pauseRun({
        runId: context.runId,
        userId: input.context.authenticatedUserId,
        expectedControlRevision: 0,
        actorUserId: input.context.authenticatedUserId,
        createdAt: new Date().toISOString(),
      });
      const blockedAdmission = await tryAdmission(input, 2);
      let dispatchBlocked = false;
      try {
        await sql`SELECT public.begin_agent_provider_cost_dispatch(${admitted.result.admission_id as string}::uuid)`;
      } catch (error) {
        dispatchBlocked = error instanceof Error && error.message.includes("AGENT_PROVIDER_COST_CONTROL_BLOCKED");
      }
      return { pause, blockedAdmission, dispatchBlocked };
    }, undefined, true);

    expect(outcome.pause).toMatchObject({ status: "pause_requested", controlState: "pause_requested" });
    expect(outcome.blockedAdmission).toMatchObject({ admitted: false });
    if (!outcome.blockedAdmission.admitted) {
      expect(outcome.blockedAdmission.message).toContain("AGENT_PROVIDER_COST_RUN_INELIGIBLE");
    }
    expect(outcome.dispatchBlocked).toBe(true);
  });

  it("rolls back partial admission, rejects forged attempts, uses UTC days, and persists across reconnect", async () => {
    const outcome = await runWithActiveStep(async (input) => {
      const cost = input.context.providerCost;
      if (!cost) throw new Error("Accepted execution did not provide trusted provider-cost identity.");
      let rpcCompletedBeforeRollback = false;
      try {
        await sql.begin(async (tx) => {
          await tx`SELECT public.admit_agent_provider_cost(
            ${cost.runId}::uuid, ${cost.stepId}, ${cost.attemptId}::uuid, ${cost.attemptNumber}::smallint,
            1::smallint, ${cost.capabilityId}, 'openai', 'gpt-6-luna',
            120::integer, 4096::integer, NULL::smallint
          )`;
          rpcCompletedBeforeRollback = true;
          throw new Error("qualification rollback marker");
        });
      } catch (error) {
        if (!(error instanceof Error) || error.message !== "qualification rollback marker") throw error;
      }
      const [afterRollback] = await sql<{ count: number }[]>`
        SELECT count(*)::integer AS count FROM public.agent_provider_cost_admissions
        WHERE run_id = ${cost.runId}::uuid AND step_id = ${cost.stepId}
          AND attempt_id = ${cost.attemptId}::uuid AND invocation_sequence = 1`;

      let forgedAttemptDenied = false;
      try {
        await sql`SELECT public.admit_agent_provider_cost(
          ${cost.runId}::uuid, ${cost.stepId}, ${randomUUID()}::uuid, ${cost.attemptNumber}::smallint,
          2::smallint, ${cost.capabilityId}, 'openai', 'gpt-6-luna',
          120::integer, 4096::integer, NULL::smallint
        )`;
      } catch (error) {
        forgedAttemptDenied = error instanceof Error && error.message.includes("AGENT_PROVIDER_COST_STEP_INELIGIBLE");
      }
      let forgedRunDenied = false;
      try {
        await sql`SELECT public.admit_agent_provider_cost(
          ${randomUUID()}::uuid, ${cost.stepId}, ${cost.attemptId}::uuid, ${cost.attemptNumber}::smallint,
          2::smallint, ${cost.capabilityId}, 'openai', 'gpt-6-luna',
          120::integer, 4096::integer, NULL::smallint
        )`;
      } catch (error) {
        forgedRunDenied = error instanceof Error && error.message.includes("AGENT_PROVIDER_COST_RUN_INELIGIBLE");
      }

      const admitted = await admission(input, 1);
      const reconnect = postgres(DATABASE_URL, { prepare: false, max: 1 });
      try {
        await reconnect`SET TIME ZONE 'Pacific/Kiritimati'`;
        const [persisted] = await reconnect<{ status: string; utc_day_matches: boolean }[]>`
          SELECT admission.status,
            admission.accounting_day = (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')::date AS utc_day_matches
          FROM public.agent_provider_cost_admissions AS admission
          WHERE admission.id = ${admitted.result.admission_id as string}::uuid`;
        return {
          rpcCompletedBeforeRollback,
          rollbackRows: afterRollback!.count,
          forgedAttemptDenied,
          forgedRunDenied,
          persisted: persisted ?? null,
        };
      } finally {
        await reconnect.end();
      }
    });

    expect(outcome.rpcCompletedBeforeRollback).toBe(true);
    expect(outcome.rollbackRows).toBe(0);
    expect(outcome.forgedAttemptDenied).toBe(true);
    expect(outcome.forgedRunDenied).toBe(true);
    expect(outcome.persisted).toEqual({ status: "admitted", utc_day_matches: true });
  });

  it("settles measured OpenAI usage idempotently, records price evidence, and rejects conflicting replay", async () => {
    const result = await runWithActiveStep(async (input) => {
      const { result: admitted } = await admission(input);
      const admissionId = admitted.admission_id as string;
      await sql`SELECT public.begin_agent_provider_cost_dispatch(${admissionId}::uuid)`;
      const fingerprint = "a".repeat(64);
      const settle = () => sql<{ result: Record<string, unknown> }[]>`
        SELECT public.settle_agent_provider_cost(
          ${admissionId}::uuid, 'settled', ${fingerprint},
          120, 20, 5, 18, NULL, 'resp_test_1', 'provider_succeeded'
        ) AS result`;
      const first = await settle();
      const replay = await settle();
      let conflict = false;
      try {
        await sql`SELECT public.settle_agent_provider_cost(
          ${admissionId}::uuid, 'settled', ${"b".repeat(64)},
          120, 20, 5, 18, NULL, 'resp_test_1', 'provider_succeeded'
        )`;
      } catch { conflict = true; }
      const [row] = await sql<{ status: string; settled_nano_usd: string; settlement_kind: string }[]>`
        SELECT status, settled_nano_usd::text, settlement_kind
        FROM public.agent_provider_cost_admissions WHERE id = ${admissionId}::uuid`;
      return { first: first[0]!.result, replay: replay[0]!.result, conflict, row };
    });

    expect(result.first).toMatchObject({ status: "settled", settled_nano_usd: 19325, overrun: false });
    expect(result.replay).toMatchObject({ status: "settled", idempotent: true, settled_nano_usd: 19325 });
    expect(result.conflict).toBe(true);
    expect(result.row).toEqual({ status: "settled", settled_nano_usd: "19325", settlement_kind: "measured" });
  });

  it("retains dispatched uncertainty, releases only pre-send failures, and keeps invocation identities distinct", async () => {
    const result = await runWithActiveStep(async (input) => {
      const first = await admission(input, 1);
      const second = await admission(input, 2);
      const firstId = first.result.admission_id as string;
      const secondId = second.result.admission_id as string;
      const releaseFingerprint = "c".repeat(64);
      const released = await sql<{ result: Record<string, unknown> }[]>`
        SELECT public.settle_agent_provider_cost(${firstId}::uuid, 'no_charge', ${releaseFingerprint},
          NULL, NULL, NULL, NULL, NULL, NULL, 'pre_dispatch_configuration_failure') AS result`;
      await sql`SELECT public.begin_agent_provider_cost_dispatch(${secondId}::uuid)`;
      const uncertain = await sql<{ result: Record<string, unknown> }[]>`
        SELECT public.settle_agent_provider_cost(${secondId}::uuid, 'uncertain', ${"d".repeat(64)},
          NULL, NULL, NULL, NULL, NULL, 'resp_unknown_1', 'provider_outcome_unknown') AS result`;
      const rows = await sql<{ id: string; status: string; reservation_nano_usd: string }[]>`
        SELECT id, status, reservation_nano_usd::text FROM public.agent_provider_cost_admissions
        WHERE id IN (${firstId}::uuid, ${secondId}::uuid) ORDER BY id`;
      return { first, second, released: released[0]!.result, uncertain: uncertain[0]!.result, rows };
    });

    expect(result.first.result.admission_id).not.toBe(result.second.result.admission_id);
    expect(result.released).toMatchObject({ status: "released", settled_nano_usd: 0 });
    expect(result.uncertain).toMatchObject({ status: "uncertain", reservation_retained: true });
    expect(result.rows.map((row) => row.status).sort()).toEqual(["released", "uncertain"]);
  });
});
