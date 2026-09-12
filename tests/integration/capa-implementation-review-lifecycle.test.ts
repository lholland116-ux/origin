import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  handleCapaImplementationReviewGet,
  handleCapaImplementationReviewPost,
  type CapaImplementationReviewApiDependencies,
} from "../../lib/capa/api/capa-implementation-review-route-handler";
import { submitCapaImplementation } from "../../lib/capa/application/submit-capa-implementation";
import { createCapaDevelopmentRuntime } from "../../lib/capa/application/capa-development-runtime";
import { resolveDevelopmentCapaRequestContext } from "../../lib/security/supabase-capa-context";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const OWNER = "20000000-0000-4000-8000-000000000002";
const CASE = "30000000-0000-4000-8000-000000000001";
const S60 = "40000000-0000-4000-8000-000000000001";
const S70 = "40000000-0000-4000-8000-000000000002";
const S80 = "40000000-0000-4000-8000-000000000003";
const S90 = "40000000-0000-4000-8000-000000000004";
const ACTION = "50000000-0000-4000-8000-000000000001";
const BASELINE = "50000000-0000-4000-8000-000000000002";
const OTHER_BASELINE = "50000000-0000-4000-8000-000000000003";
const APPROVAL_AUDIT = "60000000-0000-4000-8000-000000000001";
const EVIDENCE = "70000000-0000-4000-8000-000000000001";
const NOW = "2026-09-11T12:00:00.000Z";

