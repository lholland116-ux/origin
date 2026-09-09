import { describe, expect, it, vi } from "vitest";
import {
  decideCapaActionPlanReview,
  type DecideCapaActionPlanReviewDependencies,
} from "../../lib/capa/application/decide-capa-action-plan-review";
import {
  CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
} from "../../lib/capa/domain/capa-action-plan-review-decision";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const RESULT = "40000000-0000-4000-8000-000000000002";
const ACTION_PLAN = "50000000-0000-4000-8000-000000000001";
const AUDIT = "60000000-0000-4000-8000-000000000001";
const NOW = "2026-09-09T12:00:00.000Z";

const actionPlan = {
  items: [{
    item_id: "A-1",
    action_type: "corrective",
    description: "Revise the controlled process.",
    linked_targets: [],
    owner_user_id: USER,
    due_date: "2026-10-01",
    status: "planned",
    deliverable: "Approved revised procedure.",
    implementation_evidence: "Training record and released procedure.",
    dependency_item_ids: [],
    unintended_consequence_assessment: "Assess downstream process impact.",
    effectiveness_check_required: false,
    draft_provenance: {
      source_type: "human",
      source_reference: null,
      adopted_by_user_id: null,
      adopted_at: null,
    },
  }],
  effectiveness_checks: [],
};

function command(overrides: Record<string, unknown> = {}) {
  return {
    authentication: {
      principal: { principal_type: "human", user_id: USER },
      session_id: "70000000-0000-4000-8000-000000000001",
      authentication_method: "SUPABASE_SESSION",
      assurance_level: "MFA",
      authenticated_at: NOW,
      expires_at: "2026-09-10T12:00:00.000Z",
      reauthenticated_at: NOW,
    },
    tenant: {
      organization_id: ORG,
      access_grant_id: "grant",
      access_path: "ORGANIZATION",
      authorization_policy_version: "policy-1",
      resolved_at: NOW,
      role_assignments: [],
    },
    capa_case_id: CASE,
    expected_record_version: 7,
    expected_current_version_id: SOURCE,
    request_trace: {
      request_id: "80000000-0000-4000-8000-000000000001",
      correlation_id: "90000000-0000-4000-8000-000000000001",
      idempotency_key: "review-1",
    },
    body: {
      schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
      source_case_version_id: SOURCE,
      action_plan_section_version_id: ACTION_PLAN,
      decision: "approve",
      rationale: "The submitted action plan is suitable for implementation.",
    },
    ...overrides,
  } as any;
}

