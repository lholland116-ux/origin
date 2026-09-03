import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_RELEASE_CONFIRMATION,
  releaseCapaInvestigation,
  type ReleaseCapaInvestigationDependencies,
} from "../../lib/capa/application/release-capa-investigation";
import {
  submitCapaRootCausePackage,
  type SubmitCapaRootCausePackageDependencies,
} from "../../lib/capa/application/submit-capa-root-cause-package";
import {
  updateCapaInvestigationProgress,
  type UpdateCapaInvestigationProgressDependencies,
} from "../../lib/capa/application/update-capa-investigation-progress";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "20000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const V3 = "40000000-0000-4000-8000-000000000003";
const V4 = "40000000-0000-4000-8000-000000000004";
const V5 = "40000000-0000-4000-8000-000000000005";
const V6 = "40000000-0000-4000-8000-000000000006";
const CONTAINMENT = "70000000-0000-4000-8000-000000000001";
const PLAN1 = "70000000-0000-4000-8000-000000000002";
const PLAN2 = "70000000-0000-4000-8000-000000000003";
const LEDGER = "70000000-0000-4000-8000-000000000004";
const ROOT = "70000000-0000-4000-8000-000000000005";
const RELEASE_AUDIT = "80000000-0000-4000-8000-000000000001";
const D3_AUDIT = "80000000-0000-4000-8000-000000000002";
const D2_AUDIT = "80000000-0000-4000-8000-000000000003";
const NOW = "2026-09-01T12:00:00.000Z";
const human = { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null };

function authentication() {
  return {
    principal: { principal_type: "human", user_id: USER }, session_id: "session",
    authentication_method: "SUPABASE_SESSION", assurance_level: "SINGLE_FACTOR",
    authenticated_at: "2026-09-01T11:00:00.000Z", expires_at: "2026-09-02T12:00:00.000Z",
  } as never;
}

function tenant() {
  return {
    organization_id: ORG, access_grant_id: "grant", access_path: "ORGANIZATION",
    authorization_policy_version: "policy-1", resolved_at: NOW, role_assignments: [],
  } as never;
}

function trace(idempotency_key: string) {
  return {
    request_id: "50000000-0000-4000-8000-000000000001",
    correlation_id: "60000000-0000-4000-8000-000000000001",
    idempotency_key,
  } as never;
}

function plan() {
  return { items: [{
    item_id: "INV-1", investigation_question: "Why?", evidence_target: "Record",
    investigation_method: "Review", owner_user_id: USER, due_date: "2026-09-30",
    sme_user_ids: [], dependency_item_ids: [], scope_relationship: "Approved scope",
    status: "planned", disposition: null, disposition_rationale: null, draft_provenance: human,
  }] };
}

function ledger() {
  return { items: [{
    item_id: "E-1", information_class: "verified_evidence",
    statement: "The record establishes seal wear.", evidence_status: "verified",
    assumption_status: null, gap_status: null, conflict_status: null, provenance: human,
    owner_user_id: null, information_date: null, source_version: null, context: null,
    linked_capa_objects: [], supporting_item_ids: [], contradictory_item_ids: [], conflict_item_ids: [],
    material_to_conclusion: false, critical_to_conclusion: false,
    recommended_next_step: null, target_date: null,
    human_disposition: { user_id: USER, disposition_at: NOW, rationale: "Reviewed by investigator." },
  }] };
}

function rootCause() {
  return {
    hypotheses: [{
      hypothesis_id: "H-1", statement: "Seal wear caused the event.", status: "confirmed",
      causal_role: "proposed_root_cause", rationale: "Supported by the record.",
      responsible_user_id: USER, supporting_evidence_item_ids: ["E-1"],
      contradictory_evidence_item_ids: [], linked_assumption_item_ids: [], linked_gap_item_ids: [],
      linked_conflict_item_ids: [], material_to_package: true, provenance: human,
    }],
    root_cause_not_confirmed: null,
  };
}

async function lifecycleHarness() {
  let transaction = 0;
  const database = new InMemoryCapaDatabase({
    generate_transaction_id: () => `lifecycle-${++transaction}` as never,
    now: () => new Date(NOW),
  });
  await database.runInTransaction(trace("seed"), async (tx) => {
    await database.insertCase(tx, {
      organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-000001",
      current_version_id: V3, status: "S30", record_version: 3,
      owner_user_id: USER, confidentiality: "CUSTOMER_CONFIDENTIAL",
      effective_at: NOW, created_at: NOW, updated_at: NOW,
      created_by: { actor_type: "human", actor_id: USER }, updated_by: { actor_type: "human", actor_id: USER },
    } as never);
    await database.insertSectionVersion(tx, {
      organization_id: ORG, capa_case_id: CASE, section_version_id: CONTAINMENT,
      section_type: "CAPA.CONTAINMENT_RISK", version_number: 1,
      schema_version: "containment-risk-1", content: {}, change_reason: "G-02",
      effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: USER },
    } as never);
    await database.insertCaseVersion(tx, {
      organization_id: ORG, capa_case_id: CASE, case_version_id: V3,
      version_number: 3, status: "S30", section_version_ids: [CONTAINMENT],
      change_reason: "G-02", effective_at: NOW, created_at: NOW,
      created_by: { actor_type: "human", actor_id: USER },
    } as never);
  });
  const authorization_policy = { evaluate: vi.fn().mockResolvedValue({
    decision: "allow", reason_code: "AUTHORIZED", policy_version: "policy-1",
    evaluated_at: NOW, relied_on_role_assignment_ids: ["role-1"],
  }) };
  const common = {
    transaction_manager: database, capa_repository: database, audit_repository: database,
    adoption_repository: database,
    workflow_idempotency_repository: database, authorization_policy,
    clock: { now: () => new Date(NOW) },
    configuration: { workflow_version: "workflow-1", audit_schema_version: "audit-1", authorization_purpose: "CAPA_WORKFLOW_TRANSITION" as never },
  };
  const release: ReleaseCapaInvestigationDependencies = {
    ...common,
    participant_eligibility_repository: {
      listEligibleInvestigationOwners: vi.fn(),
      findIneligibleInvestigationOwnerIds: vi.fn().mockResolvedValue([]),
    },
    id_generator: {
      generateCaseVersionId: () => V4,
      generateSectionVersionId: () => PLAN1,
      generateAuditEventId: () => RELEASE_AUDIT,
    } as never,
  };
  const progress: UpdateCapaInvestigationProgressDependencies = {
    ...common,
    configuration: { ...common.configuration, authorization_purpose: "CAPA_CASE_EDIT" as never },
    id_generator: {
      generateCaseVersionId: () => V5,
      generateSectionVersionId: () => PLAN2,
      generateAuditEventId: () => D3_AUDIT,
    } as never,
  };
  const submit: SubmitCapaRootCausePackageDependencies = {
    ...common,
    id_generator: {
      generateCaseVersionId: () => V6,
      generateSectionVersionId: (() => { let index = 0; return () => [LEDGER, ROOT][index++]!; })(),
      generateAuditEventId: () => D2_AUDIT,
    } as never,
  };
  return { database, release, progress, submit };
}

