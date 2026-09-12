import { describe, expect, it, vi } from "vitest";
import type {
  AuthenticationContext,
} from "../../lib/security/auth-context";
import type {
  CapaRequestContext,
} from "../../lib/security/supabase-capa-context";
import type {
  TenantContext,
} from "../../lib/security/tenant-context";
import {
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
} from "../../lib/capa/domain/capa-action-plan";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";
import {
  createCapaImplementationWorkspaceService,
} from "../../lib/capa/application/capa-implementation-workspace-service";
import {
  createCapaImplementationReturnCycleResolver,
} from "../../lib/capa/application/capa-implementation-return-cycle-resolver";
import type {
  CapaImplementationWorkspaceRecord,
  CapaImplementationWorkspaceRepository,
  SaveCapaImplementationWorkspaceInput,
  SaveCapaImplementationWorkspaceResult,
} from "../../lib/database/repositories/capa-implementation-workspace-repository";
import {
  CapaImplementationWorkspaceRepositoryError,
  normalizeCapaImplementationWorkspaceRecord,
} from "../../lib/database/repositories/capa-implementation-workspace-repository";
import type {
  CapaActionPlanReviewDecisionRepository,
} from "../../lib/database/repositories/capa-action-plan-review-decision-repository";
import type {
  CapaAuthorizationPolicy,
} from "../../lib/capa/authorization/capa-policy";
import type {
  CapaRepository,
} from "../../lib/database/repositories/capa-repository";
import type {
  TransactionManager,
} from "../../lib/database/transactions";
import type {
  TransactionContext,
} from "../../lib/database/transactions";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const OTHER_CASE = "20000000-0000-4000-8000-000000000002";
const SOURCE_VERSION = "30000000-0000-4000-8000-000000000001";
const CURRENT_VERSION = "30000000-0000-4000-8000-000000000002";
const ACTION_SECTION = "40000000-0000-4000-8000-000000000001";
const APPROVAL_AUDIT = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const EVIDENCE = "70000000-0000-4000-8000-000000000001";
const RETURN_AUDIT = "80000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const ACTION_PLAN = {
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
    draft_provenance: {
      source_type: "human",
      source_reference: null,
      adopted_by_user_id: null,
      adopted_at: null,
    },
  }],
  effectiveness_checks: [],
};

const BASELINE = {
  source_case_version_id: SOURCE_VERSION,
  approved_action_plan_section_id: ACTION_SECTION,
  approval_decision_reference: APPROVAL_AUDIT,
};

const source = {
  origin_kind: "uploaded_artifact",
  source_system_kind: "other",
  source_system_name: "Document store",
  source_record_reference: "TR-001",
  source_record_version: "1",
  artifact_reference: "artifact://TR-001",
};

const evidence = {
  schema_version: CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
  evidence_id: EVIDENCE,
  approved_action_reference: "ACTION-1",
  evidence_kind: "training_record",
  description: "Training completion record",
  evidence_date: "2026-09-10",
  source,
};

const response = {
  schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
  return_transition_audit_event_id: RETURN_AUDIT,
  source_case_version_id: SOURCE_VERSION,
  resulting_case_version_id: CURRENT_VERSION,
  response_narrative: "The returned implementation comments were addressed.",
};

const currentCase = {
  organization_id: ORG,
  capa_case_id: CASE,
  current_version_id: CURRENT_VERSION,
  status: "S80",
  record_version: 8,
};

const sourceVersion = {
  organization_id: ORG,
  capa_case_id: CASE,
  case_version_id: SOURCE_VERSION,
  version_number: 7,
  status: "S70",
  section_version_ids: [ACTION_SECTION],
};

const currentVersion = {
  organization_id: ORG,
  capa_case_id: CASE,
  case_version_id: CURRENT_VERSION,
  version_number: 8,
  status: "S80",
  parent_version_id: SOURCE_VERSION,
  section_version_ids: [ACTION_SECTION],
};

const section = {
  organization_id: ORG,
  capa_case_id: CASE,
  section_version_id: ACTION_SECTION,
  section_type: CAPA_ACTION_PLAN_SECTION_TYPE,
  schema_version: CAPA_ACTION_PLAN_SCHEMA_VERSION,
  content: ACTION_PLAN,
};

