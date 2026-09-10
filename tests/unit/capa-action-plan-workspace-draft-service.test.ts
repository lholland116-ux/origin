import { describe, expect, it, vi } from "vitest";
import { createCapaActionPlanWorkspaceDraftService } from "../../lib/capa/application/capa-action-plan-workspace-draft-service";

const ORG = "10000000-0000-4000-8000-000000000001" as never;
const CASE = "20000000-0000-4000-8000-000000000001" as never;
const VERSION = "30000000-0000-4000-8000-000000000001" as never;
const USER = "40000000-0000-4000-8000-000000000001" as never;
const NOW = new Date("2026-09-09T12:00:00.000Z");
const trace = { request_id: "50000000-0000-4000-8000-000000000001", correlation_id: "60000000-0000-4000-8000-000000000001" } as never;

const context = {
  authentication: { principal: { principal_type: "human", user_id: USER }, session_id: "70000000-0000-4000-8000-000000000001", authentication_method: "SUPABASE_SESSION", assurance_level: "SINGLE_FACTOR", authenticated_at: "2026-09-09T11:00:00.000Z", expires_at: "2026-09-09T13:00:00.000Z" },
  tenant: { organization_id: ORG, access_grant_id: "80000000-0000-4000-8000-000000000001", access_path: "DEVELOPMENT_SINGLE_USER_TENANT", authorization_policy_version: "development-policy-1.0.0", resolved_at: "2026-09-09T11:00:00.000Z", role_assignments: [] },
  owner_user_id: USER,
} as any;

function setup(overrides: Record<string, unknown> = {}) {
  const capaCase = { organization_id: ORG, capa_case_id: CASE, current_version_id: VERSION, status: "S60", record_version: 4 };
  const caseVersion = { organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, version_number: 4, status: "S60" };
  const repository = { findCaseById: vi.fn(async () => capaCase), findCaseVersionById: vi.fn(async () => caseVersion), findDraft: vi.fn(async () => null), saveDraft: vi.fn(async (_tx: unknown, input: any) => ({ status: "saved", draft: input.draft })), ...overrides } as any;
  const authorization_policy = { evaluate: vi.fn(async () => ({ decision: "allow", reason_code: "ALLOWED", policy_version: "development-policy-1.0.0", evaluated_at: NOW.toISOString(), relied_on_role_assignment_ids: [] })) } as any;
  const transaction_manager = { runInTransaction: vi.fn(async (_trace: unknown, work: any) => work({ transaction_id: "tx" })) } as any;
  const dependencies = { request_context: context, capa_repository: repository, workspace_repository: repository, transaction_manager, authorization_policy, now: () => NOW };
  const service = createCapaActionPlanWorkspaceDraftService(dependencies);
  return { service, repository, dependencies };
}

const body = { expected_draft_revision: null, action_plan: { items: [], effectiveness_checks: [] } };

describe("S60 action-plan workspace application service", () => {
  it("loads absent workspaces and saves incomplete plans with server-owned envelope fields", async () => {
    const test = setup();
    await expect(test.service.load({ capa_case_id: CASE })).resolves.toEqual({ status: "loaded", workspace: null });
    await expect(test.service.save({ capa_case_id: CASE, body, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { workflow_state: "S60", organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, record_version: 4, draft_revision: 1, updated_by_user_id: USER, updated_at: NOW.toISOString() } });
    expect(test.repository.saveDraft).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expected_draft_revision: null, expected_case_version_id: VERSION, expected_record_version: 4, expected_workflow_state: "S60" }));
  });

  it("computes the next revision and fails closed for malformed durable workspaces", async () => {
    const test = setup({ findDraft: vi.fn(async () => ({ malformed: true })) });
    await expect(test.service.save({ capa_case_id: CASE, body: { ...body, expected_draft_revision: 1 }, request_trace: trace })).rejects.toThrow("durable workspace draft is invalid");
    const updated = setup({ findDraft: vi.fn(async () => ({
      schema_version: "capa-action-plan-workspace-draft-1.0.0",
      trust: "untrusted_human_draft",
      workflow_state: "S60",
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: VERSION,
      record_version: 4,
      draft_revision: 1,
      action_plan: { items: [], effectiveness_checks: [] },
      updated_by_user_id: USER,
      updated_at: NOW.toISOString(),
    })) });
    await expect(updated.service.save({ capa_case_id: CASE, body: { ...body, expected_draft_revision: 1 }, request_trace: trace })).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 2 } });
  });

  it("server-binds a return response to the active S70 cycle without changing the action plan", async () => {
    const base = setup();
    const cycle = {
      return_transition_audit_event_id: "50000000-0000-4000-8000-000000000001",
      source_case_version_id: "30000000-0000-4000-8000-000000000002",
      resulting_case_version_id: VERSION,
    };
    const service = createCapaActionPlanWorkspaceDraftService({
      ...base.dependencies,
      return_cycle_resolver: { resolve: vi.fn(async () => ({ status: "active", cycle })) },
    } as any);
    const actionPlan = { items: [], effectiveness_checks: [] };
    const result = await service.save({
      capa_case_id: CASE,
      body: { expected_draft_revision: null, action_plan: actionPlan, action_plan_return_response: { response_narrative: "The returned review comments were addressed." } },
      request_trace: trace,
    });
    expect(result).toMatchObject({
      status: "saved",
      workspace: {
        action_plan: actionPlan,
        action_plan_return_response: {
          response_narrative: "The returned review comments were addressed.",
          return_transition_audit_event_id: cycle.return_transition_audit_event_id,
          source_case_version_id: cycle.source_case_version_id,
          resulting_case_version_id: cycle.resulting_case_version_id,
          responded_by: { actor_type: "human", actor_id: USER },
          responded_at: NOW.toISOString(),
        },
      },
    });
  });

  it("rejects client-owned envelope fields and invalid workflow state before persistence", async () => {
    const test = setup();
    await expect(test.service.save({ capa_case_id: CASE, body: { ...body, organization_id: ORG }, request_trace: trace })).resolves.toMatchObject({ status: "validation_failed", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" });
    const nonS60 = setup({ findCaseById: vi.fn(async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: VERSION, status: "S50", record_version: 4 })), findCaseVersionById: vi.fn(async () => ({ organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, version_number: 4, status: "S50" })) });
    await expect(nonS60.service.load({ capa_case_id: CASE })).resolves.toEqual({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" });
    await expect(nonS60.service.save({ capa_case_id: CASE, body, request_trace: trace })).resolves.toEqual({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" });
  });

  it("maps authorization, case, and revision conflicts without invoking readiness", async () => {
    const denied = setup();
    const deniedService = createCapaActionPlanWorkspaceDraftService({ ...denied.dependencies, authorization_policy: { evaluate: vi.fn(async () => ({ decision: "deny", reason_code: "DENIED", policy_version: "p" })) } } as any);
    await expect(deniedService.save({ capa_case_id: CASE, body, request_trace: trace })).resolves.toMatchObject({ status: "authorization_denied", reason_code: "DENIED" });
    const changed = setup({ saveDraft: vi.fn(async () => ({ status: "case_changed" })) });
    await expect(changed.service.save({ capa_case_id: CASE, body, request_trace: trace })).resolves.toEqual({ status: "case_changed", reason_code: "WORKFLOW_MUTATION_DETECTED" });
    const conflict = setup({ saveDraft: vi.fn(async () => ({ status: "concurrency_conflict" })) });
    await expect(conflict.service.save({ capa_case_id: CASE, body, request_trace: trace })).resolves.toEqual({ status: "concurrency_conflict" });
  });
});
