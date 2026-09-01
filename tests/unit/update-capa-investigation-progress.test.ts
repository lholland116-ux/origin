import { describe, expect, it, vi } from "vitest";

import {
  updateCapaInvestigationProgress,
  validateCapaInvestigationProgressTransition,
  type UpdateCapaInvestigationProgressDependencies,
} from "../../lib/capa/application/update-capa-investigation-progress";
import { evaluateCapaRootCauseReadiness } from "../../lib/capa/domain/capa-root-cause-package";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "20000000-0000-4000-8000-000000000001";
const USER = "10000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000004";
const NEXT = "40000000-0000-4000-8000-000000000005";
const PLAN = "70000000-0000-4000-8000-000000000001";
const NEXT_PLAN = "70000000-0000-4000-8000-000000000002";
const OTHER = "70000000-0000-4000-8000-000000000003";
const AUDIT = "80000000-0000-4000-8000-000000000001";
const ALTERNATE_SOURCE = "40000000-0000-4000-8000-000000000010";
const NOW = "2026-09-01T12:00:00.000Z";
const human = { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null };

function item(item_id: string, status: string, dependencies: string[] = []) {
  return {
    item_id,
    investigation_question: `Question ${item_id}`,
    evidence_target: `Evidence ${item_id}`,
    investigation_method: "Review",
    owner_user_id: USER,
    due_date: "2026-09-30",
    sme_user_ids: [],
    dependency_item_ids: dependencies,
    scope_relationship: "Included process",
    status,
    disposition: status === "dispositioned" || status === "cancelled" ? "NOT_REQUIRED" : null,
    disposition_rationale: status === "dispositioned" || status === "cancelled" ? "Controlled rationale" : null,
    draft_provenance: human,
  };
}

function capaCase(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-000001",
    current_version_id: SOURCE, status: "S40", record_version: 4,
    owner_user_id: USER, confidentiality: "CUSTOMER_CONFIDENTIAL",
    effective_at: NOW, created_at: NOW, updated_at: NOW,
    created_by: { actor_type: "human", actor_id: USER },
    updated_by: { actor_type: "human", actor_id: USER }, ...overrides,
  };
}

function caseVersion(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG, capa_case_id: CASE, case_version_id: SOURCE,
    version_number: 4, parent_version_id: "40000000-0000-4000-8000-000000000003",
    change_reason: "G-03", status: "S40", section_version_ids: [OTHER, PLAN],
    effective_at: NOW, created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER }, ...overrides,
  };
}

function section(content: unknown, overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG, capa_case_id: CASE, section_version_id: PLAN,
    section_type: "CAPA.INVESTIGATION_PLAN", version_number: 1,
    schema_version: "capa-investigation-plan-1.0.0", content,
    change_reason: "G-03", effective_at: NOW, created_at: NOW,
    created_by: { actor_type: "human", actor_id: USER }, ...overrides,
  };
}

function command(overrides: Record<string, unknown> = {}) {
  return {
    authentication: {
      principal: { principal_type: "human", user_id: USER }, session_id: "session",
      authentication_method: "SUPABASE_SESSION", assurance_level: "SINGLE_FACTOR",
      authenticated_at: NOW, expires_at: "2026-09-02T12:00:00.000Z",
    },
    tenant: {
      organization_id: ORG, access_grant_id: "grant", access_path: "ORGANIZATION",
      authorization_policy_version: "policy-1", resolved_at: NOW, role_assignments: [],
    },
    capa_case_id: CASE, expected_record_version: 4,
    expected_current_version_id: SOURCE, item_id: "INV-1", new_status: "completed",
    disposition: null, disposition_rationale: null,
    request_trace: { request_id: "50000000-0000-4000-8000-000000000001", correlation_id: "60000000-0000-4000-8000-000000000001", idempotency_key: "progress-1" },
    ...overrides,
  } as never;
}

function trace(idempotency_key = "progress-1") {
  return {
    request_id: "50000000-0000-4000-8000-000000000001",
    correlation_id: "60000000-0000-4000-8000-000000000001",
    idempotency_key,
  } as never;
}

