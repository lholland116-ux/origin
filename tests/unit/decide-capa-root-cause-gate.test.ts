import { describe, expect, it, vi } from "vitest";
import {
  decideCapaRootCauseGate,
  CAPA_ROOT_CAUSE_GATE_APPROVAL_CONFIRMATION,
  type DecideCapaRootCauseGateDependencies,
} from "../../lib/capa/application/decide-capa-root-cause-gate";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "10000000-0000-4000-8000-000000000001";
const USER = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const S50 = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const LATER = "40000000-0000-4000-8000-000000000003";
const ALTERNATE = "40000000-0000-4000-8000-000000000004";
const SECTION = "50000000-0000-4000-8000-000000000001";
const APPROVAL_AUDIT = "60000000-0000-4000-8000-000000000001";
const TRANSITION_AUDIT = "60000000-0000-4000-8000-000000000002";
const NOW = "2026-09-06T12:00:00.000Z";

function auth() {
  return { principal: { principal_type: "human", user_id: USER }, session_id: "session",
    authentication_method: "OIDC", assurance_level: "MFA", authenticated_at: NOW,
    expires_at: "2026-09-07T12:00:00.000Z", reauthenticated_at: NOW } as never;
}
function tenant() {
  return { organization_id: ORG, access_grant_id: "grant", access_path: "HUMAN_MEMBERSHIP",
    authorization_policy_version: "policy-1", resolved_at: NOW, role_assignments: [] } as never;
}
function trace(key: string) {
  return { request_id: "70000000-0000-4000-8000-000000000001", correlation_id: "80000000-0000-4000-8000-000000000001", idempotency_key: key } as never;
}
function idGenerator() {
  return { generateCaseVersionId: () => NEXT, generateSectionVersionId: () => SECTION,
    generateAuditEventId: (() => { let value = 0; return () => (++value % 2 === 1 ? APPROVAL_AUDIT : TRANSITION_AUDIT); })() } as never;
}

async function harness() {
  let transaction = 0;
  const database = new InMemoryCapaDatabase({ generate_transaction_id: () => `tx-${++transaction}` as never, now: () => new Date(NOW) });
  await database.runInTransaction(trace("seed"), async (tx) => {
    await database.insertCase(tx, { organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-1",
      current_version_id: S50, status: "S50", record_version: 5, owner_user_id: "90000000-0000-4000-8000-000000000001",
      confidentiality: "CUSTOMER_CONFIDENTIAL", effective_at: NOW, created_at: NOW, updated_at: NOW,
      created_by: { actor_type: "human", actor_id: USER }, updated_by: { actor_type: "human", actor_id: USER } } as never);
    await database.insertSectionVersion(tx, { organization_id: ORG, capa_case_id: CASE, section_version_id: SECTION,
      section_type: "CAPA.ROOT_CAUSE_PACKAGE", version_number: 1, schema_version: "root-cause-1",
      content: { hypotheses: [] }, change_reason: "S50", effective_at: NOW, created_at: NOW,
      created_by: { actor_type: "human", actor_id: USER } } as never);
    await database.insertCaseVersion(tx, { organization_id: ORG, capa_case_id: CASE, case_version_id: S50,
      version_number: 5, status: "S50", section_version_ids: [SECTION], change_reason: "S40 to S50",
      effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: USER } } as never);
    await database.insertCaseVersion(tx, { organization_id: ORG, capa_case_id: CASE, case_version_id: ALTERNATE,
      version_number: 4, status: "S50", section_version_ids: [SECTION], change_reason: "Historical alternate",
      effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: USER } } as never);
  });
  const dependencies: DecideCapaRootCauseGateDependencies = {
    transaction_manager: database, capa_repository: database, audit_repository: database,
    workflow_idempotency_repository: database, clock: { now: () => new Date(NOW) }, id_generator: idGenerator(),
    authorization_policy: { evaluate: vi.fn().mockResolvedValue({ decision: "allow", reason_code: "AUTHORIZED",
      policy_version: "policy-1", evaluated_at: NOW, relied_on_role_assignment_ids: ["role-1"] }) },
    configuration: { workflow_version: "workflow-1", audit_schema_version: "audit-1", step_up_maximum_age_ms: 900000,
      required_step_up_assurance: "MFA" as never, authorization_purpose: "CAPA_GATE_DECISION" as never },
  };
  return { database, dependencies };
}

async function advanceAfterGate(database: InMemoryCapaDatabase, status: "S70" | "S40") {
  await database.runInTransaction(trace(`later-${status}`), async (tx) => {
    await database.insertCaseVersion(tx, { organization_id: ORG, capa_case_id: CASE, case_version_id: LATER,
      version_number: 7, status, parent_version_id: NEXT, section_version_ids: [SECTION], change_reason: "Later legitimate activity",
      effective_at: NOW, created_at: NOW, created_by: { actor_type: "human", actor_id: USER } } as never);
    const advanced = await database.advanceCurrentVersion(tx, { organization_id: ORG, capa_case_id: CASE,
      expected_record_version: 6, expected_current_version_id: NEXT, next_current_version_id: LATER,
      next_status: status, updated_at: NOW, updated_by: { actor_type: "human", actor_id: USER } } as never);
    expect(advanced).toMatchObject({ status: "updated", capa_case: { record_version: 7, current_version_id: LATER, status } });
  });
}

