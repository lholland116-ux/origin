import { describe, expect, it, vi } from "vitest";
import {
  CapaRootCauseReviewAdvisoryService,
  CapaRootCauseReviewAdvisoryServiceError,
} from "../../lib/capa/ai/capa-root-cause-review-advisory-service";

const ORG = "10000000-0000-4000-8000-000000000001" as any;
const CASE_ID = "20000000-0000-4000-8000-000000000001" as any;
const VERSION_ID = "30000000-0000-4000-8000-000000000001" as any;
const USER_ID = "60000000-0000-4000-8000-000000000001" as any;
const REQUEST_ID = "40000000-0000-4000-8000-000000000001" as any;
const CORRELATION_ID = "50000000-0000-4000-8000-000000000001" as any;
const RUN_ID = "70000000-0000-4000-8000-000000000001" as any;
const OUTPUT_ID = "80000000-0000-4000-8000-000000000001" as any;

function assembly(): any {
  return {
    authoritative: {
      trust: "authoritative_server_context", organization_id: ORG,
      capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4,
      workflow_state: "S50", actor: USER_ID, active_roles: [{ role_id: "CAPA_REVIEWER" }],
      sections: { investigation_ledger: {}, root_cause_package: {}, investigation_plan: null },
    },
    reference_manifest: [],
    model_safe_context: { trust: "model_safe_context", workflow_state: "S50", references: [] },
  };
}

function generated(): any {
  return {
    response: {
      run_id: RUN_ID, output_id: OUTPUT_ID,
      output_schema_version: "capa_review_packet_draft-1.0.0", status: "completed_draft",
      proposal: null, uncertainty_and_limitations: [], citations: [], warnings: [],
      advisory_only: true, workflow_mutated: false, controlled_record_mutated: false,
      review_disposition: null, workflow_transition: null, human_acceptance_required: true,
    },
    trace: {
      trace_schema_version: "capa-ai-generation-trace-1.0.0",
      package: {
        package_schema_version: "capa-root-cause-review-prompt-package-1.0.0",
        scope: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4, workflow_state: "S50" },
        agent: { agent_id: "AG-REVIEW", agent_version: "ag-review-1.0.0" },
        trace: { run_id: RUN_ID, request_id: REQUEST_ID, correlation_id: CORRELATION_ID },
        generation_contract: { operation: "assemble_review_packet", output_schema_version: "capa_review_packet_draft-1.0.0" },
        governance: { advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, human_acceptance_required: true },
      },
      policy_manifest: { policy_manifest_schema_version: "capa-root-cause-review-policy-manifest-1.0.0", workflow_state: "S50", operation: "assemble_review_packet" },
    },
  };
}

function invocation() {
  return { organization_id: ORG, capa_case_id: CASE_ID, user_id: USER_ID, request_id: REQUEST_ID, correlation_id: CORRELATION_ID, request: { expected_case_version_id: VERSION_ID, expected_record_version: 4 } };
}

function service(overrides: Record<string, unknown> = {}) {
  return new CapaRootCauseReviewAdvisoryService({
    context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => true) },
    authorizer: { authorize: vi.fn(async () => true) },
    agent_gate: { evaluate: vi.fn(() => true) },
    generator: { generate: vi.fn(async () => generated()) },
    output_repository: { save: vi.fn(async () => "saved") },
    transaction_manager: { runInTransaction: vi.fn(async (_trace, callback) => callback({})) },
    ...overrides,
  } as any);
}