function harness(items = [item("INV-1", "planned")], options: { advanced?: unknown; claim?: unknown } = {}) {
  const sourcePlan = section({ items });
  const otherSection = section({}, { section_version_id: OTHER, section_type: "CAPA.INTAKE", schema_version: "intake-1" });
  const insertedSections: any[] = [];
  const insertedVersions: any[] = [];
  const audits: any[] = [];
  const repository = {
    findCaseById: vi.fn().mockResolvedValue(capaCase()),
    findCaseVersionById: vi.fn().mockResolvedValue(caseVersion()),
    findSectionVersionById: vi.fn(async (_o, _c, id) => id === PLAN ? sourcePlan : id === OTHER ? otherSection : null),
    insertSectionVersion: vi.fn(async (_t, value) => { insertedSections.push(value); }),
    insertCaseVersion: vi.fn(async (_t, value) => { insertedVersions.push(value); }),
    advanceCurrentVersion: vi.fn().mockResolvedValue(options.advanced ?? { status: "updated", capa_case: capaCase({ current_version_id: NEXT, record_version: 5 }) }),
  };
  const auditRepository = {
    appendEvent: vi.fn(async (_t, value) => { audits.push(value); return { status: "appended", event_id: AUDIT }; }),
    findEventById: vi.fn(),
  };
  const deps: UpdateCapaInvestigationProgressDependencies = {
    transaction_manager: { runInTransaction: vi.fn(async (trace, work) => work({ transaction_id: "tx", started_at: NOW, request_trace: trace })) } as never,
    capa_repository: repository as never,
    audit_repository: auditRepository as never,
    workflow_idempotency_repository: { claimWorkflowOperation: vi.fn().mockResolvedValue(options.claim ?? { status: "claimed" }) } as never,
    authorization_policy: { evaluate: vi.fn().mockResolvedValue({ decision: "allow", reason_code: "AUTHORIZED", policy_version: "policy-1", evaluated_at: NOW, relied_on_role_assignment_ids: ["role-1"] }) } as never,
    id_generator: {
      generateCaseId: vi.fn(), generateCaseVersionId: () => NEXT,
      generateSectionVersionId: () => NEXT_PLAN, generateAuditEventId: () => AUDIT,
    } as never,
    clock: { now: () => new Date(NOW) },
    configuration: { workflow_version: "workflow-1", audit_schema_version: "audit-1", authorization_purpose: "CAPA_CASE_EDIT" as never },
  };
  return { deps, repository, auditRepository, insertedSections, insertedVersions, audits };
}

async function statefulHarness(items = [item("INV-1", "planned")]) {
  let transactionSequence = 0;
  const database = new InMemoryCapaDatabase({
    generate_transaction_id: () => `transaction-${++transactionSequence}` as never,
    now: () => new Date(NOW),
  });
  await database.runInTransaction(trace("seed"), async (transaction) => {
    await database.insertCase(transaction, capaCase() as never);
    await database.insertSectionVersion(transaction, section({}, {
      section_version_id: OTHER, section_type: "CAPA.INTAKE", schema_version: "intake-1",
    }) as never);
    await database.insertSectionVersion(transaction, section({ items }) as never);
    await database.insertCaseVersion(transaction, caseVersion() as never);
    await database.insertCaseVersion(transaction, caseVersion({
      case_version_id: ALTERNATE_SOURCE,
      version_number: 3,
      parent_version_id: "40000000-0000-4000-8000-000000000002",
    }) as never);
  });
  const ids = {
    versions: [
      NEXT,
      "40000000-0000-4000-8000-000000000006",
      "40000000-0000-4000-8000-000000000007",
      "40000000-0000-4000-8000-000000000008",
      "40000000-0000-4000-8000-000000000009",
    ],
    sections: [
      NEXT_PLAN,
      "70000000-0000-4000-8000-000000000004",
      "70000000-0000-4000-8000-000000000005",
      "70000000-0000-4000-8000-000000000006",
      "70000000-0000-4000-8000-000000000007",
    ],
    audits: [
      AUDIT,
      "80000000-0000-4000-8000-000000000002",
      "80000000-0000-4000-8000-000000000003",
      "80000000-0000-4000-8000-000000000004",
      "80000000-0000-4000-8000-000000000005",
    ],
  };
  let failAt: "section" | "case" | "aggregate" | "audit" | null = null;
  const repository = {
    findCaseById: database.findCaseById.bind(database),
    findCaseVersionById: database.findCaseVersionById.bind(database),
    findSectionVersionById: database.findSectionVersionById.bind(database),
    insertSectionVersion: async (...args: any[]) => {
      if (failAt === "section") throw new Error("injected section failure");
      return database.insertSectionVersion(args[0], args[1]);
    },
    insertCaseVersion: async (...args: any[]) => {
      if (failAt === "case") throw new Error("injected case failure");
      return database.insertCaseVersion(args[0], args[1]);
    },
    advanceCurrentVersion: async (...args: any[]) => {
      if (failAt === "aggregate") throw new Error("injected aggregate failure");
      return database.advanceCurrentVersion(args[0], args[1]);
    },
  };
  const auditRepository = {
    findEventById: database.findEventById.bind(database),
    appendEvent: async (...args: any[]) => {
      if (failAt === "audit") throw new Error("injected audit failure");
      return database.appendEvent(args[0], args[1]);
    },
  };
  const policy = { evaluate: vi.fn().mockResolvedValue({
    decision: "allow", reason_code: "AUTHORIZED", policy_version: "policy-1",
    evaluated_at: NOW, relied_on_role_assignment_ids: ["role-1"],
  }) };
  const deps: UpdateCapaInvestigationProgressDependencies = {
    transaction_manager: database,
    capa_repository: repository as never,
    audit_repository: auditRepository as never,
    workflow_idempotency_repository: database,
    authorization_policy: policy as never,
    id_generator: {
      generateCaseVersionId: () => ids.versions.shift() as never,
      generateSectionVersionId: () => ids.sections.shift() as never,
      generateAuditEventId: () => ids.audits.shift() as never,
    } as never,
    clock: { now: () => new Date(NOW) },
    configuration: { workflow_version: "workflow-1", audit_schema_version: "audit-1", authorization_purpose: "CAPA_CASE_EDIT" as never },
  };
  return {
    database, deps, ids,
    setFailure(value: typeof failAt) { failAt = value; },
  };
}

