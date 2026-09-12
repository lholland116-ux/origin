import { describe, expect, it, vi } from "vitest";
import type { CapaAuthorizationPolicy } from "../../lib/capa/authorization/capa-policy";
import { CAPA_ACTION_PLAN_SCHEMA_VERSION, CAPA_ACTION_PLAN_SECTION_TYPE } from "../../lib/capa/domain/capa-action-plan";
import { CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION } from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import { CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE, CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION } from "../../lib/capa/implementation/capa-implementation-review-baseline";
import { submitCapaImplementation, type SubmitCapaImplementationDependencies } from "../../lib/capa/application/submit-capa-implementation";
import { createCapaImplementationReturnCycleResolver } from "../../lib/capa/application/capa-implementation-return-cycle-resolver";
import type { CapaImplementationWorkspaceRecord } from "../../lib/database/repositories/capa-implementation-workspace-repository";
import type { CapaActionPlanReviewDecisionRepository, CapaActionPlanReviewDecisionTransactionReadRepository } from "../../lib/database/repositories/capa-action-plan-review-decision-repository";
import type { CapaRepository, CapaTransactionReadRepository } from "../../lib/database/repositories/capa-repository";
import type { AuditRepository } from "../../lib/database/repositories/audit-repository";
import type { CapaWorkflowIdempotencyRepository } from "../../lib/database/repositories/capa-workflow-idempotency-repository";
import type { TransactionContext, TransactionManager } from "../../lib/database/transactions";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const S70_VERSION = "30000000-0000-4000-8000-000000000001";
const S80_VERSION = "30000000-0000-4000-8000-000000000002";
const S90_VERSION = "30000000-0000-4000-8000-000000000003";
const ACTION_SECTION = "40000000-0000-4000-8000-000000000001";
const BASELINE_SECTION = "40000000-0000-4000-8000-000000000002";
const APPROVAL_AUDIT = "50000000-0000-4000-8000-000000000001";
const SUBMISSION_AUDIT = "50000000-0000-4000-8000-000000000002";
const USER = "60000000-0000-4000-8000-000000000001";
const EVIDENCE = "70000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const actionPlan = {
  items: [{
    item_id: "ACTION-1",
    action_type: "corrective",
    description: "Complete the approved implementation action.",
    linked_targets: [],
    owner_user_id: null,
    due_date: "2026-09-30",
    status: "approved",
    deliverable: "Validated completion record",
    implementation_evidence: "Training and validation evidence",
    dependency_item_ids: [],
    unintended_consequence_assessment: "Review unintended consequences.",
    effectiveness_check_required: false,
    draft_provenance: { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null },
  }],
  effectiveness_checks: [],
};

const evidence = {
  schema_version: CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
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
const secondEvidence = {
  ...evidence,
  evidence_id: "70000000-0000-4000-8000-000000000002",
  evidence_kind: "test_or_validation_result",
  description: "Validation result",
  source: {
    ...evidence.source,
    source_record_reference: "VAL-002",
    source_record_version: 2,
    artifact_reference: "artifact://VAL-002",
  },
};

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: "capa-implementation-workspace-draft-1.0.0",
    action_progress: [{
      approved_action_reference: "ACTION-1",
      owner_reported_status: "reported_complete",
      implementation_narrative: "Implemented exactly as approved.",
      blocked_reason: null,
      evidence: [evidence],
    }],
    implementation_review_return_response: null,
    ...overrides,
  };
}

