import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { PlanStep } from "@/lib/ai/intelligence-plan";
import type { CapabilityId } from "@/lib/ai/capability-registry";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { PlannedExecutionHandoff } from "@/lib/ai/intelligence-decision-coordinator";
import type { StandardOperationInput } from "@/lib/ai/standard-operation-service";
import type { WebSearchOperationInput } from "@/lib/ai/web-search-operation-service";
import type { FileContextServiceInput } from "@/lib/ai/file-context-service";
import type { CapabilityExecutor } from "@/lib/agent-runtime/capability-executor";
import type { RequestMessageBinding } from "@/lib/agent-runtime/application-contracts";
import { createStandardCapabilityAdapter, type StandardOperationRunner } from "@/lib/agent-runtime/capability-adapters/standard";
import { createWebSearchCapabilityAdapter } from "@/lib/agent-runtime/capability-adapters/web-search";
import { createFileAnalysisCapabilityAdapter, type FileContextPreparer } from "@/lib/agent-runtime/capability-adapters/file-analysis";
import { createExecutionRegistry } from "@/lib/agent-runtime/execution-registry";
import { createRegistryCapabilityExecutor } from "@/lib/agent-runtime/registry-capability-executor";
import { DurableXStateExecutionRuntime } from "@/lib/agent-runtime/durable-execution-runtime";
import { executionResultJsonBytes } from "@/lib/agent-runtime/result-payload-contract";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

vi.mock("@/lib/openai", () => ({ openai: { responses: { stream: vi.fn(), create: vi.fn() } } }));

const RUN_DATABASE_TESTS = process.env.EXECUTION_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.EXECUTION_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57242/postgres";
const describeDatabase = RUN_DATABASE_TESTS ? describe : describe.skip;

function requireIsolatedLocalDatabase(connectionString: string): void {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("Adapter payload integration requires a local PostgreSQL URL."); }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)
    || !["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    || parsed.port !== "57242" || parsed.pathname !== "/postgres") {
    throw new Error("Adapter payload integration is restricted to the isolated local database on port 57242.");
  }
}

