import { describe, expect, it, vi } from "vitest";

import {
  CAPA_INVESTIGATION_RELEASE_CONFIRMATION,
  releaseCapaInvestigation,
  type ReleaseCapaInvestigationDependencies,
} from "../../lib/capa/application/release-capa-investigation";

const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "20000000-0000-4000-8000-000000000001";
const CASE = "30000000-0000-4000-8000-000000000001";
const VERSION = "40000000-0000-4000-8000-000000000001";

function plan(status = "planned") {
  return {
    items: [{
      item_id: "INV-001",
      investigation_question: "What caused the event?",
      evidence_target: "Controlled records",
      investigation_method: "Document review",
      owner_user_id: USER,
      due_date: "2026-09-30",
      sme_user_ids: [],
      dependency_item_ids: [],
      scope_relationship: "Approved G-01 scope",
      status,
      disposition: null,
      disposition_rationale: null,
      draft_provenance: {
        source_type: "human",
        source_reference: null,
        adopted_by_user_id: null,
        adopted_at: null,
      },
    }],
  };
}

function dependencies(): ReleaseCapaInvestigationDependencies {
  return {
    transaction_manager: { runInTransaction: vi.fn() } as never,
    capa_repository: {
      findCaseById: vi.fn().mockResolvedValue(null),
    } as never,
    audit_repository: {} as never,
    workflow_idempotency_repository: {} as never,
    authorization_policy: {
      evaluate: vi.fn().mockResolvedValue({
        decision: "deny",
        reason_code: "REQUIRED_PERMISSION_NOT_GRANTED",
        policy_version: "policy-1",
        evaluated_at: "2026-09-01T12:00:00.000Z",
      }),
    },
    id_generator: {} as never,
    clock: { now: () => new Date("2026-09-01T12:00:00.000Z") },
    configuration: {
      workflow_version: "workflow-1",
      audit_schema_version: "audit-1",
      authorization_purpose: "CAPA_WORKFLOW_TRANSITION" as never,
    },
  };
}

function command(body: unknown) {
  return {
    authentication: {
      principal: { principal_type: "human" as const, user_id: USER as never },
      session_id: "session" as never,
      authentication_method: "SUPABASE_SESSION" as never,
      assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-09-01T11:00:00.000Z" as never,
      expires_at: "2026-09-01T13:00:00.000Z" as never,
    },
    tenant: {
      organization_id: ORG as never,
      access_grant_id: "grant" as never,
      access_path: "ORGANIZATION" as never,
      authorization_policy_version: "policy-1",
      resolved_at: "2026-09-01T12:00:00.000Z" as never,
      role_assignments: [],
    },
    capa_case_id: CASE as never,
    expected_record_version: 3,
    expected_current_version_id: VERSION as never,
    request_trace: {
      request_id: "50000000-0000-4000-8000-000000000001" as never,
      correlation_id: "60000000-0000-4000-8000-000000000001" as never,
      idempotency_key: "release-1" as never,
    },
    body,
  };
}

function body(investigationPlan: unknown = plan()) {
  return {
    investigation_plan: investigationPlan,
    release: {
      confirmation: CAPA_INVESTIGATION_RELEASE_CONFIRMATION,
      comment: null,
    },
  };
}