function harness() {
  let currentCase: any = { organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-1", current_version_id: S80_VERSION, status: "S80", record_version: 8 };
  const sourceVersion: any = { organization_id: ORG, capa_case_id: CASE, case_version_id: S70_VERSION, version_number: 7, status: "S70", section_version_ids: [ACTION_SECTION] };
  const currentVersion: any = { organization_id: ORG, capa_case_id: CASE, case_version_id: S80_VERSION, version_number: 8, status: "S80", parent_version_id: S70_VERSION, section_version_ids: [ACTION_SECTION] };
  const actionSection: any = { organization_id: ORG, capa_case_id: CASE, section_version_id: ACTION_SECTION, section_type: CAPA_ACTION_PLAN_SECTION_TYPE, version_number: 1, schema_version: CAPA_ACTION_PLAN_SCHEMA_VERSION, content: actionPlan };
  const baseline = { source_case_version_id: S70_VERSION, approved_action_plan_section_id: ACTION_SECTION, approval_decision_reference: APPROVAL_AUDIT };
  const workspace: CapaImplementationWorkspaceRecord = {
    organization_id: ORG as never,
    capa_case_id: CASE as never,
    case_version_id: S80_VERSION as never,
    record_version: 8,
    workflow_state: "S80",
    approved_s70_baseline: baseline as never,
    draft_revision: 3,
    draft: draft() as never,
    created_by_user_id: USER as never,
    created_at: AT as never,
    updated_by_user_id: USER as never,
    updated_at: AT as never,
  };
  const decision: any = { organization_id: ORG, capa_case_id: CASE, source_case_version_id: S70_VERSION, action_plan_section_version_id: ACTION_SECTION, schema_version: "capa-action-plan-review-decision-1.0.0", decision: "approve", rationale: "Approved for implementation.", reviewer_user_id: USER, decided_at: AT, resulting_case_version_id: S80_VERSION, transition_audit_event_id: APPROVAL_AUDIT };
  let nextVersion: any = null;
  let materializedSection: any = null;
  let auditEvent: any = null;
  let fail: "section" | "version" | "audit" | null = null;
  let transactionActive = false;
  let sharedPoolReadsDuringTransaction = 0;
  const workflow = new Map<string, any>();
  const transactionManager: TransactionManager = {
    async runInTransaction(_trace, work) {
      const before = { currentCase, nextVersion, materializedSection, auditEvent, workflow: new Map(workflow) };
      transactionActive = true;
      try {
        return await work({ transaction_id: "80000000-0000-4000-8000-000000000001" as never, started_at: AT as never, request_trace: _trace });
      } catch (error) {
        currentCase = before.currentCase;
        nextVersion = before.nextVersion;
        materializedSection = before.materializedSection;
        auditEvent = before.auditEvent;
        workflow.clear();
        for (const [key, value] of before.workflow) workflow.set(key, value);
        throw error;
      } finally {
        transactionActive = false;
      }
    },
  };
  const capaRepository: CapaRepository & CapaTransactionReadRepository = {
    findCaseById: vi.fn(async () => currentCase),
    findCaseVersionById: vi.fn(async (_org, _case, id) => {
      if (transactionActive) {
        sharedPoolReadsDuringTransaction += 1;
        throw new Error("shared-pool case-version read attempted during transaction");
      }
      return id === S70_VERSION ? sourceVersion : id === S80_VERSION ? currentVersion : nextVersion;
    }),
    findCaseVersionByIdInTransaction: vi.fn(async (_tx, _org, _case, id) => id === S70_VERSION ? sourceVersion : id === S80_VERSION ? currentVersion : nextVersion),
    findSectionVersionById: vi.fn(async (_org, _case, id) => {
      if (transactionActive) {
        sharedPoolReadsDuringTransaction += 1;
        throw new Error("shared-pool section-version read attempted during transaction");
      }
      return id === ACTION_SECTION ? actionSection : id === BASELINE_SECTION ? materializedSection : null;
    }),
    findSectionVersionByIdInTransaction: vi.fn(async (_tx, _org, _case, id) => id === ACTION_SECTION ? actionSection : id === BASELINE_SECTION ? materializedSection : null),
    async insertSectionVersion(_tx: TransactionContext, value: any) { if (fail === "section") throw new Error("section failure"); materializedSection = value; },
    async insertCaseVersion(_tx: TransactionContext, value: any) { if (fail === "version") throw new Error("version failure"); nextVersion = value; },
    async advanceCurrentVersion(_tx: TransactionContext, input: any) {
      if (currentCase.record_version !== input.expected_record_version) return { status: "conflict", reason_code: "RECORD_VERSION_CONFLICT" };
      currentCase = { ...currentCase, current_version_id: input.next_current_version_id, status: input.next_status, record_version: currentCase.record_version + 1 };
      return { status: "updated", capa_case: currentCase };
    },
  } as unknown as CapaRepository & CapaTransactionReadRepository;
  const workspaceRepository = { findWorkspaceForUpdate: vi.fn(async () => workspace) } as any;
  const reviewRepository = {
    findDecision: vi.fn(async () => {
      if (transactionActive) {
        sharedPoolReadsDuringTransaction += 1;
        throw new Error("shared-pool review-decision read attempted during transaction");
      }
      return decision;
    }),
    findDecisionInTransaction: vi.fn(async () => decision),
  } as unknown as CapaActionPlanReviewDecisionRepository & CapaActionPlanReviewDecisionTransactionReadRepository;
  const auditRepository: AuditRepository = {
    async appendEvent(_tx, value) { if (fail === "audit") throw new Error("audit failure"); auditEvent = value; return { status: "appended", event_id: value.event_id }; },
    async findEventById() { return auditEvent; },
    async listEventsForAggregate() { return { events: [] }; },
  };
  const idempotencyRepository: CapaWorkflowIdempotencyRepository = {
    async findWorkflowOperation(_tx, input) { return workflow.get(`${input.organization_id}:${input.idempotency_key}`) ?? null; },
    async claimWorkflowOperation(_tx, value) {
      const key = `${value.organization_id}:${value.idempotency_key}`;
      const existing = workflow.get(key);
      if (existing === undefined) { workflow.set(key, value); return { status: "claimed", record: value }; }
      return existing.request_fingerprint === value.request_fingerprint ? { status: "already_claimed", record: existing } : { status: "conflict", record: existing, reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST" };
    },
  };
  const authorizationPolicy: CapaAuthorizationPolicy = { evaluate: vi.fn(async () => ({ decision: "allow" as const, reason_code: "ALLOWED" as never, policy_version: "test-policy", evaluated_at: AT as never, relied_on_role_assignment_ids: [] })) };
  const dependencies: SubmitCapaImplementationDependencies = {
    transaction_manager: transactionManager,
    capa_repository: capaRepository,
    audit_repository: auditRepository,
    workspace_repository: workspaceRepository,
    review_decision_repository: reviewRepository,
    return_cycle_resolver: createCapaImplementationReturnCycleResolver({
      capa_repository: capaRepository,
      implementation_review_decision_repository: {
        findDecision: reviewRepository.findDecision.bind(reviewRepository),
      } as any,
    }),
    workflow_idempotency_repository: idempotencyRepository,
    authorization_policy: authorizationPolicy,
    id_generator: { generateCaseVersionId: () => S90_VERSION as never, generateSectionVersionId: () => BASELINE_SECTION as never, generateAuditEventId: () => SUBMISSION_AUDIT as never, generateCapaCaseId: () => CASE as never },
    clock: { now: () => new Date(AT) },
    configuration: { workflow_version: "workflow-test", audit_schema_version: "audit-test", authorization_purpose: "CAPA_WORKFLOW_TRANSITION" as never },
  };
  const command = (key = "submission-1", revision = 3) => ({ authentication: { principal: { principal_type: "human", user_id: USER }, session_id: "90000000-0000-4000-8000-000000000001", authentication_method: "password", assurance_level: "aal1", authenticated_at: "2026-09-10T11:00:00.000Z", expires_at: "2026-09-10T13:00:00.000Z" } as any, tenant: { organization_id: ORG, access_grant_id: "91000000-0000-4000-8000-000000000001", access_path: "DEVELOPMENT_SINGLE_USER_TENANT", authorization_policy_version: "test-policy", resolved_at: AT, role_assignments: [] } as any, capa_case_id: CASE as never, request_trace: { request_id: "a0000000-0000-4000-8000-000000000001", correlation_id: "b0000000-0000-4000-8000-000000000001", idempotency_key: key }, body: { expected_draft_revision: revision } } as any);
  return { dependencies, command, get currentCase() { return currentCase; }, get nextVersion() { return nextVersion; }, get materializedSection() { return materializedSection; }, get auditEvent() { return auditEvent; }, set fail(value: "section" | "version" | "audit" | null) { fail = value; }, workspace, maximumConnections: 1, sharedPoolReadsDuringTransaction: () => sharedPoolReadsDuringTransaction, transactionReads: { caseVersion: (capaRepository.findCaseVersionByIdInTransaction as ReturnType<typeof vi.fn>), sectionVersion: (capaRepository.findSectionVersionByIdInTransaction as ReturnType<typeof vi.fn>), reviewDecision: (reviewRepository.findDecisionInTransaction as ReturnType<typeof vi.fn>) } };
}

describe("controlled S80 implementation submission", () => {
  it("resolves the approved baseline on the active max-one-connection transaction", async () => {
    const h = harness();

    const result = await submitCapaImplementation(h.dependencies, h.command("max-one-connection"));

    expect(result.status).toBe("submitted");
    expect(h.maximumConnections).toBe(1);
    expect(h.transactionReads.caseVersion).toHaveBeenCalledOnce();
    expect(h.transactionReads.reviewDecision).toHaveBeenCalledOnce();
    expect(h.transactionReads.sectionVersion).toHaveBeenCalledOnce();
    expect(h.sharedPoolReadsDuringTransaction()).toBe(0);
  });

  it("materializes the human-owned package, transitions to S90, and preserves lineage", async () => {
    const h = harness();
    const result = await submitCapaImplementation(h.dependencies, h.command());
    expect(result).toMatchObject({ status: "submitted", capa_case: { status: "S90" }, source_case_version_id: S80_VERSION, resulting_case_version_id: S90_VERSION, transition_audit_event_id: SUBMISSION_AUDIT });
    expect(h.materializedSection).toMatchObject({ section_type: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE, version_number: 1, schema_version: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION, created_by: { actor_type: "human", actor_id: USER } });
    expect(h.materializedSection.parent_version_id).toBeUndefined();
    expect(h.materializedSection.content).toMatchObject({ approved_s70_baseline: { source_case_version_id: S70_VERSION, approved_action_plan_section_id: ACTION_SECTION, approval_decision_reference: APPROVAL_AUDIT }, source_s80_case_version_id: S80_VERSION, resulting_s90_case_version_id: S90_VERSION, transition_audit_event_id: SUBMISSION_AUDIT, submitted_by_user_id: USER, source_s80_workspace_revision: 3, action_progress: [{ implementation_narrative: "Implemented exactly as approved.", evidence: [{ evidence_id: EVIDENCE, source: { artifact_reference: "artifact://TR-001", source_record_version: "1" } }] }] });
    expect(h.nextVersion).toMatchObject({ status: "S90", parent_version_id: S80_VERSION, section_version_ids: [ACTION_SECTION, BASELINE_SECTION] });
    expect(h.auditEvent).toMatchObject({ action: "SUBMIT_CAPA_IMPLEMENTATION", actor: { actor_type: "human", actor_id: USER }, target: { object_version_id: S90_VERSION }, metadata: { implementation_review_baseline_section_version_id: BASELINE_SECTION, from_state: "S80", to_state: "S90" } });
  });

  it("preserves multiple evidence/provenance records and isolates the immutable snapshot from later workspace edits", async () => {
    const h = harness();
    const originalProgress = (h.workspace.draft as any).action_progress[0];
    (h.workspace as any).draft = draft({
      action_progress: [{
        ...originalProgress,
        evidence: [evidence, secondEvidence],
      }],
    });

    const result = await submitCapaImplementation(h.dependencies, h.command("snapshot"));

    expect(result.status).toBe("submitted");
    expect(h.materializedSection.content.action_progress[0].evidence).toHaveLength(2);
    expect(h.materializedSection.content.action_progress[0].evidence[1]).toMatchObject({
      evidence_id: secondEvidence.evidence_id,
      source: secondEvidence.source,
    });
    expect(JSON.stringify(h.materializedSection.content)).not.toContain("advisory");

    (h.workspace as any).draft = draft({
      action_progress: [{
        ...originalProgress,
        implementation_narrative: "A later mutable workspace edit.",
        evidence: [],
      }],
    });
    expect(h.materializedSection.content.action_progress[0].implementation_narrative).toBe("Implemented exactly as approved.");
    expect(h.materializedSection.content.action_progress[0].evidence).toHaveLength(2);
  });

  it("accepts first-entry null return response and rejects a stale workspace revision", async () => {
    const h = harness();
    const result = await submitCapaImplementation(h.dependencies, h.command("submission-null", 3));
    expect(result.status).toBe("submitted");
    const replay = await submitCapaImplementation(h.dependencies, h.command("submission-null", 3));
    expect(replay).toMatchObject({ status: "already_submitted" });
    const stale = harness();
    const staleResult = await submitCapaImplementation(stale.dependencies, stale.command("submission-stale", 2));
    expect(staleResult).toMatchObject({ status: "concurrency_conflict", reason_code: "WORKSPACE_DRAFT_REVISION_CONFLICT" });
    expect(stale.materializedSection).toBeNull();
    expect(stale.currentCase.status).toBe("S80");
  });

  it.each(["section", "version", "audit"] as const)("rolls back all controlled writes when %s materialization fails", async (failure) => {
    const h = harness();
    h.fail = failure;
    await expect(submitCapaImplementation(h.dependencies, h.command(`failure-${failure}`))).rejects.toThrow(`${failure === "section" ? "section" : failure === "version" ? "version" : "audit"} failure`);
    expect(h.materializedSection).toBeNull();
    expect(h.nextVersion).toBeNull();
    expect(h.auditEvent).toBeNull();
    expect(h.currentCase).toMatchObject({ status: "S80", current_version_id: S80_VERSION, record_version: 8 });
    h.fail = null;
    await expect(submitCapaImplementation(h.dependencies, h.command(`failure-${failure}`))).resolves.toMatchObject({ status: "submitted" });
  });

  it("does not materialize an incomplete package", async () => {
    const h = harness();
    (h.workspace as any).draft = { ...h.workspace.draft, action_progress: [{ ...(h.workspace.draft.action_progress[0] as any), owner_reported_status: "in_progress" }] };
    const result = await submitCapaImplementation(h.dependencies, h.command("not-ready"));
    expect(result).toMatchObject({ status: "submission_blocked", blocker_codes: ["ACTION_NOT_REPORTED_COMPLETE"] });
    expect(h.materializedSection).toBeNull();
    expect(h.currentCase.status).toBe("S80");
  });

  it("rejects non-human, unauthorized, cross-organization, and cross-case submissions before materialization", async () => {
    const nonHuman = harness();
    const nonHumanCommand = nonHuman.command("non-human");
    (nonHumanCommand as any).authentication = {
      ...nonHumanCommand.authentication,
      principal: { principal_type: "service", user_id: USER },
    };
    await expect(submitCapaImplementation(nonHuman.dependencies, nonHumanCommand)).resolves.toMatchObject({ status: "authorization_denied" });
    expect(nonHuman.materializedSection).toBeNull();

    const unauthorized = harness();
    (unauthorized.dependencies.authorization_policy.evaluate as any).mockResolvedValue({ decision: "deny", reason_code: "DENIED", policy_version: "test-policy" });
    await expect(submitCapaImplementation(unauthorized.dependencies, unauthorized.command("unauthorized"))).resolves.toMatchObject({ status: "authorization_denied" });
    expect(unauthorized.materializedSection).toBeNull();

    const crossOrganization = harness();
    const crossOrganizationCommand = crossOrganization.command("cross-org");
    (crossOrganizationCommand as any).tenant = { ...crossOrganizationCommand.tenant, organization_id: "10000000-0000-4000-8000-000000000099" };
    await expect(submitCapaImplementation(crossOrganization.dependencies, crossOrganizationCommand)).resolves.toMatchObject({ status: "not_found_or_not_authorized" });
    expect(crossOrganization.materializedSection).toBeNull();

    const crossCase = harness();
    const crossCaseCommand = crossCase.command("cross-case");
    (crossCaseCommand as any).capa_case_id = "20000000-0000-4000-8000-000000000099";
    await expect(submitCapaImplementation(crossCase.dependencies, crossCaseCommand)).resolves.toMatchObject({ status: "not_found_or_not_authorized" });
    expect(crossCase.materializedSection).toBeNull();
  });
});