function handoff(step: PlanStep): PlannedExecutionHandoff {
  const objective = `Run ${step.capability} adapter payload qualification.`;
  const plan = { objective, steps: [step], status: "validated" as const };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid adapter payload test plan: ${validation.errors.join(", ")}`);
  return {
    version: 1,
    objective,
    plan,
    orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 1,
      capabilityIds: [step.capability],
      modelPlanningAllowed: false,
      maxModelCalls: 0,
      maxRepairAttempts: 0,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

function multiStepHandoff(steps: PlanStep[]): PlannedExecutionHandoff {
  const objective = "Verify large file context through registry dispatch.";
  const plan = { objective, steps, status: "validated" as const };
  const validation = validateIntelligencePlan(plan);
  if (!validation.valid) throw new Error(`Invalid registry payload flow plan: ${validation.errors.join(", ")}`);
  return {
    version: 1,
    objective,
    plan,
    orderedStepIds: validation.orderedStepIds,
    plannerSource: "deterministic",
    governance: {
      maxSteps: 6,
      capabilityIds: [...new Set(steps.map((step) => step.capability))].sort() as PlannedExecutionHandoff["governance"]["capabilityIds"],
      modelPlanningAllowed: false,
      maxModelCalls: 0,
      maxRepairAttempts: 0,
      attachmentContextAllowed: true,
      handoffVersion: 1,
    },
  };
}

function executorThroughRegistry(capabilityId: CapabilityId, adapter: CapabilityExecutor): CapabilityExecutor {
  const unused = (): CapabilityExecutor => ({
    async execute() { throw new Error("Unexpected capability in payload integration."); },
  });
  return createRegistryCapabilityExecutor(createExecutionRegistry({
    standardExecutor: capabilityId === "standard" ? adapter : unused(),
    webSearchExecutor: capabilityId === "web_search" ? adapter : unused(),
    fileAnalysisExecutor: capabilityId === "file_analysis" ? adapter : unused(),
    documentGenerationExecutor: capabilityId === "document_generation" ? adapter : unused(),
    imageGenerationExecutor: capabilityId === "image_generation" ? adapter : unused(),
    imageEditingExecutor: capabilityId === "image_editing" ? adapter : unused(),
  }));
}

function makeBinding(userId: string, conversationId: string): RequestMessageBinding {
  return { requestId: randomUUID(), userId, conversationId, userMessageId: randomUUID(), assistantMessageId: randomUUID() };
}

describeDatabase("large capability adapter results through durable PostgreSQL storage (isolated local DB only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;
  const userId = randomUUID();
  const conversationId = randomUUID();

  beforeAll(async () => {
    requireIsolatedLocalDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 1 });
    await sql`SELECT 1`;
    await sql`INSERT INTO auth.users (id, aud, role, email) VALUES
      (${userId}::uuid, 'authenticated', 'authenticated', ${`${userId}@adapter-payload.test`})`;
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => {
    if (!sql) return;
    await sql`DELETE FROM public.execution_runs WHERE user_id = ${userId}::uuid`;
    await sql`DELETE FROM auth.users WHERE id = ${userId}::uuid`;
    await sql.end();
  });

  it("externalizes and reloads large Standard, Web, and CJK File Context adapter results exactly", async () => {
    const cases: Array<{
      capability: "standard" | "web_search" | "file_analysis";
      resultKind: "text" | "search_results" | "structured_data";
      step: PlanStep;
      attachments?: readonly { id: string; kind: "file" }[];
      createAdapter: (binding: RequestMessageBinding) => CapabilityExecutor;
    }> = [
      {
        capability: "standard", resultKind: "text",
        step: { id: "standard", capability: "standard", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "text" },
        createAdapter: (binding) => createStandardCapabilityAdapter({
          runOperation: (async function* (input: StandardOperationInput) {
            const reply = "standard result ".repeat(5_000);
            const result = { kind: "standard_operation" as const, requestId: binding.requestId, userId, conversationId,
              reply, model: "test-model", reasoningEffort: input.reasoningEffort, measurements: [] };
            for (let index = 0; index < reply.length; index += 4_000) yield { type: "text_delta" as const, text: reply.slice(index, index + 4_000) };
            yield { type: "completion" as const, result };
          }) as StandardOperationRunner,
        }),
      },
      {
        capability: "web_search", resultKind: "search_results",
        step: { id: "web", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
        createAdapter: (binding) => createWebSearchCapabilityAdapter({
          runOperation: async (input: WebSearchOperationInput) => {
            const result = {
              kind: "web_search_operation" as const, requestId: binding.requestId, userId, conversationId,
              reply: "web result ".repeat(7_000), sources: [{ title: "Evidence", url: "https://example.test", snippet: "retained" }],
              sourceCount: 1, widget: null, web: true as const, webSearchCalls: 2, model: "test-model",
              reasoningEffort: input.reasoningEffort, outcome: "success" as const, latencyMs: 1,
              usage: { inputTokens: 1, cachedInputTokens: 0, outputTokens: 1, reasoningTokens: 0, totalTokens: 2 },
            };
            return { ok: true as const, result, measurement: { model: "test-model", webSearchCalls: 2,
              outcome: "success" as const, latencyMs: 1, usage: result.usage } };
          },
        }),
      },
      {
        capability: "file_analysis", resultKind: "structured_data",
        step: { id: "files", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }], expectedOutput: "structured_data" },
        attachments: [{ id: randomUUID(), kind: "file" }],
        createAdapter: (binding) => createFileAnalysisCapabilityAdapter({
          prepareFileContext: (async (input: FileContextServiceInput) => ({
            kind: "file_context" as const, userId: binding.userId, conversationId: binding.conversationId,
            documents: [{ documentId: input.documentIds[0]!, fileName: "unicode.txt",
              mimeType: "text/plain", sizeBytes: 80_000, extractedText: "漢字資料".repeat(7_000) }],
          })) as FileContextPreparer,
        }),
      },
    ];

    for (const item of cases) {
      const binding = makeBinding(userId, conversationId);
      const adapter = item.createAdapter(binding);
      const runtime = new DurableXStateExecutionRuntime({
        store,
        executor: executorThroughRegistry(item.capability, adapter),
        authorizer: { authorize: async () => ({ allowed: true }) },
        requestMessageBindingValidator: { validate: async () => true },
      });
      const runId = randomUUID();
      const input = {
        authenticatedUserId: userId,
        conversationId,
        requestMessageBinding: binding,
        userInput: "Run a bounded adapter result qualification.",
        ...(item.attachments ? { attachments: item.attachments } : {}),
      };
      const result = await runtime.execute(handoff(item.step), input, `${item.capability}-${runId}`);
      const failureDescription = result.kind === "failed" || result.kind === "rejected" || result.kind === "recovery_required"
        ? `${result.kind}:${result.failure.code}`
        : result.kind;
      expect(result.kind, `${item.capability}:${failureDescription}`).toBe("succeeded");
      if (result.kind !== "succeeded") continue;
      const step = result.run.steps[0]!;
      const saved = await store.getRun({ runId: result.run.id, userId });
      const savedResult = saved?.steps[0]?.result;
      expect(savedResult).toEqual(result.stepResults[step.id]);
      expect(savedResult?.kind).toBe(item.resultKind);
      expect(executionResultJsonBytes(savedResult)).toBeGreaterThan(65_536);

      const rows = await sql`SELECT steps.result_payload_id,
          octet_length(steps.result_envelope::text) AS envelope_bytes,
          payload.serialized_size_bytes, payload.result_kind
        FROM public.execution_steps AS steps
        JOIN public.execution_step_result_payloads AS payload
          ON payload.id = steps.result_payload_id
          AND payload.run_id = steps.run_id AND payload.user_id = steps.user_id AND payload.step_id = steps.step_id
        WHERE steps.run_id = ${result.run.id}::uuid AND steps.user_id = ${userId}::uuid`;
      expect(rows).toHaveLength(1);
      expect(rows[0]!.result_payload_id).toBeTruthy();
      expect(Number(rows[0]!.envelope_bytes)).toBeLessThanOrEqual(65_536);
      expect(Number(rows[0]!.serialized_size_bytes)).toBe(executionResultJsonBytes(savedResult));
      expect(rows[0]!.result_kind).toBe(item.resultKind);
    }
  });

  it("routes a >65 KiB CJK File Context through registry and durable runtime into Standard unchanged", async () => {
    const binding = makeBinding(userId, conversationId);
    const sourceDocumentId = randomUUID();
    const extractedText = "漢字資".repeat(9_500);
    const receivedContexts: string[] = [];
    const unused = (): CapabilityExecutor => ({ async execute() { throw new Error("Unexpected capability in large-result flow."); } });
    const fileAdapter = createFileAnalysisCapabilityAdapter({
      prepareFileContext: (async (input: FileContextServiceInput) => ({
        kind: "file_context" as const,
        userId,
        conversationId,
        documents: [{
          documentId: input.documentIds[0]!,
          fileName: "large-unicode-source.txt",
          mimeType: "text/plain",
          sizeBytes: new TextEncoder().encode(extractedText).byteLength,
          extractedText,
        }],
      })) as FileContextPreparer,
    });
    const standardAdapter = createStandardCapabilityAdapter({
      runOperation: (async function* (input: StandardOperationInput) {
        receivedContexts.push(input.fileContext?.documents[0]?.extractedText ?? "");
        const reply = "The full Unicode source reached Standard.";
        const result = {
          kind: "standard_operation" as const,
          requestId: binding.requestId,
          userId,
          conversationId,
          reply,
          model: "test-model",
          reasoningEffort: input.reasoningEffort,
          measurements: [],
        };
        yield { type: "text_delta" as const, text: reply };
        yield { type: "completion" as const, result };
      }) as StandardOperationRunner,
    });
    const registry = createExecutionRegistry({
      standardExecutor: standardAdapter,
      webSearchExecutor: unused(),
      fileAnalysisExecutor: fileAdapter,
      documentGenerationExecutor: unused(),
      imageGenerationExecutor: unused(),
      imageEditingExecutor: unused(),
    });
    const runtime = new DurableXStateExecutionRuntime({
      store,
      executor: createRegistryCapabilityExecutor(registry),
      authorizer: { authorize: async () => ({ allowed: true }) },
      requestMessageBindingValidator: { validate: async () => true },
    });
    const steps: PlanStep[] = [
      { id: "files", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }], expectedOutput: "structured_data" },
      { id: "answer", capability: "standard", dependsOn: ["files"], inputs: [
        { source: "user" }, { source: "step", stepId: "files", output: "structured_data" },
      ], expectedOutput: "text" },
    ];
    const outcome = await runtime.execute(multiStepHandoff(steps), {
      authenticatedUserId: userId,
      conversationId,
      requestMessageBinding: binding,
      userInput: "Use the entire uploaded source.",
      attachments: [{ id: sourceDocumentId, kind: "file" }],
    }, `registry-large-file-${randomUUID()}`);
    expect(outcome.kind).toBe("succeeded");
    if (outcome.kind !== "succeeded") return;

    expect(executionResultJsonBytes({
      kind: "structured_data",
      value: { kind: "file_context", userId, conversationId, documents: [{ extractedText }] },
    })).toBeGreaterThan(65_536);
    expect(receivedContexts).toEqual([extractedText]);
    const saved = await store.getRun({ runId: outcome.run.id, userId });
    const fileResult = saved?.steps.find(({ stepId }) => stepId === "files")?.result;
    expect(fileResult).toEqual(outcome.stepResults.files);
    expect((fileResult?.value as { documents: Array<{ extractedText: string }> }).documents[0]!.extractedText)
      .toBe(extractedText);
    const rows = await sql`SELECT steps.result_payload_id,
        octet_length(steps.result_envelope::text) AS envelope_bytes,
        payload.serialized_size_bytes, payload.result_kind
      FROM public.execution_steps AS steps
      JOIN public.execution_step_result_payloads AS payload
        ON payload.id = steps.result_payload_id
        AND payload.run_id = steps.run_id AND payload.user_id = steps.user_id AND payload.step_id = steps.step_id
      WHERE steps.run_id = ${outcome.run.id}::uuid AND steps.user_id = ${userId}::uuid AND steps.step_id = 'files'`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.result_payload_id).toBeTruthy();
    expect(Number(rows[0]!.envelope_bytes)).toBeLessThanOrEqual(65_536);
    expect(Number(rows[0]!.serialized_size_bytes)).toBe(executionResultJsonBytes(fileResult));
    expect(rows[0]!.result_kind).toBe("structured_data");
  });
});
