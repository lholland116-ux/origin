import { describe, expect, it, vi } from "vitest";
import {
  createInitialCapaImplementationWorkspaceDraft,
  loadCapaImplementationWorkspace,
  parseCapaImplementationEvidenceAdvisory,
  parseCapaImplementationWorkspaceLoad,
  prepareCapaImplementationEvidenceAdvisoryAdoption,
  saveCapaImplementationWorkspace,
} from "../../app/capa/capa-implementation-workspace-client";
import type { CapaImplementationEvidence } from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import type { CapaImplementationEvidenceId } from "../../lib/capa/domain/capa-types";

const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const SECTION = "40000000-0000-4000-8000-000000000001";
const APPROVAL = "50000000-0000-4000-8000-000000000001";
const RUN = "60000000-0000-4000-8000-000000000001";
const OUTPUT = "70000000-0000-4000-8000-000000000001";
const CORRELATION = "80000000-0000-4000-8000-000000000001";
const ACTION = "90000000-0000-4000-8000-000000000001";

const ACTION_PROJECTION = {
  approved_action_reference: ACTION,
  status: "approved",
  action_type: "corrective",
  description: "Implement the approved training control.",
  due_date: "2026-09-30",
  deliverable: "Training control record",
  implementation_expectation: "A completed training record",
  effectiveness_check_required: false,
  acceptance_criteria: [],
};

function projection(draft: ReturnType<typeof createInitialCapaImplementationWorkspaceDraft> | null = createInitialCapaImplementationWorkspaceDraft([ACTION_PROJECTION])) {
  return {
    draft_revision: 1,
    case_version_id: VERSION,
    record_version: 8,
    approved_s70_baseline: {
      source_case_version_id: VERSION,
      approved_action_plan_section_id: SECTION,
      approval_decision_reference: APPROVAL,
    },
    approved_actions: [ACTION_PROJECTION],
    draft,
    updated_at: "2026-09-10T12:00:00.000Z",
  };
}

function advisoryBody() {
  return {
    advisory: {
      run_id: RUN,
      output_id: OUTPUT,
      output_schema_version: "capa_implementation_evidence_advisory-1.0.0",
      schema_version: "capa_implementation_evidence_advisory-1.0.0",
      status: "completed_draft",
      advisory_summary: "The implementation narrative needs a supporting record.",
      findings: [{
        finding_id: "F-NARRATIVE",
        approved_action_reference: ACTION,
        category: "documentation_improvement",
        severity: "medium",
        finding: "The narrative could be more specific.",
        rationale: "The current narrative does not identify the implemented control.",
        evidence_reference_ids: [],
        reference_keys: ["R1"],
        suggested_human_action: "Describe the implemented control in the narrative.",
        adoption: { eligible: true, field: "implementation_narrative", suggested_value: "The human should describe the implemented control." },
      }],
      warnings: [],
      uncertainty_and_limitations: [],
      citations: [{ reference_key: "R1", source_kind: "approved_action", source_reference: ACTION, source_status: "authoritative", locator: null }],
      advisory_only: true,
      workflow_mutated: false,
      controlled_record_mutated: false,
      approval_claimed: false,
      workflow_transition: null,
      human_acceptance_required: true,
    },
    snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 8 },
    correlation_id: CORRELATION,
  };
}

describe("S80 implementation workspace browser client", () => {
  it("loads first-entry authority without sending a save and initializes valid local progress", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ workspace: projection(null), correlation_id: CORRELATION }), { status: 200 }));
    const result = await loadCapaImplementationWorkspace(CASE, fetcher as typeof fetch);
    expect(result).toMatchObject({ status: "loaded", workspace: { draft: null, approved_actions: [{ approved_action_reference: ACTION }] } });
    const loaded = parseCapaImplementationWorkspaceLoad({ workspace: projection(null), correlation_id: CORRELATION });
    expect(loaded).toMatchObject({ status: "loaded", workspace: { approved_s70_baseline: { approved_action_plan_section_id: SECTION } } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("round-trips editable evidence and provenance while excluding approved baseline authority", async () => {
    const draft = createInitialCapaImplementationWorkspaceDraft([ACTION_PROJECTION]);
    const evidence: CapaImplementationEvidence = {
      schema_version: "capa-implementation-evidence-1.0.0",
      evidence_id: "a0000000-0000-4000-8000-000000000001" as CapaImplementationEvidenceId,
      approved_action_reference: ACTION,
      evidence_kind: "controlled_document" as const,
      description: "Training procedure revision.",
      evidence_date: "2026-09-10",
      source: { origin_kind: "controlled_document" as const, source_system_kind: "other" as const, source_system_name: null, source_record_reference: "SOP-80", source_record_version: 3, artifact_reference: "doc://SOP-80" },
    };
    const savedDraft = { ...draft, action_progress: [{ ...draft.action_progress[0]!, implementation_narrative: "Implemented the control.", evidence: [evidence] }] };
    let sent: RequestInit | undefined;
    const result = await saveCapaImplementationWorkspace(CASE, { expected_draft_revision: 1, action_progress: savedDraft.action_progress }, async (_url, init) => { sent = init; return new Response(JSON.stringify({ workspace: projection(savedDraft), correlation_id: CORRELATION }), { status: 200 }); });
    expect(result).toMatchObject({ status: "saved", workspace: { draft_revision: 1, draft: savedDraft } });
    const payload = JSON.parse(String(sent?.body));
    expect(payload).toEqual({ expected_draft_revision: 1, action_progress: savedDraft.action_progress });
    expect(JSON.stringify(payload)).not.toContain("approved_s70_baseline");
  });

  it("maps stale revision without retrying and fails closed for malformed projections", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: { code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", correlation_id: CORRELATION } }), { status: 409 }));
    await expect(saveCapaImplementationWorkspace(CASE, { expected_draft_revision: 1, action_progress: projection().draft!.action_progress }, fetcher as typeof fetch)).resolves.toMatchObject({ status: "failed", code: "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(parseCapaImplementationWorkspaceLoad({ workspace: { ...projection(), record_version: 0 }, correlation_id: CORRELATION })).toMatchObject({ status: "failed", code: "INVALID_WORKSPACE_RESPONSE" });
  });

  it("parses governed findings and verifies the deliberate local adoption patch", async () => {
    const parsed = parseCapaImplementationEvidenceAdvisory(advisoryBody());
    expect(parsed).toMatchObject({ status: "success", value: { advisory: { findings: [{ category: "documentation_improvement" }], citations: [{ reference_key: "R1" }] } } });
    const adoption = await prepareCapaImplementationEvidenceAdvisoryAdoption(CASE, { output_id: OUTPUT, finding_id: "F-NARRATIVE", expected_case_version_id: VERSION, expected_record_version: 8 }, async (_url, init) => {
      expect(init?.headers).toMatchObject({ "idempotency-key": expect.any(String) });
      return new Response(JSON.stringify({ adoption: { status: "prepared", patch: { output_id: OUTPUT, finding_id: "F-NARRATIVE", capa_case_id: CASE, case_version_id: VERSION, record_version: 8, approved_action_reference: ACTION, field: "implementation_narrative", value: "The human should describe the implemented control.", requires_human_review: true, auto_saved: false, auto_submitted: false, evidence_created: false, owner_reported_status_changed: false, approved_baseline_changed: false, audit_event_id: null } }, correlation_id: CORRELATION }), { status: 201 });
    });
    expect(adoption).toMatchObject({ status: "success", value: { patch: { field: "implementation_narrative", auto_saved: false, evidence_created: false } } });
  });
});