const decision = {
  organization_id: ORG,
  capa_case_id: CASE,
  source_case_version_id: SOURCE_VERSION,
  action_plan_section_version_id: ACTION_SECTION,
  schema_version: "capa-action-plan-review-decision-1.0.0",
  decision: "approve",
  rationale: "Approved for implementation.",
  reviewer_user_id: USER,
  decided_at: AT,
  resulting_case_version_id: CURRENT_VERSION,
  transition_audit_event_id: APPROVAL_AUDIT,
};

const authentication: AuthenticationContext = {
  principal: { principal_type: "human", user_id: USER as never },
  session_id: "90000000-0000-4000-8000-000000000001" as never,
  authentication_method: "password" as never,
  assurance_level: "aal1" as never,
  authenticated_at: AT as never,
  expires_at: "2026-09-10T13:00:00.000Z" as never,
};

const tenant: TenantContext = {
  organization_id: ORG as never,
  access_grant_id: "91000000-0000-4000-8000-000000000001" as never,
  access_path: "DEVELOPMENT_SINGLE_USER_TENANT" as never,
  authorization_policy_version: "test-policy-1.0.0",
  resolved_at: AT as never,
  role_assignments: [],
};

const requestContext: CapaRequestContext = {
  authentication,
  tenant,
  owner_user_id: USER as never,
};

function body(overrides: Record<string, unknown> = {}) {
  return {
    expected_draft_revision: null,
    action_progress: [{
      approved_action_reference: "ACTION-1",
      owner_reported_status: "in_progress",
      implementation_narrative: "Implementation is underway.",
      blocked_reason: null,
      evidence: [evidence],
    }],
    implementation_review_return_response: {
      response_narrative: response.response_narrative,
    },
    ...overrides,
  };
}

function createRecord(input: SaveCapaImplementationWorkspaceInput): CapaImplementationWorkspaceRecord {
  return normalizeCapaImplementationWorkspaceRecord({
    organization_id: input.organization_id,
    capa_case_id: input.capa_case_id,
    case_version_id: input.case_version_id,
    record_version: input.record_version,
    workflow_state: "S80",
    approved_s70_baseline: input.approved_s70_baseline,
    draft_revision: input.draft_revision,
    draft: input.draft,
    created_by_user_id: input.actor_user_id,
    created_at: AT,
    updated_by_user_id: input.actor_user_id,
    updated_at: AT,
  });
}

