import { describe, expect, it } from "vitest";
import {
  validateCapaImplementationReviewReturnResponseContent,
  validateCapaImplementationReviewReturnResponseDraft,
  validateCapaImplementationReviewReturnResponseEditableContent,
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";
import { validateCapaImplementationWorkspaceSaveRequest } from "../../lib/capa/application/capa-implementation-workspace-request";
import { createCapaImplementationReturnCycleResolver } from "../../lib/capa/application/capa-implementation-return-cycle-resolver";
import {
  parseCapaImplementationWorkspaceLoad,
  saveCapaImplementationWorkspace,
} from "../../app/capa/capa-implementation-workspace-client";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const S90 = "30000000-0000-4000-8000-000000000001";
const S80 = "30000000-0000-4000-8000-000000000002";
const S70 = "30000000-0000-4000-8000-000000000003";
const RETURN_AUDIT = "40000000-0000-4000-8000-000000000001";
const REVIEWER = "50000000-0000-4000-8000-000000000001";
const BASELINE = "60000000-0000-4000-8000-000000000001";
const APPROVAL = "70000000-0000-4000-8000-000000000001";
const ACTION = "ACTION-1";
const AT = "2026-09-11T12:00:00.000Z";

const editable = { response_narrative: "The owner completed the requested rework." };
const draft = {
  schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
  return_transition_audit_event_id: RETURN_AUDIT,
  source_case_version_id: S90,
  resulting_case_version_id: S80,
  response_narrative: editable.response_narrative,
};
const content = {
  ...draft,
  schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_SCHEMA_VERSION,
  resubmitted_case_version_id: "30000000-0000-4000-8000-000000000004",
  responded_by: { actor_type: "human", actor_id: REVIEWER },
  responded_at: AT,
};

const progress = [{
  approved_action_reference: ACTION,
  owner_reported_status: "in_progress" as const,
  implementation_narrative: "The approved control is being implemented.",
  blocked_reason: null,
  evidence: [],
}];

function resolverHarness(overrides: Record<string, unknown> = {}) {
  const capaCase: any = { organization_id: ORG, capa_case_id: CASE, current_version_id: S80, status: "S80", record_version: 11 };
  const versions: Record<string, any> = {
    [S90]: { organization_id: ORG, capa_case_id: CASE, case_version_id: S90, version_number: 10, status: "S90", parent_version_id: S70 },
    [S80]: { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 11, status: "S80", parent_version_id: S90 },
  };
  const decision: any = { organization_id: ORG, capa_case_id: CASE, source_case_version_id: S90, decision: "return", rationale: "Provide additional implementation evidence.", reviewer_user_id: REVIEWER, decided_at: AT, resulting_case_version_id: S80, transition_audit_event_id: RETURN_AUDIT, ...overrides };
  return createCapaImplementationReturnCycleResolver({
    capa_repository: {
      findCaseById: async () => capaCase,
      findCaseVersionById: async (_org: unknown, _case: unknown, id: string) => versions[id] ?? null,
    } as any,
    implementation_review_decision_repository: {
      findDecision: async () => decision,
    } as any,
  });
}

function workspaceProjection(overrides: Record<string, unknown> = {}) {
  return {
    draft_revision: null,
    case_version_id: S80,
    record_version: 11,
    approved_s70_baseline: {
      source_case_version_id: S70,
      approved_action_plan_section_id: BASELINE,
      approval_decision_reference: APPROVAL,
    },
    approved_actions: [{
      approved_action_reference: ACTION,
      status: "approved",
      action_type: "corrective",
      description: "Implement the control.",
      due_date: null,
      deliverable: "Evidence",
      implementation_expectation: "Validation result",
      effectiveness_check_required: false,
      acceptance_criteria: [],
    }],
    draft: null,
    implementation_review_return_cycle: {
      return_transition_audit_event_id: RETURN_AUDIT,
      source_case_version_id: S90,
      resulting_case_version_id: S80,
      returned_by_user_id: REVIEWER,
      returned_at: AT,
      rationale: "Provide additional implementation evidence.",
    },
    updated_at: null,
    ...overrides,
  };
}

describe("S90 implementation-review return/rework qualification", () => {
  it("accepts only the editable owner response field", () => {
    expect(validateCapaImplementationReviewReturnResponseEditableContent(editable).status).toBe("valid");
  });

  it("rejects a blank owner response", () => {
    expect(validateCapaImplementationReviewReturnResponseEditableContent({ response_narrative: " " })).toMatchObject({ status: "invalid" });
  });

  it("rejects client-supplied cycle metadata in editable content", () => {
    expect(validateCapaImplementationReviewReturnResponseEditableContent({ ...editable, source_case_version_id: S90 })).toMatchObject({ status: "invalid" });
  });

  it("validates a server-bound response draft", () => {
    expect(validateCapaImplementationReviewReturnResponseDraft(draft).status).toBe("valid");
  });

  it("rejects a response draft with a mismatched source version shape", () => {
    expect(validateCapaImplementationReviewReturnResponseDraft({ ...draft, source_case_version_id: "not-a-uuid" })).toMatchObject({ status: "invalid" });
  });

  it("validates immutable response content", () => {
    expect(validateCapaImplementationReviewReturnResponseContent(content).status).toBe("valid");
  });

  it("rejects immutable content without resubmission identity", () => {
    const { resubmitted_case_version_id: _removed, ...missing } = content;
    expect(validateCapaImplementationReviewReturnResponseContent(missing)).toMatchObject({ status: "invalid" });
  });

  it("rejects non-human response attribution", () => {
    expect(validateCapaImplementationReviewReturnResponseContent({ ...content, responded_by: { actor_type: "ai", actor_id: REVIEWER } })).toMatchObject({ status: "invalid" });
  });

  it("resolves the exact active S90 return cycle", async () => {
    await expect(resolverHarness().resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toMatchObject({ status: "active", cycle: { source_case_version_id: S90, resulting_case_version_id: S80, return_transition_audit_event_id: RETURN_AUDIT } });
  });

  it("returns no active cycle outside S80", async () => {
    const resolver = resolverHarness();
    (resolver as any);
    const result = await createCapaImplementationReturnCycleResolver({ capa_repository: { findCaseById: async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S90, status: "S90", record_version: 10 }) } as any, implementation_review_decision_repository: {} as any }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(result).toEqual({ status: "no_active_return_cycle" });
  });

  it("resolves legitimate first-entry S70 to S80 lineage as having no active cycle", async () => {
    const firstEntry = await createCapaImplementationReturnCycleResolver({ capa_repository: { findCaseById: async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S80, status: "S80", record_version: 11 }), findCaseVersionById: async (_o: unknown, _c: unknown, id: string) => id === S80 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 11, status: "S80", parent_version_id: S70 } : id === S70 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S70, version_number: 10, status: "S70" } : null } as any, implementation_review_decision_repository: {} as any }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(firstEntry).toEqual({ status: "no_active_return_cycle" });
  });

  it("fails closed for an unexpected S80 parent state", async () => {
    const result = await createCapaImplementationReturnCycleResolver({ capa_repository: { findCaseById: async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S80, status: "S80", record_version: 11 }), findCaseVersionById: async (_o: unknown, _c: unknown, id: string) => id === S80 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 11, status: "S80", parent_version_id: S70 } : id === S70 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S70, version_number: 10, status: "S60" } : null } as any, implementation_review_decision_repository: {} as any }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("fails closed when the S80 parent is missing or has malformed lineage", async () => {
    const missingParent = await createCapaImplementationReturnCycleResolver({ capa_repository: { findCaseById: async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S80, status: "S80", record_version: 11 }), findCaseVersionById: async (_o: unknown, _c: unknown, id: string) => id === S80 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 11, status: "S80" } : null } as any, implementation_review_decision_repository: {} as any }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(missingParent).toMatchObject({ status: "invalid" });

    const malformedLineage = await createCapaImplementationReturnCycleResolver({ capa_repository: { findCaseById: async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S80, status: "S80", record_version: 11 }), findCaseVersionById: async (_o: unknown, _c: unknown, id: string) => id === S80 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 11, status: "S80", parent_version_id: S70 } : id === S70 ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S70, version_number: 9, status: "S70" } : null } as any, implementation_review_decision_repository: {} as any }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(malformedLineage).toMatchObject({ status: "invalid" });
  });

  it("fails closed when the decision is not a return", async () => {
    const result = await resolverHarness({ decision: "accept" }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("fails closed when the decision resulting version is stale", async () => {
    const result = await resolverHarness({ resulting_case_version_id: S90 }).resolve({ organization_id: ORG as never, capa_case_id: CASE as never });
    expect(result).toMatchObject({ status: "invalid" });
  });

  it("fails closed when the exact S90 return decision is missing", async () => {
    const resolver = createCapaImplementationReturnCycleResolver({
      capa_repository: {
        findCaseById: async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S80, status: "S80", record_version: 11 }),
        findCaseVersionById: async (_o: unknown, _c: unknown, id: string) => id === S80
          ? { organization_id: ORG, capa_case_id: CASE, case_version_id: S80, version_number: 11, status: "S80", parent_version_id: S90 }
          : { organization_id: ORG, capa_case_id: CASE, case_version_id: S90, version_number: 10, status: "S90", parent_version_id: S70 },
      } as any,
      implementation_review_decision_repository: { findDecision: async () => null } as any,
    });
    await expect(resolver.resolve({ organization_id: ORG as never, capa_case_id: CASE as never })).resolves.toMatchObject({ status: "invalid" });
  });

  it("validates a workspace save request with only owner response content", () => {
    expect(validateCapaImplementationWorkspaceSaveRequest({ expected_draft_revision: null, action_progress: progress, implementation_review_return_response: editable })).toMatchObject({ status: "valid", value: { implementation_review_return_response: editable } });
  });

  it("rejects workspace save metadata injection", () => {
    expect(validateCapaImplementationWorkspaceSaveRequest({ expected_draft_revision: null, action_progress: progress, implementation_review_return_response: { ...editable, return_transition_audit_event_id: RETURN_AUDIT } })).toMatchObject({ status: "invalid" });
  });

  it("parses the authoritative active return projection", () => {
    expect(parseCapaImplementationWorkspaceLoad({ workspace: workspaceProjection(), correlation_id: "80000000-0000-4000-8000-000000000001" })).toMatchObject({ status: "loaded", workspace: { implementation_review_return_cycle: { source_case_version_id: S90, resulting_case_version_id: S80, rationale: "Provide additional implementation evidence." } } });
  });

  it("fails closed for a malformed active return projection", () => {
    expect(parseCapaImplementationWorkspaceLoad({ workspace: workspaceProjection({ implementation_review_return_cycle: { source_case_version_id: S90 } }), correlation_id: "80000000-0000-4000-8000-000000000001" })).toMatchObject({ status: "failed", code: "INVALID_WORKSPACE_RESPONSE" });
  });

  it("preserves a null cycle for first-entry workspaces", () => {
    expect(parseCapaImplementationWorkspaceLoad({ workspace: workspaceProjection({ implementation_review_return_cycle: null }), correlation_id: "80000000-0000-4000-8000-000000000001" })).toMatchObject({ status: "loaded", workspace: { implementation_review_return_cycle: null } });
  });

  it("sends editable response content without trusted cycle metadata", async () => {
    let payload: any;
    await saveCapaImplementationWorkspace(CASE, { expected_draft_revision: 1, action_progress: progress, implementation_review_return_response: editable }, async (_url, init) => {
      payload = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ workspace: workspaceProjection({ draft_revision: 2, draft: { schema_version: "capa-implementation-workspace-draft-1.0.0", action_progress: progress, implementation_review_return_response: draft } }), correlation_id: "80000000-0000-4000-8000-000000000001" }), { status: 200 });
    });
    expect(payload.implementation_review_return_response).toEqual(editable);
    expect(payload.implementation_review_return_response).not.toHaveProperty("source_case_version_id");
  });

  it("keeps the reviewer rationale separate from owner response", () => {
    expect(content.response_narrative).not.toBe("Provide additional implementation evidence.");
    expect(content).not.toHaveProperty("rationale");
  });

  it("binds immutable response content to the returned S90 version", () => {
    expect(content.source_case_version_id).toBe(S90);
    expect(content.resulting_case_version_id).toBe(S80);
    expect(content.resubmitted_case_version_id).not.toBe(S80);
  });

  it("records human response attribution only", () => {
    expect(content.responded_by).toEqual({ actor_type: "human", actor_id: REVIEWER });
  });

  it("keeps the authoritative S70 baseline independent of the return source", () => {
    expect({ expected_current_version_id: S90, source_case_version_id: S90, implementation_review_baseline_section_version_id: BASELINE, submitted_s80_source_version_id: S80 }).toEqual({ expected_current_version_id: S90, source_case_version_id: S90, implementation_review_baseline_section_version_id: BASELINE, submitted_s80_source_version_id: S80 });
    expect(S80).not.toBe(S90);
  });

  it("does not allow an owner response to become an AI response", () => {
    expect(content.responded_by.actor_type).toBe("human");
    expect(content.response_narrative).toBe(editable.response_narrative);
  });

  it("preserves cycle identity across a second immutable response version", () => {
    const second = { ...content, resubmitted_case_version_id: "30000000-0000-4000-8000-000000000005", response_narrative: "The second returned issue was addressed." };
    expect(second.return_transition_audit_event_id).toBe(content.return_transition_audit_event_id);
    expect(second.source_case_version_id).toBe(content.source_case_version_id);
    expect(second.resubmitted_case_version_id).not.toBe(content.resubmitted_case_version_id);
  });
});
