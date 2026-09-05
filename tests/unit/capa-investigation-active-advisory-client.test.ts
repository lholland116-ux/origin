import { describe, expect, it } from "vitest";
import { buildCapaInvestigationActiveAdvisoryRequest, fetchCapaInvestigationActiveAdvisory, parseCapaInvestigationActiveAdvisorySuccess } from "../../app/capa/capa-investigation-active-advisory-client";
import { createInitialLedgerDraft, createInitialRootCausePackageDraft } from "../../app/capa/capa-root-cause-draft";

const CASE = "10000000-0000-4000-8000-000000000001";
const VERSION = "20000000-0000-4000-8000-000000000001";
const OUTPUT = "30000000-0000-4000-8000-000000000001";
const RUN = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";
const response = { advisory: { run_id: RUN, output_id: OUTPUT, output_schema_version: "capa_investigation_analysis_draft-1.0.0", status: "completed_draft", proposal: { evidence_gaps: [], conflicting_information: [], assumptions: [], causal_hypotheses: [], alternative_hypotheses: [], investigation_recommendations: [] }, uncertainty_and_limitations: [], citations: [], warnings: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true }, snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 4 }, correlation_id: CORRELATION };

describe("S40 advisory browser client", () => {
  it("sends exactly the governed untrusted draft body and verifies the snapshot", async () => {
    const request = buildCapaInvestigationActiveAdvisoryRequest({ currentVersionId: VERSION, recordVersion: 4, ledger: createInitialLedgerDraft(), rootCausePackage: createInitialRootCausePackageDraft() });
    let body = "";
    const result = await fetchCapaInvestigationActiveAdvisory(CASE, request, async (_url, init) => { body = String(init?.body); return new Response(JSON.stringify(response), { status: 201 }); });
    expect(result).toHaveProperty("advisory");
    expect(JSON.parse(body)).toEqual({ expected_case_version_id: VERSION, expected_record_version: 4, untrusted_human_draft: { trust: "untrusted_human_draft", evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null } } });
    expect(parseCapaInvestigationActiveAdvisorySuccess(response, { caseId: CASE, currentVersionId: VERSION, recordVersion: 4 })?.advisory.outputId).toBe(OUTPUT);
  });
  it("fails closed when the response snapshot does not match the request", () => {
    expect(parseCapaInvestigationActiveAdvisorySuccess({ ...response, snapshot: { ...response.snapshot, record_version: 5 } }, { caseId: CASE, currentVersionId: VERSION, recordVersion: 4 })).toBeNull();
  });
});