function harness(options: {
  policy?: unknown;
  workflowState?: string;
  enforceSingleConnection?: boolean;
} = {}) {
  const currentCase: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_number: "CAPA-1",
    current_version_id: SOURCE,
    status: options.workflowState ?? "S70",
    record_version: 7,
    owner_user_id: USER,
    confidentiality: "CUSTOMER_CONFIDENTIAL",
    effective_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    updated_by: { actor_type: "human", actor_id: USER },
  };
  const sourceVersion: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: SOURCE,
    version_number: 7,
    parent_version_id: null,
    change_reason: "Submit action plan for review",
    status: "S70",
    section_version_ids: [ACTION_PLAN],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
  };
  const actionPlanSection: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: ACTION_PLAN,
    section_type: "CAPA.ACTION_PLAN",
    version_number: 1,
    schema_version: "capa-action-plan-1.0.0",
    content: actionPlan,
    change_reason: "Submit action plan for review",
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
  };
  const state: { resultVersion: any; audit: any; operation: any; decision: any } = {
    resultVersion: null,
    audit: null,
    operation: null,
    decision: null,
  };
  let transactionActive = false;
  const assertReadOutsideTransaction = () => {
    if (options.enforceSingleConnection && transactionActive) {
      throw new Error("base repository read attempted while transaction callback is active");
    }
  };
  const capaRepository: any = {
    findCaseById: vi.fn(async () => {
      assertReadOutsideTransaction();
      return { ...currentCase };
    }),
    findCaseVersionById: vi.fn(async (_org: string, _case: string, id: string) => {
      assertReadOutsideTransaction();
      return id === SOURCE ? sourceVersion : state.resultVersion;
    }),
    findSectionVersionById: vi.fn(async () => {
      assertReadOutsideTransaction();
      return actionPlanSection;
    }),
    insertCaseVersion: vi.fn(async (_transaction: unknown, version: any) => {
      state.resultVersion = version;
    }),
    advanceCurrentVersion: vi.fn(async () => {
      const updated = {
        ...currentCase,
        current_version_id: RESULT,
        status: state.resultVersion.status,
        record_version: 8,
      };
      Object.assign(currentCase, updated);
      return { status: "updated", capa_case: updated };
    }),
  };
  const auditRepository: any = {
    findEventById: vi.fn(async () => {
      assertReadOutsideTransaction();
      return state.audit;
    }),
    appendEvent: vi.fn(async (_transaction: unknown, audit: any) => {
      state.audit = audit;
      return { status: "appended", event_id: audit.event_id };
    }),
  };
  const workflowRepository: any = {
    findWorkflowOperation: vi.fn(async () => state.operation),
    claimWorkflowOperation: vi.fn(async (_transaction: unknown, record: any) => {
      if (state.operation !== null) return { status: "already_claimed", record: state.operation };
      state.operation = record;
      return { status: "claimed", record };
    }),
  };
  const reviewDecisionRepository: any = {
    findDecision: vi.fn(async () => state.decision),
    saveDecision: vi.fn(async (_transaction: unknown, decision: any) => {
      if (state.decision !== null) {
        return { status: "conflict", reason_code: "DECISION_ALREADY_COMMITTED", decision: state.decision };
      }
      state.decision = decision;
      return { status: "saved", decision };
    }),
  };
  const dependencies: DecideCapaActionPlanReviewDependencies = {
    transaction_manager: {
      runInTransaction: vi.fn(async (_trace, work) => {
        transactionActive = true;
        const stateSnapshot = { ...state };
        const caseSnapshot = { ...currentCase };
        try {
          return await work({ transaction_id: "tx-1" as never, started_at: NOW as never, request_trace: {} as never });
        } catch (error) {
          Object.assign(state, stateSnapshot);
          Object.assign(currentCase, caseSnapshot);
          throw error;
        } finally {
          transactionActive = false;
        }
      }),
    },
    capa_repository: capaRepository,
    audit_repository: auditRepository,
    review_decision_repository: reviewDecisionRepository,
    workflow_idempotency_repository: workflowRepository,
    authorization_policy: {
      evaluate: vi.fn(async () => options.policy ?? {
        decision: "allow",
        reason_code: "AUTHORIZED",
        policy_version: "policy-1",
        evaluated_at: NOW,
        relied_on_role_assignment_ids: ["role-1"],
      }) as never,
    },
    id_generator: {
      generateCapaCaseId: () => CASE as never,
      generateCaseVersionId: () => RESULT as never,
      generateSectionVersionId: () => ACTION_PLAN as never,
      generateAuditEventId: () => AUDIT as never,
    },
    clock: { now: () => new Date(NOW) },
    configuration: {
      workflow_version: "workflow-1",
      audit_schema_version: "audit-1",
      step_up_maximum_age_ms: 900_000,
      required_step_up_assurance: "MFA" as never,
      authorization_purpose: "CAPA_GATE_DECISION" as never,
    },
  };
  return { dependencies, state, currentCase, capaRepository, auditRepository, workflowRepository, reviewDecisionRepository };
}

