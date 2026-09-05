import { describe, expect, it } from "vitest";
import {
  CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/application/capa-investigation-active-workspace-draft-contract";
import {
  validateCapaInvestigationActiveWorkspaceDraft,
} from "../../lib/capa/application/capa-investigation-active-workspace-draft-validator";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const ADOPTION = "50000000-0000-4000-8000-000000000001";
const AT = "2026-09-05T12:00:00.000Z";
const human = { source_type: "human", source_reference: null, adopted_by_user_id: null, adopted_at: null };
const ai = { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: AT };

function evidence(provenance: Record<string, unknown> = human) {
  return { item_id: "E-1", information_class: "user_provided_statement", statement: "The batch record was reviewed.", evidence_status: "current", assumption_status: null, gap_status: null, conflict_status: null, provenance, owner_user_id: null, information_date: null, source_version: null, context: null, linked_capa_objects: [], supporting_item_ids: [], contradictory_item_ids: [], conflict_item_ids: [], material_to_conclusion: false, critical_to_conclusion: false, recommended_next_step: null, target_date: null, human_disposition: null };
}

function hypothesis(provenance: Record<string, unknown> = human) {
  return { hypothesis_id: "H-1", statement: "A process variation may have contributed.", status: "proposed", causal_role: "proposed_root_cause", rationale: "The observation warrants human review.", responsible_user_id: null, supporting_evidence_item_ids: [], contradictory_evidence_item_ids: [], linked_assumption_item_ids: [], linked_gap_item_ids: [], linked_conflict_item_ids: [], material_to_package: false, provenance };
}

function draft(overrides: Record<string, unknown> = {}) {
  return { schema_version: CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION, trust: "untrusted_human_draft", workflow_state: "S40", organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, record_version: 4, draft_revision: 1, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_by_user_id: USER, updated_at: AT, ...overrides };
}

function expectInvalid(value: unknown, reason_code: string) {
  expect(validateCapaInvestigationActiveWorkspaceDraft(value)).toEqual({ status: "invalid", reason_code });
}

describe("S40 investigation-active workspace draft validation", () => {
  it("accepts an empty workspace, human content, UUID-based AI provenance, and later revisions", () => {
    expect(validateCapaInvestigationActiveWorkspaceDraft(draft())).toMatchObject({ status: "valid", value: { draft_revision: 1 } });
    expect(validateCapaInvestigationActiveWorkspaceDraft(draft({ evidence_assumption_ledger: { items: [evidence()] }, root_cause_package: { hypotheses: [hypothesis()], root_cause_not_confirmed: null } }))).toMatchObject({ status: "valid" });
    const aiGap = { ...evidence(ai), item_id: "G-1", information_class: "missing_information", evidence_status: null, gap_status: "open", recommended_next_step: "Review the controlled archive." };
    expect(validateCapaInvestigationActiveWorkspaceDraft(draft({ draft_revision: 2, evidence_assumption_ledger: { items: [aiGap] }, root_cause_package: { hypotheses: [hypothesis(ai)], root_cause_not_confirmed: null } }))).toMatchObject({ status: "valid", value: { draft_revision: 2 } });
    expect(validateCapaInvestigationActiveWorkspaceDraft(draft({ root_cause_package: { hypotheses: [hypothesis(ai)], root_cause_not_confirmed: null } }))).toMatchObject({ status: "valid" });
  });

  it("fails closed for shape, literals, bindings, versions, and timestamps", () => {
    expectInvalid({ ...draft(), unknown: true }, "INVALID_WORKSPACE_DRAFT_FIELDS");
    const { updated_at: _updatedAt, ...missing } = draft(); expectInvalid(missing, "INVALID_WORKSPACE_DRAFT_FIELDS");
    expectInvalid(draft({ schema_version: "wrong" }), "INVALID_WORKSPACE_DRAFT_SCHEMA_VERSION");
    expectInvalid(draft({ trust: "authoritative_server_context" }), "INVALID_WORKSPACE_DRAFT_TRUST");
    expectInvalid(draft({ workflow_state: "S50" }), "INVALID_WORKSPACE_DRAFT_WORKFLOW_STATE");
    expectInvalid(draft({ organization_id: "not-a-uuid" }), "INVALID_WORKSPACE_DRAFT_IDENTITY");
    expectInvalid(draft({ updated_at: "not-a-time" }), "INVALID_WORKSPACE_DRAFT_UPDATED_AT");
    for (const record_version of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expectInvalid(draft({ record_version }), "INVALID_WORKSPACE_DRAFT_RECORD_VERSION");
    for (const draft_revision of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) expectInvalid(draft({ draft_revision }), "INVALID_WORKSPACE_DRAFT_REVISION");
  });

  it("composes governed validation and requires complete UUID-based AI provenance", () => {
    expectInvalid(draft({ evidence_assumption_ledger: { items: [{}] } }), "INVALID_WORKSPACE_DRAFT_LEDGER");
    for (const provenance of [
      { ...ai, source_reference: "adoption-1" },
      { ...ai, source_reference: null },
      { ...ai, adopted_by_user_id: "not-a-user" },
      { ...ai, adopted_by_user_id: null },
      { ...ai, adopted_at: "not-a-time" },
      { ...ai, adopted_at: null },
    ]) expectInvalid(draft({ evidence_assumption_ledger: { items: [{ ...evidence(provenance) }] } }), "INVALID_WORKSPACE_DRAFT_LEDGER");
    expectInvalid(draft({ root_cause_package: { hypotheses: "not-an-array", root_cause_not_confirmed: null } }), "INVALID_WORKSPACE_DRAFT_ROOT_CAUSE_PACKAGE");
    expectInvalid(draft({ root_cause_package: { hypotheses: [], root_cause_not_confirmed: { rationale: "Continue investigation.", next_steps: ["Review records"], concluded_by_user_id: USER, concluded_at: AT, provenance: ai } } }), "INVALID_WORKSPACE_DRAFT_ROOT_CAUSE_PACKAGE");
  });
});
