import { describe, expect, it, vi } from "vitest";
import {
  createCapaImplementationReviewProjectionService,
  type CapaImplementationReviewProjectionServiceDependencies,
} from "../../lib/capa/application/capa-implementation-review-projection-service";
import {
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE,
} from "../../lib/capa/implementation/capa-implementation-review-baseline";
import {
  CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
} from "../../lib/capa/domain/capa-implementation-review-decision";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const S60 = "40000000-0000-4000-8000-000000000001";
const S70 = "40000000-0000-4000-8000-000000000002";
const S80 = "40000000-0000-4000-8000-000000000003";
const S90 = "40000000-0000-4000-8000-000000000004";
const S80B = "40000000-0000-4000-8000-000000000005";
const S90A = "40000000-0000-4000-8000-000000000006";
const OTHER_USER = "20000000-0000-4000-8000-000000000002";
const ACTION = "50000000-0000-4000-8000-000000000001";
const BASELINE = "50000000-0000-4000-8000-000000000002";
const PRIOR_BASELINE = "50000000-0000-4000-8000-000000000003";
const RETURN_RESPONSE = "50000000-0000-4000-8000-000000000004";
const APPROVAL_AUDIT = "60000000-0000-4000-8000-000000000001";
const PRIOR_AUDIT = "60000000-0000-4000-8000-000000000002";
const SUBMISSION_AUDIT = "60000000-0000-4000-8000-000000000003";
const EVIDENCE = "70000000-0000-4000-8000-000000000001";
const NOW = "2026-09-11T12:00:00.000Z";

const actionPlan = {
  items: [{
    item_id: "ACTION-1",
    action_type: "corrective",
    description: "Complete the approved implementation action.",
    linked_targets: [],
    owner_user_id: USER,
    due_date: "2026-10-01",
    status: "approved",
    deliverable: "Validated completion record",
    implementation_evidence: "Training and validation evidence",
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

const approvedBaseline = {
  source_case_version_id: S70,
  approved_action_plan_section_id: ACTION,
  approval_decision_reference: APPROVAL_AUDIT,
};

function baselineContent(overrides: Record<string, unknown> = {}) {
  return {
    approved_s70_baseline: approvedBaseline,
    source_s80_case_version_id: S80,
    source_s80_workspace_revision: 3,
    resulting_s90_case_version_id: S90,
    transition_audit_event_id: "60000000-0000-4000-8000-000000000010",
    submitted_by_user_id: USER,
    submitted_at: NOW,
    action_progress: [{
      approved_action_reference: "ACTION-1",
      owner_reported_status: "reported_complete",
      implementation_narrative: "Implemented exactly as approved.",
      blocked_reason: null,
      evidence: [evidence],
    }],
    ...overrides,
  };
}

function decision(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    source_case_version_id: S70,
    action_plan_section_version_id: ACTION,
    schema_version: "capa-action-plan-review-decision-1.0.0",
    decision: "approve",
    rationale: "Approved for implementation.",
    reviewer_user_id: USER,
    decided_at: NOW,
    resulting_case_version_id: S80,
    transition_audit_event_id: APPROVAL_AUDIT,
    ...overrides,
  };
}

function approvalAudit(actorId = USER) {
  return {
    organization_id: ORG,
    event_id: APPROVAL_AUDIT,
    event_type: "EVT-STATE-TRANSITION",
    schema_version: "audit-1",
    aggregate_type: "CAPA_CASE",
    aggregate_id: CASE,
    aggregate_version: 8,
    actor: { actor_type: "human", actor_id: actorId },
    occurred_at: NOW,
    request_id: "80000000-0000-4000-8000-000000000001",
    correlation_id: "80000000-0000-4000-8000-000000000002",
    idempotency_key: "approve-action-plan",
    action: "DECIDE_CAPA_ACTION_PLAN_REVIEW",
    target: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S80 },
    outcome: "succeeded",
    reason: "Approved for implementation.",
    change: {
      before_ref: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S70 },
      after_ref: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S80 },
    },
    configuration_versions: {},
    metadata: {
      from_state: "S70",
      to_state: "S80",
      source_case_version_id: S70,
      resulting_case_version_id: S80,
      review_decision: "approve",
    },
  };
}

