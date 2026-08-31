import { describe, expect, it, vi } from "vitest";
import { CAPA_INVESTIGATION_RELEASE_CONFIRMATION, releaseCapaInvestigation,
  type ReleaseCapaInvestigationDependencies } from
  "../../lib/capa/application/release-capa-investigation";

const USER_A = "10000000-0000-4000-8000-000000000001";
const USER_B = "10000000-0000-4000-8000-000000000002";
const WRONG_TENANT = "10000000-0000-4000-8000-000000000003";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const SOURCE = "40000000-0000-4000-8000-000000000001";
const NEXT = "40000000-0000-4000-8000-000000000002";
const PRIOR_SECTION = "70000000-0000-4000-8000-000000000001";
const PLAN_SECTION = "70000000-0000-4000-8000-000000000002";
const AUDIT = "80000000-0000-4000-8000-000000000001";

function item(id: string, owner: string) {
  return { item_id: id, investigation_question: "Question", evidence_target: "Records",
    investigation_method: "Review", owner_user_id: owner, due_date: "2026-09-30",
    sme_user_ids: [], dependency_item_ids: [], scope_relationship: "G-01 scope",
    status: "planned", disposition: null, disposition_rationale: null,
    draft_provenance: { source_type: "human", source_reference: null,
      adopted_by_user_id: null, adopted_at: null } };
}

function command(items = [item("INV-1", USER_A)]) {
  return {
    authentication: { principal: { principal_type: "human" as const, user_id: USER_A as never },
      session_id: "session" as never, authentication_method: "SUPABASE_SESSION" as never,
      assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-09-01T11:00:00.000Z" as never,
      expires_at: "2026-09-01T13:00:00.000Z" as never },
    tenant: { organization_id: ORG as never, access_grant_id: "grant" as never,
      access_path: "ORGANIZATION" as never, authorization_policy_version: "policy-1",
      resolved_at: "2026-09-01T12:00:00.000Z" as never, role_assignments: [] },
    capa_case_id: CASE as never, expected_record_version: 3,
    expected_current_version_id: SOURCE as never,
    request_trace: { request_id: "request" as never, correlation_id: "correlation" as never,
      idempotency_key: "release-eligibility" as never },
    body: { investigation_plan: { items }, release: {
      confirmation: CAPA_INVESTIGATION_RELEASE_CONFIRMATION, comment: null } },
  };
}

function harness(ineligible: readonly string[] = []) {
  const insertSectionVersion = vi.fn();
  const insertCaseVersion = vi.fn();
  const advanceCurrentVersion = vi.fn().mockResolvedValue({ status: "updated", capa_case: {
    organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-1", current_version_id: NEXT,
    status: "S40", record_version: 4, owner_user_id: USER_A,
  } });
  const appendEvent = vi.fn().mockResolvedValue({ status: "appended", event_id: AUDIT });
  const findEventById = vi.fn();
  const eligibility = vi.fn().mockResolvedValue(ineligible);
  let claimPersisted = false;
  const claim = vi.fn().mockImplementation(async () => {
    claimPersisted = true;
    return { status: "claimed" };
  });
  const transactionManager = { runInTransaction: vi.fn(async (trace, work) => {
    try {
      return await work({ transaction_id: "transaction", started_at: "2026-09-01T12:00:00.000Z",
        request_trace: trace });
    } catch (error) {
      claimPersisted = false;
      throw error;
    }
  }) };
  const capaCase = { organization_id: ORG, capa_case_id: CASE, case_number: "CAPA-1",
    current_version_id: SOURCE, status: "S30", record_version: 3, owner_user_id: USER_A };
  const sourceVersion = { organization_id: ORG, capa_case_id: CASE, case_version_id: SOURCE,
    version_number: 3, status: "S30", section_version_ids: [PRIOR_SECTION] };
  const deps: ReleaseCapaInvestigationDependencies = {
    transaction_manager: transactionManager as never,
    capa_repository: { findCaseById: vi.fn().mockResolvedValue(capaCase),
      findCaseVersionById: vi.fn().mockResolvedValue(sourceVersion),
      findSectionVersionById: vi.fn().mockResolvedValue({ organization_id: ORG,
        capa_case_id: CASE, section_version_id: PRIOR_SECTION, section_type: "CAPA.CONTAINMENT_RISK" }),
      insertSectionVersion, insertCaseVersion, advanceCurrentVersion } as never,
    audit_repository: { appendEvent, findEventById } as never,
    workflow_idempotency_repository: { claimWorkflowOperation: claim } as never,
    participant_eligibility_repository: { listEligibleInvestigationOwners: vi.fn(),
      findIneligibleInvestigationOwnerIds: eligibility },
    authorization_policy: { evaluate: vi.fn().mockResolvedValue({ decision: "allow",
      reason_code: "AUTHORIZED", policy_version: "policy-1",
      evaluated_at: "2026-09-01T12:00:00.000Z", relied_on_role_assignment_ids: [] }) },
    id_generator: { generateCaseVersionId: () => NEXT as never,
      generateSectionVersionId: () => PLAN_SECTION as never,
      generateAuditEventId: () => AUDIT as never } as never,
    clock: { now: () => new Date("2026-09-01T12:00:00.000Z") },
    configuration: { workflow_version: "workflow-1", audit_schema_version: "audit-1",
      authorization_purpose: "CAPA_WORKFLOW_TRANSITION" as never },
  };
  return { deps, eligibility, insertSectionVersion, insertCaseVersion,
    advanceCurrentVersion, appendEvent, findEventById, claimPersisted: () => claimPersisted };
}

