import { describe, expect, it, vi } from "vitest";
import { fingerprintCanonicalJson } from "../../lib/capa/ai/capa-ai-generation-trace";
import { constructCapaInvestigationActiveAdoption } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import { CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION } from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";
import { createReconcileCapaInvestigationActiveWorkspaceAdoptionsService } from "../../lib/capa/application/reconcile-capa-investigation-active-workspace-adoptions";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-05T12:00:00.000Z");
const TRACE = { request_id: "50000000-0000-4000-8000-000000000001", correlation_id: "60000000-0000-4000-8000-000000000001" } as never;

function context() {
  return {
    authentication: { principal: { principal_type: "human", user_id: USER }, session_id: "70000000-0000-4000-8000-000000000001", authentication_method: "SUPABASE_SESSION", assurance_level: "SINGLE_FACTOR", authenticated_at: "2026-09-05T11:00:00.000Z", expires_at: "2026-09-05T13:00:00.000Z" },
    tenant: { organization_id: ORG, access_grant_id: "80000000-0000-4000-8000-000000000001", access_path: "DEVELOPMENT_SINGLE_USER_TENANT", authorization_policy_version: "development-policy-1.0.0", resolved_at: "2026-09-05T11:00:00.000Z", role_assignments: [{ role_assignment_id: "development-role", role_id: "CAPA_OWNER", scope: "ORGANIZATION", effective_at: "2026-09-05T10:00:00.000Z" }] },
    owner_user_id: USER,
  } as any;
}

function persisted(adoptionId: string, causalRole?: "proposed_root_cause" | "contributing_factor") {
  const adoption = constructCapaInvestigationActiveAdoption({ adoption_id: adoptionId as never, organization_id: ORG as never, capa_case_id: CASE as never, case_version_id: VERSION as never, record_version: 4, output_id: "90000000-0000-4000-8000-000000000001" as never, proposal_key: "P1", proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "Historical gap", why_it_matters: "It matters", recommended_next_step: "Review it" } }, resolved_reference_bindings: [], reference_manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION, reference_manifest_fingerprint_algorithm: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, reference_manifest_sha256: "a".repeat(64), adopted_at: NOW.toISOString() as never, adopted_by: { actor_type: "human", actor_id: USER }, request_id: "a0000000-0000-4000-8000-000000000001" as never, correlation_id: "b0000000-0000-4000-8000-000000000001" as never, idempotency_key: adoptionId as never, workflow_mutated: false, controlled_record_mutated: false, gate_approved: false });
  return { adoption: causalRole === undefined ? adoption : { ...adoption, proposal_category: "causal_hypothesis", adopted_item: { proposal_key: "P1", adopted_content: { hypothesis: "Hypothesis", rationale: "Rationale" }, human_causal_role: causalRole } } as never, request_fingerprint: "b".repeat(64) as never, record_fingerprint: fingerprintCanonicalJson(adoption) as never, audit_event_id: "c0000000-0000-4000-8000-000000000001" as never };
}

function setup(adoptions: readonly any[] = [], initialWorkspace: any = null) {
  let workspace = initialWorkspace;
  const saveDraft = vi.fn(async (_transaction: unknown, input: any) => { workspace = input.draft; return { status: "saved" as const, draft: input.draft }; });
  const service = createReconcileCapaInvestigationActiveWorkspaceAdoptionsService({
    request_context: context(),
    capa_repository: { findCaseById: vi.fn(async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: VERSION, record_version: 4, status: "S40" })), findCaseVersionById: vi.fn(async () => ({ organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, version_number: 4, status: "S40" })) } as any,
    adoption_repository: { listAdoptionsForCase: vi.fn(async () => adoptions) } as any,
    workspace_repository: { findDraft: vi.fn(async () => workspace), saveDraft } as any,
    transaction_manager: { runInTransaction: vi.fn(async (_trace: unknown, work: (tx: unknown) => unknown) => work({ transaction_id: "tx", request_trace: TRACE })) } as any,
    authorization_policy: { evaluate: vi.fn(async () => ({ decision: "allow", reason_code: "ALLOWED", policy_version: "development-policy-1.0.0", evaluated_at: NOW.toISOString(), relied_on_role_assignment_ids: ["development-role"] })) } as any,
    now: () => NOW,
  });
  return { service, saveDraft, getWorkspace: () => workspace };
}

