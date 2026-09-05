import { describe, expect, it, vi } from "vitest";
import { createCapaInvestigationActiveWorkspaceDraftService } from "../../lib/capa/application/capa-investigation-active-workspace-draft-service";

const ORG = "10000000-0000-4000-8000-000000000001" as never;
const CASE = "20000000-0000-4000-8000-000000000001" as never;
const VERSION_1 = "30000000-0000-4000-8000-000000000001" as never;
const VERSION_2 = "30000000-0000-4000-8000-000000000002" as never;
const USER = "40000000-0000-4000-8000-000000000001" as never;
const OTHER_USER = "40000000-0000-4000-8000-000000000002" as never;
const NOW = new Date("2026-09-05T12:00:00.000Z");

const emptyPayload = {
  evidence_assumption_ledger: { items: [] },
  root_cause_package: { hypotheses: [], root_cause_not_confirmed: null },
};

function context(user = USER) {
  return {
    authentication: {
      principal: { principal_type: "human", user_id: user },
      session_id: "50000000-0000-4000-8000-000000000001",
      authentication_method: "SUPABASE_SESSION",
      assurance_level: "SINGLE_FACTOR",
      authenticated_at: "2026-09-05T11:00:00.000Z",
      expires_at: "2026-09-05T13:00:00.000Z",
    },
    tenant: {
      organization_id: ORG,
      access_grant_id: "60000000-0000-4000-8000-000000000001",
      access_path: "DEVELOPMENT_SINGLE_USER_TENANT",
      authorization_policy_version: "development-policy-1.0.0",
      resolved_at: "2026-09-05T11:00:00.000Z",
      role_assignments: [{
        role_assignment_id: `development-role:${user}`,
        role_id: "CAPA_OWNER",
        scope: "ORGANIZATION",
        effective_at: "2026-09-05T10:00:00.000Z",
      }],
    },
    owner_user_id: user,
  } as any;
}

function setup(overrides: Record<string, unknown> = {}) {
  const capaCase = {
    organization_id: ORG,
    capa_case_id: CASE,
    current_version_id: VERSION_1,
    status: "S40",
    record_version: 4,
  } as any;
  const caseVersion = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION_1,
    version_number: 4,
    status: "S40",
  } as any;
  const repository = {
    findCaseById: vi.fn(async () => capaCase),
    findCaseVersionById: vi.fn(async () => caseVersion),
    findDraft: vi.fn(async () => null),
    saveDraft: vi.fn(async (_transaction, input) => ({ status: "saved", draft: input.draft })),
    ...overrides,
  } as any;
  const policy = {
    evaluate: vi.fn(async () => ({
      decision: "allow",
      reason_code: "ALLOWED",
      policy_version: "development-policy-1.0.0",
      evaluated_at: NOW.toISOString(),
      relied_on_role_assignment_ids: ["assignment"],
    })),
  } as any;
  const transactionManager = {
    runInTransaction: vi.fn(async (_trace, work) => work({ transaction_id: "tx" })),
  } as any;
  const service = createCapaInvestigationActiveWorkspaceDraftService({
    request_context: context(),
    capa_repository: repository,
    workspace_repository: repository,
    transaction_manager: transactionManager,
    authorization_policy: policy,
    now: () => NOW,
  });
  return { service, repository, policy, transactionManager, capaCase, caseVersion };
}

const trace = { request_id: "70000000-0000-4000-8000-000000000001", correlation_id: "80000000-0000-4000-8000-000000000001" } as any;