function harness(options: { readonly useRealReturnCycleResolver?: boolean } = {}) {
  let persisted: CapaImplementationWorkspaceRecord | null = null;
  let forcedResult: SaveCapaImplementationWorkspaceResult | null = null;
  let forcedError: Error | null = null;
  let lastInput: SaveCapaImplementationWorkspaceInput | null = null;
  const saveWorkspace = vi.fn(async (
    _transaction: TransactionContext,
    input: SaveCapaImplementationWorkspaceInput,
  ): Promise<SaveCapaImplementationWorkspaceResult> => {
    lastInput = input;
    if (forcedError !== null) throw forcedError;
    if (forcedResult !== null) return forcedResult;
    persisted = createRecord(input);
    return { status: "saved", workspace: persisted };
  });
  const initializeWorkspace = vi.fn(async (
    transaction: TransactionContext,
    input: SaveCapaImplementationWorkspaceInput,
  ): Promise<SaveCapaImplementationWorkspaceResult> => saveWorkspace(
    transaction,
    input,
  ));
  const repository: CapaImplementationWorkspaceRepository = {
    findWorkspace: vi.fn(async () => persisted),
    findWorkspaceForUpdate: vi.fn(async () => persisted),
    initializeWorkspace,
    saveWorkspace,
  };
  const capaRepository = {
    findCaseById: vi.fn(async (_organizationId, capaCaseId) =>
      capaCaseId === CASE ? currentCase : null),
    findCaseVersionById: vi.fn(async (_organizationId, _capaCaseId, caseVersionId) =>
      caseVersionId === SOURCE_VERSION ? sourceVersion : currentVersion),
    findSectionVersionById: vi.fn(async () => section),
  } as unknown as CapaRepository;
  const reviewDecisionRepository = {
    findDecision: vi.fn(async () => decision),
  } as unknown as CapaActionPlanReviewDecisionRepository;
  const transactionManager = {
    runInTransaction: vi.fn(async (trace, work) => work({
      transaction_id: "92000000-0000-4000-8000-000000000001" as never,
      started_at: AT as never,
      request_trace: trace,
    })),
  } as unknown as TransactionManager;
  const authorizationPolicy: CapaAuthorizationPolicy = {
    evaluate: vi.fn(async () => ({
      decision: "allow" as const,
      reason_code: "TEST_ALLOWED" as never,
      policy_version: "test-policy-1.0.0",
      evaluated_at: AT as never,
      relied_on_role_assignment_ids: [],
    })),
  };
  const returnCycleResolver = options.useRealReturnCycleResolver
    ? createCapaImplementationReturnCycleResolver({
      capa_repository: capaRepository,
      implementation_review_decision_repository: {
        findDecision: reviewDecisionRepository.findDecision.bind(reviewDecisionRepository),
      } as any,
    })
    : {
      resolve: vi.fn(async () => ({
        status: "active" as const,
        cycle: {
          return_transition_audit_event_id: RETURN_AUDIT as never,
          source_case_version_id: SOURCE_VERSION as never,
          resulting_case_version_id: CURRENT_VERSION as never,
          returned_by_user_id: USER as never,
          returned_at: AT as never,
          rationale: "Reviewer return rationale.",
        },
      })),
    };
  const service = createCapaImplementationWorkspaceService({
    request_context: requestContext,
    capa_repository: capaRepository,
    review_decision_repository: reviewDecisionRepository,
    workspace_repository: repository,
    transaction_manager: transactionManager,
    authorization_policy: authorizationPolicy,
    return_cycle_resolver: returnCycleResolver,
    now: () => new Date(AT),
  });
  return {
    service,
    repository,
    capaRepository,
    transactionManager,
    get persisted() { return persisted; },
    set forcedResult(value: SaveCapaImplementationWorkspaceResult | null) { forcedResult = value; },
    set forcedError(value: Error | null) { forcedError = value; },
    get lastInput() { return lastInput; },
  };
}

