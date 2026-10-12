import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const bridge = vi.hoisted(() => ({
  sql: null as postgres.Sql | null,
  deniedLedgerReads: 0,
}));

// Adapt Supabase's HTTP client surface to real local SQL. Every .from/.rpc read
// runs as service_role, so PostgreSQL grants, RLS, and SECURITY DEFINER behavior
// remain authoritative. Auth Admin reads the synthetic auth.users table directly.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: { getUserById: async (id: string) => {
      const sql = bridge.sql;
      if (!sql) throw new Error("Disposable SQL bridge is unavailable.");
      const rows = await sql`SELECT id, banned_until, deleted_at FROM auth.users WHERE id = ${id}::uuid`;
      return { data: { user: rows[0] ?? null }, error: null };
    } } },
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name !== "resolve_trusted_agent_execution_subject") throw new Error("Unexpected RPC in isolated test.");
      const sql = bridge.sql;
      if (!sql) throw new Error("Disposable SQL bridge is unavailable.");
      try {
        const rows = await sql.begin(async (tx) => {
          await tx`SET LOCAL ROLE service_role`;
          return tx`SELECT * FROM public.resolve_trusted_agent_execution_subject(
            ${String(args.p_run_id)}::uuid, ${String(args.p_step_id)}, ${String(args.p_execution_key)}::uuid,
            ${String(args.p_claim_id)}::uuid, ${Number(args.p_fencing_generation)}::bigint,
            ${args.p_allow_pending === true}::boolean
          )`;
        });
        return { data: rows, error: null };
      } catch (error) {
        return { data: null, error: { code: (error as { code?: string }).code ?? "unknown" } };
      }
    },
    from: (table: string) => {
      const allowedTables = new Set(["execution_runs", "agent_request_acceptances", "profiles", "conversations", "documents"]);
      if (!allowedTables.has(table)) throw new Error("Unexpected table in isolated test.");
      const safeIdentifier = /^[a-z_][a-z0-9_]*$/;
      const filters: Array<{ column: string; values: string[] }> = [];
      let columns = "*";
      const query = {
        select(value: string) {
          if (!value.split(",").every((column) => safeIdentifier.test(column))) throw new Error("Unexpected selected column.");
          columns = value;
          return query;
        },
        eq(column: string, value: string) {
          if (!safeIdentifier.test(column)) throw new Error("Unexpected filter column.");
          filters.push({ column, values: [value] });
          return query;
        },
        in(column: string, values: string[]) {
          if (!safeIdentifier.test(column) || values.length < 1) throw new Error("Unexpected filter values.");
          filters.push({ column, values });
          return query;
        },
        maybeSingle: () => execute(true),
        then: (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) => execute(false).then(resolve, reject),
      };
      async function execute(single: boolean) {
        const sql = bridge.sql;
        if (!sql) throw new Error("Disposable SQL bridge is unavailable.");
        const values: string[] = [];
        const predicates = filters.map(({ column, values: terms }) => {
          const placeholders = terms.map((term) => {
            values.push(term);
            return `$${values.length}`;
          });
          return terms.length === 1 ? `${column} = ${placeholders[0]}` : `${column} IN (${placeholders.join(",")})`;
        });
        const statement = `SELECT ${columns} FROM public.${table}${predicates.length ? ` WHERE ${predicates.join(" AND ")}` : ""} LIMIT ${single ? 2 : 100}`;
        try {
          const rows = await sql.begin(async (tx) => {
            await tx`SET LOCAL ROLE service_role`;
            return tx.unsafe(statement, values);
          });
          return { data: single ? rows[0] ?? null : rows, error: null };
        } catch (error) {
          const code = (error as { code?: string }).code ?? "unknown";
          if (table === "agent_request_acceptances" && code === "42501") bridge.deniedLedgerReads += 1;
          return { data: null, error: { code } };
        }
      }
      return query;
    },
  }),
}));

