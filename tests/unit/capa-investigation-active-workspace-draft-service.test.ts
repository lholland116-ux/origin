import { describe, expect, it, vi } from "vitest";
import { CapaInvestigationActiveWorkspaceDraftIntegrityError, createCapaInvestigationActiveWorkspaceDraftService } from "../../lib/capa/application/capa-investigation-active-workspace-draft-service";

const ORG = "10000000-0000-4000-8000-000000000001" as never;
const CASE = "20000000-0000-4000-8000-000000000001" as never;
const VERSION_1 = "30000000-0000-4000-8000-000000000001" as never;
const VERSION_2 = "30000000-0000-4000-8000-000000000002" as never;
const RETURN_EVENT = "50000000-0000-4000-8000-000000000002" as never;
const USER = "40000000-0000-4000-8000-000000000001" as never;
const OTHER_USER = "40000000-0000-4000-8000-000000000002" as never;
const NOW = new Date("2026-09-05T12:00:00.000Z");
const LATER = new Date("2026-09-05T12:10:00.000Z");
const LATER_AGAIN = new Date("2026-09-05T12:20:00.000Z");
const FINAL = new Date("2026-09-05T12:30:00.000Z");

const emptyPayload = {
  evidence_assumption_ledger: { items: [] },
  root_cause_package: { hypotheses: [], root_cause_not_confirmed: null },
};
const returnResponse = {
  response_summary: "The investigation response addresses the review feedback.",
  actions_taken: "The team updated the investigation analysis.",
  disposition: "addressed",
  supporting_evidence_item_ids: ["E-1"],
};
const activeCycle = {
  return_transition_audit_event_id: RETURN_EVENT,
  source_case_version_id: VERSION_2,
  resulting_case_version_id: VERSION_1,
  returned_by: { actor_type: "human", actor_id: USER },
  returned_at: "2026-09-05T10:00:00.000Z",
  rationale: "More investigation is required.",
  source_record_version: 3,
  resulting_record_version: 4,
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
  const returnCycleResolver = (Object.prototype.hasOwnProperty.call(overrides, "return_cycle_resolver")
    ? overrides.return_cycle_resolver
    : { resolve: vi.fn(async () => ({ status: "no_active_return_cycle" })) }) as any;
  const service = createCapaInvestigationActiveWorkspaceDraftService({
    request_context: (overrides.request_context ?? context()) as any,
    capa_repository: repository,
    workspace_repository: repository,
    transaction_manager: transactionManager,
    authorization_policy: policy,
    return_cycle_resolver: returnCycleResolver,
    now: (overrides.now ?? (() => NOW)) as () => Date,
  });
  return { service, repository, policy, transactionManager, returnCycleResolver, capaCase, caseVersion };
}

const trace = { request_id: "70000000-0000-4000-8000-000000000001", correlation_id: "80000000-0000-4000-8000-000000000001" } as any;

