import { describe, expect, it, vi } from "vitest";
import { RepositoryCapaImplementationEvidenceAdvisoryContextResolver } from "../../lib/capa/ai/capa-implementation-evidence-advisory-context";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import type { CapaImplementationWorkspaceService } from "../../lib/capa/application/capa-implementation-workspace-service";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const EVIDENCE = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-10T12:00:00.000Z");
const TRACE = {
  organization_id: ORG,
  capa_case_id: CASE,
  user_id: USER,
  request_id: "60000000-0000-4000-8000-000000000001",
  correlation_id: "70000000-0000-4000-8000-000000000001",
};

const requestContext = {
  authentication: {
    principal: { principal_type: "human", user_id: USER },
    session_id: "80000000-0000-4000-8000-000000000001",
    authentication_method: "password",
    assurance_level: "aal1",
    authenticated_at: NOW.toISOString(),
    expires_at: "2026-09-10T13:00:00.000Z",
  },
  tenant: {
    organization_id: ORG,
    access_grant_id: "90000000-0000-4000-8000-000000000001",
    access_path: "HUMAN_MEMBERSHIP",
    authorization_policy_version: "policy-1.0.0",
    resolved_at: NOW.toISOString(),
    role_assignments: [{
      role_assignment_id: "91000000-0000-4000-8000-000000000001",
      role_id: "CAPA_OWNER",
      scope: "ORGANIZATION",
      effective_at: "2026-01-01T00:00:00.000Z",
    }],
  },
  owner_user_id: USER,
} as unknown as CapaRequestContext;

function workspace(overrides: Record<string, unknown> = {}) {
  return {
    draft_revision: 2,
    case_version_id: VERSION,
    record_version: 8,
    approved_s70_baseline: {
      source_case_version_id: "30000000-0000-4000-8000-000000000002",
      approved_action_plan_section_id: "30000000-0000-4000-8000-000000000003",
      approval_decision_reference: "30000000-0000-4000-8000-000000000004",
    },
    approved_actions: [{
      approved_action_reference: "ACTION-1",
      status: "approved",
      action_type: "corrective",
      description: "Complete the approved action.",
      due_date: "2026-09-30",
      deliverable: "Validated record",
      implementation_expectation: "Training record",
      effectiveness_check_required: false,
      acceptance_criteria: ["Training is validated."],
    }],
    draft: {
      schema_version: "capa-implementation-workspace-draft-1.0.0",
      action_progress: [{
        approved_action_reference: "ACTION-1",
        owner_reported_status: "in_progress",
        implementation_narrative: "Training is underway.",
        blocked_reason: null,
        evidence: [{
          evidence_id: EVIDENCE,
          approved_action_reference: "ACTION-1",
          evidence_kind: "training_record",
          description: "Training completion record",
          evidence_date: "2026-09-10",
          source: { source_record_reference: "TR-1" },
        }],
      }],
      implementation_review_return_response: null,
    },
    updated_at: NOW.toISOString(),
    ...overrides,
  };
}

function resolver(overrides: Record<string, unknown> = {}) {
  const workspaceService = {
    load: vi.fn(async () => ({ status: "loaded", workspace: workspace() })),
  } as unknown as CapaImplementationWorkspaceService;
  const value = new RepositoryCapaImplementationEvidenceAdvisoryContextResolver({
    workspace_service: workspaceService,
    authentication: requestContext.authentication,
    tenant: requestContext.tenant,
    now: () => NOW,
    ...overrides,
  });
  return { value, workspaceService };
}

describe("S80 advisory server context", () => {
  it("L/M: resolves the approved S70 baseline, workspace, evidence, roles, and safe references server-side", async () => {
    const subject = resolver({
      knowledge_provider: {
        retrieve: vi.fn(async () => ({
          references: [{ source_reference: "controlled-procedure-1", locator: "section-2", title: "Current procedure" }],
          citations: [],
          warnings: ["Knowledge was limited to current-effective material."],
          retrieval_provenance: { retrieval: "governed" },
        })),
      },
    });
    const result = await subject.value.resolve(TRACE as never);
    expect(result.status).toBe("resolved");
    if (result.status !== "resolved") return;
    expect(result.assembly.authoritative).toMatchObject({ workflow_state: "S80", case_version_id: VERSION, approved_actions: [{ approved_action_reference: "ACTION-1" }] });
    expect(result.assembly.model_safe_context).toMatchObject({ trust: "model_safe_context", workflow_state: "S80", untrusted_human_workspace: expect.any(Object), governed_knowledge: [{ source_reference: "controlled-procedure-1" }] });
    expect(result.assembly.reference_manifest).toEqual(expect.arrayContaining([
      expect.objectContaining({ source_kind: "approved_action", source_status: "authoritative" }),
      expect.objectContaining({ source_kind: "implementation_evidence", source_status: "untrusted_human_draft", source_reference: EVIDENCE }),
      expect.objectContaining({ source_kind: "governed_knowledge", source_status: "governed_current_effective" }),
    ]));
    expect(result.assembly.knowledge_warnings).toEqual(["Knowledge was limited to current-effective material."]);
  });

  it("N/O: fails closed for mismatched identity, non-human identity, and non-S80 workspace results", async () => {
    const mismatched = resolver().value.resolve({ ...TRACE, organization_id: "99999999-9999-4999-8999-999999999999" } as never);
    await expect(mismatched).resolves.toMatchObject({ status: "not_found_or_not_authorized" });

    const servicePrincipal = resolver();
    const nonHuman = new RepositoryCapaImplementationEvidenceAdvisoryContextResolver({
      workspace_service: servicePrincipal.workspaceService,
      authentication: { ...requestContext.authentication, principal: { principal_type: "service", service_identity_id: "service-1" } } as never,
      tenant: requestContext.tenant,
      now: () => NOW,
    });
    await expect(nonHuman.resolve(TRACE as never)).resolves.toMatchObject({ status: "not_found_or_not_authorized" });

    const wrongState = resolver();
    vi.mocked(wrongState.workspaceService.load).mockResolvedValue({ status: "workflow_conflict", reason_code: "WORKFLOW_STATE_NOT_ALLOWED" } as never);
    await expect(wrongState.value.resolve(TRACE as never)).resolves.toMatchObject({ status: "wrong_workflow_state" });
  });

  it("P/Q/R: maps missing baselines and knowledge failures without exposing partial context", async () => {
    const baseline = resolver();
    vi.mocked(baseline.workspaceService.load).mockResolvedValue({ status: "baseline_unavailable", reason_code: "APPROVED_S70_BASELINE_NOT_AVAILABLE" } as never);
    await expect(baseline.value.resolve(TRACE as never)).resolves.toMatchObject({ status: "baseline_unavailable" });

    const unavailable = resolver({ knowledge_provider: { retrieve: vi.fn(async () => { throw new Error("knowledge"); }) } });
    await expect(unavailable.value.resolve(TRACE as never)).resolves.toMatchObject({ status: "knowledge_unavailable" });
  });

  it("S/T: detects a changed implementation workspace before persistence", async () => {
    const subject = resolver();
    const resolved = await subject.value.resolve(TRACE as never);
    expect(resolved.status).toBe("resolved");
    if (resolved.status !== "resolved") return;
    vi.mocked(subject.workspaceService.load).mockResolvedValue({ status: "loaded", workspace: workspace({ record_version: 9 }) } as never);
    await expect(subject.value.assertCaseUnchanged(resolved.assembly.authoritative)).resolves.toBe(false);
  });
});
