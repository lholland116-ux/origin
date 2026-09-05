import { describe, expect, it } from "vitest";
import {
  CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION,
  type CapaInvestigationActiveWorkspaceDraft,
} from "../../lib/capa/application/capa-investigation-active-workspace-draft-contract";

describe("S40 investigation-active workspace draft contract", () => {
  it("defines a versioned untrusted S40 workspace using governed domain payloads", () => {
    const draft = {
      schema_version: CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION,
      trust: "untrusted_human_draft",
      workflow_state: "S40",
      organization_id: "10000000-0000-4000-8000-000000000001" as never,
      capa_case_id: "20000000-0000-4000-8000-000000000001" as never,
      case_version_id: "30000000-0000-4000-8000-000000000001" as never,
      record_version: 4,
      draft_revision: 1,
      evidence_assumption_ledger: { items: [] },
      root_cause_package: { hypotheses: [], root_cause_not_confirmed: null },
      updated_by_user_id: "40000000-0000-4000-8000-000000000001" as never,
      updated_at: "2026-09-05T12:00:00.000Z" as never,
    } satisfies CapaInvestigationActiveWorkspaceDraft;

    expect(draft.schema_version).toBe("capa-investigation-active-workspace-draft-1.0.0");
    expect(draft.trust).toBe("untrusted_human_draft");
    expect(draft.workflow_state).toBe("S40");
    expect(draft.evidence_assumption_ledger).toEqual({ items: [] });
    expect(draft.root_cause_package).toEqual({ hypotheses: [], root_cause_not_confirmed: null });
  });
});