const actionPlan = {
  items: [{
    item_id: "ACTION-1",
    action_type: "corrective",
    description: "Complete the approved implementation action.",
    linked_targets: [],
    owner_user_id: OWNER,
    due_date: "2026-10-01",
    status: "approved",
    deliverable: "Validated completion record",
    implementation_evidence: "Training and validation evidence",
    dependency_item_ids: [],
    unintended_consequence_assessment: "Assess downstream impact.",
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

function baseline() {
  return {
    approved_s70_baseline: {
      source_case_version_id: S70,
      approved_action_plan_section_id: ACTION,
      approval_decision_reference: APPROVAL_AUDIT,
    },
    source_s80_case_version_id: S80,
    source_s80_workspace_revision: 1,
    resulting_s90_case_version_id: S90,
    transition_audit_event_id: "60000000-0000-4000-8000-000000000010",
    submitted_by_user_id: OWNER,
    submitted_at: NOW,
    action_progress: [{
      approved_action_reference: "ACTION-1",
      owner_reported_status: "reported_complete",
      implementation_narrative: "Implemented the approved action.",
      blocked_reason: null,
      evidence: [evidence],
    }],
  };
}

function approvalDecision() {
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
  };
}

function approvalAudit() {
  return {
    organization_id: ORG,
    event_id: APPROVAL_AUDIT,
    event_type: "EVT-STATE-TRANSITION",
    schema_version: "audit-1",
    aggregate_type: "CAPA_CASE",
    aggregate_id: CASE,
    aggregate_version: 8,
    actor: { actor_type: "human", actor_id: USER },
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

function facts(options: { readonly freshStepUp?: boolean } = {}) {
  return {
    verified_user_id: USER,
    authenticated_at: "2026-09-11T11:00:00.000Z",
    expires_at_epoch_seconds: Date.parse("2026-09-12T12:00:00.000Z") / 1_000,
    ...(options.freshStepUp === false
      ? { verified_aal: "aal1" as const }
      : {
          verified_aal: "aal2" as const,
          verified_reauthenticated_at_epoch_seconds: Date.parse(NOW) / 1_000,
        }),
  };
}

function reviewRequest(
  decision: "accept" | "return" = "accept",
  key = "implementation-review-1",
  expectedRecordVersion = 9,
  expectedCurrentVersionId = S90,
  sourceCaseVersionId = S90,
  baselineSectionVersionId = BASELINE,
  rationaleOverride?: string,
) {
  return new Request(`https://example.test/api/capa/${CASE}/implementation-review`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "idempotency-key": key,
      "x-request-id": randomUUID(),
      "x-correlation-id": randomUUID(),
    },
    body: JSON.stringify({
      expected_record_version: expectedRecordVersion,
      expected_current_version_id: expectedCurrentVersionId,
      schema_version: "capa-implementation-review-decision-1.0.0",
      source_case_version_id: sourceCaseVersionId,
      implementation_review_baseline_section_version_id: baselineSectionVersionId,
      decision,
      rationale: rationaleOverride ?? (decision === "accept"
        ? "Accept the implementation evidence."
        : "Return the implementation for additional work."),
    }),
  });
}

async function harness(options: {
  readonly caseStatus?: "S90" | "S80";
  readonly baseline?: unknown;
  readonly role?: "CAPA_APPROVER" | "CAPA_REVIEWER";
  readonly freshStepUp?: boolean;
} = {}) {
  const previousOrganization = process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;
  const previousRole = process.env.CAPA_DEVELOPMENT_ROLE_ID;
  process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID = ORG;
  process.env.CAPA_DEVELOPMENT_ROLE_ID = options.role ?? "CAPA_APPROVER";
  const runtime = createCapaDevelopmentRuntime({
    environment: "test",
    now: () => new Date(NOW),
    generate_uuid: randomUUID,
  });
  const database = runtime.database as any;
  await database.runInTransaction({ request_id: randomUUID(), correlation_id: randomUUID(), idempotency_key: "seed" }, async (transaction: any) => {
    await database.insertCase(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      case_number: "CAPA-1",
      current_version_id: S90,
      status: options.caseStatus ?? "S90",
      record_version: 9,
      owner_user_id: OWNER,
      confidentiality: "CUSTOMER_CONFIDENTIAL",
      effective_at: NOW,
      created_at: NOW,
      updated_at: NOW,
      created_by: { actor_type: "human", actor_id: OWNER },
      updated_by: { actor_type: "human", actor_id: OWNER },
    });
    for (const version of [
      { case_version_id: S60, version_number: 6, parent_version_id: null, status: "S60", section_version_ids: [ACTION] },
      { case_version_id: S70, version_number: 7, parent_version_id: S60, status: "S70", section_version_ids: [ACTION] },
      { case_version_id: S80, version_number: 8, parent_version_id: S70, status: "S80", section_version_ids: [ACTION] },
      { case_version_id: S90, version_number: 9, parent_version_id: S80, status: "S90", section_version_ids: [ACTION, BASELINE] },
    ]) {
      await database.insertCaseVersion(transaction, {
        organization_id: ORG,
        capa_case_id: CASE,
        ...version,
        change_reason: "Controlled transition",
        effective_at: NOW,
        created_at: NOW,
        created_by: { actor_type: "human", actor_id: OWNER },
      });
    }
    await database.insertSectionVersion(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      section_version_id: ACTION,
      section_type: "CAPA.ACTION_PLAN",
      version_number: 1,
      schema_version: "capa-action-plan-1.0.0",
      content: actionPlan,
      change_reason: "Approved action plan",
      effective_at: NOW,
      created_at: NOW,
      created_by: { actor_type: "human", actor_id: USER },
    });
    await database.insertSectionVersion(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      section_version_id: BASELINE,
      section_type: "CAPA.IMPLEMENTATION_REVIEW_BASELINE",
      version_number: 1,
      schema_version: "capa-implementation-review-baseline-1.0.0",
      content: options.baseline ?? baseline(),
      change_reason: "Submit implementation for review",
      effective_at: NOW,
      created_at: NOW,
      created_by: { actor_type: "human", actor_id: OWNER },
    });
    await database.saveDecision(transaction, approvalDecision());
    await database.appendEvent(transaction, approvalAudit());
  });
  const dependencies: CapaImplementationReviewApiDependencies = {
    get_session_facts: vi.fn(async () => facts({ freshStepUp: options.freshStepUp })),
    resolve_context: vi.fn(async (sessionFacts, now) => resolveDevelopmentCapaRequestContext(sessionFacts, now)),
    create_projection_service: (context) => runtime.create_implementation_review_projection_service(context),
    get_decision_dependencies: () => runtime.decide_implementation_review_dependencies,
    now: () => new Date(NOW),
    generate_uuid: randomUUID,
    logger: { error: vi.fn() },
  };
  return {
    runtime,
    database,
    dependencies,
    restore() {
      if (previousOrganization === undefined) delete process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID;
      else process.env.CAPA_DEVELOPMENT_ORGANIZATION_ID = previousOrganization;
      if (previousRole === undefined) delete process.env.CAPA_DEVELOPMENT_ROLE_ID;
      else process.env.CAPA_DEVELOPMENT_ROLE_ID = previousRole;
    },
  };
}

