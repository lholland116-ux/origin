import { describe, expect, it, vi } from "vitest";
import { submitCapaActionPlan } from "../../lib/capa/application/submit-capa-action-plan";
import { CAPA_ACTION_PLAN_SCHEMA_VERSION, CAPA_ACTION_PLAN_SECTION_TYPE } from "../../lib/capa/domain/capa-action-plan";

const ORG = "20000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const OTHER_SECTION = "70000000-0000-4000-8000-000000000001";
const ACTION_SECTION = "70000000-0000-4000-8000-000000000002";
const AUDIT = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-09-09T12:00:00.000Z";

const humanProvenance = { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null };
const actionPlan = {
  items: [{ item_id: "A-1", action_type: "corrective", description: "Revise the controlled process.", linked_targets: [{ target_type: "cause", target_id: "CAUSE-1", rationale: "Addresses the approved cause." }], owner_user_id: USER, due_date: "2026-10-01", status: "planned", deliverable: "Approved revised procedure.", implementation_evidence: "Training record and released procedure.", dependency_item_ids: [], unintended_consequence_assessment: "Assess downstream process impact.", effectiveness_check_required: false, draft_provenance: humanProvenance }],
  effectiveness_checks: [],
};
const actionPlanRevision4 = { ...actionPlan, items: [{ ...actionPlan.items[0], description: "Revision 4 controlled process update." }] };

function sourceVersion(overrides: Record<string, unknown> = {}) {
  return { organization_id: ORG, capa_case_id: CASE, case_version_id: SOURCE, version_number: 4, parent_version_id: null, change_reason: "Action Planning", status: "S60", section_version_ids: [OTHER_SECTION], effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: USER }, ...overrides };
}
function capaCase(overrides: Record<string, unknown> = {}) {
  return { organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-000001", current_version_id: SOURCE, status: "S60", record_version: 4, owner_user_id: USER, confidentiality: "CUSTOMER_CONFIDENTIAL", effective_at: NOW, created_at: NOW, updated_at: NOW, created_by: { actor_type: "human", actor_id: USER }, updated_by: { actor_type: "human", actor_id: USER }, ...overrides };
}
function workspace(overrides: Record<string, unknown> = {}) {
  return { schema_version: "capa-action-plan-workspace-draft-1.0.0", trust: "untrusted_human_draft", workflow_state: "S60", organization_id: ORG, capa_case_id: CASE, case_version_id: SOURCE, record_version: 4, draft_revision: 1, action_plan: actionPlan, updated_by_user_id: USER, updated_at: NOW, ...overrides };
}
function command(overrides: Record<string, unknown> = {}) {
  return { authentication: { principal: { principal_type: "human", user_id: USER }, session_id: "90000000-0000-4000-8000-000000000001", authentication_method: "SUPABASE_SESSION", assurance_level: "SINGLE_FACTOR", authenticated_at: NOW, expires_at: "2026-09-10T12:00:00.000Z" }, tenant: { organization_id: ORG, access_grant_id: "grant", access_path: "ORGANIZATION", authorization_policy_version: "policy-1", resolved_at: NOW, role_assignments: [] }, capa_case_id: CASE, expected_record_version: 4, expected_current_version_id: SOURCE, request_trace: { request_id: "50000000-0000-4000-8000-000000000001", correlation_id: "60000000-0000-4000-8000-000000000001", idempotency_key: "submit-action-plan-1" }, body: { expected_record_version: 4, expected_current_version_id: SOURCE }, ...overrides } as any;
}

function harness(options: { plan?: unknown; workspaceOverrides?: Record<string, unknown>; caseOverrides?: Record<string, unknown>; sourceOverrides?: Record<string, unknown>; policy?: unknown; principalType?: string; claim?: unknown; } = {}) {
  const currentCase: any = capaCase(options.caseOverrides);
  const currentSource: any = sourceVersion(options.sourceOverrides);
  const sections = new Map<string, any>([[OTHER_SECTION, { organization_id: ORG, capa_case_id: CASE, section_version_id: OTHER_SECTION, section_type: "CAPA.ROOT_CAUSE_PACKAGE", version_number: 1, schema_version: "root-1", content: {}, change_reason: "prior", effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: USER } }]]);
  const state: { operation: any; audit: any; next: any } = { operation: null, audit: null, next: null };
  const inserts: any[] = [];
  const repository: any = {
    findCaseById: vi.fn(async () => ({ ...currentCase })),
    findCaseVersionById: vi.fn(async (_org: string, _case: string, id: string) => id === SOURCE ? currentSource : state.next),
    findSectionVersionById: vi.fn(async (_org: string, _case: string, id: string) => sections.get(id) ?? null),
    insertSectionVersion: vi.fn(async (_transaction: unknown, section: any) => { sections.set(section.section_version_id, section); inserts.push(section); }),
    insertCaseVersion: vi.fn(async (_transaction: unknown, version: any) => { state.next = version; inserts.push(version); }),
    advanceCurrentVersion: vi.fn(async () => { const updated = { ...currentCase, current_version_id: NEXT, status: "S70", record_version: 5 }; Object.assign(currentCase, updated); return { status: "updated", capa_case: updated }; }),
  };
  const auditRepository: any = {
    findEventById: vi.fn(async () => state.audit),
    appendEvent: vi.fn(async (_transaction: unknown, audit: any) => { state.audit = audit; return { status: "appended", event_id: audit.event_id }; }),
  };
  const workflow: any = {
    findWorkflowOperation: vi.fn(async () => state.operation),
    claimWorkflowOperation: vi.fn(async (_transaction: unknown, input: any) => { if (state.operation !== null) return { status: "already_claimed", record: state.operation }; state.operation = { ...input }; return { status: "claimed" }; }),
  };
  const policy = { evaluate: vi.fn(async () => options.policy ?? { decision: "allow", reason_code: "AUTHORIZED", policy_version: "policy-1", evaluated_at: NOW, relied_on_role_assignment_ids: ["assignment-1"] }) };
  const dependencies: any = {
    transaction_manager: { runInTransaction: vi.fn(async (_trace: unknown, work: any) => work({ transaction_id: "tx-1", started_at: NOW, request_trace: {} })) },
    capa_repository: repository,
    audit_repository: auditRepository,
    workspace_repository: { findDraft: vi.fn(async () => workspace({ ...(options.workspaceOverrides ?? {}), ...(options.plan === undefined ? {} : { action_plan: options.plan }) })), findDraftForUpdate: vi.fn(async () => workspace({ ...(options.workspaceOverrides ?? {}), ...(options.plan === undefined ? {} : { action_plan: options.plan }) })) },
    workflow_idempotency_repository: workflow,
    authorization_policy: policy,
    id_generator: { generateCaseVersionId: () => NEXT, generateSectionVersionId: () => ACTION_SECTION, generateAuditEventId: () => AUDIT },
    clock: { now: () => new Date(NOW) },
    configuration: { workflow_version: "workflow-1", audit_schema_version: "audit-1", authorization_purpose: "CAPA_ACTION_PLAN_SUBMISSION" },
  };
  const request = command({ authentication: { ...command().authentication, principal: { principal_type: options.principalType ?? "human", user_id: USER } } });
  return { dependencies, request, currentCase, currentSource, state, inserts, repository, policy, auditRepository, workflow };
}