function commandContext(organizationId = ORG, userId = USER): any {
  return {
    authentication: {
      principal: { principal_type: "human", user_id: userId },
      session_id: "90000000-0000-4000-8000-000000000001",
      authentication_method: "SUPABASE_SESSION",
      assurance_level: "MFA",
      authenticated_at: NOW,
      expires_at: "2026-09-12T12:00:00.000Z",
      reauthenticated_at: NOW,
    },
    tenant: {
      organization_id: organizationId,
      access_grant_id: "grant",
      access_path: "ORGANIZATION",
      authorization_policy_version: "policy-1",
      resolved_at: NOW,
      role_assignments: [{
        role_assignment_id: "90000000-0000-4000-8000-000000000002",
        role_id: "CAPA_REVIEWER",
        scope: "ORGANIZATION",
        effective_at: "2026-09-01T00:00:00.000Z",
      }],
    },
    owner_user_id: USER,
  };
}

function harness(options: {
  caseStatus?: string;
  baseline?: unknown;
  sections?: string[];
  parentStatus?: string;
  policy?: unknown;
  history?: boolean;
  secondCycle?: boolean;
  approvalActorMismatch?: boolean;
  historyActorMismatch?: boolean;
} = {}) {
  const currentS80 = options.secondCycle ? S80B : S80;
  const currentRecordVersion = options.secondCycle ? 11 : 9;
  const capaCase: any = {
    organization_id: ORG,
    capa_case_id: CASE,
    case_number: "CAPA-1",
    current_version_id: S90,
    status: options.caseStatus ?? "S90",
    record_version: currentRecordVersion,
    owner_user_id: USER,
    confidentiality: "CUSTOMER_CONFIDENTIAL",
    effective_at: NOW,
    created_at: NOW,
    updated_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    updated_by: { actor_type: "human", actor_id: USER },
  };
  const versions = new Map<string, any>([
    [S60, { organization_id: ORG, capa_case_id: CASE, case_version_id: S60, version_number: 6, parent_version_id: null, change_reason: "Plan investigation", status: "S60", section_version_ids: [ACTION] }],
    [S70, { organization_id: ORG, capa_case_id: CASE, case_version_id: S70, version_number: 7, parent_version_id: S60, change_reason: "Submit action plan for review", status: "S70", section_version_ids: [ACTION] }],
    [S80, { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 8, parent_version_id: S70, change_reason: "Approve action plan", status: options.parentStatus ?? "S80", section_version_ids: [ACTION] }],
    [S90, { organization_id: ORG, capa_case_id: CASE, case_version_id: S90, version_number: currentRecordVersion, parent_version_id: currentS80, change_reason: "Submit implementation for review", status: "S90", section_version_ids: options.sections ?? [ACTION, BASELINE] }],
  ]);
  const sections = new Map<string, any>([
    [ACTION, { organization_id: ORG, capa_case_id: CASE, section_version_id: ACTION, section_type: "CAPA.ACTION_PLAN", version_number: 1, schema_version: "capa-action-plan-1.0.0", content: actionPlan }],
    [BASELINE, { organization_id: ORG, capa_case_id: CASE, section_version_id: BASELINE, section_type: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE, version_number: 1, schema_version: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION, content: options.baseline ?? baselineContent({ source_s80_case_version_id: currentS80 }) }],
  ]);
  const events = new Map<string, any>([[APPROVAL_AUDIT, approvalAudit(options.approvalActorMismatch ? OTHER_USER : USER)]]);
  const implementationDecisions = new Map<string, any>();
  if (options.history && options.secondCycle) {
    versions.set(S90A, { ...versions.get(S90), case_version_id: S90A, version_number: 9, parent_version_id: S80, status: "S90", section_version_ids: [ACTION, PRIOR_BASELINE] });
    versions.set(S80B, { ...versions.get(S80), case_version_id: S80B, version_number: 10, parent_version_id: S90A, status: "S80", section_version_ids: [ACTION, PRIOR_BASELINE] });
    versions.set(S90, { ...versions.get(S90), version_number: 11, parent_version_id: S80B });
    capaCase.record_version = 11;
    sections.set(PRIOR_BASELINE, { ...sections.get(BASELINE), section_version_id: PRIOR_BASELINE, content: baselineContent({ source_s80_case_version_id: S80, resulting_s90_case_version_id: S90A, transition_audit_event_id: PRIOR_AUDIT }) });
    sections.set(BASELINE, { ...sections.get(BASELINE), content: baselineContent({ source_s80_case_version_id: S80B, resulting_s90_case_version_id: S90, transition_audit_event_id: SUBMISSION_AUDIT }) });
    sections.set(RETURN_RESPONSE, {
      organization_id: ORG,
      capa_case_id: CASE,
      section_version_id: RETURN_RESPONSE,
      section_type: "CAPA.IMPLEMENTATION_REVIEW_RETURN_RESPONSE",
      version_number: 1,
      schema_version: "capa-implementation-review-return-response-1.0.0",
      content: {
        schema_version: "capa-implementation-review-return-response-1.0.0",
        response_narrative: "The owner addressed the reviewer return.",
        return_transition_audit_event_id: PRIOR_AUDIT,
        source_case_version_id: S90A,
        resulting_case_version_id: S80B,
        resubmitted_case_version_id: S90,
        responded_by: { actor_type: "human", actor_id: USER },
        responded_at: NOW,
      },
    });
    versions.set(S90, { ...versions.get(S90), section_version_ids: [ACTION, BASELINE, RETURN_RESPONSE] });
    implementationDecisions.set(S90A, {
      organization_id: ORG,
      capa_case_id: CASE,
      source_case_version_id: S90A,
      implementation_review_baseline_section_version_id: PRIOR_BASELINE,
      schema_version: CAPA_IMPLEMENTATION_REVIEW_DECISION_SCHEMA_VERSION,
      decision: "return",
      rationale: "Return for additional evidence.",
      reviewer_user_id: USER,
      decided_at: NOW,
      resulting_case_version_id: S80B,
      transition_audit_event_id: PRIOR_AUDIT,
    });
    events.set(PRIOR_AUDIT, {
      organization_id: ORG,
      event_id: PRIOR_AUDIT,
      event_type: "EVT-STATE-TRANSITION",
      schema_version: "audit-1",
      aggregate_type: "CAPA_CASE",
      aggregate_id: CASE,
      aggregate_version: 10,
      actor: { actor_type: "human", actor_id: options.historyActorMismatch ? OTHER_USER : USER },
      occurred_at: NOW,
      request_id: "80000000-0000-4000-8000-000000000003",
      correlation_id: "80000000-0000-4000-8000-000000000004",
      idempotency_key: "implementation-return-1",
      action: "DECIDE_CAPA_IMPLEMENTATION_REVIEW",
      target: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S80B },
      outcome: "succeeded",
      reason: "Return for additional evidence.",
      change: {
        before_ref: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S90A },
        after_ref: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S80B },
      },
      configuration_versions: {},
      metadata: {
        from_state: "S90",
        to_state: "S80",
        source_case_version_id: S90A,
        resulting_case_version_id: S80B,
        implementation_review_baseline_section_version_id: PRIOR_BASELINE,
        review_decision: "return",
      },
    });
    events.set(SUBMISSION_AUDIT, {
      organization_id: ORG,
      event_id: SUBMISSION_AUDIT,
      event_type: "EVT-STATE-TRANSITION",
      schema_version: "audit-1",
      aggregate_type: "CAPA_CASE",
      aggregate_id: CASE,
      aggregate_version: 11,
      actor: { actor_type: "human", actor_id: USER },
      occurred_at: NOW,
      request_id: "80000000-0000-4000-0000-000000000005",
      correlation_id: "80000000-0000-4000-8000-000000000006",
      idempotency_key: "implementation-submit-2",
      action: "SUBMIT_CAPA_IMPLEMENTATION",
      target: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S90 },
      outcome: "succeeded",
      change: { before_ref: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S80B }, after_ref: { object_type: "CAPA_CASE", object_id: CASE, object_version_id: S90 } },
      configuration_versions: {},
      metadata: {
        from_state: "S80",
        to_state: "S90",
        source_case_version_id: S80B,
        resulting_case_version_id: S90,
        implementation_review_baseline_section_version_id: BASELINE,
        implementation_review_return_response_section_version_id: RETURN_RESPONSE,
        workspace_draft_revision: 4,
      },
    });
  }
  const repository: any = {
    findCaseById: vi.fn(async (organizationId: string) => organizationId === ORG ? capaCase : null),
    findCaseVersionById: vi.fn(async (organizationId: string, _caseId: string, versionId: string) => organizationId === ORG ? versions.get(versionId) ?? null : null),
    findSectionVersionById: vi.fn(async (organizationId: string, _caseId: string, sectionId: string) => organizationId === ORG ? sections.get(sectionId) ?? null : null),
  };
  const auditRepository: any = {
    findEventById: vi.fn(async (organizationId: string, eventId: string) => organizationId === ORG ? events.get(eventId) ?? null : null),
    listEventsForAggregate: vi.fn(async () => ({ events: options.history && options.secondCycle ? [events.get(PRIOR_AUDIT), events.get(SUBMISSION_AUDIT)] : [], next_cursor: undefined })),
  };
  const policy = {
    evaluate: vi.fn(async () => options.policy ?? {
      decision: "allow",
      reason_code: "AUTHORIZED",
      policy_version: "policy-1",
      evaluated_at: NOW,
      relied_on_role_assignment_ids: ["90000000-0000-4000-8000-000000000002"],
    }),
  };
  const dependencies: CapaImplementationReviewProjectionServiceDependencies = {
    request_context: commandContext(),
    capa_repository: repository,
    action_plan_review_decision_repository: {
      findDecision: vi.fn(async () => decision()),
    } as any,
    implementation_review_decision_repository: {
      findDecision: vi.fn(async (_organizationId: string, _caseId: string, sourceId: string) => implementationDecisions.get(sourceId) ?? null),
    } as any,
    audit_repository: auditRepository,
    authorization_policy: policy as any,
    now: () => new Date(NOW),
    step_up_maximum_age_ms: 900_000,
    required_step_up_assurance: "MFA" as never,
  };
  return {
    service: createCapaImplementationReviewProjectionService(dependencies),
    dependencies,
    repository,
    auditRepository,
    versions,
    sections,
    capaCase,
  };
}