describe("integrated S90 implementation-review API/runtime qualification", () => {
  it("reads the authoritative projection through development runtime wiring", async () => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewGet(
        new Request(`https://example.test/api/capa/${CASE}/implementation-review`),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        projection: {
          trust: "authoritative_server_projection",
          workflow_state: "S90",
          current_case_version_id: S90,
          case_version: { parent_version_id: S80 },
          approved_s70_baseline: { source_case_version_id: S70 },
          submitted_implementation: { source_s80_case_version_id: S80 },
        },
      });
      expect(test.runtime.create_implementation_review_projection_service).toEqual(expect.any(Function));
      expect(test.runtime.submit_implementation_dependencies.return_cycle_resolver).toBeDefined();
    } finally {
      test.restore();
    }
  });

  it("completes S90 return to S80 response binding and back to S90 with immutable history", async () => {
    const test = await harness();
    try {
      const returned = await handleCapaImplementationReviewPost(
        reviewRequest("return", "implementation-review-rework-1"),
        CASE,
        test.dependencies,
      );
      expect(returned.status).toBe(200);
      const factsValue = await test.dependencies.get_session_facts();
      const context = await test.dependencies.resolve_context(factsValue as never, new Date(NOW));
      const workspaceService = test.runtime.create_implementation_workspace_service(context as never);
      const loaded: any = await workspaceService.load({ capa_case_id: CASE as never });
      expect(loaded).toMatchObject({ status: "loaded", workspace: { implementation_review_return_cycle: { source_case_version_id: S90, resulting_case_version_id: expect.any(String), rationale: "Return the implementation for additional work." }, draft: null } });
      const saved: any = await workspaceService.save({
        capa_case_id: CASE as never,
        body: {
          expected_draft_revision: null,
          action_progress: baseline().action_progress,
          implementation_review_return_response: { response_narrative: "The implementation evidence was reworked for the reviewer." },
        },
        request_trace: { request_id: randomUUID(), correlation_id: randomUUID() } as never,
      });
      expect(saved).toMatchObject({ status: "saved", workspace: { draft_revision: 1, draft: { implementation_review_return_response: { source_case_version_id: S90, response_narrative: "The implementation evidence was reworked for the reviewer." } } } });
      const submission = await submitCapaImplementation(test.runtime.submit_implementation_dependencies, {
        authentication: (context as any).authentication,
        tenant: (context as any).tenant,
        capa_case_id: CASE as never,
        request_trace: { request_id: randomUUID(), correlation_id: randomUUID(), idempotency_key: "implementation-rework-submit-1" } as never,
        body: { expected_draft_revision: 1 },
      });
      expect(submission).toMatchObject({ status: "submitted", capa_case: { status: "S90" }, source_case_version_id: expect.any(String), implementation_review_baseline_section_version: { section_version_id: expect.any(String), version_number: 2, parent_version_id: BASELINE }, implementation_review_return_response_section_version: { section_type: "CAPA.IMPLEMENTATION_REVIEW_RETURN_RESPONSE", version_number: 1 } });
      expect((submission as any).implementation_review_return_response_section_version.parent_version_id).toBeUndefined();
      const firstBaseline = (submission as any).implementation_review_baseline_section_version.section_version_id as string;
      const firstResponse = (submission as any).implementation_review_return_response_section_version.section_version_id as string;
      const firstResultingVersion = await test.database.findCaseVersionById(
        ORG,
        CASE,
        (submission as any).resulting_case_version_id,
      );
      expect(firstResultingVersion).toMatchObject({ section_version_ids: [ACTION, firstBaseline, firstResponse] });
      expect(firstResultingVersion?.section_version_ids).not.toContain(BASELINE);
      const projection = await test.runtime.create_implementation_review_projection_service(context as never).load({ capa_case_id: CASE as never });
      expect(projection).toMatchObject({ status: "resolved", projection: { current_case_version_id: (submission as any).resulting_case_version_id, prior_review_history: [{ decision: "return", return_response: { content: { response_narrative: "The implementation evidence was reworked for the reviewer.", source_case_version_id: S90 } } }] } });
      const firstS90 = (submission as any).resulting_case_version_id as string;
      const secondReturned = await handleCapaImplementationReviewPost(
        reviewRequest("return", "implementation-review-rework-2", 11, firstS90, firstS90, firstBaseline, "The second review cycle still requires objective evidence."),
        CASE,
        test.dependencies,
      );
      expect(secondReturned.status).toBe(200);
      const secondLoaded: any = await workspaceService.load({ capa_case_id: CASE as never });
      expect(secondLoaded).toMatchObject({
        status: "loaded",
        workspace: {
          implementation_review_return_cycle: {
            source_case_version_id: firstS90,
            rationale: "The second review cycle still requires objective evidence.",
          },
          draft_revision: null,
          updated_at: null,
          draft: {
            action_progress: baseline().action_progress,
            implementation_review_return_response: null,
          },
        },
      });
      const secondSaved: any = await workspaceService.save({
        capa_case_id: CASE as never,
        body: {
          expected_draft_revision: null,
          action_progress: baseline().action_progress,
          implementation_review_return_response: { response_narrative: "The second review cycle was addressed separately." },
        },
        request_trace: { request_id: randomUUID(), correlation_id: randomUUID() } as never,
      });
      expect(secondSaved).toMatchObject({ status: "saved", workspace: { draft_revision: 1 } });
      const secondSubmissionCommand = {
        authentication: (context as any).authentication,
        tenant: (context as any).tenant,
        capa_case_id: CASE as never,
        request_trace: { request_id: randomUUID(), correlation_id: randomUUID(), idempotency_key: "implementation-rework-submit-2" } as never,
        body: { expected_draft_revision: 1 },
      };
      const secondSubmission = await submitCapaImplementation(test.runtime.submit_implementation_dependencies, secondSubmissionCommand);
      expect(secondSubmission).toMatchObject({ status: "submitted", implementation_review_baseline_section_version: { version_number: 3, parent_version_id: firstBaseline }, implementation_review_return_response_section_version: { version_number: 2, parent_version_id: firstResponse } });
      const secondReplay = await submitCapaImplementation(test.runtime.submit_implementation_dependencies, secondSubmissionCommand);
      expect(secondReplay).toMatchObject({ status: "already_submitted", implementation_review_baseline_section_version: { version_number: 3, parent_version_id: firstBaseline }, implementation_review_return_response_section_version: { version_number: 2, parent_version_id: firstResponse } });
      const secondProjection = await test.runtime.create_implementation_review_projection_service(context as never).load({ capa_case_id: CASE as never });
      expect(secondProjection).toMatchObject({ status: "resolved" });
      expect((secondProjection as any).projection.prior_review_history.map((entry: any) => entry.return_response.content.response_narrative)).toEqual(expect.arrayContaining(["The implementation evidence was reworked for the reviewer.", "The second review cycle was addressed separately."]));
    } finally {
      test.restore();
    }
  });

  it("blocks S80 resubmission when the active return cycle has no owner response", async () => {
    const test = await harness();
    try {
      const returned = await handleCapaImplementationReviewPost(reviewRequest("return", "implementation-review-missing-response"), CASE, test.dependencies);
      expect(returned.status).toBe(200);
      const factsValue = await test.dependencies.get_session_facts();
      const context = await test.dependencies.resolve_context(factsValue as never, new Date(NOW));
      const workspaceService = test.runtime.create_implementation_workspace_service(context as never);
      await expect(workspaceService.save({
        capa_case_id: CASE as never,
        body: { expected_draft_revision: null, action_progress: baseline().action_progress },
        request_trace: { request_id: randomUUID(), correlation_id: randomUUID() } as never,
      })).resolves.toMatchObject({ status: "saved" });
      const result = await submitCapaImplementation(test.runtime.submit_implementation_dependencies, {
        authentication: (context as any).authentication,
        tenant: (context as any).tenant,
        capa_case_id: CASE as never,
        request_trace: { request_id: randomUUID(), correlation_id: randomUUID(), idempotency_key: "implementation-missing-response-submit" } as never,
        body: { expected_draft_revision: 1 },
      });
      expect(result).toEqual({ status: "validation_failed", reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_REQUIRED" });
    } finally {
      test.restore();
    }
  });

  it.each([
    ["accept", "S100"],
    ["return", "S80"],
  ] as const)("routes %s through CS3 and preserves atomic runtime state", async (decision, state) => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest(decision),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        status: "decided",
        decision,
        capa: { status: state, workflow_state: state, record_version: 10 },
        replayed: false,
      });
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: state,
        current_version_id: expect.any(String),
        record_version: 10,
      });
      await expect(
        test.runtime.decide_implementation_review_dependencies.review_decision_repository.findDecision(
          ORG as never,
          CASE as never,
          S90 as never,
        ),
      ).resolves.toMatchObject({ decision });
    } finally {
      test.restore();
    }
  });

  it("rejects a mismatched expected current version without transitioning the CAPA", async () => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "mismatched-current-version", 9, S80, S90),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED" },
      });
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: "S90",
        current_version_id: S90,
        record_version: 9,
      });
      expect(await test.database.findImplementationReviewDecision(ORG, CASE, S90)).toBeNull();
      expect(test.database.exportSnapshot().case_versions).toHaveLength(4);
      expect(test.database.exportSnapshot().audit_events).toHaveLength(1);
    } finally {
      test.restore();
    }
  });

  it("rejects a stale expected record version with a controlled concurrency conflict", async () => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "stale-record-version", 8),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({
        error: { code: "CAPA_CONCURRENCY_CONFLICT" },
      });
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: "S90",
        current_version_id: S90,
        record_version: 9,
      });
      expect(await test.database.findImplementationReviewDecision(ORG, CASE, S90)).toBeNull();
      expect(test.database.exportSnapshot().case_versions).toHaveLength(4);
      expect(test.database.exportSnapshot().audit_events).toHaveLength(1);
    } finally {
      test.restore();
    }
  });

  it("requires fresh step-up authentication before deciding", async () => {
    const test = await harness({ freshStepUp: false });
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "missing-step-up"),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "CAPA_STEP_UP_REQUIRED" },
      });
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: "S90",
        current_version_id: S90,
        record_version: 9,
      });
      expect(await test.database.findImplementationReviewDecision(ORG, CASE, S90)).toBeNull();
    } finally {
      test.restore();
    }
  });

  it("denies a human reviewer without the controlled implementation-review role", async () => {
    const test = await harness({ role: "CAPA_REVIEWER" });
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "unauthorized-reviewer"),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        error: { code: "CAPA_ACCESS_DENIED" },
      });
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: "S90",
        current_version_id: S90,
        record_version: 9,
      });
      expect(await test.database.findImplementationReviewDecision(ORG, CASE, S90)).toBeNull();
    } finally {
      test.restore();
    }
  });

  it("replays an exact idempotent decision without creating a second transition", async () => {
    const test = await harness();
    try {
      const first = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "exact-duplicate"),
        CASE,
        test.dependencies,
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      expect(firstBody).toMatchObject({ replayed: false, decision: "accept" });
      const afterFirst = test.database.exportSnapshot();

      const second = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "exact-duplicate"),
        CASE,
        test.dependencies,
      );
      expect(second.status).toBe(200);
      expect(await second.json()).toMatchObject({
        replayed: true,
        decision: "accept",
        transition_audit_event_id: firstBody.transition_audit_event_id,
      });
      const afterSecond = test.database.exportSnapshot();
      const { revision: _firstRevision, ...firstPersistedState } = afterFirst;
      const { revision: _secondRevision, ...secondPersistedState } = afterSecond;
      expect(secondPersistedState).toEqual(firstPersistedState);
      expect(afterFirst.case_versions).toHaveLength(5);
      expect(afterFirst.implementation_review_decisions).toHaveLength(1);
      expect(afterFirst.audit_events).toHaveLength(2);
      expect(afterFirst.workflow_idempotency).toHaveLength(1);
    } finally {
      test.restore();
    }
  });

  it("rejects a conflicting idempotency request while preserving the committed result", async () => {
    const test = await harness();
    try {
      const first = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "conflicting-idempotency"),
        CASE,
        test.dependencies,
      );
      expect(first.status).toBe(200);
      const firstBody = await first.json();
      const afterFirst = test.database.exportSnapshot();

      const conflict = await handleCapaImplementationReviewPost(
        reviewRequest("return", "conflicting-idempotency"),
        CASE,
        test.dependencies,
      );
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({
        error: { code: "CAPA_IDEMPOTENCY_CONFLICT" },
      });
      const afterConflict = test.database.exportSnapshot();
      const { revision: _committedRevision, ...committedPersistedState } = afterFirst;
      const { revision: _conflictRevision, ...conflictPersistedState } = afterConflict;
      expect(conflictPersistedState).toEqual(committedPersistedState);
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: "S100",
        current_version_id: firstBody.capa.resulting_case_version_id,
        record_version: 10,
      });
      await expect(
        test.database.findImplementationReviewDecision(ORG, CASE, S90),
      ).resolves.toMatchObject({ decision: "accept" });
    } finally {
      test.restore();
    }
  });

  it("rejects a POST baseline that is not authoritative for the current S90 source", async () => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "mismatched-baseline", 9, S90, S90, OTHER_BASELINE),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: { code: "CAPA_IMPLEMENTATION_REVIEW_VALIDATION_FAILED" },
      });
      expect(await test.database.findCaseById(ORG, CASE)).toMatchObject({
        status: "S90",
        current_version_id: S90,
        record_version: 9,
      });
      expect(await test.database.findImplementationReviewDecision(ORG, CASE, S90)).toBeNull();
      expect(test.database.exportSnapshot().case_versions).toHaveLength(4);
      expect(test.database.exportSnapshot().audit_events).toHaveLength(1);
    } finally {
      test.restore();
    }
  });

  it.each(["accept", "return"] as const)(
    "preserves the submitted S80/S90 baseline section on %s",
    async (decision) => {
      const test = await harness();
      try {
        const before = await test.database.findSectionVersionById(ORG, CASE, BASELINE);
        const response = await handleCapaImplementationReviewPost(
          reviewRequest(decision, `baseline-immutable-${decision}`),
          CASE,
          test.dependencies,
        );
        expect(response.status).toBe(200);
        const after = await test.database.findSectionVersionById(ORG, CASE, BASELINE);
        expect(after).toEqual(before);
      } finally {
        test.restore();
      }
    },
  );

  it("returns to S80 without creating an owner return-response draft or history record", async () => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("return", "return-without-owner-response"),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        decision: "return",
        capa: { status: "S80", workflow_state: "S80" },
      });
      const snapshot = test.database.exportSnapshot();
      expect(snapshot.implementation_workspace_records).toHaveLength(0);
      expect(snapshot.implementation_review_decisions).toHaveLength(1);
      expect(snapshot.audit_events).toHaveLength(2);
    } finally {
      test.restore();
    }
  });

  it("persists mutually bound S90 result, decision, and transition audit through CS3", async () => {
    const test = await harness();
    try {
      const response = await handleCapaImplementationReviewPost(
        reviewRequest("accept", "controlled-binding"),
        CASE,
        test.dependencies,
      );
      expect(response.status).toBe(200);
      const body = await response.json();
      const resultingCaseVersionId = body.capa.resulting_case_version_id;
      const auditEventId = body.transition_audit_event_id;
      const resultingVersion = await test.database.findCaseVersionById(
        ORG,
        CASE,
        resultingCaseVersionId,
      );
      const decision = await test.database.findImplementationReviewDecision(
        ORG,
        CASE,
        S90,
      );
      const audit = await test.database.findEventById(ORG, auditEventId);

      expect(resultingVersion).toMatchObject({
        capa_case_id: CASE,
        case_version_id: resultingCaseVersionId,
        version_number: 10,
        parent_version_id: S90,
        status: "S100",
        section_version_ids: [ACTION, BASELINE],
      });
      expect(decision).toMatchObject({
        capa_case_id: CASE,
        source_case_version_id: S90,
        implementation_review_baseline_section_version_id: BASELINE,
        decision: "accept",
        resulting_case_version_id: resultingCaseVersionId,
        transition_audit_event_id: auditEventId,
      });
      expect(audit).toMatchObject({
        aggregate_id: CASE,
        aggregate_version: 10,
        action: "DECIDE_CAPA_IMPLEMENTATION_REVIEW",
        target: { object_id: CASE, object_version_id: resultingCaseVersionId },
        change: {
          before_ref: { object_id: CASE, object_version_id: S90 },
          after_ref: { object_id: CASE, object_version_id: resultingCaseVersionId },
        },
        metadata: {
          from_state: "S90",
          to_state: "S100",
          source_case_version_id: S90,
          resulting_case_version_id: resultingCaseVersionId,
          implementation_review_baseline_section_version_id: BASELINE,
          review_decision: "accept",
          review_decision_schema_version: "capa-implementation-review-decision-1.0.0",
        },
      });
      expect(decision?.transition_audit_event_id).toBe(audit?.event_id);
      expect(audit?.target.object_version_id).toBe(resultingVersion?.case_version_id);
    } finally {
      test.restore();
    }
  });

  it("maps wrong workflow state and invalid authoritative projection without leaking tenant data", async () => {
    const wrongState = await harness({ caseStatus: "S80" });
    try {
      const response = await handleCapaImplementationReviewGet(new Request("https://example.test"), CASE, wrongState.dependencies);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "CAPA_IMPLEMENTATION_REVIEW_CASE_STATE_CONFLICT" } });
    } finally {
      wrongState.restore();
    }

    const invalid = await harness({
      baseline: { ...baseline(), resulting_s90_case_version_id: S80 },
    });
    try {
      const response = await handleCapaImplementationReviewGet(new Request("https://example.test"), CASE, invalid.dependencies);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "CAPA_IMPLEMENTATION_REVIEW_INVALID_AUTHORITATIVE_CONTEXT" } });
    } finally {
      invalid.restore();
    }
  });
});