describe("S40 historical adoption workspace reconciliation", () => {
  it("leaves an absent workspace absent when there are no adoptions", async () => {
    const test = setup();
    await expect(test.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE })).resolves.toEqual({ status: "reconciled", workspace: null });
    expect(test.saveDraft).not.toHaveBeenCalled();
  });

  it("materializes a historical adoption as revision one", async () => {
    const test = setup([persisted("d0000000-0000-4000-8000-000000000001")]);
    const result = await test.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE });
    expect(result).toMatchObject({ status: "reconciled", workspace: { draft_revision: 1, evidence_assumption_ledger: { items: [{ item_id: "LED-d0000000-0000-4000-8000-000000000001" }] } } });
    expect(test.saveDraft).toHaveBeenCalledOnce();
  });

  it("does not bump an already reconciled workspace", async () => {
    const adoption = persisted("d0000000-0000-4000-8000-000000000002");
    const first = setup([adoption]);
    const firstResult = await first.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE });
    const second = setup([adoption], firstResult.status === "reconciled" ? firstResult.workspace : null);
    await expect(second.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE })).resolves.toMatchObject({ status: "reconciled", workspace: { draft_revision: 1 } });
    expect(second.saveDraft).not.toHaveBeenCalled();
  });

  it("preserves a human workspace edit while reconciling the same adoption", async () => {
    const adoption = persisted("d0000000-0000-4000-8000-000000000005");
    const first = setup([adoption]);
    const firstResult = await first.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE });
    if (firstResult.status !== "reconciled" || firstResult.workspace === null) throw new Error("Expected the historical adoption to be materialized.");
    const item = firstResult.workspace.evidence_assumption_ledger.items[0]!;
    const editedWorkspace = { ...firstResult.workspace, draft_revision: 7, evidence_assumption_ledger: { items: [{ ...item, critical_to_conclusion: true, target_date: "2026-09-30" }] } };
    const second = setup([adoption], editedWorkspace);
    const result = await second.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE });
    expect(result).toMatchObject({ status: "reconciled", workspace: { draft_revision: 7, evidence_assumption_ledger: { items: [{ critical_to_conclusion: true, target_date: "2026-09-30" }] } } });
    if (result.status !== "reconciled" || result.workspace === null) throw new Error("Expected the edited workspace to reconcile.");
    expect(result.workspace.evidence_assumption_ledger.items.filter((candidate) => candidate.provenance.source_reference === adoption.adoption.adoption_id)).toHaveLength(1);
    expect(second.saveDraft).not.toHaveBeenCalled();
  });

  it("fails closed for a historical causal adoption without a recorded human role", async () => {
    const valid = constructCapaInvestigationActiveAdoption({ adoption_id: "d0000000-0000-4000-8000-000000000003" as never, organization_id: ORG as never, capa_case_id: CASE as never, case_version_id: VERSION as never, record_version: 4, output_id: "90000000-0000-4000-8000-000000000001" as never, proposal_key: "P1", proposal_category: "causal_hypothesis", adopted_item: { proposal_key: "P1", adopted_content: { hypothesis: "Hypothesis", rationale: "Rationale" }, human_causal_role: "proposed_root_cause" }, resolved_reference_bindings: [], reference_manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION, reference_manifest_fingerprint_algorithm: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, reference_manifest_sha256: "a".repeat(64), adopted_at: NOW.toISOString() as never, adopted_by: { actor_type: "human", actor_id: USER }, request_id: "a0000000-0000-4000-8000-000000000001" as never, correlation_id: "b0000000-0000-4000-8000-000000000001" as never, idempotency_key: "legacy" as never, workflow_mutated: false, controlled_record_mutated: false, gate_approved: false });
    const legacy = { adoption: { ...valid, adopted_item: { proposal_key: "P1", adopted_content: valid.adopted_item.adopted_content } }, request_fingerprint: "b".repeat(64), record_fingerprint: fingerprintCanonicalJson(valid), audit_event_id: "c0000000-0000-4000-8000-000000000004" };
    const test = setup([legacy]);
    await expect(test.service.reconcile({ capa_case_id: CASE as never, request_trace: TRACE })).resolves.toEqual({ status: "legacy_causal_role_not_recorded" });
    expect(test.saveDraft).not.toHaveBeenCalled();
  });
});