describe("S40 investigation-active workspace application service", () => {
  it("loads an absent workspace as null and permits a workspace saved against an older S40 version", async () => {
    const absent = setup();
    await expect(absent.service.load({ capa_case_id: CASE })).resolves.toEqual({ status: "loaded", workspace: null });

    const existing = {
      schema_version: "capa-investigation-active-workspace-draft-1.0.0",
      trust: "untrusted_human_draft",
      workflow_state: "S40",
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: VERSION_2,
      record_version: 3,
      draft_revision: 2,
      ...emptyPayload,
      updated_by_user_id: USER,
      updated_at: "2026-09-05T11:00:00.000Z",
    };
    const loaded = setup({ findDraft: vi.fn(async () => existing) });
    await expect(loaded.service.load({ capa_case_id: CASE })).resolves.toMatchObject({ status: "loaded", workspace: { case_version_id: VERSION_2, record_version: 3, draft_revision: 2 } });
  });

  it("constructs server-owned fields and computes create revision one", async () => {
    const test = setup();
    const body = { expected_draft_revision: null, ...emptyPayload };
    await expect(test.service.save({ capa_case_id: CASE, body, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION_1, record_version: 4, draft_revision: 1, updated_by_user_id: USER, updated_at: NOW.toISOString() } });
    expect(test.repository.saveDraft).toHaveBeenCalledWith(expect.anything(), { expected_draft_revision: null, expected_case_version_id: VERSION_1, expected_record_version: 4, expected_workflow_state: "S40", draft: expect.objectContaining({ workflow_state: "S40", trust: "untrusted_human_draft" }) });
  });

  it("rejects client-owned envelope fields and malformed payload revisions", async () => {
    const test = setup();
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 0, ...emptyPayload }, request_trace: trace })).resolves.toEqual({ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_REVISION", detail_reason_code: undefined });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload, organization_id: ORG }, request_trace: trace })).resolves.toMatchObject({ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" });
    expect(test.repository.findCaseById).not.toHaveBeenCalled();
  });

  it("computes the next revision, maps atomic conflicts, and does not read the workspace before saving", async () => {
    const test = setup();
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 1, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 2 } });
    expect(test.repository.findDraft).not.toHaveBeenCalled();
    test.repository.saveDraft.mockResolvedValue({ status: "concurrency_conflict" });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 1, ...emptyPayload }, request_trace: trace })).resolves.toEqual({ status: "concurrency_conflict" });
  });

  it("rejects the maximum expected revision but accepts its predecessor", async () => {
    const test = setup();
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: Number.MAX_SAFE_INTEGER, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_REVISION" });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: Number.MAX_SAFE_INTEGER - 1, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: Number.MAX_SAFE_INTEGER } });
  });

  it("re-stamps an update from the current authoritative S40 version", async () => {
    const test = setup();
    test.capaCase.current_version_id = VERSION_2;
    test.capaCase.record_version = 5;
    test.caseVersion.case_version_id = VERSION_2;
    test.caseVersion.version_number = 5;
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 1, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { case_version_id: VERSION_2, record_version: 5, draft_revision: 2 } });
  });

  it("does not persist a workspace stamped with a stale CAPA context", async () => {
    const test = setup();
    test.transactionManager.runInTransaction.mockImplementation(async (_trace: any, work: any) => {
      test.capaCase.current_version_id = VERSION_2;
      test.capaCase.record_version = 5;
      return work({ transaction_id: "tx" } as any);
    });
    test.repository.saveDraft.mockImplementation(async (_transaction: any, input: any) =>
      input.expected_case_version_id === test.capaCase.current_version_id &&
      input.expected_record_version === test.capaCase.record_version
        ? { status: "saved", draft: input.draft }
        : { status: "case_changed" });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload }, request_trace: trace })).resolves.toEqual({ status: "case_changed", reason_code: "WORKFLOW_MUTATION_DETECTED" });
    expect(test.repository.saveDraft).toHaveBeenCalledTimes(1);
  });

  it("fails closed for a non-S40 case and an unauthorized edit", async () => {
    const test = setup();
    test.capaCase.status = "S50";
    test.caseVersion.status = "S50";
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload }, request_trace: trace })).resolves.toEqual({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" });
    test.capaCase.status = "S40";
    test.caseVersion.status = "S40";
    test.policy.evaluate.mockResolvedValue({ decision: "deny", reason_code: "DENIED", policy_version: "development-policy-1.0.0", evaluated_at: NOW.toISOString() });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "authorization_denied", reason_code: "DENIED" });
  });

  it("rejects structurally invalid AI provenance without an adoption lookup", async () => {
    const test = setup();
    const ledger = { items: [{ item_id: "G-1", information_class: "missing_information", statement: "A gap.", evidence_status: null, assumption_status: null, gap_status: "open", conflict_status: null, provenance: { source_type: "ai_proposal", source_reference: "not-a-uuid", adopted_by_user_id: USER, adopted_at: NOW.toISOString() }, owner_user_id: null, information_date: null, source_version: null, context: null, linked_capa_objects: [], supporting_item_ids: [], contradictory_item_ids: [], conflict_item_ids: [], material_to_conclusion: false, critical_to_conclusion: false, recommended_next_step: "Review it.", target_date: null, human_disposition: null }] };
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, evidence_assumption_ledger: ledger, root_cause_package: emptyPayload.root_cause_package }, request_trace: trace })).resolves.toMatchObject({ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_LEDGER" });
    expect(test.repository.findDraft).not.toHaveBeenCalled();
  });

  it("fails closed when the durable repository returns a malformed workspace", async () => {
    const test = setup({ findDraft: vi.fn(async () => ({ draft_revision: 1 })) });
    await expect(test.service.load({ capa_case_id: CASE })).rejects.toThrow("durable workspace draft is invalid");
  });
});