describe("G-03 commit-time investigation-owner eligibility", () => {
  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR"])("permits an eligible %s owner", async () => {
    const test = harness();
    await expect(releaseCapaInvestigation(test.deps, command())).resolves.toMatchObject({ status: "released" });
    expect(test.insertSectionVersion).toHaveBeenCalledOnce();
  });

  it.each(["revoked", "wrong-tenant"])("uses one public failure for a %s owner", async (kind) => {
    const owner = kind === "wrong-tenant" ? WRONG_TENANT : USER_A;
    const test = harness([owner]);
    await expect(releaseCapaInvestigation(test.deps, command([item("INV-1", owner)])))
      .resolves.toEqual({ status: "owner_eligibility_failed",
        reason_code: "INELIGIBLE_INVESTIGATION_PLAN_OWNER" });
  });

  it("deduplicates repeated owners before validation", async () => {
    const test = harness();
    await releaseCapaInvestigation(test.deps, command([
      item("INV-1", USER_A), item("INV-2", USER_A), item("INV-3", USER_B),
    ]));
    expect(test.eligibility.mock.calls[0]![2]).toEqual([USER_A, USER_B]);
  });

  it("one invalid owner rolls back the claim and prevents every material effect", async () => {
    const test = harness([USER_B]);
    await releaseCapaInvestigation(test.deps, command([item("INV-1", USER_A), item("INV-2", USER_B)]));
    expect(test.claimPersisted()).toBe(false);
    expect(test.insertSectionVersion).not.toHaveBeenCalled();
    expect(test.insertCaseVersion).not.toHaveBeenCalled();
    expect(test.advanceCurrentVersion).not.toHaveBeenCalled();
    expect(test.appendEvent).not.toHaveBeenCalled();
  });

  it("a committed exact replay bypasses later owner revocation", async () => {
    const test = harness([USER_A]);
    const record = { organization_id: ORG, idempotency_key: "release-eligibility",
      operation_code: "RELEASE_CAPA_INVESTIGATION", request_fingerprint: "a".repeat(64),
      capa_case_id: CASE, source_case_version_id: SOURCE,
      resulting_case_version_id: NEXT, audit_event_id: AUDIT };
    (test.deps.workflow_idempotency_repository.claimWorkflowOperation as ReturnType<typeof vi.fn>)
      .mockResolvedValue({ status: "already_claimed", record });
    (test.deps.capa_repository.findCaseById as ReturnType<typeof vi.fn>).mockResolvedValue({
      organization_id: ORG, capa_case_id: CASE, status: "S40", current_version_id: NEXT });
    (test.deps.capa_repository.findCaseVersionById as ReturnType<typeof vi.fn>)
      .mockImplementation(async (_org: string, _case: string, id: string) => id === SOURCE
        ? { organization_id: ORG, capa_case_id: CASE, case_version_id: SOURCE,
          status: "S30", section_version_ids: [PRIOR_SECTION], version_number: 3 }
        : { organization_id: ORG, capa_case_id: CASE, case_version_id: NEXT,
          parent_version_id: SOURCE, status: "S40", section_version_ids: [PLAN_SECTION] });
    (test.deps.capa_repository.findSectionVersionById as ReturnType<typeof vi.fn>)
      .mockImplementation(async (_org: string, _case: string, id: string) => ({
        organization_id: ORG, capa_case_id: CASE, section_version_id: id,
        section_type: id === PLAN_SECTION ? "CAPA.INVESTIGATION_PLAN" : "CAPA.CONTAINMENT_RISK" }));
    test.findEventById.mockResolvedValue({ event_type: "EVT-STATE-TRANSITION" });
    await expect(releaseCapaInvestigation(test.deps, command())).resolves.toMatchObject({
      status: "already_released",
    });
    expect(test.eligibility).not.toHaveBeenCalled();
  });
});
