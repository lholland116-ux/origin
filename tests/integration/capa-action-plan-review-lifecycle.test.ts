import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import {
  handleCapaActionPlanReview,
  handleCapaGet,
  type CapaApiHandlerDependencies,
} from "../../lib/capa/api/capa-route-handler";
import {
  createCapaActionPlanReviewAttempt,
  submitCapaActionPlanReviewAttempt,
} from "../../app/capa/capa-action-plan-review-client";
import { createCapaDevelopmentRuntime } from "../../lib/capa/application/capa-development-runtime";
import { resolveDevelopmentCapaRequestContext } from "../../lib/security/supabase-capa-context";

const USER = "10000000-0000-4000-8000-000000000001";
const OTHER_USER = "10000000-0000-4000-8000-000000000002";
const CASE = "30000000-0000-4000-8000-000000000001";
const PREVIOUS = "40000000-0000-4000-8000-000000000006";
const SOURCE = "40000000-0000-4000-8000-000000000007";
const ACTION_PLAN = "50000000-0000-4000-8000-000000000001";
const NOW = "2026-09-09T12:00:00.000Z";
const human = { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null };
const actionPlan = {
  items: [{ item_id: "A-1", action_type: "corrective", description: "Revise the controlled process.", linked_targets: [], owner_user_id: USER, due_date: "2026-10-01", status: "planned", deliverable: "Released procedure.", implementation_evidence: "Training record.", dependency_item_ids: [], unintended_consequence_assessment: "Assess downstream impact.", effectiveness_check_required: false, draft_provenance: human }],
  effectiveness_checks: [],
};

function facts() {
  return { verified_user_id: USER, authenticated_at: "2026-09-09T11:00:00.000Z", expires_at_epoch_seconds: Date.parse("2026-09-10T12:00:00.000Z") / 1000, verified_aal: "aal2" as const, verified_reauthenticated_at_epoch_seconds: Date.parse(NOW) / 1000 };
}

function reviewRequest(decision: "approve" | "return", key: string, expectedRecordVersion = 7, currentVersionId = SOURCE) {
  return new Request(`https://example.test/api/capa/${CASE}/action-plan-review`, {
    method: "POST",
    headers: { "content-type": "application/json", "idempotency-key": key, "x-request-id": randomUUID(), "x-correlation-id": randomUUID() },
    body: JSON.stringify({ expected_record_version: expectedRecordVersion, expected_current_version_id: currentVersionId, schema_version: "capa-action-plan-review-decision-1.0.0", source_case_version_id: SOURCE, action_plan_section_version_id: ACTION_PLAN, decision, rationale: decision === "approve" ? "Approved for implementation." : "Revise before implementation." }),
  });
}

