import { describe, expect, it, vi } from "vitest";
import { CapaInvestigationActiveAdvisoryService, CapaInvestigationActiveAdvisoryServiceError } from "../../lib/capa/ai/capa-investigation-active-advisory-service";

const ORG = "10000000-0000-4000-8000-000000000001" as any;
const CASE_ID = "20000000-0000-4000-8000-000000000001" as any;
const VERSION_ID = "30000000-0000-4000-8000-000000000001" as any;
const REQUEST_ID = "40000000-0000-4000-8000-000000000001" as any;
const CORRELATION_ID = "50000000-0000-4000-8000-000000000001" as any;

function assembly(): any {
  const context = { trust: "authoritative_server_context", organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4, workflow_state: "S40", actor: "60000000-0000-4000-8000-000000000001", active_roles: [{ role_id: "CAPA_OWNER" }], investigation_plan: { items: [] } };
  return { authoritative: context, reference_manifest: [], model_safe_context: { trust: "model_safe_context", workflow_state: "S40", references: [] } };
}
function generated(): any {
  return { response: { run_id: "70000000-0000-4000-8000-000000000001", output_id: "80000000-0000-4000-8000-000000000001", output_schema_version: "capa_investigation_analysis_draft-1.0.0", status: "completed_draft", proposal: null, uncertainty_and_limitations: [], citations: [], warnings: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true }, trace: { trace_schema_version: "capa-ai-generation-trace-1.0.0", package: { package_schema_version: "capa-investigation-active-prompt-package-1.0.0", scope: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4, workflow_state: "S40" }, agent: { agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" }, trace: { run_id: "70000000-0000-4000-8000-000000000001", request_id: REQUEST_ID, correlation_id: CORRELATION_ID }, generation_contract: { operation: "facilitate_root_cause", output_schema_version: "capa_investigation_analysis_draft-1.0.0" } }, store: false } };
}

describe("CapaInvestigationActiveAdvisoryService", () => {
  it("checks S40 context and eligibility before invoking generation", async () => {
    const generate = vi.fn(async () => generated());
    const service = new CapaInvestigationActiveAdvisoryService({
      context_resolver: { resolve: vi.fn(async () => ({ status: "wrong_workflow_state" as const })), assertCaseUnchanged: vi.fn() },
      authorizer: { authorize: vi.fn(async () => true) },
      agent_gate: { evaluate: vi.fn(() => true) },
      generator: { generate },
      output_repository: {} as any,
      transaction_manager: {} as any,
    });
    await expect(service.execute({ organization_id: ORG, capa_case_id: CASE_ID, user_id: "60000000-0000-4000-8000-000000000001" as any, request_id: REQUEST_ID, correlation_id: CORRELATION_ID, request: { expected_case_version_id: VERSION_ID, expected_record_version: 4, untrusted_human_draft: null } })).rejects.toMatchObject({ reason_code: "CASE_NOT_IN_INVESTIGATION_ACTIVE" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("persists a completed advisory with the server manifest and returns a safe snapshot", async () => {
    const outputRepository = { save: vi.fn(async () => "saved") };
    const service = new CapaInvestigationActiveAdvisoryService({ context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => true) }, authorizer: { authorize: vi.fn(async () => true) }, agent_gate: { evaluate: vi.fn(() => true) }, generator: { generate: vi.fn(async () => generated()) }, output_repository: outputRepository as any, transaction_manager: { runInTransaction: vi.fn(async (_trace, callback) => callback({})) } as any });
    const result = await service.execute({ organization_id: ORG, capa_case_id: CASE_ID, user_id: "60000000-0000-4000-8000-000000000001" as any, request_id: REQUEST_ID, correlation_id: CORRELATION_ID, request: { expected_case_version_id: VERSION_ID, expected_record_version: 4, untrusted_human_draft: null } });
    expect(result.snapshot).toEqual({ capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4 });
    expect(outputRepository.save).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ reference_manifest: [] }));
  });

  it("maps a transaction-time case race to workflow mutation", async () => {
    const service = new CapaInvestigationActiveAdvisoryService({ context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => true) }, authorizer: { authorize: vi.fn(async () => true) }, agent_gate: { evaluate: vi.fn(() => true) }, generator: { generate: vi.fn(async () => generated()) }, output_repository: { save: vi.fn(async () => "case_changed") } as any, transaction_manager: { runInTransaction: vi.fn(async (_trace, callback) => callback({})) } as any });
    await expect(service.execute({ organization_id: ORG, capa_case_id: CASE_ID, user_id: "60000000-0000-4000-8000-000000000001" as any, request_id: REQUEST_ID, correlation_id: CORRELATION_ID, request: { expected_case_version_id: VERSION_ID, expected_record_version: 4, untrusted_human_draft: null } })).rejects.toMatchObject({ reason_code: "WORKFLOW_MUTATION_DETECTED" });
  });

  it("keeps a genuine repository exception as persistence failure", async () => {
    const service = new CapaInvestigationActiveAdvisoryService({ context_resolver: { resolve: vi.fn(async () => ({ status: "resolved" as const, assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => true) }, authorizer: { authorize: vi.fn(async () => true) }, agent_gate: { evaluate: vi.fn(() => true) }, generator: { generate: vi.fn(async () => generated()) }, output_repository: { save: vi.fn(async () => { throw new Error("database"); }) } as any, transaction_manager: { runInTransaction: vi.fn(async (_trace, callback) => callback({})) } as any });
    await expect(service.execute({ organization_id: ORG, capa_case_id: CASE_ID, user_id: "60000000-0000-4000-8000-000000000001" as any, request_id: REQUEST_ID, correlation_id: CORRELATION_ID, request: { expected_case_version_id: VERSION_ID, expected_record_version: 4, untrusted_human_draft: null } })).rejects.toEqual(expect.objectContaining({ reason_code: "ADVISORY_PERSISTENCE_FAILED" } satisfies Partial<CapaInvestigationActiveAdvisoryServiceError>));
  });
});