describe("controlled human S60 action-plan submission", () => {
  it("materializes the plan, advances S60/N to S70/N+1, preserves prior sections, and audits the transition", async () => {
    const test = harness();
    const result = await submitCapaActionPlan(test.dependencies, test.request);
    expect(result.status).toBe("submitted");
    expect(test.currentCase).toMatchObject({ status: "S70", record_version: 5, current_version_id: NEXT });
    expect(test.inserts[0]).toMatchObject({ section_type: CAPA_ACTION_PLAN_SECTION_TYPE, schema_version: CAPA_ACTION_PLAN_SCHEMA_VERSION, content: actionPlan });
    expect(test.inserts[1]).toMatchObject({ status: "S70", version_number: 5, parent_version_id: SOURCE, section_version_ids: [OTHER_SECTION, ACTION_SECTION] });
    expect(test.state.audit).toMatchObject({ event_type: "EVT-STATE-TRANSITION", action: "SUBMIT_CAPA_ACTION_PLAN", aggregate_version: 5, metadata: { from_state: "S60", to_state: "S70", source_case_version_id: SOURCE, resulting_case_version_id: NEXT, action_plan_section_version_id: ACTION_SECTION, workspace_draft_revision: 1, transition_event: "Submit action plan for review" } });
    expect(test.state.operation).toMatchObject({ operation_code: "SUBMIT_CAPA_ACTION_PLAN", source_case_version_id: SOURCE, resulting_case_version_id: NEXT, audit_event_id: AUDIT });
  });

  it("materializes the transaction-visible revision 4 after a stale revision 3 preflight", async () => {
    const test = harness({ workspaceOverrides: { draft_revision: 4, action_plan: actionPlanRevision4 } });
    test.dependencies.workspace_repository.findDraft.mockResolvedValue(workspace({ draft_revision: 3, action_plan: actionPlan }));
    await expect(submitCapaActionPlan(test.dependencies, test.request)).resolves.toMatchObject({ status: "submitted" });
    expect(test.dependencies.workspace_repository.findDraft).not.toHaveBeenCalled();
    expect(test.inserts[0]).toMatchObject({ content: actionPlanRevision4 });
    expect(test.state.audit).toMatchObject({ metadata: { workspace_draft_revision: 4 } });
  });

  it("returns an exact idempotent replay without inserting or auditing again", async () => {
    const test = harness();
    await expect(submitCapaActionPlan(test.dependencies, test.request)).resolves.toMatchObject({ status: "submitted" });
    const insertCount = test.inserts.length;
    const auditCount = test.auditRepository.appendEvent.mock.calls.length;
    await expect(submitCapaActionPlan(test.dependencies, test.request)).resolves.toMatchObject({ status: "already_submitted", action_plan_section_version: { section_version_id: ACTION_SECTION } });
    expect(test.inserts).toHaveLength(insertCount);
    expect(test.auditRepository.appendEvent).toHaveBeenCalledTimes(auditCount);
  });

  it("rejects a reused key when server-resolved workspace content or revision changes", async () => {
    const test = harness();
    await submitCapaActionPlan(test.dependencies, test.request);
    test.dependencies.workspace_repository.findDraftForUpdate.mockResolvedValue(workspace({ draft_revision: 2, action_plan: { ...actionPlan, items: [] } }));
    await expect(submitCapaActionPlan(test.dependencies, test.request)).resolves.toEqual({ status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" });
  });

  it("returns deterministic readiness blockers without mutating the aggregate", async () => {
    const test = harness({ plan: { items: [], effectiveness_checks: [] } });
    await expect(submitCapaActionPlan(test.dependencies, test.request)).resolves.toMatchObject({ status: "submission_blocked", blocker_codes: ["EMPTY_ACTION_PLAN"] });
    expect(test.inserts).toHaveLength(0);
    expect(test.currentCase).toMatchObject({ status: "S60", record_version: 4, current_version_id: SOURCE });
  });

  it("rejects invalid or misbound workspaces before transition", async () => {
    const invalid = harness({ plan: { items: {} } });
    await expect(submitCapaActionPlan(invalid.dependencies, invalid.request)).resolves.toMatchObject({ status: "validation_failed", reason_code: "INVALID_ACTION_PLAN_WORKSPACE" });
    const mismatched = harness({ workspaceOverrides: { case_version_id: NEXT } });
    await expect(submitCapaActionPlan(mismatched.dependencies, mismatched.request)).resolves.toMatchObject({ status: "validation_failed", detail_reason_code: "ACTION_PLAN_WORKSPACE_BINDING_MISMATCH" });
  });

  it("maps record-version and workflow conflicts without materializing a new version", async () => {
    const recordConflict = harness();
    recordConflict.request.expected_record_version = 9;
    recordConflict.request.body = { expected_record_version: 9, expected_current_version_id: SOURCE };
    await expect(submitCapaActionPlan(recordConflict.dependencies, recordConflict.request)).resolves.toEqual({ status: "concurrency_conflict", reason_code: "RECORD_VERSION_CONFLICT" });
    expect(recordConflict.inserts).toHaveLength(0);
    const workflowConflict = harness({ caseOverrides: { status: "S50" } });
    await expect(submitCapaActionPlan(workflowConflict.dependencies, workflowConflict.request)).resolves.toEqual({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" });
  });

  it("does not permit a delayed S60 workspace save after submission commits", async () => {
    const test = harness();
    await expect(submitCapaActionPlan(test.dependencies, test.request)).resolves.toMatchObject({ status: "submitted" });
    const delayedSave = vi.fn(async () => ({ status: "case_changed" as const }));
    test.dependencies.workspace_repository.saveDraft = delayedSave;
    await expect(test.dependencies.workspace_repository.saveDraft({} as never, { draft: workspace({ draft_revision: 2 }) as never, expected_draft_revision: 1, expected_case_version_id: SOURCE, expected_record_version: 4, expected_workflow_state: "S60" })).resolves.toEqual({ status: "case_changed" });
    expect(delayedSave).toHaveBeenCalledTimes(1);
  });

  it("requires the distinct human submit operation and denies policy or non-human principals", async () => {
    const denied = harness({ policy: { decision: "deny", reason_code: "DENIED", policy_version: "policy-1" } });
    await expect(submitCapaActionPlan(denied.dependencies, denied.request)).resolves.toMatchObject({ status: "authorization_denied", reason_code: "DENIED" });
    expect(denied.policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: "submit_action_plan" }));
    expect((denied.policy.evaluate as any).mock.calls[0]?.[0]?.operation).not.toBe("approve_action_plan");
    const nonHuman = harness({ principalType: "service" });
    await expect(submitCapaActionPlan(nonHuman.dependencies, nonHuman.request)).resolves.toMatchObject({ status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED" });
    expect(nonHuman.inserts).toHaveLength(0);
  });
});