describe("S80 implementation workspace application service", () => {
  it("resolves the approved S70 baseline and projects a safe first-entry load", async () => {
    const h = harness({ useRealReturnCycleResolver: true });
    const result = await h.service.load({ capa_case_id: CASE as never });
    expect(result).toMatchObject({
      status: "loaded",
      workspace: {
        draft_revision: null,
        draft: null,
        approved_s70_baseline: BASELINE,
          approved_actions: [{
          approved_action_reference: "ACTION-1",
          description: ACTION_PLAN.items[0].description,
          due_date: ACTION_PLAN.items[0].due_date,
          deliverable: ACTION_PLAN.items[0].deliverable,
          implementation_expectation: ACTION_PLAN.items[0].implementation_evidence,
          }],
        implementation_review_return_cycle: null,
      },
    });
    expect(result).not.toHaveProperty("workspace.created_by_user_id");
    expect(result).not.toHaveProperty("workspace.organization_id");

    const { implementation_review_return_response: _omitted, ...firstEntryBody } = body();
    const saved = await h.service.save({
      capa_case_id: CASE as never,
      body: firstEntryBody,
      request_trace: {} as never,
    });
    expect(saved).toMatchObject({ status: "saved", workspace: { implementation_review_return_cycle: null } });
    expect(saved).not.toMatchObject({ reason_code: "IMPLEMENTATION_REVIEW_RETURN_RESPONSE_REQUIRED" });
  });

  it("saves only mutable request state and returns evidence/provenance/return response safely", async () => {
    const h = harness();
    const result = await h.service.save({
      capa_case_id: CASE as never,
      body: body(),
      request_trace: { request_id: "93000000-0000-4000-8000-000000000001", correlation_id: "94000000-0000-4000-8000-000000000001" } as never,
    });
    expect(result).toMatchObject({
      status: "saved",
      workspace: {
        draft_revision: 1,
        draft: {
          action_progress: [{ evidence: [evidence] }],
          implementation_review_return_response: response,
        },
      },
    });
    expect(h.lastInput?.approved_s70_baseline).toEqual(BASELINE);
    expect(h.lastInput?.organization_id).toBe(ORG);
    expect(h.repository.initializeWorkspace).toHaveBeenCalledTimes(1);
    expect(result).not.toHaveProperty("workspace.updated_by_user_id");
    expect(result).not.toHaveProperty("workspace.created_at");
  });

  it("rejects baseline injection and non-authoritative action references before repository save", async () => {
    const h = harness();
    const injected = await h.service.save({
      capa_case_id: CASE as never,
      body: body({ approved_s70_baseline: BASELINE }),
      request_trace: {} as never,
    });
    expect(injected).toMatchObject({ status: "validation_failed" });
    expect(h.repository.saveWorkspace).not.toHaveBeenCalled();

    const nonAuthoritative = await h.service.save({
      capa_case_id: CASE as never,
      body: body({
        action_progress: [{
          approved_action_reference: "ACTION-OTHER",
          owner_reported_status: "in_progress",
          implementation_narrative: "Wrong action.",
          blocked_reason: null,
          evidence: [],
        }],
      }),
      request_trace: {} as never,
    });
    expect(nonAuthoritative).toMatchObject({
      status: "validation_failed",
      reason_code: "APPROVED_ACTION_REFERENCE_NOT_AUTHORITATIVE",
    });
    expect(h.repository.saveWorkspace).not.toHaveBeenCalled();
  });

  it("rejects evidence outside the authoritative action set and metadata injection", async () => {
    const h = harness();
    const mismatchedEvidence = {
      ...evidence,
      approved_action_reference: "ACTION-OTHER",
    };
    const evidenceResult = await h.service.save({
      capa_case_id: CASE as never,
      body: body({
        action_progress: [{
          approved_action_reference: "ACTION-1",
          owner_reported_status: "in_progress",
          implementation_narrative: "Implementation is underway.",
          blocked_reason: null,
          evidence: [mismatchedEvidence],
        }],
      }),
      request_trace: {} as never,
    });
    expect(evidenceResult).toMatchObject({ status: "validation_failed" });
    expect(h.repository.initializeWorkspace).not.toHaveBeenCalled();

    const metadataResult = await h.service.save({
      capa_case_id: CASE as never,
      body: body({
        created_by_user_id: USER,
        updated_at: AT,
      }),
      request_trace: {} as never,
    });
    expect(metadataResult).toMatchObject({ status: "validation_failed" });
    expect(h.repository.initializeWorkspace).not.toHaveBeenCalled();
  });

  it("rejects cross-case and cross-organization requests at the tenant boundary", async () => {
    const h = harness();
    const result = await h.service.load({ capa_case_id: OTHER_CASE as never });
    expect(result).toEqual({ status: "not_found" });
    expect(h.repository.findWorkspace).not.toHaveBeenCalled();
    expect(h.capaRepository.findCaseById).toHaveBeenCalledWith(ORG, OTHER_CASE);
  });

  it("maps a repository failure without exposing persistence details", async () => {
    const h = harness();
    h.forcedError = new CapaImplementationWorkspaceRepositoryError("database detail");
    const result = await h.service.save({
      capa_case_id: CASE as never,
      body: body(),
      request_trace: {} as never,
    });
    expect(result).toEqual({ status: "persistence_failed" });
  });

  it("maps repository revision conflicts without last-write-wins behavior", async () => {
    const h = harness();
    await h.service.save({
      capa_case_id: CASE as never,
      body: body(),
      request_trace: {} as never,
    });
    h.forcedResult = { status: "concurrency_conflict" };
    const stale = await h.service.save({
      capa_case_id: CASE as never,
      body: body({ expected_draft_revision: 1 }),
      request_trace: {} as never,
    });
    expect(stale).toEqual({ status: "concurrency_conflict" });
  });
});