describe("Capa implementation review projection", () => {
  it("loads a valid S90 reviewer projection", async () => {
    const test = harness();
    const result = await test.service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved", projection: { workflow_state: "S90" } });
  });

  it("exposes the exact S90/current case identity", async () => {
    const result = await harness().service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved", projection: { organization_id: ORG, capa_case_id: CASE, record_version: 9, current_case_version_id: S90 } });
  });

  it("exposes the immutable CAPA implementation-review baseline", async () => {
    const result = await harness().service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved", projection: { implementation_review_baseline_section_version_id: BASELINE, implementation_review_baseline: { section_type: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SECTION_TYPE, schema_version: CAPA_IMPLEMENTATION_REVIEW_BASELINE_SCHEMA_VERSION } } });
  });

  it("verifies the source S80 to resulting S90 linkage", async () => {
    const result = await harness().service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved", projection: { submitted_implementation: { source_s80_case_version_id: S80, resulting_s90_case_version_id: S90 }, case_version: { parent_version_id: S80 } } });
  });

  it("exposes the approved S70 authority and approval decision", async () => {
    const result = await harness().service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved", projection: { approved_s70_baseline: { source_case_version_id: S70, reference: { approved_action_plan_section_id: ACTION, approval_decision_reference: APPROVAL_AUDIT }, approval_decision: { decision: "approve", resulting_case_version_id: S80 } } } });
  });

  it("exposes submitted implementation action progress", async () => {
    const result: any = await harness().service.load({ capa_case_id: CASE as never });
    expect(result.projection.submitted_implementation.action_progress[0]).toMatchObject({ approved_action_reference: "ACTION-1", implementation_narrative: "Implemented exactly as approved." });
  });

  it("preserves evidence and provenance", async () => {
    const result: any = await harness().service.load({ capa_case_id: CASE as never });
    expect(result.projection.submitted_implementation.action_progress[0].evidence[0]).toMatchObject({ evidence_id: EVIDENCE, source: { artifact_reference: "artifact://TR-001", source_record_reference: "TR-001" } });
  });

  it("presents owner-reported status as submitted data, not reviewer acceptance", async () => {
    const result: any = await harness().service.load({ capa_case_id: CASE as never });
    expect(result.projection.submitted_implementation.action_progress[0].owner_reported_status).toBe("reported_complete");
    expect(result.projection.submitted_implementation.action_progress[0]).not.toHaveProperty("accepted");
  });

  it("rejects a non-S90 current state", async () => {
    const test = harness({ caseStatus: "S80" });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "wrong_workflow_state" });
  });

  it("rejects a stale or non-current case version", async () => {
    const test = harness();
    test.capaCase.record_version = 8;
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("rejects a missing baseline section", async () => {
    const test = harness({ sections: [ACTION] });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("rejects duplicate or malformed section references", async () => {
    const duplicate = harness({ sections: [ACTION, BASELINE, BASELINE] });
    await expect(duplicate.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
    const malformed = harness();
    malformed.versions.get(S90).section_version_ids = [ACTION, "50000000-0000-4000-8000-000000000099"];
    await expect(malformed.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("rejects the wrong baseline section type or schema", async () => {
    const wrongType = harness();
    wrongType.sections.get(BASELINE).section_type = "CAPA.OTHER";
    await expect(wrongType.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
    const wrongSchema = harness();
    wrongSchema.sections.get(BASELINE).schema_version = "wrong";
    await expect(wrongSchema.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("rejects invalid S80 parent linkage", async () => {
    const test = harness({ parentStatus: "S70" });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("rejects invalid resulting S90 linkage", async () => {
    const test = harness({ baseline: baselineContent({ resulting_s90_case_version_id: S80 }) });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("fails closed when the S70 approval audit actor does not match the reviewer", async () => {
    const test = harness({ approvalActorMismatch: true });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("fails closed across tenant boundaries", async () => {
    const test = harness();
    (test.dependencies as any).request_context = commandContext(OTHER_ORG);
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "not_found_or_not_authorized" });
  });

  it("does not mutate repository state", async () => {
    const test = harness();
    const beforeVersions = structuredClone([...test.versions.entries()]);
    const beforeSections = structuredClone([...test.sections.entries()]);
    const beforeCase = structuredClone(test.capaCase);
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toMatchObject({ status: "resolved" });
    expect([...test.versions.entries()]).toEqual(beforeVersions);
    expect([...test.sections.entries()]).toEqual(beforeSections);
    expect(test.capaCase).toEqual(beforeCase);
  });

  it("does not invoke a decision engine or create an S80 owner response", async () => {
    const decisionEngine = vi.fn();
    const test = harness();
    await test.service.load({ capa_case_id: CASE as never });
    expect(decisionEngine).not.toHaveBeenCalled();
    const result: any = await test.service.load({ capa_case_id: CASE as never });
    expect(result.projection).not.toHaveProperty("implementation_review_return_response");
    expect(result.projection).not.toHaveProperty("owner_return_response");
  });

  it("exposes prior immutable S90 review history without overwriting cycles", async () => {
    const test = harness({ secondCycle: true, history: true });
    const result: any = await test.service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved" });
    expect(result.projection.prior_review_history).toHaveLength(1);
    expect(result.projection.prior_review_history[0]).toMatchObject({ source_case_version_id: S90A, decision: "return", rationale: "Return for additional evidence.", resulting_case_version_id: S80B, transition_audit_event_id: PRIOR_AUDIT });
  });

  it("resolves a second S90 cycle while preserving the original S70 authority", async () => {
    const test = harness({ secondCycle: true, history: true });
    expect(test.versions.get(S70)).toMatchObject({ version_number: 7, status: "S70" });
    expect(test.versions.get(S80)).toMatchObject({ version_number: 8, parent_version_id: S70, status: "S80" });
    expect(test.versions.get(S90A)).toMatchObject({ version_number: 9, parent_version_id: S80, status: "S90" });
    expect(test.versions.get(S80B)).toMatchObject({ version_number: 10, parent_version_id: S90A, status: "S80" });
    expect(test.versions.get(S90)).toMatchObject({ version_number: 11, parent_version_id: S80B, status: "S90" });
    expect(test.sections.get(PRIOR_BASELINE).content).toMatchObject({ source_s80_case_version_id: S80, resulting_s90_case_version_id: S90A });
    expect(test.sections.get(BASELINE).content).toMatchObject({ source_s80_case_version_id: S80B, resulting_s90_case_version_id: S90 });
    const result: any = await test.service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({
      status: "resolved",
      projection: {
        current_case_version_id: S90,
        case_version: { parent_version_id: S80B },
        approved_s70_baseline: { source_case_version_id: S70 },
        submitted_implementation: { source_s80_case_version_id: S80B },
      },
    });
    expect(result.projection.prior_review_history).toHaveLength(1);
    expect(result.projection.prior_review_history[0]).toMatchObject({
      source_case_version_id: S90A,
      resulting_case_version_id: S80B,
      decision: "return",
    });
  });

  it("fails closed when a historical S90 audit actor does not match the reviewer", async () => {
    const test = harness({ secondCycle: true, history: true, historyActorMismatch: true });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "invalid_authoritative_context" });
  });

  it("passes CASE_OWNER to both read and decision authorization evaluations", async () => {
    const test = harness();
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toMatchObject({ status: "resolved" });
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource: expect.objectContaining({ relationship: "CASE_OWNER" }) }));
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenNthCalledWith(2, expect.objectContaining({ resource: expect.objectContaining({ relationship: "CASE_OWNER" }) }));
  });

  it("uses normal case access for S90 reads and keeps decision authorization separate", async () => {
    const test = harness();
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toMatchObject({ status: "resolved" });
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenNthCalledWith(1, expect.objectContaining({ operation: "view_case", purpose: "CAPA_CASE_ACCESS" }));
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenNthCalledWith(2, expect.objectContaining({ operation: "accept_implementation", purpose: "CAPA_GATE_DECISION" }));
  });

  it("allows a case owner to read S90 while denying reviewer decision authority", async () => {
    const test = harness();
    vi.mocked(test.dependencies.authorization_policy.evaluate).mockImplementation(async (request: any) => (request.operation === "view_case"
      ? { decision: "allow", reason_code: "AUTHORIZED", policy_version: "policy-1", evaluated_at: NOW, relied_on_role_assignment_ids: [] }
      : { decision: "deny", reason_code: "SEGREGATION_OF_DUTIES_DENIED", policy_version: "policy-1", evaluated_at: NOW, relied_on_role_assignment_ids: [] }) as any);
    const result: any = await test.service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({
      status: "resolved",
      projection: {
        reviewer: {
          authorization: {
            read: { status: "allowed", operation: "view_case" },
            decision: { status: "denied", reason_code: "SEGREGATION_OF_DUTIES_DENIED", operation: "accept_implementation" },
          },
        },
      },
    });
  });

  it("passes NOT_CASE_OWNER to both read and decision authorization evaluations", async () => {
    const test = harness();
    (test.dependencies as any).request_context = commandContext(ORG, OTHER_USER);
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toMatchObject({ status: "resolved" });
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenNthCalledWith(1, expect.objectContaining({ resource: expect.objectContaining({ relationship: "NOT_CASE_OWNER" }) }));
    expect(test.dependencies.authorization_policy.evaluate).toHaveBeenNthCalledWith(2, expect.objectContaining({ resource: expect.objectContaining({ relationship: "NOT_CASE_OWNER" }) }));
  });

  it("reports missing step-up as decision authorization state while preserving read access", async () => {
    const test = harness();
    (test.dependencies as any).request_context = commandContext();
    (test.dependencies as any).request_context.authentication.reauthenticated_at = undefined;
    const result: any = await test.service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "resolved", projection: { reviewer: { authorization: { read: { status: "allowed", operation: "view_case" }, decision: { status: "step_up_required", operation: "accept_implementation" } } } } });
  });

  it("rejects a read authorization denial", async () => {
    const test = harness({ policy: { decision: "deny", reason_code: "READ_DENIED", policy_version: "policy-1" } });
    await expect(test.service.load({ capa_case_id: CASE as never })).resolves.toEqual({ status: "authorization_denied", reason_code: "READ_DENIED", policy_version: "policy-1" });
  });

  it("does not treat an owner completion status as an accept decision", async () => {
    const test = harness({ baseline: baselineContent({ action_progress: [{ ...baselineContent().action_progress[0], owner_reported_status: "reported_complete" }] }) });
    const result: any = await test.service.load({ capa_case_id: CASE as never });
    expect(result.projection.reviewer.authorization.decision.operation).toBe("accept_implementation");
    expect(result.projection.submitted_implementation.action_progress[0].owner_reported_status).toBe("reported_complete");
  });
});