describe("CapaRootCauseReviewAdvisoryService", () => {
  it("persists one governed S50 advisory and returns a safe snapshot", async () => {
    const output_repository = { save: vi.fn(async () => "saved") };
    const result = await service({ output_repository }).execute(invocation());
    expect(result.snapshot).toEqual({ capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4 });
    expect(output_repository.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reference_manifest: [] }));
  });

  it("denies before generation when authorization fails", async () => {
    const generate = vi.fn(async () => generated());
    await expect(service({ authorizer: { authorize: vi.fn(async () => false) }, generator: { generate } }).execute(invocation())).rejects.toMatchObject({ reason_code: "ADVISORY_ACCESS_DENIED" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("denies before generation when activation fails", async () => {
    const generate = vi.fn(async () => generated());
    await expect(service({ agent_gate: { evaluate: vi.fn(() => false) }, generator: { generate } }).execute(invocation())).rejects.toMatchObject({ reason_code: "AGENT_NOT_ELIGIBLE" });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["organization", { organization_id: "90000000-0000-4000-8000-000000000001" }, {}],
    ["case", { capa_case_id: "90000000-0000-4000-8000-000000000001" }, {}],
    ["actor", {}, { user_id: "90000000-0000-4000-8000-000000000001" }],
    ["case version", {}, { request: { expected_case_version_id: "90000000-0000-4000-8000-000000000001", expected_record_version: 4 } }],
    ["record version", {}, { request: { expected_case_version_id: VERSION_ID, expected_record_version: 5 } }],
  ])("rejects mismatched %s context before generation", async (_name, contextOverride, invocationOverride) => {
    const generate = vi.fn(async () => generated());
    const persist = vi.fn(async () => "saved");
    await expect(service({ generator: { generate }, output_repository: { save: persist }, context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: { ...assembly(), authoritative: { ...assembly().authoritative, ...contextOverride } } })), assertCaseUnchanged: vi.fn() } }).execute({ ...invocation(), ...invocationOverride } as any)).rejects.toMatchObject({ reason_code: "CASE_NOT_FOUND_OR_NOT_AUTHORIZED" });
    expect(generate).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("rejects a resolved context with no active role before generation", async () => {
    const generate = vi.fn(async () => generated());
    await expect(service({ generator: { generate }, context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: { ...assembly(), authoritative: { ...assembly().authoritative, active_roles: [] } } })), assertCaseUnchanged: vi.fn() } }).execute(invocation())).rejects.toMatchObject({ reason_code: "CASE_NOT_FOUND_OR_NOT_AUTHORIZED" });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["run_id", { response: { ...generated().response, run_id: "90000000-0000-4000-8000-000000000001" } }],
    ["request_id", { trace: { ...generated().trace, package: { ...generated().trace.package, trace: { ...generated().trace.package.trace, request_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["correlation_id", { trace: { ...generated().trace, package: { ...generated().trace.package, trace: { ...generated().trace.package.trace, correlation_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["case binding", { trace: { ...generated().trace, package: { ...generated().trace.package, scope: { ...generated().trace.package.scope, capa_case_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["agent identity", { trace: { ...generated().trace, package: { ...generated().trace.package, agent: { agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" } } } }],
  ])("rejects invalid generated %s identity without persistence", async (_name, change) => {
    const persist = vi.fn(async () => "saved");
    await expect(service({ generator: { generate: vi.fn(async () => ({ ...generated(), ...change })) }, output_repository: { save: persist } }).execute(invocation())).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
    expect(persist).not.toHaveBeenCalled();
  });

  it("does not open a transaction when assertCaseUnchanged is false", async () => {
    const transaction = vi.fn(async (_trace, callback) => callback({}));
    const persist = vi.fn(async () => "saved");
    await expect(service({ output_repository: { save: persist }, transaction_manager: { runInTransaction: transaction }, context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => false) } }).execute(invocation())).rejects.toMatchObject({ reason_code: "WORKFLOW_MUTATION_DETECTED" });
    expect(transaction).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
  });

  it("passes exact request traces and persistence values on success", async () => {
    const save = vi.fn(async () => "saved");
    const runInTransaction = vi.fn(async (_trace, callback) => callback({ transaction_id: "tx" }));
    await service({ output_repository: { save }, transaction_manager: { runInTransaction } }).execute(invocation());
    expect(runInTransaction).toHaveBeenCalledWith({ request_id: REQUEST_ID, correlation_id: CORRELATION_ID }, expect.any(Function));
    expect(save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ context: assembly().authoritative, response: generated().response, generation_trace: generated().trace, reference_manifest: [], request_id: REQUEST_ID, correlation_id: CORRELATION_ID }));
  });

  it("fails closed for wrong state, generator failure, invalid output, stale context, and transaction races", async () => {
    await expect(service({ context_resolver: { resolve: vi.fn(async () => ({ status: "wrong_workflow_state" as const })), assertCaseUnchanged: vi.fn() } }).execute(invocation())).rejects.toMatchObject({ reason_code: "CASE_NOT_IN_ROOT_CAUSE_REVIEW" });
    await expect(service({ generator: { generate: vi.fn(async () => { throw new Error(); }) } }).execute(invocation())).rejects.toMatchObject({ reason_code: "ADVISORY_GENERATION_FAILED" });
    await expect(service({ generator: { generate: vi.fn(async () => ({ response: {}, trace: {} })) } }).execute(invocation())).rejects.toMatchObject({ reason_code: "INVALID_ADVISORY_RESULT" });
    await expect(service({ context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => false) } }).execute(invocation())).rejects.toMatchObject({ reason_code: "WORKFLOW_MUTATION_DETECTED" });
    await expect(service({ output_repository: { save: vi.fn(async () => "case_changed") } }).execute(invocation())).rejects.toMatchObject({ reason_code: "WORKFLOW_MUTATION_DETECTED" });
  });

  it("keeps persistence failures fail closed", async () => {
    await expect(service({ output_repository: { save: vi.fn(async () => { throw new Error(); }) } }).execute(invocation())).rejects.toEqual(expect.objectContaining({ reason_code: "ADVISORY_PERSISTENCE_FAILED" } satisfies Partial<CapaRootCauseReviewAdvisoryServiceError>));
  });
});
