import { describe, expect, it, vi } from "vitest";
import {
  decideCapaImplementationReview,
  type DecideCapaImplementationReviewDependencies,
} from "../../lib/capa/application/decide-capa-implementation-review";
import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
} from "../../lib/capa/domain/capa-implementation-review-decision";
import {
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
} from "../../lib/capa/implementation/capa-implementation-review-baseline";
import type { TransactionManager } from "../../lib/database/transactions";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const S80 = "40000000-0000-4000-8000-000000000001";
const S90 = "40000000-0000-4000-8000-000000000002";
const RESULT = "40000000-0000-4000-8000-000000000003";
const BASELINE = "50000000-0000-4000-8000-000000000001";
const ACTION = "50000000-0000-4000-8000-000000000002";
const SUBMISSION_AUDIT = "60000000-0000-4000-8000-000000000001";
const REVIEW_AUDIT = "60000000-0000-4000-8000-000000000002";
const EVIDENCE = "70000000-0000-4000-8000-000000000001";
const NOW = "2026-09-11T12:00:00.000Z";

const evidence = {
  schema_version: "capa-implementation-evidence-1.0.0",
  evidence_id: EVIDENCE,
  approved_action_reference: "ACTION-1",
  evidence_kind: "training_record",
  description: "Training completion record",
  evidence_date: "2026-09-10",
  source: {
    origin_kind: "uploaded_artifact",
    source_system_kind: "other",
    source_system_name: "Document store",
    source_record_reference: "TR-001",
    source_record_version: "1",
    artifact_reference: "artifact://TR-001",
  },
};

const baselineContent = {
  approved_s70_baseline: {
    source_case_version_id: "40000000-0000-4000-8000-000000000010",
    approved_action_plan_section_id: ACTION,
    approval_decision_reference: "60000000-0000-4000-8000-000000000010",
  },
  source_s80_case_version_id: S80,
  source_s80_workspace_revision: 3,
  resulting_s90_case_version_id: S90,
  transition_audit_event_id: SUBMISSION_AUDIT,
  submitted_by_user_id: USER,
  submitted_at: NOW,
  action_progress: [{
    approved_action_reference: "ACTION-1",
    owner_reported_status: "reported_complete",
    implementation_narrative: "Implemented exactly as approved.",
    blocked_reason: null,
    evidence: [evidence],
  }],
};

