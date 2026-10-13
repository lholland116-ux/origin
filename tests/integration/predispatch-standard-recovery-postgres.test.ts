import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import { createExecutionRunLifecycle, createExecutionStepLifecycle } from "@/lib/agent-runtime/execution-lifecycle";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import type { ExecutionSnapshotEnvelope } from "@/lib/agent-runtime/execution-store";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const ENABLED = process.env.PREDISPATCH_RECOVERY_DATABASE_TESTS === "true";
const DATABASE_URL = process.env.PREDISPATCH_RECOVERY_TEST_DATABASE_URL
  ?? "postgresql://supabase_admin:postgres@127.0.0.1:57242/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;

function requireDisposableTarget(value: string): void {
  const parsed = new URL(value);
  if (parsed.protocol !== "postgresql:" || parsed.hostname !== "127.0.0.1"
    || parsed.port !== "57242" || parsed.pathname !== "/postgres") {
    throw new Error("Pre-dispatch recovery tests require the dedicated loopback fixture on port 57242.");
  }
}

function plan(): PlannedExecutionHandoff {
  const steps = [
    { id: "file-analysis", capability: "file_analysis" as const, dependsOn: [] as string[],
      inputs: [{ source: "attachment" as const, output: "file" as const }], expectedOutput: "structured_data" as const },
    { id: "synthesis", capability: "standard" as const, dependsOn: ["file-analysis"],
      inputs: [{ source: "user" as const }, { source: "step" as const, stepId: "file-analysis", output: "structured_data" as const }],
      expectedOutput: "text" as const },
    { id: "document", capability: "document_generation" as const, dependsOn: ["synthesis"],
      inputs: [{ source: "step" as const, stepId: "synthesis", output: "text" as const }], expectedOutput: "document" as const },
  ];
  const candidate = { objective: "Analyze a synthetic report and make a document.", steps, status: "validated" as const };
  const checked = validateIntelligencePlan(candidate);
  if (!checked.valid) throw new Error(checked.errors.join("; "));
  return { version: 1, objective: candidate.objective, plan: candidate, orderedStepIds: checked.orderedStepIds,
    plannerSource: "deterministic", governance: { maxSteps: 3,
      capabilityIds: ["file_analysis", "standard", "document_generation"], modelPlanningAllowed: false,
      maxModelCalls: 0, maxRepairAttempts: 0, attachmentContextAllowed: true, handoffVersion: 1 } };
}