async function harness() {
  const previousRole = process.env.CAPA_DEVELOPMENT_ROLE_ID;
  process.env.CAPA_DEVELOPMENT_ROLE_ID = "CAPA_APPROVER";
  const runtime = createCapaDevelopmentRuntime({ environment: "test", now: () => new Date(NOW), generate_uuid: randomUUID });
  const database = runtime.database as any;
  await database.runInTransaction({ request_id: randomUUID(), correlation_id: randomUUID(), idempotency_key: "seed" }, async (transaction: any) => {
    await database.insertCase(transaction, { organization_id: USER, capa_case_id: CASE, case_number: "CAPA-1", current_version_id: SOURCE, status: "S70", record_version: 7, owner_user_id: OTHER_USER, confidentiality: "CUSTOMER_CONFIDENTIAL", effective_at: NOW, created_at: NOW, updated_at: NOW, created_by: { actor_type: "human", actor_id: OTHER_USER }, updated_by: { actor_type: "human", actor_id: OTHER_USER } });
    await database.insertSectionVersion(transaction, { organization_id: USER, capa_case_id: CASE, section_version_id: ACTION_PLAN, section_type: "CAPA.ACTION_PLAN", version_number: 1, schema_version: "capa-action-plan-1.0.0", content: actionPlan, change_reason: "Submit action plan for review", effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: OTHER_USER } });
    await database.insertCaseVersion(transaction, { organization_id: USER, capa_case_id: CASE, case_version_id: PREVIOUS, version_number: 6, parent_version_id: null, status: "S60", section_version_ids: [ACTION_PLAN], change_reason: "Action planning", effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: OTHER_USER } });
    await database.insertCaseVersion(transaction, { organization_id: USER, capa_case_id: CASE, case_version_id: SOURCE, version_number: 7, parent_version_id: PREVIOUS, status: "S70", section_version_ids: [ACTION_PLAN], change_reason: "Submit action plan for review", effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: OTHER_USER } });
    await database.saveActionPlanWorkspaceDraft(transaction, { expected_draft_revision: null, draft: { schema_version: "capa-action-plan-workspace-draft-1.0.0", trust: "untrusted_human_draft", workflow_state: "S60", organization_id: USER, capa_case_id: CASE, case_version_id: PREVIOUS, record_version: 6, draft_revision: 1, action_plan: actionPlan, updated_by_user_id: USER, updated_at: NOW } });
  });
  const dependencies: CapaApiHandlerDependencies = {
    get_session_facts: vi.fn().mockResolvedValue(facts()),
    resolve_context: vi.fn().mockImplementation((sessionFacts, now) => resolveDevelopmentCapaRequestContext(sessionFacts, now)),
    get_runtime: vi.fn().mockReturnValue(runtime),
    now: () => new Date(NOW),
    generate_uuid: randomUUID,
    logger: { error: vi.fn() },
  };
  return { runtime, database, dependencies, restoreRole: () => { if (previousRole === undefined) delete process.env.CAPA_DEVELOPMENT_ROLE_ID; else process.env.CAPA_DEVELOPMENT_ROLE_ID = previousRole; } };
}