import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import { createFileAnalysisCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/file-analysis";
import type { CapabilityExecutionInput, ExecutionAuthorizationInput } from "@/lib/agent-runtime/capability-executor";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { createTrustedBackgroundExecutionAuthorizer } from "@/lib/agent-runtime/execution-authorizer";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import type { AcceptedRequestExecutionIdentity, ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import { createTrustedExecutionWorker } from "@/lib/agent-runtime/trusted-execution-worker";
import { resolveTrustedExecutionSubject } from "@/lib/agent-runtime/trusted-execution-subject";
import { resolveExecutionInputs } from "@/lib/agent-runtime/xstate-runtime-adapter";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const ENABLED = process.env.TRUSTED_FILE_ANALYSIS_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.TRUSTED_FILE_ANALYSIS_TEST_DATABASE_URL ?? "";
const describeDatabase = ENABLED ? describe : describe.skip;
const STEP_ID = "file-analysis";

function requireIsolatedFixture(url: string): void {
  const target = new URL(url);
  if (target.protocol !== "postgres:" && target.protocol !== "postgresql:") throw new Error("Local PostgreSQL URL required.");
  if (target.hostname !== "127.0.0.1" || target.port !== "57242" || target.pathname !== "/postgres"
    || target.username !== "postgres" || !target.password || target.search || target.hash) {
    throw new Error("File Analysis authorization tests require the disposable loopback fixture on port 57242.");
  }
}

function filePlan(): PlannedExecutionHandoff {
  const candidate = {
    objective: "Analyze a synthetic quality note.",
    steps: [{ id: STEP_ID, capability: "file_analysis" as const, dependsOn: [] as string[],
      inputs: [{ source: "attachment" as const, output: "file" as const }], expectedOutput: "structured_data" as const }],
    status: "validated" as const,
  };
  const validation = validateIntelligencePlan(candidate);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return {
    version: 1, objective: candidate.objective, plan: candidate, orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: { maxSteps: 1, capabilityIds: ["file_analysis"], modelPlanningAllowed: false,
      maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: true, handoffVersion: 1 },
  };
}

describeDatabase("trusted File Analysis authorization with real isolated PostgreSQL", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const handoff = filePlan();

  async function asServiceRole<T>(query: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE service_role`;
      return query(tx);
    }) as unknown as Promise<T>;
  }

  async function asSyntheticUser<T>(userId: string, query: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
    return sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
      return query(tx);
    }) as unknown as Promise<T>;
  }

  async function createSyntheticRun(runtime: DurableXStateExecutionRuntime) {
    const userId = randomUUID();
    const conversationId = randomUUID();
    const documentId = randomUUID();
    const idempotencyKey = randomUUID();
    const requestFingerprint = "a".repeat(64);
    const userInput = "Analyze the synthetic quality note.";
    await sql`INSERT INTO auth.users (id,aud,role,email) VALUES
      (${userId}::uuid,'authenticated','authenticated',${`${userId}@trusted-file-analysis.test`})`;
    await sql`INSERT INTO public.conversations (id,user_id,title) VALUES
      (${conversationId}::uuid,${userId}::uuid,'Synthetic authorization fixture')`;
    await sql`INSERT INTO public.documents
      (id,user_id,conversation_id,file_name,mime_type,size_bytes,storage_path,extracted_text,extraction_status)
      VALUES (${documentId}::uuid,${userId}::uuid,${conversationId}::uuid,'quality.txt','text/plain',32,
        ${`synthetic/${documentId}.txt`},'Synthetic quality evidence only.','ready')`;
    const [row] = await asServiceRole((tx) => tx<{ result: Record<string, unknown> }[]>`
      SELECT public.accept_agent_request(${userId}::uuid,${conversationId}::uuid,
        ${idempotencyKey},${requestFingerprint},${sql.json({ routingMode: "auto", reasoningMode: "medium" })}::jsonb,
        ${userInput},ARRAY[${documentId}::uuid],'[]'::jsonb,${new Date().toISOString().slice(0, 10)}::date,100,100
      ) AS result`);
    if (row?.result.kind !== "accepted") throw new Error("Synthetic request acceptance failed.");
    const accepted = row.result;
    const identity: AcceptedRequestExecutionIdentity = {
      requestId: accepted.requestId as string,
      userId, conversationId,
      userMessageId: accepted.userMessageId as string,
      assistantMessageId: accepted.assistantMessageId as string,
      idempotencyKey, requestFingerprint,
    };
    const binding = { requestId: identity.requestId, userId, conversationId,
      userMessageId: identity.userMessageId, assistantMessageId: identity.assistantMessageId };
    const associated = await runtime.associateAcceptedRequest(handoff, {
      authenticatedUserId: userId, conversationId, requestMessageBinding: binding,
      userInput, reasoningMode: "medium", attachments: [{ id: documentId, kind: "file" }],
      resourceReferences: [documentId],
    }, identity);
    if (associated.kind !== "associated") throw new Error(`Synthetic association failed: ${JSON.stringify(associated.failure)}`);
    return { userId, conversationId, documentId, identity, binding, runId: associated.runId };
  }

  function makeRuntime() {
    const adapter = createFileAnalysisCapabilityAdapter();
    const execute = vi.fn((input: CapabilityExecutionInput) => adapter.execute(input));
    const authorizedInputs: ExecutionAuthorizationInput[] = [];
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: { execute },
      authorizer: { authorize: async () => { throw new Error("Customer-session authorizer must not run in background."); } },
      requestMessageBindingValidator: { validate: async (binding) => {
        const [row] = await asSyntheticUser(binding.userId, (tx) => tx<{ valid: boolean }[]>`SELECT public.validate_agent_request_message_binding(
          ${binding.requestId}::uuid,${binding.conversationId}::uuid,
          ${binding.userMessageId}::uuid,${binding.assistantMessageId}::uuid) AS valid`);
        return row?.valid === true;
      } },
      resolveTrustedExecutionSubject,
      createTrustedBackgroundAuthorizer: (subject) => {
        const actual = createTrustedBackgroundExecutionAuthorizer(subject);
        return { authorize: async (input) => {
          authorizedInputs.push(input);
          return actual.authorize(input);
        } };
      },
    });
    return { runtime, execute, authorizedInputs };
  }

  beforeAll(async () => {
    requireIsolatedFixture(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 8 });
    bridge.sql = sql;
    const [check] = await sql<{ unexpected_users: number; trusted_rpc: boolean }[]>`
      SELECT (SELECT count(*)::integer FROM auth.users WHERE email NOT LIKE '%@trusted-file-analysis.test') AS unexpected_users,
        has_function_privilege('service_role',
          'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)', 'EXECUTE') AS trusted_rpc`;
    if (check?.unexpected_users !== 0 || check.trusted_rpc !== true) throw new Error("Disposable fixture identity check failed.");
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    bridge.sql = null;
    if (sql) await sql.end();
  });

  it("preserves the service-role ledger ACL while allowing the fenced resolver RPC", async () => {
    await expect(asServiceRole((tx) => tx`SELECT request_id FROM public.agent_request_acceptances LIMIT 0`))
      .rejects.toMatchObject({ code: "42501" });
    const [grant] = await sql<{ executable: boolean }[]>`SELECT has_function_privilege('service_role',
      'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)', 'EXECUTE') AS executable`;
    expect(grant?.executable).toBe(true);
  });

  it("executes a valid accepted File Analysis step through real claim, trusted RPC, authorizer, and document read", async () => {
    const { runtime, execute, authorizedInputs } = makeRuntime();
    const fixture = await createSyntheticRun(runtime);
    await sql`UPDATE public.execution_run_work_state SET available_at=clock_timestamp()+interval '1 day'
      WHERE run_id<>${fixture.runId}::uuid`;
    bridge.deniedLedgerReads = 0;
    const worker = createTrustedExecutionWorker({
      store, runtime, listPendingFinalizationRunIds: async () => [],
      finalizeAcceptedExecution: async () => { throw new Error("Finalization is outside this test."); },
      createClaimId: randomUUID,
    });
    const result = await worker.runOnce();
    expect(result).toMatchObject({ status: "step_completed", capability: "file_analysis", providerCalls: 0 });
    expect(bridge.deniedLedgerReads).toBe(0);
    expect(authorizedInputs).toHaveLength(1);
    expect(authorizedInputs[0]).toMatchObject({
      executionId: fixture.runId,
      authenticatedUserId: fixture.userId,
      conversationId: fixture.conversationId,
      capabilityId: "file_analysis",
      resolvedInputs: [{ source: "attachment", reference: { id: fixture.documentId, kind: "file" } }],
    });
    expect(execute).toHaveBeenCalledOnce();
    const persisted = await store.getRun({ runId: fixture.runId, userId: fixture.userId });
    expect(persisted?.steps[0]?.status).toBe("succeeded");
    expect(persisted?.steps[0]?.result).toMatchObject({
      kind: "structured_data",
      value: { kind: "file_context", documents: [{
        documentId: fixture.documentId, extractedText: "Synthetic quality evidence only.",
      }] },
    });
  });

  it("rejects foreign owners and documents, missing extraction, invalid claims, and stale fencing", async () => {
    const { runtime } = makeRuntime();
    const fixture = await createSyntheticRun(runtime);
    const claimed = await store.claimExecutionWork({ runId: fixture.runId, claimId: randomUUID() });
    if (claimed.status !== "claimed") throw new Error("Synthetic work claim failed.");
    const runActor = createExecutionRunLifecycle();
    runActor.start();
    const stepActor = createExecutionStepLifecycle();
    const envelope = (stepSnapshot = stepActor.getPersistedSnapshot()): ExecutionSnapshotEnvelope => ({
      version: 1, runtimeVersion: 1,
      snapshot: { run: runActor.getPersistedSnapshot(), steps: { [STEP_ID]: stepSnapshot } },
    });
    const running = await store.saveRunState({ runId: fixture.runId, userId: fixture.userId,
      expectedRevision: claimed.snapshotRevision, status: "running", snapshot: envelope(),
      startedAt: new Date().toISOString(), workClaim: claimed.claim });
    if (running.status !== "saved") throw new Error("Synthetic run transition failed.");
    stepActor.start();
    const step = await store.claimStep({ runId: fixture.runId, userId: fixture.userId, stepId: STEP_ID,
      expectedRevision: running.snapshotRevision, snapshot: envelope(),
      startedAt: new Date().toISOString(), workClaim: claimed.claim });
    runActor.stop();
    stepActor.stop();
    if (step.status !== "claimed") throw new Error("Synthetic step transition failed.");
    const subjectInput = { runId: fixture.runId, stepId: STEP_ID, executionKey: step.executionKey,
      claimId: claimed.claim.claimId, fencingGeneration: claimed.claim.fencingGeneration };
    const subject = await resolveTrustedExecutionSubject(subjectInput);
    expect(subject).not.toBeNull();
    expect(await resolveTrustedExecutionSubject({ ...subjectInput, claimId: randomUUID() })).toBeNull();
    expect(await resolveTrustedExecutionSubject({ ...subjectInput,
      fencingGeneration: subjectInput.fencingGeneration + 1 })).toBeNull();

    const run = await store.getRun({ runId: fixture.runId, userId: fixture.userId });
    if (!run?.runtimeContext.requestMessageBinding) throw new Error("Synthetic run hydration failed.");
    const resolved = resolveExecutionInputs(handoff.plan.steps[0]!, handoff, {
      authenticatedUserId: run.userId,
      conversationId: run.runtimeContext.conversationId,
      requestMessageBinding: run.runtimeContext.requestMessageBinding,
      attachments: run.runtimeContext.attachments,
      resourceReferences: run.runtimeContext.resourceReferences,
      userInput: run.runtimeContext.userInput,
    }, {});
    if (!resolved.inputs) throw new Error("Synthetic File Analysis input resolution failed.");
    const authorization: ExecutionAuthorizationInput = {
      executionId: run.id, stepId: STEP_ID, capabilityId: "file_analysis", authenticatedUserId: run.userId,
      acceptedRequestId: run.acceptedRequestId, acceptanceFingerprint: run.acceptanceFingerprint,
      idempotencyKey: run.idempotencyKey, requestFingerprint: run.requestFingerprint,
      conversationId: run.runtimeContext.conversationId,
      requestMessageBinding: run.runtimeContext.requestMessageBinding,
      reasoningMode: run.runtimeContext.reasoningMode,
      resolvedInputs: resolved.inputs, resourceReferences: resolved.resourceReferences,
      requestId: fixture.identity.requestId,
    };
    const authorizer = createTrustedBackgroundExecutionAuthorizer(subject!);
    expect(await authorizer.authorize(authorization)).toEqual({ allowed: true });
    expect(await authorizer.authorize({ ...authorization, authenticatedUserId: randomUUID() })).toMatchObject({
      allowed: false, diagnosticPredicate: "trusted_subject_context_mismatch",
    });
    expect(await authorizer.authorize({ ...authorization, acceptanceFingerprint: "b".repeat(64) })).toMatchObject({
      allowed: false, diagnosticPredicate: "accepted_run_association_mismatch",
    });

    const foreignUser = randomUUID();
    const foreignConversation = randomUUID();
    const foreignDocument = randomUUID();
    await sql`INSERT INTO auth.users (id,aud,role,email) VALUES
      (${foreignUser}::uuid,'authenticated','authenticated',${`${foreignUser}@trusted-file-analysis.test`})`;
    await sql`INSERT INTO public.conversations (id,user_id,title) VALUES
      (${foreignConversation}::uuid,${foreignUser}::uuid,'Foreign synthetic conversation')`;
    await sql`INSERT INTO public.documents
      (id,user_id,conversation_id,file_name,mime_type,size_bytes,storage_path,extracted_text,extraction_status)
      VALUES (${foreignDocument}::uuid,${foreignUser}::uuid,${foreignConversation}::uuid,'foreign.txt','text/plain',16,
        ${`synthetic/${foreignDocument}.txt`},'Foreign synthetic note.','ready')`;
    expect(await authorizer.authorize({ ...authorization, resolvedInputs: [
      { source: "attachment", reference: { id: foreignDocument, kind: "file" } },
    ] })).toMatchObject({ allowed: false, diagnosticPredicate: "document_not_owned_or_found" });

    await sql`UPDATE public.documents SET extraction_status='processing',extracted_text=NULL
      WHERE id=${fixture.documentId}::uuid`;
    expect(await authorizer.authorize(authorization)).toMatchObject({
      allowed: false, diagnosticPredicate: "document_not_ready_or_size_invalid",
    });
  });
});