describe("decideCapaActionPlanReview", () => {
  it("approves S70 to S80 and persists the exact submitted baseline, decision, and audit", async () => {
    const test = harness();
    const result = await decideCapaActionPlanReview(test.dependencies, command());
    expect(result).toMatchObject({
      status: "decided",
      decision: "approve",
      workflow_state: "S80",
      record_version: 8,
      resulting_case_version_id: RESULT,
    });
    expect(test.state.resultVersion).toMatchObject({ status: "S80", parent_version_id: SOURCE, section_version_ids: [ACTION_PLAN] });
    expect(test.state.decision).toMatchObject({
      decision: "approve",
      source_case_version_id: SOURCE,
      action_plan_section_version_id: ACTION_PLAN,
      resulting_case_version_id: RESULT,
      transition_audit_event_id: AUDIT,
      reviewer_user_id: USER,
    });
    expect(test.state.audit).toMatchObject({
      event_type: "EVT-STATE-TRANSITION",
      metadata: {
        from_state: "S70",
        to_state: "S80",
        transition_event: "Approve action plan",
        review_decision: "approve",
        action_plan_section_version_id: ACTION_PLAN,
      },
    });
  });

  it("returns S70 to S60 while preserving the submitted action-plan section", async () => {
    const test = harness();
    const result = await decideCapaActionPlanReview(test.dependencies, command({
      request_trace: { ...command().request_trace, idempotency_key: "return-1" },
      body: { ...command().body, decision: "return", rationale: "The plan needs revision before implementation." },
    }));
    expect(result).toMatchObject({ status: "decided", decision: "return", workflow_state: "S60", record_version: 8 });
    expect(test.state.resultVersion).toMatchObject({ status: "S60", section_version_ids: [ACTION_PLAN], parent_version_id: SOURCE });
    expect(test.state.decision).toMatchObject({ decision: "return", action_plan_section_version_id: ACTION_PLAN });
    expect(test.state.audit).toMatchObject({ metadata: { from_state: "S70", to_state: "S60", transition_event: "Return for action planning" } });
  });

  it("replays exactly without base reads while its transaction callback is active", async () => {
    const test = harness({ enforceSingleConnection: true });
    const request = command();
    await expect(decideCapaActionPlanReview(test.dependencies, request)).resolves.toMatchObject({ status: "decided" });
    const insertCount = test.capaRepository.insertCaseVersion.mock.calls.length;
    const auditCount = test.auditRepository.appendEvent.mock.calls.length;
    await expect(decideCapaActionPlanReview(test.dependencies, request)).resolves.toMatchObject({ status: "already_decided", workflow_state: "S80" });
    expect(test.capaRepository.insertCaseVersion).toHaveBeenCalledTimes(insertCount);
    expect(test.auditRepository.appendEvent).toHaveBeenCalledTimes(auditCount);
  });

  it("rejects a reused idempotency key with a different decision", async () => {
    const test = harness();
    await decideCapaActionPlanReview(test.dependencies, command());
    const result = await decideCapaActionPlanReview(test.dependencies, command({
      body: { ...command().body, decision: "return", rationale: "The plan needs revision before implementation." },
    }));
    expect(result).toEqual({ status: "idempotency_conflict", reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" });
  });

  it("rolls back the controlled writes when a different committed decision wins", async () => {
    const test = harness();
    test.state.decision = {
      organization_id: ORG,
      capa_case_id: CASE,
      source_case_version_id: SOURCE,
      action_plan_section_version_id: ACTION_PLAN,
      schema_version: CAPA_ACTION_PLAN_REVIEW_DECISION_SCHEMA_VERSION,
      decision: "approve",
      rationale: "A prior reviewer decision.",
      reviewer_user_id: USER,
      decided_at: NOW,
      resulting_case_version_id: RESULT,
      transition_audit_event_id: AUDIT,
    };
    await expect(decideCapaActionPlanReview(test.dependencies, command({
      request_trace: { ...command().request_trace, idempotency_key: "different-key" },
    }))).resolves.toEqual({ status: "workflow_conflict", reason_code: "DECISION_ALREADY_COMMITTED" });
    expect(test.state.resultVersion).toBeNull();
    expect(test.state.audit).toBeNull();
    expect(test.state.operation).toBeNull();
    expect(test.currentCase).toMatchObject({ status: "S70", record_version: 7, current_version_id: SOURCE });
  });

  it("maps aggregate and audit conflicts without leaving a partial transition", async () => {
    const aggregateConflict = harness();
    aggregateConflict.capaRepository.advanceCurrentVersion.mockResolvedValue({ status: "conflict", reason_code: "CURRENT_VERSION_CONFLICT" });
    await expect(decideCapaActionPlanReview(aggregateConflict.dependencies, command())).resolves.toEqual({ status: "concurrency_conflict", reason_code: "CURRENT_VERSION_CONFLICT" });
    expect(aggregateConflict.state.resultVersion).toBeNull();
    expect(aggregateConflict.state.operation).toBeNull();

    const auditConflict = harness();
    auditConflict.auditRepository.appendEvent.mockRejectedValueOnce(new Error("audit conflict"));
    await expect(decideCapaActionPlanReview(auditConflict.dependencies, command())).rejects.toThrow("audit conflict");
    expect(auditConflict.state.resultVersion).toBeNull();
    expect(auditConflict.state.operation).toBeNull();
    expect(auditConflict.state.decision).toBeNull();
  });

  it("fails closed for a non-S70 workflow and malformed or mismatched baselines", async () => {
    const nonS70 = harness({ workflowState: "S60" });
    await expect(decideCapaActionPlanReview(nonS70.dependencies, command())).resolves.toEqual({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" });
    const malformed = harness();
    await expect(decideCapaActionPlanReview(malformed.dependencies, command({ body: { decision: "approve" } }))).resolves.toMatchObject({ status: "validation_failed" });
    const mismatched = harness();
    await expect(decideCapaActionPlanReview(mismatched.dependencies, command({ body: { ...command().body, action_plan_section_version_id: "50000000-0000-4000-8000-000000000099" } }))).resolves.toMatchObject({ status: "validation_failed", reason_code: "REVIEW_BASELINE_NOT_AUTHORITATIVE" });
    expect(mismatched.capaRepository.insertCaseVersion).not.toHaveBeenCalled();
  });

  it("maps stale aggregate, policy, and non-human failures without mutation", async () => {
    const stale = harness();
    const staleRequest = command({ expected_record_version: 6, body: { ...command().body } });
    await expect(decideCapaActionPlanReview(stale.dependencies, staleRequest)).resolves.toEqual({ status: "concurrency_conflict", reason_code: "RECORD_VERSION_CONFLICT" });
    const denied = harness({ policy: { decision: "deny", reason_code: "DENIED", policy_version: "policy-1" } });
    await expect(decideCapaActionPlanReview(denied.dependencies, command())).resolves.toMatchObject({ status: "authorization_denied", reason_code: "DENIED" });
    const nonHuman = harness();
    const serviceCommand = command({ authentication: { ...command().authentication, principal: { principal_type: "service", service_identity_id: USER } } });
    await expect(decideCapaActionPlanReview(nonHuman.dependencies, serviceCommand)).resolves.toMatchObject({ status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED" });
  });
});