function command(overrides: Record<string, unknown> = {}) {
  const base = {
    authentication: {
      principal: { principal_type: "human", user_id: USER },
      session_id: "80000000-0000-4000-8000-000000000001",
      authentication_method: "SUPABASE_SESSION",
      assurance_level: "MFA",
      authenticated_at: NOW,
      expires_at: "2026-09-12T12:00:00.000Z",
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
    expected_record_version: 9,
    expected_current_version_id: S90,
    request_trace: {
      request_id: "90000000-0000-4000-8000-000000000001",
      correlation_id: "90000000-0000-4000-8000-000000000001",
      idempotency_key: "review-1",
    },
    body: {
      schema_version: CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
      source_case_version_id: S90,
      implementation_review_baseline_section_version_id: BASELINE,
      decision: "accept",
      rationale: "The implementation evidence is sufficient.",
    },
  };
  return {
    ...base,
    ...overrides,
  } as any;
}

function harness(options: {
  sourceState?: string;
  caseState?: string;
  policy?: unknown;
  baseline?: unknown;
  fail?: "case-version" | "audit" | "decision";
} = {}) {
  const currentCase: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_number: "CAPA-1",
    current_version_id: S90,
    status: options.caseState ?? "S90",
    record_version: 9,
    owner_user_id: USER,
    confidentiality: "CUSTOMER_CONFIDENTIAL",
    effective_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    updated_by: { actor_type: "human", actor_id: USER },
  };
  const parentVersion: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: S80,
    version_number: 8,
    parent_version_id: "40000000-0000-4000-8000-000000000000",
    change_reason: "Submit implementation for review",
    status: "S80",
    section_version_ids: [ACTION],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
  };
  const sourceVersion: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: S90,
    version_number: 9,
    parent_version_id: S80,
    change_reason: "Submit implementation for review",
    status: options.sourceState ?? "S90",
    section_version_ids: [ACTION, BASELINE],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
  };
  const baselineSection: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: BASELINE,
    section_type: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
    version_number: 1,
    schema_version: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
    content: options.baseline ?? baselineContent,
    change_reason: "Submit implementation for review",
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
  };
  const actionSection: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    section_version_id: ACTION,
    section_type: "CAPA.ACTION_PLAN",
    version_number: 1,
    schema_version: "capa-action-plan-1.0.0",
    content: {},
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
  };
  const state: {
    resultVersion: any;
    audit: any;
    operation: any;
    decision: any;
  } = { resultVersion: null, audit: null, operation: null, decision: null };
  let transactionActive = false;
  let sharedPoolReadsDuringTransaction = 0;

  const ordinaryRead = <T>(value: T) => {
    if (transactionActive) sharedPoolReadsDuringTransaction += 1;
    return value;
  };
  const capaRepository: any = {
    findCaseById: vi.fn(async (organizationId: string) =>
      ordinaryRead(organizationId === ORG ? { ...currentCase } : null)),
    findCaseVersionById: vi.fn(async (
      organizationId: string,
      _caseId: string,
      versionId: string,
    ) => {
      if (organizationId !== ORG) return ordinaryRead(null);
      return ordinaryRead(
        versionId === S90
          ? sourceVersion
          : versionId === S80
            ? parentVersion
            : state.resultVersion,
      );
    }),
    findSectionVersionById: vi.fn(async (
      organizationId: string,
      _caseId: string,
      sectionId: string,
    ) => ordinaryRead(
      organizationId !== ORG
        ? null
        : sectionId === BASELINE
          ? baselineSection
          : actionSection,
    )),
    findCaseVersionByIdInTransaction: vi.fn(async (
      _transaction: unknown,
      organizationId: string,
      _caseId: string,
      versionId: string,
    ) => organizationId !== ORG
      ? null
      : versionId === S90
        ? sourceVersion
        : versionId === S80
          ? parentVersion
          : state.resultVersion),
    findSectionVersionByIdInTransaction: vi.fn(async (
      _transaction: unknown,
      organizationId: string,
      _caseId: string,
      sectionId: string,
    ) => organizationId !== ORG
      ? null
      : sectionId === BASELINE
        ? baselineSection
        : actionSection),
    insertCaseVersion: vi.fn(async (_transaction: unknown, version: any) => {
      if (options.fail === "case-version") throw new Error("case version failure");
      state.resultVersion = version;
    }),
    advanceCurrentVersion: vi.fn(async () => {
      if (options.fail === "case-version") throw new Error("advance failure");
      const updated = {
        ...currentCase,
        current_version_id: RESULT,
        status: state.resultVersion.status,
        record_version: 10,
      };
      Object.assign(currentCase, updated);
      return { status: "updated", capa_case: updated };
    }),
  };
  const auditRepository: any = {
    findEventById: vi.fn(async () => ordinaryRead(state.audit)),
    appendEvent: vi.fn(async (_transaction: unknown, event: any) => {
      if (options.fail === "audit") throw new Error("audit failure");
      state.audit = event;
      return { status: "appended", event_id: event.event_id };
    }),
  };
  const workflowRepository: any = {
    findWorkflowOperation: vi.fn(async () => state.operation),
    claimWorkflowOperation: vi.fn(async (_transaction: unknown, record: any) => {
      if (state.operation !== null) {
        return { status: "already_claimed", record: state.operation };
      }
      state.operation = record;
      return { status: "claimed", record };
    }),
  };
  const reviewDecisionRepository: any = {
    findDecision: vi.fn(async () => ordinaryRead(state.decision)),
    findDecisionInTransaction: vi.fn(async () => state.decision),
    saveDecision: vi.fn(async (_transaction: unknown, decision: any) => {
      if (options.fail === "decision") throw new Error("decision failure");
      if (state.decision !== null) {
        return {
          status: "conflict",
          reason_code: "DECISION_ALREADY_COMMITTED",
          decision: state.decision,
        };
      }
      state.decision = decision;
      return { status: "saved", decision };
    }),
  };
  const transactionManager: TransactionManager = {
    runInTransaction: vi.fn(async (_trace, work) => {
      transactionActive = true;
      const stateSnapshot = { ...state };
      const caseSnapshot = { ...currentCase };
      try {
        return await work({
          transaction_id: "tx-1" as never,
          started_at: NOW as never,
          request_trace: {} as never,
        });
      } catch (error) {
        Object.assign(state, stateSnapshot);
        Object.assign(currentCase, caseSnapshot);
        throw error;
      } finally {
        transactionActive = false;
      }
    }),
  };
  const dependencies: DecideCapaImplementationReviewDependencies = {
    transaction_manager: transactionManager,
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
      generateSectionVersionId: () => BASELINE as never,
      generateAuditEventId: () => REVIEW_AUDIT as never,
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
  return {
    dependencies,
    state,
    currentCase,
    capaRepository,
    auditRepository,
    reviewDecisionRepository,
    workflowRepository,
    sharedPoolReadsDuringTransaction: () => sharedPoolReadsDuringTransaction,
  };
}