describe("S40 investigation-active workspace application service", () => {
  it("fails closed when load is composed without a return-cycle resolver", async () => {
    const test = setup({ return_cycle_resolver: undefined });
    await expect(test.service.load({ capa_case_id: CASE })).rejects.toThrow(new CapaInvestigationActiveWorkspaceDraftIntegrityError("The root-cause return-cycle resolver is not configured."));
  });

  it("fails closed when save is composed without a return-cycle resolver", async () => {
    const test = setup({ return_cycle_resolver: undefined });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload }, request_trace: trace })).rejects.toThrow("The root-cause return-cycle resolver is not configured.");
    expect(test.repository.saveDraft).not.toHaveBeenCalled();
  });

  it("preserves first-time legacy behavior with a wired resolver reporting no active cycle", async () => {
    const resolver = { resolve: vi.fn(async () => ({ status: "no_active_return_cycle" })) };
    const test = setup({ return_cycle_resolver: resolver });
    await expect(test.service.load({ capa_case_id: CASE })).resolves.toEqual({ status: "loaded", workspace: null });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { root_cause_return_response: null } });
  });

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

  it("rejects a return response when no authoritative active return cycle exists", async () => {
    const test = setup();
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload, root_cause_return_response: returnResponse }, request_trace: trace })).resolves.toEqual({ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_RETURN_RESPONSE", detail_reason_code: "NO_ACTIVE_ROOT_CAUSE_RETURN_CYCLE" });
    expect(test.repository.saveDraft).not.toHaveBeenCalled();
  });

  it("distinguishes omit, explicit same-content save, material response change, and explicit clear", async () => {
    let stored: any = null;
    const resolver = { resolve: vi.fn(async () => ({ status: "active", cycle: activeCycle })) };
    const saveDraft = vi.fn(async (_transaction, input) => {
      stored = input.draft;
      return { status: "saved", draft: stored };
    });
    const userA = setup({
      return_cycle_resolver: { resolve: vi.fn(async () => ({ status: "active", cycle: activeCycle })) },
      findDraft: vi.fn(async () => stored),
      saveDraft,
    });
    const created = await userA.service.save({ capa_case_id: CASE, body: { expected_draft_revision: null, ...emptyPayload, root_cause_return_response: returnResponse }, request_trace: trace });
    expect(created).toMatchObject({ status: "saved", workspace: { draft_revision: 1, root_cause_return_response: { ...returnResponse, return_transition_audit_event_id: RETURN_EVENT, source_case_version_id: VERSION_2, resulting_case_version_id: VERSION_1, responded_by: { actor_type: "human", actor_id: USER }, responded_at: NOW.toISOString() } } });
    const userBAtT2 = setup({ request_context: context(OTHER_USER), now: () => LATER, return_cycle_resolver: resolver, findDraft: vi.fn(async () => stored), saveDraft });
    const omitted = await userBAtT2.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 1, evidence_assumption_ledger: { items: [] }, root_cause_package: emptyPayload.root_cause_package }, request_trace: trace });
    expect(omitted).toMatchObject({ status: "saved", workspace: { draft_revision: 2, updated_by_user_id: OTHER_USER, updated_at: LATER.toISOString(), root_cause_return_response: { responded_by: { actor_type: "human", actor_id: USER }, responded_at: NOW.toISOString() } } });
    const userBAtT3 = setup({ request_context: context(OTHER_USER), now: () => LATER_AGAIN, return_cycle_resolver: resolver, findDraft: vi.fn(async () => stored), saveDraft });
    const sameContent = await userBAtT3.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 2, ...emptyPayload, root_cause_return_response: returnResponse }, request_trace: trace });
    expect(sameContent).toMatchObject({ status: "saved", workspace: { draft_revision: 3, root_cause_return_response: { responded_by: { actor_type: "human", actor_id: USER }, responded_at: NOW.toISOString() } } });
    const changed = await userBAtT3.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 3, ...emptyPayload, root_cause_return_response: { ...returnResponse, response_summary: "The investigation response was materially revised." } }, request_trace: trace });
    expect(changed).toMatchObject({ status: "saved", workspace: { draft_revision: 4, root_cause_return_response: { response_summary: "The investigation response was materially revised.", responded_by: { actor_type: "human", actor_id: OTHER_USER }, responded_at: LATER_AGAIN.toISOString() } } });
    const userBAtT5 = setup({ request_context: context(OTHER_USER), now: () => FINAL, return_cycle_resolver: resolver, findDraft: vi.fn(async () => stored), saveDraft });
    await expect(userBAtT5.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 4, ...emptyPayload, root_cause_return_response: null }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 5, record_version: 4, root_cause_return_response: null } });
  });

  it("does not expose, reinterpret, or restamp a stale-cycle response omitted from an unrelated save", async () => {
    const stale = {
      schema_version: "capa-root-cause-review-return-response-draft-1.0.0",
      ...returnResponse,
      return_transition_audit_event_id: "50000000-0000-4000-8000-000000000003",
      source_case_version_id: VERSION_2,
      resulting_case_version_id: VERSION_1,
      responded_by: { actor_type: "human", actor_id: USER },
      responded_at: NOW.toISOString(),
    };
    let saved: any;
    const test = setup({
      return_cycle_resolver: { resolve: vi.fn(async () => ({ status: "active", cycle: activeCycle })) },
      findDraft: vi.fn(async () => ({ schema_version: "capa-investigation-active-workspace-draft-1.0.0", trust: "untrusted_human_draft", workflow_state: "S40", organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION_1, record_version: 4, draft_revision: 1, ...emptyPayload, root_cause_return_response: stale, updated_by_user_id: USER, updated_at: NOW.toISOString() })),
      saveDraft: vi.fn(async (_transaction, input) => { saved = input.draft; return { status: "saved", draft: saved }; }),
    });
    await expect(test.service.load({ capa_case_id: CASE })).resolves.toMatchObject({ status: "loaded", workspace: { root_cause_return_response: null } });
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 1, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { root_cause_return_response: null } });
    expect(saved.root_cause_return_response).toEqual(stale);
  });

  it("computes the next revision, maps atomic conflicts, and reads the workspace to preserve return-response attribution", async () => {
    const test = setup();
    await expect(test.service.save({ capa_case_id: CASE, body: { expected_draft_revision: 1, ...emptyPayload }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 2 } });
    expect(test.repository.findDraft).toHaveBeenCalledWith(ORG, CASE);
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