function committedMap(database: InMemoryCapaDatabase, name: string): Map<string, unknown> {
  return (database as unknown as { committed_state: Record<string, Map<string, unknown>> })
    .committed_state[name]!;
}

describe("controlled S40 investigation progress", () => {
  it.each([
    ["planned", "in_progress"], ["planned", "completed"], ["planned", "dispositioned"],
    ["planned", "cancelled"], ["in_progress", "completed"], ["in_progress", "dispositioned"],
    ["in_progress", "cancelled"],
  ])("authorizes %s -> %s", (from, to) => {
    expect(validateCapaInvestigationProgressTransition(from as never, to as never)).toEqual({ status: "allowed" });
  });

  it.each([
    ["planned", "in_progress", null],
    ["planned", "completed", null],
    ["planned", "dispositioned", "NOT_REQUIRED"],
    ["planned", "cancelled", "NOT_REQUIRED"],
    ["in_progress", "completed", null],
    ["in_progress", "dispositioned", "NOT_REQUIRED"],
    ["in_progress", "cancelled", "NOT_REQUIRED"],
  ])("persists the complete service transition %s -> %s", async (from, to, disposition) => {
    const test = harness([item("INV-1", from)]);
    const result = await updateCapaInvestigationProgress(test.deps, command({
      new_status: to,
      disposition,
      disposition_rationale: disposition === null ? null : "Controlled rationale",
    }));
    expect(result).toMatchObject({ status: "updated", previous_item_status: from, new_item_status: to });
    expect(test.insertedSections[0].content.items[0]).toMatchObject({ status: to, disposition });
    expect(test.insertedVersions[0]).toMatchObject({ status: "S40", version_number: 5 });
    expect(test.audits[0]).toMatchObject({ event_type: "EVT-SUBSTANTIVE-CHANGE", metadata: { previous_item_status: from, new_item_status: to } });
  });

  it.each([
    ["planned", "in_progress", null],
    ["planned", "completed", null],
    ["planned", "dispositioned", "NOT_REQUIRED"],
    ["planned", "cancelled", "NOT_REQUIRED"],
    ["in_progress", "completed", null],
    ["in_progress", "dispositioned", "NOT_REQUIRED"],
    ["in_progress", "cancelled", "NOT_REQUIRED"],
  ])("persists %s -> %s through the real in-memory repositories", async (from, to, disposition) => {
    const unchanged = item("INV-2", "completed");
    const original = item("INV-1", from);
    const test = await statefulHarness([original, unchanged]);
    const result = await updateCapaInvestigationProgress(test.deps, command({
      new_status: to,
      disposition,
      disposition_rationale: disposition === null ? null : "Controlled rationale",
    }));
    expect(result).toMatchObject({
      status: "updated",
      capa_case: { status: "S40", record_version: 5, current_version_id: NEXT },
      case_version: { case_version_id: NEXT, version_number: 5, parent_version_id: SOURCE },
      investigation_plan_section_version: {
        section_version_id: NEXT_PLAN,
        version_number: 2,
        parent_version_id: PLAN,
      },
    });
    const aggregate = await test.database.findCaseById(ORG as never, CASE as never);
    const version = await test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never);
    const persistedPlan: any = await test.database.findSectionVersionById(ORG as never, CASE as never, NEXT_PLAN as never);
    const audit: any = await test.database.findEventById(ORG as never, AUDIT as never);
    expect(aggregate).toMatchObject({ status: "S40", record_version: 5, current_version_id: NEXT });
    expect(version).toMatchObject({ status: "S40", version_number: 5, parent_version_id: SOURCE, section_version_ids: [OTHER, NEXT_PLAN] });
    expect(persistedPlan).toMatchObject({ version_number: 2, parent_version_id: PLAN });
    expect(persistedPlan.content.items[0]).toEqual({
      ...original,
      status: to,
      disposition,
      disposition_rationale: disposition === null ? null : "Controlled rationale",
    });
    expect(persistedPlan.content.items[1]).toEqual(unchanged);
    expect(audit).toMatchObject({
      event_type: "EVT-SUBSTANTIVE-CHANGE",
      action: "UPDATE_CAPA_INVESTIGATION_PROGRESS",
      aggregate_version: 5,
      metadata: { previous_item_status: from, new_item_status: to },
    });
  });

  it.each([
    ["planned", "planned"], ["in_progress", "in_progress"], ["in_progress", "planned"],
    ["completed", "planned"], ["completed", "in_progress"], ["completed", "completed"],
    ["dispositioned", "planned"], ["dispositioned", "completed"],
    ["cancelled", "planned"], ["cancelled", "in_progress"],
  ])("prohibits %s -> %s", (from, to) => {
    expect(validateCapaInvestigationProgressTransition(from as never, to as never)).toMatchObject({ status: "prohibited", reason_code: "INVALID_ITEM_STATUS_TRANSITION" });
  });

  it("creates exactly one revised plan and S40 version while preserving immutable content and unrelated sections", async () => {
    const test = harness([item("INV-1", "planned"), item("INV-2", "completed")]);
    const result = await updateCapaInvestigationProgress(test.deps, command());
    expect(result).toMatchObject({ status: "updated", previous_item_status: "planned", new_item_status: "completed" });
    expect(test.insertedSections).toHaveLength(1);
    expect(test.insertedSections[0]).toMatchObject({ section_version_id: NEXT_PLAN, version_number: 2, parent_version_id: PLAN });
    expect(test.insertedSections[0].content.items[0]).toEqual({ ...item("INV-1", "planned"), status: "completed" });
    expect(test.insertedSections[0].content.items[1]).toEqual(item("INV-2", "completed"));
    expect(test.insertedVersions).toHaveLength(1);
    expect(test.insertedVersions[0]).toMatchObject({ status: "S40", version_number: 5, parent_version_id: SOURCE, section_version_ids: [OTHER, NEXT_PLAN] });
    expect(test.repository.advanceCurrentVersion).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ expected_record_version: 4, expected_current_version_id: SOURCE, next_status: "S40" }));
    expect(test.audits[0]).toMatchObject({ event_type: "EVT-SUBSTANTIVE-CHANGE", action: "UPDATE_CAPA_INVESTIGATION_PROGRESS", aggregate_version: 5, metadata: { required_permission: "capa.case.edit", item_id: "INV-1", previous_item_status: "planned", new_item_status: "completed" } });
  });

  it("removes the CS4D2 open-plan blocker only after authoritative D3 completion", async () => {
    const test = harness();
    const ledger = { items: [] } as never;
    const rootCause = { hypotheses: [], root_cause_not_confirmed: null } as never;
    expect(evaluateCapaRootCauseReadiness({ items: [item("INV-1", "planned")] } as never, ledger, rootCause))
      .toMatchObject({ reason_codes: expect.arrayContaining(["OPEN_INVESTIGATION_PLAN_ITEM"]) });
    await updateCapaInvestigationProgress(test.deps, command());
    const readiness = evaluateCapaRootCauseReadiness(test.insertedSections[0].content, ledger, rootCause);
    expect(readiness).toMatchObject({ status: "blocked" });
    expect((readiness as any).reason_codes).not.toContain("OPEN_INVESTIGATION_PLAN_ITEM");
  });

  it.each(["planned", "in_progress"])("blocks progression while a dependency is %s", async (dependencyStatus) => {
    const test = harness([item("DEP", dependencyStatus), item("INV-1", "planned", ["DEP"])]);
    await expect(updateCapaInvestigationProgress(test.deps, command({ new_status: "in_progress" }))).resolves.toEqual({ status: "transition_conflict", reason_code: "OPEN_INVESTIGATION_DEPENDENCY" });
    expect(test.insertedSections).toHaveLength(0);
  });

  it.each(["completed", "dispositioned", "cancelled"])("allows progression when a dependency is %s", async (dependencyStatus) => {
    const test = harness([item("DEP", dependencyStatus), item("INV-1", "planned", ["DEP"])]);
    await expect(updateCapaInvestigationProgress(test.deps, command({ new_status: "in_progress" }))).resolves.toMatchObject({ status: "updated" });
  });

  it.each(["dispositioned", "cancelled"])("allows target %s despite an open dependency", async (newStatus) => {
    const test = harness([item("DEP", "planned"), item("INV-1", "planned", ["DEP"])]);
    await expect(updateCapaInvestigationProgress(test.deps, command({ new_status: newStatus, disposition: "NOT_REQUIRED", disposition_rationale: "Controlled rationale" }))).resolves.toMatchObject({ status: "updated" });
  });

  it.each(["in_progress", "completed", "dispositioned", "cancelled"])("rejects authoritative dangling dependencies before transition to %s", async (newStatus) => {
    const test = harness([item("INV-1", "planned", ["DOES-NOT-EXIST"])]);
    await expect(updateCapaInvestigationProgress(test.deps, command({
      new_status: newStatus,
      disposition: newStatus === "dispositioned" || newStatus === "cancelled" ? "NOT_REQUIRED" : null,
      disposition_rationale: newStatus === "dispositioned" || newStatus === "cancelled" ? "Controlled rationale" : null,
    }))).rejects.toThrow("unresolved dependency reference");
    expect(test.insertedSections).toHaveLength(0);
  });

  it("rejects a missing item deterministically", async () => {
    const test = harness();
    await expect(updateCapaInvestigationProgress(test.deps, command({ item_id: "MISSING" }))).resolves.toEqual({ status: "transition_conflict", reason_code: "INVESTIGATION_ITEM_NOT_FOUND" });
  });

  it.each([
    { new_status: "completed", disposition: "NOT_REQUIRED", disposition_rationale: null },
    { new_status: "in_progress", disposition: null, disposition_rationale: "reason" },
    { new_status: "dispositioned", disposition: null, disposition_rationale: null },
    { new_status: "cancelled", disposition: "NOT_REQUIRED", disposition_rationale: null },
  ])("rejects invalid disposition combinations", async (overrides) => {
    const test = harness();
    await expect(updateCapaInvestigationProgress(test.deps, command(overrides))).resolves.toMatchObject({ status: "validation_failed" });
  });

  it("requires a human principal", async () => {
    const test = harness();
    await expect(updateCapaInvestigationProgress(test.deps, command({ authentication: { principal: { principal_type: "service", service_id: "service" } } }))).resolves.toMatchObject({ status: "authorization_denied", reason_code: "AUTHORIZED_HUMAN_REQUIRED" });
  });

  it.each(["S30", "S50"])("rejects source state %s", async (status) => {
    const test = harness();
    test.repository.findCaseVersionById.mockResolvedValueOnce(caseVersion({ status }));
    await expect(updateCapaInvestigationProgress(test.deps, command())).resolves.toMatchObject({ status: "workflow_conflict" });
  });

  it("returns deterministic record and current-version conflicts", async () => {
    let test = harness();
    test.repository.findCaseById.mockResolvedValueOnce(capaCase({ record_version: 5 }));
    await expect(updateCapaInvestigationProgress(test.deps, command())).resolves.toMatchObject({ status: "concurrency_conflict", reason_code: "RECORD_VERSION_CONFLICT" });
    test = harness();
    test.repository.findCaseById.mockResolvedValueOnce(capaCase({ current_version_id: NEXT }));
    await expect(updateCapaInvestigationProgress(test.deps, command())).resolves.toMatchObject({ status: "concurrency_conflict", reason_code: "CURRENT_VERSION_CONFLICT" });
  });

  it("rejects same-key changed commands", async () => {
    const test = harness(undefined, { claim: { status: "conflict" } });
    await expect(updateCapaInvestigationProgress(test.deps, command())).resolves.toMatchObject({ status: "idempotency_conflict" });
    expect(test.insertedSections).toHaveLength(0);
  });

  it.each(["none", "event", "action", "before", "after", "source", "result", "source-plan", "result-plan", "item", "old-status", "new-status", "disposition"])("replays exactly and rejects audit corruption (%s)", async (corruption) => {
    const test = harness();
    await expect(updateCapaInvestigationProgress(test.deps, command())).resolves.toMatchObject({ status: "updated" });
    const resultVersion = test.insertedVersions[0];
    const resultPlan = test.insertedSections[0];
    const audit = structuredClone(test.audits[0]);
    if (corruption === "event") audit.event_type = "EVT-STATE-TRANSITION";
    if (corruption === "action") audit.action = "OTHER_ACTION";
    if (corruption === "before") audit.change.before_ref.object_version_id = NEXT;
    if (corruption === "after") audit.change.after_ref.object_version_id = SOURCE;
    if (corruption === "source") audit.metadata.source_case_version_id = NEXT;
    if (corruption === "result") audit.metadata.resulting_case_version_id = SOURCE;
    if (corruption === "source-plan") audit.metadata.previous_investigation_plan_section_version_id = NEXT_PLAN;
    if (corruption === "result-plan") audit.metadata.resulting_investigation_plan_section_version_id = PLAN;
    if (corruption === "item") audit.metadata.item_id = "OTHER";
    if (corruption === "old-status") audit.metadata.previous_item_status = "in_progress";
    if (corruption === "new-status") audit.metadata.new_item_status = "in_progress";
    if (corruption === "disposition") audit.metadata.disposition = "NOT_REQUIRED";
    const record = {
      organization_id: ORG, idempotency_key: "progress-1",
      operation_code: "UPDATE_CAPA_INVESTIGATION_PROGRESS", request_fingerprint: "fingerprint",
      capa_case_id: CASE, source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT, audit_event_id: AUDIT,
    };
    (test.deps.workflow_idempotency_repository.claimWorkflowOperation as any).mockResolvedValue({ status: "already_claimed", record });
    test.repository.findCaseById.mockResolvedValue(capaCase({ current_version_id: NEXT, record_version: 5 }));
    test.repository.findCaseVersionById.mockImplementation(async (_o, _c, id) => id === SOURCE ? caseVersion() : id === NEXT ? resultVersion : null);
    test.repository.findSectionVersionById.mockImplementation(async (_o, _c, id) => {
      if (id === PLAN) return section({ items: [item("INV-1", "planned")] });
      if (id === NEXT_PLAN) return resultPlan;
      if (id === OTHER) return section({}, { section_version_id: OTHER, section_type: "CAPA.INTAKE", schema_version: "intake-1" });
      return null;
    });
    (test.auditRepository.findEventById as any).mockResolvedValue(audit);
    const replayPromise = updateCapaInvestigationProgress(test.deps, command());
    if (corruption !== "none") await expect(replayPromise).rejects.toThrow();
    else await expect(replayPromise).resolves.toMatchObject({ status: "already_updated", audit_event_id: AUDIT });
    expect(test.insertedSections).toHaveLength(1);
    expect(test.insertedVersions).toHaveLength(1);
    expect(test.audits).toHaveLength(1);
  });

  it("independently rejects corrupted historical disposition rationale", async () => {
    const test = harness();
    const dispositionCommand = command({
      new_status: "dispositioned",
      disposition: "NOT_REQUIRED",
      disposition_rationale: "Controlled rationale",
    });
    await updateCapaInvestigationProgress(test.deps, dispositionCommand);
    const resultVersion = test.insertedVersions[0];
    const resultPlan = test.insertedSections[0];
    const audit = structuredClone(test.audits[0]);
    audit.metadata.disposition_rationale = "Corrupted rationale";
    const record = {
      organization_id: ORG, idempotency_key: "progress-1",
      operation_code: "UPDATE_CAPA_INVESTIGATION_PROGRESS", request_fingerprint: "fingerprint",
      capa_case_id: CASE, source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT, audit_event_id: AUDIT,
    };
    (test.deps.workflow_idempotency_repository.claimWorkflowOperation as any)
      .mockResolvedValue({ status: "already_claimed", record });
    test.repository.findCaseById.mockResolvedValue(capaCase({ current_version_id: NEXT, record_version: 5 }));
    test.repository.findCaseVersionById.mockImplementation(async (_o, _c, id) => id === SOURCE ? caseVersion() : resultVersion);
    test.repository.findSectionVersionById.mockImplementation(async (_o, _c, id) => {
      if (id === PLAN) return section({ items: [item("INV-1", "planned")] });
      if (id === NEXT_PLAN) return resultPlan;
      if (id === OTHER) return section({}, { section_version_id: OTHER, section_type: "CAPA.INTAKE", schema_version: "intake-1" });
      return null;
    });
    (test.auditRepository.findEventById as any).mockResolvedValue(audit);
    await expect(updateCapaInvestigationProgress(test.deps, dispositionCommand))
      .rejects.toThrow("audit metadata is inconsistent");
  });

  it.each([
    "source-org", "source-case", "source-status", "result-org", "result-case", "result-status",
    "result-parent", "result-version", "plan-parent", "plan-version", "dangling-source",
    "dangling-result", "target-field", "unrelated-item", "item-order", "unrelated-section",
  ])("rejects historical replay corruption in %s", async (corruption) => {
    const test = harness([item("INV-1", "planned"), item("INV-2", "completed")]);
    await updateCapaInvestigationProgress(test.deps, command());
    let source = caseVersion();
    let result = test.insertedVersions[0];
    let sourcePlan = section({ items: [item("INV-1", "planned"), item("INV-2", "completed")] });
    let resultPlan = test.insertedSections[0];
    if (corruption === "source-org") source = { ...source, organization_id: "20000000-0000-4000-8000-000000000009" };
    if (corruption === "source-case") source = { ...source, capa_case_id: "30000000-0000-4000-8000-000000000009" };
    if (corruption === "source-status") source = { ...source, status: "S50" };
    if (corruption === "result-org") result = { ...result, organization_id: "20000000-0000-4000-8000-000000000009" };
    if (corruption === "result-case") result = { ...result, capa_case_id: "30000000-0000-4000-8000-000000000009" };
    if (corruption === "result-status") result = { ...result, status: "S50" };
    if (corruption === "result-parent") result = { ...result, parent_version_id: NEXT };
    if (corruption === "result-version") result = { ...result, version_number: 8 };
    if (corruption === "plan-parent") resultPlan = { ...resultPlan, parent_version_id: OTHER };
    if (corruption === "plan-version") resultPlan = { ...resultPlan, version_number: 4 };
    if (corruption === "dangling-source") sourcePlan = section({ items: [item("INV-1", "planned", ["MISSING"]), item("INV-2", "completed")] });
    if (corruption === "dangling-result") resultPlan = { ...resultPlan, content: { items: [item("INV-1", "completed", ["MISSING"]), item("INV-2", "completed")] } };
    if (corruption === "target-field") resultPlan = { ...resultPlan, content: { items: [{ ...item("INV-1", "completed"), due_date: "2026-10-01" }, item("INV-2", "completed")] } };
    if (corruption === "unrelated-item") resultPlan = { ...resultPlan, content: { items: [item("INV-1", "completed"), { ...item("INV-2", "completed"), investigation_method: "Interview" }] } };
    if (corruption === "item-order") resultPlan = { ...resultPlan, content: { items: [item("INV-2", "completed"), item("INV-1", "completed")] } };
    if (corruption === "unrelated-section") result = { ...result, section_version_ids: [PLAN, NEXT_PLAN] };
    const record = {
      organization_id: ORG, idempotency_key: "progress-1", operation_code: "UPDATE_CAPA_INVESTIGATION_PROGRESS",
      request_fingerprint: "fingerprint", capa_case_id: CASE, source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT, audit_event_id: AUDIT,
    };
    (test.deps.workflow_idempotency_repository.claimWorkflowOperation as any).mockResolvedValue({ status: "already_claimed", record });
    test.repository.findCaseById.mockResolvedValue(capaCase({ current_version_id: NEXT, record_version: 5 }));
    test.repository.findCaseVersionById.mockImplementation(async (_o, _c, id) => id === SOURCE ? source : result);
    test.repository.findSectionVersionById.mockImplementation(async (_o, _c, id) => id === PLAN ? sourcePlan : id === NEXT_PLAN ? resultPlan : id === OTHER ? section({}, { section_version_id: OTHER, section_type: "CAPA.INTAKE", schema_version: "intake-1" }) : null);
    (test.auditRepository.findEventById as any).mockResolvedValue(test.audits[0]);
    const attempt = updateCapaInvestigationProgress(test.deps, command());
    if (corruption === "source-status") await expect(attempt).resolves.toMatchObject({ status: "workflow_conflict" });
    else await expect(attempt).rejects.toThrow();
  });

  it("replays historical A after real later D3 B without moving the aggregate", async () => {
    const test = await statefulHarness();
    const requestA = command({ new_status: "in_progress", request_trace: trace("progress-a") });
    const resultA = await updateCapaInvestigationProgress(test.deps, requestA);
    expect(resultA).toMatchObject({ status: "updated", capa_case: { record_version: 5, current_version_id: NEXT } });
    const requestB = command({
      expected_record_version: 5,
      expected_current_version_id: NEXT,
      new_status: "completed",
      request_trace: trace("progress-b"),
    });
    const resultB = await updateCapaInvestigationProgress(test.deps, requestB);
    expect(resultB).toMatchObject({ status: "updated", capa_case: { record_version: 6 } });
    const currentBeforeReplay = await test.database.findCaseById(ORG as never, CASE as never);
    const planIdsBeforeReplay = [...committedMap(test.database, "section_versions").values()]
      .filter((value: any) => value.section_type === "CAPA.INVESTIGATION_PLAN")
      .map((value: any) => value.section_version_id)
      .sort();
    const replay = await updateCapaInvestigationProgress(test.deps, requestA);
    expect(replay).toMatchObject({
      status: "already_updated",
      capa_case: { status: "S40", record_version: 5, current_version_id: NEXT },
      case_version: { case_version_id: NEXT },
      investigation_plan_section_version: { section_version_id: NEXT_PLAN },
    });
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toEqual(currentBeforeReplay);
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, "40000000-0000-4000-8000-000000000007" as never)).toBeNull();
    expect(await test.database.findSectionVersionById(ORG as never, CASE as never, "70000000-0000-4000-8000-000000000005" as never)).toBeNull();
    expect(await test.database.findEventById(ORG as never, "80000000-0000-4000-8000-000000000003" as never)).toBeNull();
    const planIdsAfterReplay = [...committedMap(test.database, "section_versions").values()]
      .filter((value: any) => value.section_type === "CAPA.INVESTIGATION_PLAN")
      .map((value: any) => value.section_version_id)
      .sort();
    expect(planIdsAfterReplay).toEqual(planIdsBeforeReplay);
    expect(planIdsAfterReplay).toEqual([PLAN, NEXT_PLAN, "70000000-0000-4000-8000-000000000004"].sort());
  });

  it.each(["section", "case", "aggregate", "audit"] as const)("rolls back real persisted state after an injected %s failure", async (failure) => {
    const test = await statefulHarness();
    test.setFailure(failure);
    await expect(updateCapaInvestigationProgress(test.deps, command())).rejects.toThrow(`injected ${failure} failure`);
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ status: "S40", record_version: 4, current_version_id: SOURCE });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, NEXT as never)).toBeNull();
    expect(await test.database.findSectionVersionById(ORG as never, CASE as never, NEXT_PLAN as never)).toBeNull();
    expect(await test.database.findEventById(ORG as never, AUDIT as never)).toBeNull();
    test.setFailure(null);
    await expect(updateCapaInvestigationProgress(test.deps, command())).resolves.toMatchObject({ status: "updated", capa_case: { record_version: 5 } });
  });

  it("uses real dual expectations so first D3 wins and stale D3 leaves no orphan state", async () => {
    const test = await statefulHarness([item("INV-1", "planned"), item("INV-2", "planned")]);
    await expect(updateCapaInvestigationProgress(test.deps, command({ item_id: "INV-1", request_trace: trace("winner") })))
      .resolves.toMatchObject({ status: "updated" });
    const stale = await updateCapaInvestigationProgress(test.deps, command({ item_id: "INV-2", request_trace: trace("stale") }));
    expect(stale).toMatchObject({ status: "concurrency_conflict" });
    expect(await test.database.findCaseById(ORG as never, CASE as never)).toMatchObject({ record_version: 5, current_version_id: NEXT });
    expect(await test.database.findCaseVersionById(ORG as never, CASE as never, "40000000-0000-4000-8000-000000000006" as never)).toBeNull();
    expect(await test.database.findSectionVersionById(ORG as never, CASE as never, "70000000-0000-4000-8000-000000000004" as never)).toBeNull();
    expect(await test.database.findEventById(ORG as never, "80000000-0000-4000-8000-000000000002" as never)).toBeNull();
    expect(committedMap(test.database, "workflow_idempotency").has(`${ORG}:stale`)).toBe(false);
  });

  it.each([
    [{}, { expected_record_version: 5 }],
    [{}, { expected_current_version_id: ALTERNATE_SOURCE }],
    [{}, { item_id: "INV-2" }],
    [{}, { new_status: "in_progress" }],
    [
      { new_status: "dispositioned", disposition: "NOT_REQUIRED", disposition_rationale: "Controlled rationale" },
      { new_status: "dispositioned", disposition: "OUT_OF_SCOPE", disposition_rationale: "Controlled rationale" },
    ],
    [
      { new_status: "dispositioned", disposition: "NOT_REQUIRED", disposition_rationale: "Controlled rationale" },
      { new_status: "dispositioned", disposition: "NOT_REQUIRED", disposition_rationale: "Different rationale" },
    ],
  ])("uses real idempotency storage to reject a changed fingerprint", async (initial, changed) => {
    const test = await statefulHarness([item("INV-1", "planned"), item("INV-2", "planned")]);
    const original = command({ ...initial, request_trace: trace("same-key") });
    await updateCapaInvestigationProgress(test.deps, original);
    await expect(updateCapaInvestigationProgress(test.deps, command({
      ...changed,
      request_trace: trace("same-key"),
    }))).resolves.toMatchObject({ status: "idempotency_conflict" });
  });
});