describe("real investigation-to-root-cause lifecycle", () => {
  it("persists G-03 planned work, blocks D2, persists D3 completion, reaches S50, and replays historical D3", async () => {
    const test = await lifecycleHarness();
    const released = await releaseCapaInvestigation(test.release, {
      authentication: authentication(), tenant: tenant(), capa_case_id: CASE,
      expected_record_version: 3, expected_current_version_id: V3,
      request_trace: trace("release"),
      body: { investigation_plan: plan(), release: { confirmation: CAPA_INVESTIGATION_RELEASE_CONFIRMATION, comment: null } },
    } as never);
    expect(released).toMatchObject({ status: "released", capa_case: { status: "S40", record_version: 4, current_version_id: V4 } });
    const beforeD3 = await submitCapaRootCausePackage(test.submit, {
      authentication: authentication(), tenant: tenant(), capa_case_id: CASE,
      expected_record_version: 4, expected_current_version_id: V4,
      request_trace: trace("submit-before"),
      body: { evidence_assumption_ledger: ledger(), root_cause_package: rootCause() },
    } as never);
    expect(beforeD3).toMatchObject({ status: "submission_blocked", reason_codes: expect.arrayContaining(["OPEN_INVESTIGATION_PLAN_ITEM"]) });
    const progressCommand = {
      authentication: authentication(), tenant: tenant(), capa_case_id: CASE,
      expected_record_version: 4, expected_current_version_id: V4,
      item_id: "INV-1", new_status: "completed", disposition: null, disposition_rationale: null,
      request_trace: trace("progress"),
    } as never;
    const progressed = await updateCapaInvestigationProgress(test.progress, progressCommand);
    expect(progressed).toMatchObject({ status: "updated", capa_case: { status: "S40", record_version: 5, current_version_id: V5 } });
    const staleD2 = await submitCapaRootCausePackage(test.submit, {
      authentication: authentication(), tenant: tenant(), capa_case_id: CASE,
      expected_record_version: 4, expected_current_version_id: V4,
      request_trace: trace("submit-stale"),
      body: { evidence_assumption_ledger: ledger(), root_cause_package: rootCause() },
    } as never);
    expect(staleD2).toMatchObject({ status: "submission_blocked", reason_codes: expect.arrayContaining(["OPEN_INVESTIGATION_PLAN_ITEM"]) });
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ status: "S40", record_version: 5, current_version_id: V5 });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, V6 as never)).toBeNull();
    expect(await test.database.findEventById(ORG as never, D2_AUDIT as never)).toBeNull();
    const submitted = await submitCapaRootCausePackage(test.submit, {
      authentication: authentication(), tenant: tenant(), capa_case_id: CASE,
      expected_record_version: 5, expected_current_version_id: V5,
      request_trace: trace("submit-after"),
      body: { evidence_assumption_ledger: ledger(), root_cause_package: rootCause() },
    } as never);
    expect(submitted).toMatchObject({ status: "submitted", capa_case: { status: "S50", record_version: 6, current_version_id: V6 } });
    const replay = await updateCapaInvestigationProgress(test.progress, progressCommand);
    expect(replay).toMatchObject({ status: "already_updated", capa_case: { status: "S40", record_version: 5, current_version_id: V5 }, case_version: { case_version_id: V5 } });
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ status: "S50", record_version: 6, current_version_id: V6 });
    expect(await test.database.findEventById(ORG as never, D3_AUDIT as never)).toMatchObject({ event_type: "EVT-SUBSTANTIVE-CHANGE", action: "UPDATE_CAPA_INVESTIGATION_PROGRESS" });
    expect(await test.database.findEventById(ORG as never, D2_AUDIT as never)).toMatchObject({ event_type: "EVT-STATE-TRANSITION", action: "SUBMIT_CAPA_ROOT_CAUSE_PACKAGE" });
    expect(await test.database.findEventById(ORG as never, RELEASE_AUDIT as never)).not.toMatchObject({ event_type: "EVT-APPROVAL" });
  });
});