describe("integrated S70 action-plan review qualification", () => {
  it("approves through the API handler and reads back S80 plus the durable decision", async () => {
    const test = await harness();
    try {
      const workspaceBefore = await test.database.findActionPlanWorkspaceDraft(USER, CASE);
      const response = await handleCapaActionPlanReview(reviewRequest("approve", "approve-1"), CASE, test.dependencies);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: "decided", decision: "approve", capa: { status: "S80", workflow_state: "S80", source_case_version_id: SOURCE, action_plan_section_version_id: ACTION_PLAN, record_version: 8 } });
      const readBack = await handleCapaGet(new Request(`https://example.test/api/capa?id=${CASE}`), test.dependencies);
      expect(readBack.status).toBe(200);
      const readBody = await readBack.json();
      expect(readBody.capa).toMatchObject({ status: "S80", record_version: 8, current_version_id: body.capa.resulting_case_version_id });
      expect(readBody.capa.current_version.section_version_ids).toContain(ACTION_PLAN);
      expect(await test.database.findActionPlanWorkspaceDraft(USER, CASE)).toEqual(workspaceBefore);
      expect(test.database.exportSnapshot().action_plan_review_decisions).toHaveLength(1);
      await expect(test.runtime.decide_action_plan_review_dependencies.review_decision_repository.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toMatchObject({ decision: "approve", rationale: "Approved for implementation.", resulting_case_version_id: body.capa.resulting_case_version_id });
      expect(JSON.stringify(readBody)).not.toContain("implementation_evidence_submitted");
    } finally { test.restoreRole(); }
  });

  it("returns through the API handler, preserves the prior workspace, and reads back S60", async () => {
    const test = await harness();
    try {
      const before = await test.database.findActionPlanWorkspaceDraft(USER, CASE);
      const response = await handleCapaActionPlanReview(reviewRequest("return", "return-1"), CASE, test.dependencies);
      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body).toMatchObject({ status: "decided", decision: "return", capa: { status: "S60", workflow_state: "S60", record_version: 8 } });
      const readBack = await handleCapaGet(new Request(`https://example.test/api/capa?id=${CASE}`), test.dependencies);
      const readBody = await readBack.json();
      expect(readBody.capa).toMatchObject({ status: "S60", record_version: 8, current_version_id: body.capa.resulting_case_version_id });
      expect(readBody.capa.current_version.section_version_ids).toContain(ACTION_PLAN);
      expect(await test.database.findActionPlanWorkspaceDraft(USER, CASE)).toEqual(before);
      expect(test.database.exportSnapshot().action_plan_review_decisions).toHaveLength(1);
      await expect(test.runtime.decide_action_plan_review_dependencies.review_decision_repository.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toMatchObject({ decision: "return", rationale: "Revise before implementation." });
    } finally { test.restoreRole(); }
  });

  it("matches the CS5 browser parser to the actual CS4 route response", async () => {
    const test = await harness();
    try {
      const attempt = createCapaActionPlanReviewAttempt({
        caseId: CASE,
        recordVersion: 7,
        currentVersionId: SOURCE,
        sourceCaseVersionId: SOURCE,
        actionPlanSectionVersionId: ACTION_PLAN,
        decision: "approve",
        rationale: "Approved for implementation.",
        idempotencyKey: "client-route-contract-1",
      });
      expect(attempt).not.toBeNull();
      const result = await submitCapaActionPlanReviewAttempt(attempt!, async (_input, init) =>
        handleCapaActionPlanReview(
          new Request(`https://example.test/api/capa/${CASE}/action-plan-review`, init),
          CASE,
          test.dependencies,
        ),
      );
      expect(result).toMatchObject({
        status: "decided",
        decision: "approve",
        workflowState: "S80",
        recordVersion: 8,
        sourceCaseVersionId: SOURCE,
        actionPlanSectionVersionId: ACTION_PLAN,
        replayed: false,
      });
    } finally { test.restoreRole(); }
  });

  it("replays exactly and rejects a changed request without another transition", async () => {
    const test = await harness();
    try {
      const first = await handleCapaActionPlanReview(reviewRequest("approve", "replay-1"), CASE, test.dependencies);
      const firstBody = await first.json();
      const replay = await handleCapaActionPlanReview(reviewRequest("approve", "replay-1"), CASE, test.dependencies);
      expect(replay.status).toBe(200);
      expect(await replay.json()).toMatchObject({ replayed: true, capa: { resulting_case_version_id: firstBody.capa.resulting_case_version_id } });
      const conflict = await handleCapaActionPlanReview(reviewRequest("return", "replay-1"), CASE, test.dependencies);
      expect(conflict.status).toBe(409);
      expect(await conflict.json()).toMatchObject({ error: { code: "CAPA_IDEMPOTENCY_CONFLICT" } });
      expect((await test.database.findCaseById(USER, CASE))!.record_version).toBe(8);
      expect(test.database.exportSnapshot().action_plan_review_decisions).toHaveLength(1);
    } finally { test.restoreRole(); }
  });

  it("denies stale and unauthorized requests without mutation", async () => {
    const stale = await harness();
    try {
      const response = await handleCapaActionPlanReview(reviewRequest("approve", "stale-1", 6), CASE, stale.dependencies);
      expect(response.status).toBe(409);
      expect(await response.json()).toMatchObject({ error: { code: "CAPA_CONCURRENCY_CONFLICT" } });
      await expect(stale.runtime.decide_action_plan_review_dependencies.review_decision_repository.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toBeNull();
    } finally { stale.restoreRole(); }

    const denied = await harness();
    try {
      Object.assign(denied.dependencies, { get_runtime: vi.fn().mockReturnValue({ ...denied.runtime, decide_action_plan_review_dependencies: { ...denied.runtime.decide_action_plan_review_dependencies, authorization_policy: { evaluate: vi.fn().mockResolvedValue({ decision: "deny", reason_code: "DENIED", policy_version: "policy-1" }) } } }) });
      const response = await handleCapaActionPlanReview(reviewRequest("approve", "denied-1"), CASE, denied.dependencies);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "CAPA_ACCESS_DENIED" } });
      await expect(denied.runtime.decide_action_plan_review_dependencies.review_decision_repository.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toBeNull();
    } finally { denied.restoreRole(); }

    const stepUp = await harness();
    try {
      Object.assign(stepUp.dependencies, {
        get_session_facts: vi.fn().mockResolvedValue({
          ...facts(),
          verified_aal: "aal1",
          verified_reauthenticated_at_epoch_seconds: undefined,
        }),
      });
      const response = await handleCapaActionPlanReview(reviewRequest("approve", "step-up-1"), CASE, stepUp.dependencies);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({ error: { code: "CAPA_STEP_UP_REQUIRED" } });
      expect(await stepUp.database.findCaseById(USER, CASE)).toMatchObject({ status: "S70", record_version: 7, current_version_id: SOURCE });
      await expect(stepUp.runtime.decide_action_plan_review_dependencies.review_decision_repository.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toBeNull();
    } finally { stepUp.restoreRole(); }
  });

  it("rolls back decision, workflow, audit, and idempotency state after a post-save failure, then permits exact retry", async () => {
    const test = await harness();
    try {
      const base = test.runtime.decide_action_plan_review_dependencies.review_decision_repository;
      const failingRuntime = { ...test.runtime, decide_action_plan_review_dependencies: { ...test.runtime.decide_action_plan_review_dependencies, review_decision_repository: { findDecision: base.findDecision.bind(base), saveDecision: async (transaction: never, decision: never) => { await base.saveDecision(transaction, decision); throw new Error("injected review persistence failure"); } } } };
      Object.assign(test.dependencies, { get_runtime: vi.fn().mockReturnValue(failingRuntime) });
      const failed = await handleCapaActionPlanReview(reviewRequest("approve", "atomicity-1"), CASE, test.dependencies);
      expect(failed.status).toBe(500);
      expect(await test.database.findCaseById(USER, CASE)).toMatchObject({ status: "S70", record_version: 7, current_version_id: SOURCE });
      expect(await test.database.findCaseVersionById(USER, CASE, SOURCE)).not.toBeNull();
      await expect(base.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toBeNull();
      Object.assign(test.dependencies, { get_runtime: vi.fn().mockReturnValue(test.runtime) });
      const retry = await handleCapaActionPlanReview(reviewRequest("approve", "atomicity-1"), CASE, test.dependencies);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: "decided", decision: "approve", capa: { status: "S80", record_version: 8 } });
    } finally { test.restoreRole(); }
  });

  it("rolls back a returned decision through the same transaction infrastructure", async () => {
    const test = await harness();
    try {
      const base = test.runtime.decide_action_plan_review_dependencies.review_decision_repository;
      const failingRuntime = { ...test.runtime, decide_action_plan_review_dependencies: { ...test.runtime.decide_action_plan_review_dependencies, review_decision_repository: { findDecision: base.findDecision.bind(base), saveDecision: async (transaction: never, decision: never) => { await base.saveDecision(transaction, decision); throw new Error("injected return review persistence failure"); } } } };
      Object.assign(test.dependencies, { get_runtime: vi.fn().mockReturnValue(failingRuntime) });
      const failed = await handleCapaActionPlanReview(reviewRequest("return", "atomicity-return-1"), CASE, test.dependencies);
      expect(failed.status).toBe(500);
      expect(await test.database.findCaseById(USER, CASE)).toMatchObject({ status: "S70", record_version: 7, current_version_id: SOURCE });
      await expect(base.findDecision(USER as never, CASE as never, SOURCE as never)).resolves.toBeNull();
      Object.assign(test.dependencies, { get_runtime: vi.fn().mockReturnValue(test.runtime) });
      const retry = await handleCapaActionPlanReview(reviewRequest("return", "atomicity-return-1"), CASE, test.dependencies);
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ status: "decided", decision: "return", capa: { status: "S60", record_version: 8 } });
    } finally { test.restoreRole(); }
  });
});