describe("decideCapaImplementationReview", () => {
  it("accepts S90 to S100 and persists the decision and audit", async () => {
    const test = harness();
    const result = await decideCapaImplementationReview(test.dependencies, command());
    expect(result).toMatchObject({
      status: "decided",
      decision: "accept",
      workflow_state: "S100",
      resulting_case_version_id: RESULT,
    });
    expect(test.state.resultVersion).toMatchObject({
      status: "S100",
      parent_version_id: S90,
      section_version_ids: [ACTION, BASELINE],
    });
    expect(test.state.decision).toMatchObject({
      decision: "accept",
      source_case_version_id: S90,
      implementation_review_baseline_section_version_id: BASELINE,
      resulting_case_version_id: RESULT,
    });
    expect(test.state.audit).toMatchObject({
      action: "DECIDE_CAPA_IMPLEMENTATION_REVIEW",
      metadata: { from_state: "S90", to_state: "S100" },
    });
  });

  it("returns S90 to S80", async () => {
    const test = harness();
    const result = await decideCapaImplementationReview(test.dependencies, command({
      request_trace: { ...command().request_trace, idempotency_key: "return-1" },
      body: { ...command().body, decision: "return", rationale: "Implementation needs more work." },
    }));
    expect(result).toMatchObject({ status: "decided", decision: "return", workflow_state: "S80" });
    expect(test.state.resultVersion).toMatchObject({ status: "S80", parent_version_id: S90 });
  });

  it("requires the exact expected S90 source in the decision body", async () => {
    const test = harness();
    const result = await decideCapaImplementationReview(test.dependencies, command({
      body: { ...command().body, source_case_version_id: S80 },
    }));
    expect(result).toMatchObject({ status: "validation_failed", reason_code: "REVIEW_BASELINE_NOT_AUTHORITATIVE" });
    expect(test.state.resultVersion).toBeNull();
  });

  it("rejects a source workflow state that is not S90", async () => {
    const test = harness({ sourceState: "S80", caseState: "S80" });
    await expect(decideCapaImplementationReview(test.dependencies, command())).resolves.toEqual({
      status: "workflow_conflict",
      reason_code: "WORKFLOW_STATE_NOT_ALLOWED",
    });
  });

  it("rejects an unauthorized reviewer", async () => {
    const test = harness({ policy: { decision: "deny", reason_code: "DENIED", policy_version: "policy-1" } });
    await expect(decideCapaImplementationReview(test.dependencies, command())).resolves.toMatchObject({ status: "authorization_denied", reason_code: "DENIED" });
  });

  it("requires a valid step-up", async () => {
    const test = harness();
    const request = command({ authentication: { ...command().authentication, reauthenticated_at: undefined } });
    await expect(decideCapaImplementationReview(test.dependencies, request)).resolves.toMatchObject({ status: "step_up_required" });
  });

  it("enforces the human-only accept_implementation operation", async () => {
    const test = harness();
    const request = command({ authentication: { ...command().authentication, principal: { principal_type: "service", service_identity_id: USER } } });
    await expect(decideCapaImplementationReview(test.dependencies, request)).resolves.toMatchObject({ status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED" });
  });

  it.each(["accept", "return"] as const)("uses accept_implementation for the human consequential %s policy check", async (decision) => {
    const test = harness();
    await decideCapaImplementationReview(test.dependencies, command({ body: { ...command().body, decision } }));
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenCalledWith(expect.objectContaining({ operation: "accept_implementation" }));
  });

  it("commits the decision, resulting version, and audit as one transition", async () => {
    const test = harness();
    await expect(decideCapaImplementationReview(test.dependencies, command())).resolves.toMatchObject({ status: "decided" });
    expect(test.state).toMatchObject({ resultVersion: expect.any(Object), audit: expect.any(Object), decision: expect.any(Object), operation: expect.any(Object) });
  });

  it("replays an exact retry without a second transition", async () => {
    const test = harness();
    await decideCapaImplementationReview(test.dependencies, command());
    const inserts = test.capaRepository.insertCaseVersion.mock.calls.length;
    const audits = test.auditRepository.appendEvent.mock.calls.length;
    await expect(decideCapaImplementationReview(test.dependencies, command())).resolves.toMatchObject({ status: "already_decided", workflow_state: "S100" });
    expect(test.capaRepository.insertCaseVersion).toHaveBeenCalledTimes(inserts);
    expect(test.auditRepository.appendEvent).toHaveBeenCalledTimes(audits);
  });

  it("does not create a second transition for a conflicting committed decision", async () => {
    const test = harness();
    test.state.decision = {
      organization_id: ORG,
      capa_case_id: CASE,
      source_case_version_id: S90,
      implementation_review_baseline_section_version_id: BASELINE,
      schema_version: CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
      decision: "return",
      rationale: "A prior reviewer returned this implementation.",
      reviewer_user_id: USER,
      decided_at: NOW,
      resulting_case_version_id: RESULT,
      transition_audit_event_id: REVIEW_AUDIT,
    };
    await expect(decideCapaImplementationReview(test.dependencies, command({ request_trace: { ...command().request_trace, idempotency_key: "different-key" } }))).resolves.toEqual({ status: "workflow_conflict", reason_code: "DECISION_ALREADY_COMMITTED" });
    expect(test.state.resultVersion).toBeNull();
    expect(test.state.audit).toBeNull();
    expect(test.state.operation).toBeNull();
  });

  it("does not misclassify unrelated persistence failures as idempotency conflicts", async () => {
    const test = harness({ fail: "decision" });
    await expect(decideCapaImplementationReview(test.dependencies, command())).rejects.toThrow("decision failure");
    expect(test.state.operation).toBeNull();
  });

  it("rolls back the idempotency claim and version when decision persistence fails", async () => {
    const test = harness({ fail: "decision" });
    await expect(decideCapaImplementationReview(test.dependencies, command())).rejects.toThrow();
    expect(test.state).toMatchObject({ operation: null, resultVersion: null, audit: null, decision: null });
    expect(test.currentCase).toMatchObject({ status: "S90", record_version: 9, current_version_id: S90 });
  });

  it("rolls back when case-version persistence fails", async () => {
    const test = harness({ fail: "case-version" });
    await expect(decideCapaImplementationReview(test.dependencies, command())).rejects.toThrow("case version failure");
    expect(test.state).toMatchObject({ operation: null, resultVersion: null, audit: null, decision: null });
  });

  it("rolls back when audit persistence fails", async () => {
    const test = harness({ fail: "audit" });
    await expect(decideCapaImplementationReview(test.dependencies, command())).rejects.toThrow("audit failure");
    expect(test.state).toMatchObject({ operation: null, resultVersion: null, audit: null, decision: null });
    expect(test.currentCase.status).toBe("S90");
  });

  it("preserves the immutable baseline section identifiers", async () => {
    const test = harness();
    await decideCapaImplementationReview(test.dependencies, command());
    expect(test.state.resultVersion.section_version_ids).toEqual([ACTION, BASELINE]);
    expect(test.state.resultVersion.section_version_ids).not.toContain(RESULT);
  });

  it("preserves reviewer rationale on return history", async () => {
    const test = harness();
    const rationale = "Return to implementation for additional validation evidence.";
    await decideCapaImplementationReview(test.dependencies, command({
      request_trace: { ...command().request_trace, idempotency_key: "return-rationale" },
      body: { ...command().body, decision: "return", rationale },
    }));
    expect(test.state.decision.rationale).toBe(rationale);
    expect(test.state.audit.reason).toBe(rationale);
  });

  it("does not create or mutate an S80 owner response", async () => {
    const test = harness();
    await decideCapaImplementationReview(test.dependencies, command({ body: { ...command().body, decision: "return", rationale: "Please address the remaining gap." } }));
    expect(test.state.resultVersion.section_version_ids).toEqual([ACTION, BASELINE]);
    expect(JSON.stringify(test.state.resultVersion)).not.toContain("return_response");
  });

  it("fails closed across tenant boundaries", async () => {
    const test = harness();
    await expect(decideCapaImplementationReview(test.dependencies, command({ tenant: { ...command().tenant, organization_id: OTHER_ORG } }))).resolves.toEqual({ status: "not_found_or_not_authorized" });
    expect(test.state.resultVersion).toBeNull();
  });

  it("rejects an AI actor even when the policy would otherwise allow", async () => {
    const test = harness();
    const request = command({ authentication: { ...command().authentication, principal: { principal_type: "ai", agent_id: "AG-IMPLEMENT" } } });
    await expect(decideCapaImplementationReview(test.dependencies, request)).resolves.toMatchObject({ status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED" });
    expect(test.state.resultVersion).toBeNull();
  });

  it("requires an authoritative immutable baseline", async () => {
    const test = harness({ baseline: { ...baselineContent, resulting_s90_case_version_id: S80 } });
    await expect(decideCapaImplementationReview(test.dependencies, command())).resolves.toEqual({ status: "validation_failed", reason_code: "REVIEW_BASELINE_NOT_AUTHORITATIVE" });
    expect(test.capaRepository.insertCaseVersion).not.toHaveBeenCalled();
  });

  it("uses transaction-scoped source, parent, baseline, and decision reads", async () => {
    const test = harness();
    await decideCapaImplementationReview(test.dependencies, command());
    expect(test.capaRepository.findCaseVersionByIdInTransaction).toHaveBeenCalledWith(expect.anything(), ORG, CASE, S90);
    expect(test.capaRepository.findCaseVersionByIdInTransaction).toHaveBeenCalledWith(expect.anything(), ORG, CASE, S80);
    expect(test.capaRepository.findSectionVersionByIdInTransaction).toHaveBeenCalledWith(expect.anything(), ORG, CASE, BASELINE);
    expect(test.reviewDecisionRepository.findDecisionInTransaction).toHaveBeenCalledWith(expect.anything(), ORG, CASE, S90);
    expect(test.sharedPoolReadsDuringTransaction()).toBe(0);
  });
});