function body(decision: "approve" | "return_for_investigation", rationale = "Human decision rationale") {
  return decision === "approve"
    ? { expected_record_version: 5, expected_current_version_id: S50, decision, rationale, confirmation: CAPA_ROOT_CAUSE_GATE_APPROVAL_CONFIRMATION }
    : { expected_record_version: 5, expected_current_version_id: S50, decision, rationale };
}

describe("decideCapaRootCauseGate", () => {
  it("approves S50 to S60, preserves the submitted snapshot, and replays exactly", async () => {
    const test = await harness();
    const command = { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("approve-1"), body: body("approve") } as never;
    const result = await decideCapaRootCauseGate(test.dependencies, command);
    expect(result).toMatchObject({ status: "decided", decision: "approve", workflow_state: "S60", record_version: 6 });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, S50 as never)).toMatchObject({ status: "S50", section_version_ids: [SECTION] });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)).toMatchObject({ status: "S60", section_version_ids: [SECTION], parent_version_id: S50 });
    expect(await test.database.findEventById(ORG as never, CASE as never)).toBeNull();
    expect(await test.database.findEventById(ORG as never, APPROVAL_AUDIT as never)).toMatchObject({ event_type: "EVT-APPROVAL", metadata: { operation: "approve_root_cause", decision: "approved" } });
    expect(await test.database.findEventById(ORG as never, TRANSITION_AUDIT as never)).toMatchObject({ event_type: "EVT-STATE-TRANSITION", metadata: { from_state: "S50", to_state: "S60" } });
    await advanceAfterGate(test.database, "S70");
    const replay = await decideCapaRootCauseGate(test.dependencies, command);
    expect(replay).toMatchObject({ status: "already_decided", decision: "approve", workflow_state: "S60" });
    expect(replay).toMatchObject({ record_version: 6, resulting_case_version_id: NEXT, capa_case: { record_version: 6, current_version_id: NEXT, status: "S60" } });
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ record_version: 7, current_version_id: LATER, status: "S70" });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)).toMatchObject({ status: "S60" });
  });

  it("returns S50 to S40 without rewriting the submitted package", async () => {
    const test = await harness();
    const result = await decideCapaRootCauseGate(test.dependencies, {
      authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("return-1"), body: body("return_for_investigation"),
    } as never);
    expect(result).toMatchObject({ status: "decided", decision: "return_for_investigation", workflow_state: "S40", record_version: 6 });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, S50 as never)).toMatchObject({ status: "S50", section_version_ids: [SECTION] });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)).toMatchObject({ status: "S40", section_version_ids: [SECTION], parent_version_id: S50 });
    expect(await test.database.findEventById(ORG as never, APPROVAL_AUDIT as never)).toMatchObject({ metadata: { operation: "return_root_cause_for_investigation", decision: "returned_for_investigation" } });
    await advanceAfterGate(test.database, "S40");
    const replay = await decideCapaRootCauseGate(test.dependencies, {
      authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("return-1"), body: body("return_for_investigation"),
    } as never);
    expect(replay).toMatchObject({ status: "already_decided", decision: "return_for_investigation", workflow_state: "S40", record_version: 6, resulting_case_version_id: NEXT, capa_case: { record_version: 6, current_version_id: NEXT } });
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ record_version: 7, current_version_id: LATER, status: "S40" });
  });

  it("rejects malformed decisions and approval confirmation fail closed", async () => {
    const test = await harness();
    expect(await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("invalid-1"), body: { ...body("return_for_investigation"), confirmation: "unexpected" } } as never)).toMatchObject({ status: "validation_failed", reason_code: "INVALID_ROOT_CAUSE_GATE_BODY" });
    expect(await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("invalid-2"), body: { ...body("approve"), confirmation: "wrong" } } as never)).toMatchObject({ status: "validation_failed", reason_code: "INVALID_APPROVAL_CONFIRMATION" });
  });

  it("rejects an idempotency-key fingerprint mismatch", async () => {
    const test = await harness();
    const first = await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("same-key"), body: body("approve") } as never);
    expect(first).toMatchObject({ status: "decided" });
    const second = await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("same-key"), body: body("approve", "different rationale") } as never);
    expect(second).toMatchObject({ status: "idempotency_conflict" });
  });

  it("fails closed for stale step-up, policy denial, and non-human authority", async () => {
    const stale = await harness();
    const staleAuth = { ...(auth() as Record<string, unknown>), reauthenticated_at: undefined } as never;
    expect(await decideCapaRootCauseGate(stale.dependencies, { authentication: staleAuth, tenant: tenant(), capa_case_id: CASE, request_trace: trace("stale"), body: body("approve") } as never)).toMatchObject({ status: "step_up_required" });
    const denied = await harness();
    denied.dependencies.authorization_policy.evaluate = vi.fn().mockResolvedValue({ decision: "deny", reason_code: "REQUIRED_PERMISSION_NOT_GRANTED", policy_version: "policy-1", evaluated_at: NOW });
    expect(await decideCapaRootCauseGate(denied.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("denied"), body: body("return_for_investigation") } as never)).toMatchObject({ status: "authorization_denied" });
    const nonHuman = await harness();
    expect(await decideCapaRootCauseGate(nonHuman.dependencies, { authentication: { ...(auth() as Record<string, unknown>), principal: { principal_type: "service", service_identity_id: "90000000-0000-4000-8000-000000000001" } } as never, tenant: tenant(), capa_case_id: CASE, request_trace: trace("service"), body: body("approve") } as never)).toMatchObject({ status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED" });
  });

  it("rejects stale snapshots and concurrent aggregate advancement", async () => {
    const staleVersion = await harness();
    expect(await decideCapaRootCauseGate(staleVersion.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("stale-version"), body: { expected_record_version: 4, expected_current_version_id: S50, decision: "approve", rationale: "Human decision rationale", confirmation: CAPA_ROOT_CAUSE_GATE_APPROVAL_CONFIRMATION } } as never)).toMatchObject({ status: "concurrency_conflict", reason_code: "RECORD_VERSION_CONFLICT" });
    expect(await decideCapaRootCauseGate(staleVersion.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("stale-current"), body: { expected_record_version: 5, expected_current_version_id: LATER, decision: "return_for_investigation", rationale: "Human decision rationale" } } as never)).toMatchObject({ status: "not_found_or_not_authorized" });
    const concurrent = await harness();
    const repository = Object.create(concurrent.database) as InMemoryCapaDatabase;
    repository.advanceCurrentVersion = vi.fn().mockResolvedValue({ status: "conflict", reason_code: "RECORD_VERSION_CONFLICT" });
    const dependencies = { ...concurrent.dependencies, capa_repository: repository };
    expect(await decideCapaRootCauseGate(dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("concurrent"), body: body("approve") } as never)).toMatchObject({ status: "concurrency_conflict" });
    expect(await concurrent.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ status: "S50", record_version: 5, current_version_id: S50 });
    expect(await concurrent.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)).toBeNull();
  });

  it.each([
    ["rationale", { ...body("approve"), rationale: "Different" }],
    ["decision", body("return_for_investigation")],
    ["record version", { ...body("approve"), expected_record_version: 4 }],
    ["current version", { ...body("approve"), expected_current_version_id: ALTERNATE }],
    ["confirmation", { ...body("approve"), confirmation: "WRONG_CONFIRMATION" }],
  ])("rejects same-key mismatch for %s", async (_label, mismatched) => {
    const test = await harness();
    expect(await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("matrix"), body: body("approve") } as never)).toMatchObject({ status: "decided" });
    const result = await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace("matrix"), body: mismatched } as never);
    expect(result).toMatchObject({ status: _label === "confirmation" ? "validation_failed" : "idempotency_conflict" });
  });

  it("rolls back version, aggregate, audit, and idempotency writes when transaction stages fail", async () => {
    for (const stage of ["insert", "advance", "first-audit", "second-audit"] as const) {
      const test = await harness();
      const repository = Object.create(test.database) as InMemoryCapaDatabase;
      if (stage === "insert") repository.insertCaseVersion = vi.fn(async (transaction: never, version: never) => { await test.database.insertCaseVersion(transaction, version); throw new Error("insert failure"); });
      if (stage === "advance") repository.advanceCurrentVersion = vi.fn().mockRejectedValue(new Error("advance failure"));
      const audit = Object.create(test.database) as InMemoryCapaDatabase;
      let auditCalls = 0;
      audit.appendEvent = vi.fn(async (transaction: never, event: never) => { auditCalls += 1; if ((stage === "first-audit" && auditCalls === 1) || (stage === "second-audit" && auditCalls === 2)) throw new Error("audit failure"); return test.database.appendEvent(transaction, event); });
      const dependencies = { ...test.dependencies, capa_repository: repository, audit_repository: audit };
      await expect(decideCapaRootCauseGate(dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace(`rollback-${stage}`), body: body("approve") } as never)).rejects.toThrow();
      expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ status: "S50", record_version: 5, current_version_id: S50 });
      expect(await test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)).toBeNull();
      expect(await test.database.findEventById(ORG as never, APPROVAL_AUDIT as never)).toBeNull();
      expect(await test.database.findEventById(ORG as never, TRANSITION_AUDIT as never)).toBeNull();
      const retry = await decideCapaRootCauseGate(test.dependencies, { authentication: auth(), tenant: tenant(), capa_case_id: CASE, request_trace: trace(`rollback-${stage}`), body: body("approve") } as never);
      expect(retry).toMatchObject({ status: "decided" });
    }
  });
});