describeDatabase("pre-dispatch recovery PostgreSQL boundary (new disposable fixture only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const execute = vi.fn(async () => { throw new Error("Provider execution is prohibited in recovery tests."); });

  beforeAll(async () => {
    requireDisposableTarget(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 12 });
    const [target] = await sql<{ database: string; port: number }[]>`
      SELECT current_database() AS database, inet_server_port() AS port`;
    if (target?.database !== "postgres" || target.port !== 5432) throw new Error("Unexpected database target.");
    store = new SupabaseExecutionStore(sql);
  });
  afterAll(async () => { if (sql) await sql.end(); });

  async function prepare(options: { expired?: boolean } = {}) {
    const userId = randomUUID();
    const conversationId = randomUUID();
    const documentId = randomUUID();
    const idempotencyKey = randomUUID();
    const fingerprint = "a".repeat(64);
    const objective = "Analyze a synthetic report and make a document.";
    await sql`INSERT INTO auth.users (id,aud,role,email)
      VALUES (${userId}::uuid,'authenticated','authenticated',${`${userId}@predispatch.test`})`;
    await sql`INSERT INTO public.conversations (id,user_id,title)
      VALUES (${conversationId}::uuid,${userId}::uuid,'Synthetic recovery test')`;
    await sql`INSERT INTO public.documents
      (id,user_id,conversation_id,file_name,mime_type,size_bytes,storage_path,extracted_text,extraction_status)
      VALUES (${documentId}::uuid,${userId}::uuid,${conversationId}::uuid,'fixture.txt','text/plain',12,
        ${`synthetic/${documentId}.txt`},'synthetic data','ready')`;
    const [acceptedRow] = await sql<{ result: Record<string, string> }[]>`
      SELECT public.accept_agent_request(
        ${userId}::uuid,${conversationId}::uuid,${idempotencyKey},${fingerprint},
        ${sql.json({ routingMode: "auto" })}::jsonb,${objective},ARRAY[${documentId}::uuid],
        '[]'::jsonb,${new Date().toISOString().slice(0, 10)}::date,100,100) AS result`;
    const accepted = acceptedRow!.result;
    const identity = { requestId: accepted.requestId!, userId, conversationId,
      userMessageId: accepted.userMessageId!, assistantMessageId: accepted.assistantMessageId!,
      idempotencyKey, requestFingerprint: fingerprint };
    const runtime = new DurableXStateExecutionRuntime({ store, executor: { execute },
      authorizer: { authorize: async () => ({ allowed: false }) },
      requestMessageBindingValidator: { validate: async () => true } });
    const associated = await runtime.associateAcceptedRequest(plan(), {
      authenticatedUserId: userId, conversationId, userInput: objective,
      requestMessageBinding: { requestId: identity.requestId, userId, conversationId,
        userMessageId: identity.userMessageId, assistantMessageId: identity.assistantMessageId },
      attachments: [{ id: documentId, kind: "file" }], resourceReferences: [documentId],
    }, identity);
    if (associated.kind !== "associated") throw new Error(`Association failed: ${associated.kind}`);

    const run = createExecutionRunLifecycle(); run.start();
    const file = createExecutionStepLifecycle(); file.start(); file.succeed();
    const standard = createExecutionStepLifecycle();
    const document = createExecutionStepLifecycle();
    const snapshot = (): ExecutionSnapshotEnvelope => ({ version: 1, runtimeVersion: 1, snapshot: {
      run: run.getPersistedSnapshot(), steps: {
        "file-analysis": file.getPersistedSnapshot(), synthesis: standard.getPersistedSnapshot(),
        document: document.getPersistedSnapshot(),
      },
    } });
    const result = { kind: "structured_data", value: { kind: "file_context", userId, conversationId,
      documents: [{ documentId, fileName: "fixture.txt", mimeType: "text/plain", sizeBytes: 12,
        extractedText: "synthetic data" }] } };
    await sql.begin(async (tx) => {
      await tx`UPDATE public.execution_steps SET status='succeeded', started_at=clock_timestamp(),
        completed_at=clock_timestamp(),result_envelope=${tx.json(result)}::jsonb
        WHERE run_id=${associated.runId}::uuid AND step_id='file-analysis'`;
      await tx`UPDATE public.execution_runs SET status='running',started_at=clock_timestamp(),
        snapshot=${tx.json(JSON.parse(JSON.stringify(snapshot())))}::jsonb,snapshot_revision=3
        WHERE id=${associated.runId}::uuid`;
    });
    const claimed = await store.claimExecutionWork({ runId: associated.runId, claimId: randomUUID() });
    if (claimed.status !== "claimed" || claimed.stepId !== "synthesis") throw new Error(`Claim failed: ${claimed.status}`);
    standard.start();
    const step = await store.claimStep({ runId: associated.runId, userId, stepId: "synthesis",
      expectedRevision: claimed.snapshotRevision, snapshot: snapshot(),
      startedAt: new Date().toISOString(), workClaim: claimed.claim });
    if (step.status !== "claimed") throw new Error(`Step start failed: ${step.status}`);
    if (options.expired !== false) {
      await expire(associated.runId, claimed.claim.claimId);
    }
    const [digest] = await sql<{ snapshot_sha256: string }[]>`
      SELECT encode(extensions.digest(snapshot::text,'sha256'),'hex') AS snapshot_sha256
      FROM public.execution_runs WHERE id=${associated.runId}::uuid`;
    run.stop(); file.stop(); standard.stop(); document.stop();
    return { runId: associated.runId, userId, claimId: claimed.claim.claimId,
      generation: claimed.claim.fencingGeneration, revision: step.snapshotRevision,
      snapshotSha256: digest!.snapshot_sha256, executionKey: step.executionKey };
  }

  async function expire(runId: string, claimId: string) {
    const [row] = await sql<{ expired_at: string }[]>`SELECT clock_timestamp()-interval '1 minute' AS expired_at`;
    await sql`UPDATE public.execution_run_work_state SET lease_until=${row!.expired_at}::timestamptz
      WHERE run_id=${runId}::uuid`;
    await sql`UPDATE public.execution_work_claim_history SET lease_until=${row!.expired_at}::timestamptz
      WHERE claim_id=${claimId}::uuid`;
  }

  async function insertAdmission(input: Awaited<ReturnType<typeof prepare>>) {
    const [price] = await sql<{ provider: string; model: string; version: string }[]>`
      SELECT provider,model,version FROM public.agent_provider_cost_prices
      WHERE provider='openai' ORDER BY model,version LIMIT 1`;
    const [policy] = await sql<{ policy_version: number }[]>`
      SELECT policy_version FROM public.agent_provider_cost_active_policy WHERE singleton`;
    const [row] = await sql<{ id: string }[]>`INSERT INTO public.agent_provider_cost_admissions
      (run_id,user_id,accepted_request_id,step_id,attempt_id,attempt_number,invocation_sequence,
       capability_id,provider,model,policy_version,price_version,accounting_day,
       input_tokens,max_output_tokens,reservation_nano_usd,status)
      SELECT run.id,run.user_id,run.accepted_request_id,'synthesis',${randomUUID()}::uuid,1,1,
        'standard',${price!.provider},${price!.model},${policy!.policy_version},${price!.version},
        current_date,100,100,1000,'admitted' FROM public.execution_runs run WHERE run.id=${input.runId}::uuid
      RETURNING id`;
    return row!.id;
  }

  async function recover(input: Awaited<ReturnType<typeof prepare>>, overrides: Record<string, unknown> = {}) {
    const values = { runId: input.runId, claimId: input.claimId, generation: input.generation,
      revision: input.revision, snapshotSha256: input.snapshotSha256,
      executionKey: input.executionKey, ...overrides };
    const [row] = await sql<{ status: string }[]>`
      SELECT status FROM public.recover_trusted_predispatch_standard_step(
        ${values.runId}::uuid,${values.revision}::bigint,${values.snapshotSha256},${values.claimId}::uuid,
        ${values.generation}::bigint,${values.executionKey}::uuid)`;
    return row!.status;
  }

  it("exposes only the service-role RPC and keeps recovery events private and append-only", async () => {
    const [row] = await sql<{ definer: boolean; search_path: string[]; service_execute: boolean;
      anon_execute: boolean; authenticated_execute: boolean; service_table_insert: boolean;
      service_table_delete: boolean;
      owner_can_bypass_rls: boolean;
      rls: boolean; force_rls: boolean; immutable_trigger: boolean }[]>`
      SELECT proc.prosecdef AS definer,proc.proconfig AS search_path,
        (owner.rolsuper OR owner.rolbypassrls) AS owner_can_bypass_rls,
        has_function_privilege('service_role',proc.oid,'EXECUTE') AS service_execute,
        has_function_privilege('anon',proc.oid,'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated',proc.oid,'EXECUTE') AS authenticated_execute,
        has_table_privilege('service_role','public.execution_predispatch_recovery_events','INSERT') AS service_table_insert,
        has_table_privilege('service_role','public.execution_predispatch_recovery_events','DELETE') AS service_table_delete,
        relation.relrowsecurity AS rls,relation.relforcerowsecurity AS force_rls,
        EXISTS (SELECT 1 FROM pg_trigger trigger
          WHERE trigger.tgrelid=relation.oid AND trigger.tgname='execution_predispatch_recovery_events_immutable'
            AND trigger.tgenabled='O') AS immutable_trigger
      FROM pg_proc proc JOIN pg_roles owner ON owner.oid=proc.proowner
      JOIN pg_class relation
        ON relation.oid='public.execution_predispatch_recovery_events'::regclass
      WHERE proc.oid='public.recover_trusted_predispatch_standard_step(uuid,bigint,text,uuid,bigint,uuid)'::regprocedure`;
    expect(row).toMatchObject({ definer: true, search_path: ['search_path=""'], owner_can_bypass_rls: true,
      service_execute: true,
      anon_execute: false, authenticated_execute: false, service_table_insert: false, service_table_delete: false,
      rls: true, force_rls: true, immutable_trigger: true });
  });

  it("permits the server service role to invoke the privileged RPC without direct audit-table access", async () => {
    const input = await prepare();
    const rows = await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE service_role`;
      return await tx`SELECT status FROM public.recover_trusted_predispatch_standard_step(
        ${input.runId}::uuid,${input.revision}::bigint,${input.snapshotSha256},${input.claimId}::uuid,
        ${input.generation}::bigint,${input.executionKey}::uuid)`;
    });
    expect(rows[0]?.status).toBe("recovered");
    expect(execute).not.toHaveBeenCalled();
  });

  it("repairs a valid orphan to paused retry_pending, fences stale workers, and records correlated audit", async () => {
    const input = await prepare();
    expect(await recover(input)).toBe("recovered");
    const [state] = await sql<{ control_state: string; snapshot_revision: number; control_revision: number;
      step_status: string; snapshot_step: string; claim_id: string | null; generation: number; claim_status: string;
      recovery_events: number; control_events: number; admissions: number }[]>`
      SELECT run.control_state,run.snapshot_revision::integer AS snapshot_revision,
        run.control_revision::integer AS control_revision,
        step.status AS step_status,run.snapshot->'snapshot'->'steps'->'synthesis'->>'value' AS snapshot_step,
        work.claim_id,work.fencing_generation::integer AS generation,claim.status AS claim_status,
        (SELECT count(*)::integer FROM public.execution_predispatch_recovery_events e WHERE e.run_id=run.id) AS recovery_events,
        (SELECT count(*)::integer FROM public.execution_control_events e WHERE e.run_id=run.id AND e.action='paused') AS control_events,
        (SELECT count(*)::integer FROM public.agent_provider_cost_admissions a WHERE a.run_id=run.id) AS admissions
      FROM public.execution_runs run
      JOIN public.execution_steps step ON step.run_id=run.id AND step.step_id='synthesis'
      JOIN public.execution_run_work_state work ON work.run_id=run.id
      JOIN public.execution_work_claim_history claim ON claim.claim_id=${input.claimId}::uuid
      WHERE run.id=${input.runId}::uuid`;
    expect(state).toMatchObject({ control_state: "paused", snapshot_revision: input.revision + 1,
      control_revision: 1, step_status: "retry_pending", snapshot_step: "retry_pending",
      claim_id: null, generation: input.generation + 1, claim_status: "expired",
      recovery_events: 1, control_events: 1, admissions: 0 });
    const [audit] = await sql<{ expired_claim_id: string; prior_snapshot_revision: string;
      prior_snapshot_sha256: string;
      snapshot_revision: string; prior_fencing_generation: string; fencing_generation: string }[]>`
      SELECT expired_claim_id,prior_snapshot_revision,prior_snapshot_sha256,snapshot_revision,
        prior_fencing_generation,fencing_generation
      FROM public.execution_predispatch_recovery_events WHERE run_id=${input.runId}::uuid`;
    expect(audit).toMatchObject({ expired_claim_id: input.claimId,
      prior_snapshot_sha256: input.snapshotSha256,
      prior_snapshot_revision: String(input.revision), snapshot_revision: String(input.revision + 1),
      prior_fencing_generation: String(input.generation), fencing_generation: String(input.generation + 1) });
    await expect(sql`UPDATE public.execution_predispatch_recovery_events SET action='standard_predispatch_paused'
      WHERE run_id=${input.runId}::uuid`).rejects.toThrow();
    expect(await store.renewExecutionWorkClaim({ runId: input.runId,
      claim: { claimId: input.claimId, fencingGeneration: input.generation } })).toEqual({ status: "stale_claim" });
    const [snapshotRow] = await sql<{ snapshot: ExecutionSnapshotEnvelope }[]>`
      SELECT snapshot FROM public.execution_runs WHERE id=${input.runId}::uuid`;
    const actor = createExecutionStepLifecycle(snapshotRow!.snapshot.snapshot.steps.synthesis);
    expect(actor.status).toBe("retry_pending");
    actor.claimRetry();
    expect(actor.status).toBe("running");
    expect(await store.claimExecutionWork({ runId: input.runId, claimId: randomUUID() })).toEqual({ status: "ineligible" });
    expect(await recover(input)).toBe("already_recovered");

    const resumed = await store.resumeRun({ runId: input.runId, userId: input.userId,
      expectedControlRevision: 1, actorUserId: input.userId, createdAt: new Date().toISOString() });
    expect(resumed).toMatchObject({ status: "saved", controlState: "active", controlRevision: 2 });
    const newWorkClaim = await store.claimExecutionWork({ runId: input.runId, claimId: randomUUID() });
    if (newWorkClaim.status !== "claimed") throw new Error(`Resumed work was not claimable: ${newWorkClaim.status}`);
    const retrySnapshot: ExecutionSnapshotEnvelope = {
      version: snapshotRow!.snapshot.version,
      runtimeVersion: snapshotRow!.snapshot.runtimeVersion,
      snapshot: {
        ...snapshotRow!.snapshot.snapshot,
        steps: { ...snapshotRow!.snapshot.snapshot.steps, synthesis: actor.getPersistedSnapshot() },
      },
    };
    const retry = await store.claimRetryableStep({ runId: input.runId, userId: input.userId,
      stepId: "synthesis", expectedRevision: newWorkClaim.snapshotRevision,
      snapshot: retrySnapshot, workClaim: newWorkClaim.claim });
    expect(retry).toMatchObject({ status: "claimed", attempt: 2, executionKey: input.executionKey });
    actor.stop();
    expect(execute).not.toHaveBeenCalled();
  });

  it("serializes concurrent recovery and rejects stale, active, or changed claims", async () => {
    const input = await prepare();
    expect((await Promise.all([recover(input), recover(input)])).sort()).toEqual(["already_recovered", "recovered"]);
    const active = await prepare({ expired: false });
    expect(await recover(active)).toBe("not_eligible");
    expect(await recover(active, { claimId: randomUUID() })).toBe("not_eligible");
    const expired = await prepare();
    expect(await recover(expired, { revision: expired.revision - 1 })).toBe("not_eligible");
    expect(await recover(expired, { snapshotSha256: "e".repeat(64) })).toBe("not_eligible");
    expect(await recover(expired, { generation: expired.generation + 1 })).toBe("not_eligible");
    await sql`UPDATE public.execution_runs SET snapshot=jsonb_set(snapshot,
      '{snapshot,steps,synthesis,value}','"pending"'::jsonb,false)
      WHERE id=${expired.runId}::uuid`;
    expect(await recover(expired)).toBe("not_eligible");
    const competing = await prepare();
    await sql`INSERT INTO public.execution_work_claim_history
      (claim_id,run_id,user_id,step_id,fencing_generation,status,claimed_at,lease_until)
      VALUES (${randomUUID()}::uuid,${competing.runId}::uuid,${competing.userId}::uuid,
        'synthesis',${competing.generation + 1}::bigint,'active',clock_timestamp(),
        clock_timestamp()+interval '1 minute')`;
    expect(await recover(competing)).toBe("stale_claim");
  });

  it("preserves accepted-message owner binding and rejects a pending human approval", async () => {
    const mismatchedBinding = await prepare();
    await expect(sql`UPDATE public.execution_runs SET runtime_context=jsonb_set(
      runtime_context,'{requestMessageBinding,userId}',to_jsonb(${randomUUID()}::text),false)
      WHERE id=${mismatchedBinding.runId}::uuid`).rejects.toThrow(/Execution plan identity is immutable/);
    expect(await recover(mismatchedBinding)).toBe("recovered");

    const pendingApproval = await prepare();
    await sql`INSERT INTO public.execution_human_approval_checkpoints
      (run_id,user_id,step_id,plan_fingerprint,step_fingerprint,status,source)
      VALUES (${pendingApproval.runId}::uuid,${pendingApproval.userId}::uuid,'synthesis',
        ${"c".repeat(64)},${"d".repeat(64)},'pending','runtime_policy')`;
    expect(await recover(pendingApproval)).toBe("not_eligible");
  });

  it("denies result payloads, admission records, and unprivileged callers", async () => {
    const result = await prepare();
    await sql`INSERT INTO public.execution_step_result_payloads
      (run_id,user_id,step_id,result_kind,payload,serialized_size_bytes,payload_sha256)
      VALUES (${result.runId}::uuid,${result.userId}::uuid,'synthesis','text',
        ${sql.json({ kind: "text", value: { text: "synthetic" } })}::jsonb,42,${"b".repeat(64)})`;
    expect(await recover(result)).toBe("not_eligible");
    const admitted = await prepare({ expired: false });
    // A pre-existing admission is sufficient to make provider work uncertain.
    await insertAdmission(admitted);
    await expire(admitted.runId, admitted.claimId);
    expect(await recover(admitted)).toBe("not_eligible");
    const dispatched = await prepare({ expired: false });
    const admissionId = await insertAdmission(dispatched);
    await sql`UPDATE public.agent_provider_cost_admissions
      SET status='dispatched',dispatch_started_at=clock_timestamp() WHERE id=${admissionId}::uuid`;
    await expire(dispatched.runId, dispatched.claimId);
    expect(await recover(dispatched)).toBe("not_eligible");
    const unauthorized = await prepare();
    await expect(sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE authenticated`;
      await tx`SELECT * FROM public.recover_trusted_predispatch_standard_step(
        ${unauthorized.runId}::uuid,${unauthorized.revision}::bigint,${unauthorized.snapshotSha256},
        ${unauthorized.claimId}::uuid,
        ${unauthorized.generation}::bigint,${unauthorized.executionKey}::uuid)`;
    })).rejects.toThrow();
    expect(await recover(unauthorized)).toBe("recovered");
  });

  it("preserves run-cascade cleanup for the private recovery audit", async () => {
    const input = await prepare();
    expect(await recover(input)).toBe("recovered");
    await sql`DELETE FROM public.execution_runs WHERE id=${input.runId}::uuid`;
    const [remaining] = await sql<{ count: number }[]>`
      SELECT count(*)::integer AS count FROM public.execution_predispatch_recovery_events
      WHERE run_id=${input.runId}::uuid`;
    expect(remaining?.count).toBe(0);
  });

  it("rolls back all state changes when an audit insert fails", async () => {
    const input = await prepare();
    await sql`CREATE OR REPLACE FUNCTION public.fail_predispatch_test_audit() RETURNS trigger
      LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit failure'; END; $$`;
    await sql`CREATE TRIGGER fail_predispatch_test_audit BEFORE INSERT
      ON public.execution_predispatch_recovery_events
      FOR EACH ROW EXECUTE FUNCTION public.fail_predispatch_test_audit()`;
    try {
      await expect(recover(input)).rejects.toThrow(/synthetic audit failure/);
    } finally {
      await sql`DROP TRIGGER fail_predispatch_test_audit ON public.execution_predispatch_recovery_events`;
      await sql`DROP FUNCTION public.fail_predispatch_test_audit()`;
    }
    const [row] = await sql<{ status: string; control_state: string; generation: number; claim_status: string;
      event_count: number }[]>`
      SELECT step.status,run.control_state,work.fencing_generation::integer AS generation,
        claim.status AS claim_status,
        (SELECT count(*)::integer FROM public.execution_predispatch_recovery_events e WHERE e.run_id=run.id) AS event_count
      FROM public.execution_runs run JOIN public.execution_steps step ON step.run_id=run.id AND step.step_id='synthesis'
      JOIN public.execution_run_work_state work ON work.run_id=run.id
      JOIN public.execution_work_claim_history claim ON claim.claim_id=${input.claimId}::uuid
      WHERE run.id=${input.runId}::uuid`;
    expect(row).toMatchObject({ status: "running", control_state: "active",
      generation: input.generation, claim_status: "active", event_count: 0 });
  });
});