describe("G-03 investigation release application boundary", () => {
  it("atomically persists one S40 version, plan section, and transition audit", async () => {
    const sourceSectionId = "70000000-0000-4000-8000-000000000001";
    const nextVersionId = "40000000-0000-4000-8000-000000000002";
    const planSectionId = "70000000-0000-4000-8000-000000000002";
    const auditId = "80000000-0000-4000-8000-000000000001";
    const capaCase = {
      organization_id: ORG,
      capa_case_id: CASE,
      case_number: "CAPA-000001",
      current_version_id: VERSION,
      status: "S30",
      record_version: 3,
      owner_user_id: USER,
      confidentiality: "CUSTOMER_CONFIDENTIAL",
      effective_at: "2026-09-01T10:00:00.000Z",
      created_at: "2026-09-01T10:00:00.000Z",
      updated_at: "2026-09-01T10:00:00.000Z",
      created_by: { actor_type: "human", actor_id: USER },
      updated_by: { actor_type: "human", actor_id: USER },
    };
    const sourceVersion = {
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: VERSION,
      version_number: 3,
      change_reason: "G-02",
      status: "S30",
      section_version_ids: [sourceSectionId],
      effective_at: "2026-09-01T10:00:00.000Z",
      created_at: "2026-09-01T10:00:00.000Z",
      created_by: { actor_type: "human", actor_id: USER },
    };
    const insertSectionVersion = vi.fn();
    const insertCaseVersion = vi.fn();
    const appendEvent = vi.fn().mockResolvedValue({ status: "appended", event_id: auditId });
    const deps: ReleaseCapaInvestigationDependencies = {
      ...dependencies(),
      transaction_manager: {
        runInTransaction: vi.fn(async (trace, work) => work({
          transaction_id: "transaction-1",
          started_at: "2026-09-01T12:00:00.000Z",
          request_trace: trace,
        })),
      } as never,
      capa_repository: {
        findCaseById: vi.fn().mockResolvedValue(capaCase),
        findCaseVersionById: vi.fn().mockResolvedValue(sourceVersion),
        findSectionVersionById: vi.fn().mockResolvedValue({
          organization_id: ORG,
          capa_case_id: CASE,
          section_version_id: sourceSectionId,
          section_type: "CAPA.CONTAINMENT_RISK",
        }),
        insertSectionVersion,
        insertCaseVersion,
        advanceCurrentVersion: vi.fn().mockResolvedValue({
          status: "updated",
          capa_case: { ...capaCase, status: "S40", record_version: 4, current_version_id: nextVersionId },
        }),
      } as never,
      audit_repository: { appendEvent } as never,
      workflow_idempotency_repository: {
        claimWorkflowOperation: vi.fn().mockResolvedValue({ status: "claimed" }),
      } as never,
      authorization_policy: {
        evaluate: vi.fn().mockResolvedValue({
          decision: "allow",
          reason_code: "AUTHORIZED_BY_ACTIVE_ROLE_ASSIGNMENT",
          policy_version: "policy-1",
          evaluated_at: "2026-09-01T12:00:00.000Z",
          relied_on_role_assignment_ids: ["owner-assignment"],
        }),
      },
      id_generator: {
        generateCapaCaseId: vi.fn(),
        generateCaseVersionId: () => nextVersionId as never,
        generateSectionVersionId: () => planSectionId as never,
        generateAuditEventId: () => auditId as never,
      },
    };

    const result = await releaseCapaInvestigation(deps, command(body()));
    expect(result).toMatchObject({ status: "released", capa_case: { status: "S40", record_version: 4 } });
    expect(insertSectionVersion).toHaveBeenCalledOnce();
    expect(insertCaseVersion).toHaveBeenCalledOnce();
    expect(insertCaseVersion.mock.calls[0]![1]).toMatchObject({
      status: "S40",
      parent_version_id: VERSION,
      section_version_ids: [sourceSectionId, planSectionId],
    });
    expect(appendEvent).toHaveBeenCalledOnce();
    expect(appendEvent.mock.calls[0]![1]).toMatchObject({
      event_type: "EVT-STATE-TRANSITION",
      action: "RELEASE_CAPA_INVESTIGATION",
      metadata: {
        gate: "G-03",
        transition_event: "Authorize investigation execution",
        from_state: "S30",
        to_state: "S40",
        confirmation: CAPA_INVESTIGATION_RELEASE_CONFIRMATION,
        required_permission: "capa.case.submit",
      },
    });
  });

  it("accepts planned readiness and reaches server authorization without MFA", async () => {
    const deps = dependencies();
    const result = await releaseCapaInvestigation(deps, command(body()));
    expect(result).toEqual({ status: "not_found_or_not_authorized" });
    expect(deps.capa_repository.findCaseById).toHaveBeenCalledOnce();
  });

  it.each([
    ["in_progress", "INVESTIGATION_EXECUTION_ALREADY_STARTED"],
    ["completed", "INVESTIGATION_EXECUTION_COMPLETED_BEFORE_RELEASE"],
  ])("blocks %s before any repository access", async (status, blocker) => {
    const deps = dependencies();
    const result = await releaseCapaInvestigation(deps, command(body(plan(status))));
    expect(result).toEqual({ status: "gate_blocked", blocker_codes: [blocker] });
    expect(deps.capa_repository.findCaseById).not.toHaveBeenCalled();
  });

  it("rejects missing and invalid confirmation", async () => {
    const deps = dependencies();
    await expect(releaseCapaInvestigation(deps, command({
      investigation_plan: plan(),
      release: { confirmation: "APPROVED", comment: null },
    }))).resolves.toMatchObject({
      status: "validation_failed",
      reason_code: "INVALID_INVESTIGATION_RELEASE_CONFIRMATION",
    });
  });

  it("rejects unknown fields and unsafe comments", async () => {
    const deps = dependencies();
    await expect(releaseCapaInvestigation(deps, command({ ...body(), override: true }))).resolves.toMatchObject({ status: "validation_failed" });
    await expect(releaseCapaInvestigation(deps, command({
      investigation_plan: plan(),
      release: { confirmation: CAPA_INVESTIGATION_RELEASE_CONFIRMATION, comment: " comment" },
    }))).resolves.toMatchObject({ reason_code: "INVALID_INVESTIGATION_RELEASE_COMMENT" });
  });

  it("preserves every CS4A readiness blocker and exposes no override", async () => {
    const deps = dependencies();
    const missing = plan();
    missing.items[0]!.investigation_question = null as never;
    const result = await releaseCapaInvestigation(deps, command(body(missing)));
    expect(result).toEqual({ status: "gate_blocked", blocker_codes: ["MISSING_INVESTIGATION_QUESTION"] });
    expect(releaseCapaInvestigation).toHaveLength(2);
  });
});
