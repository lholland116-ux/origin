import { describe, expect, it } from "vitest";
import { RepositoryCapaInvestigationActiveAdoptionSourceResolver } from "../../lib/capa/application/capa-investigation-active-adoption-source-resolver";
import { createCapaInvestigationActiveAdvisoryReferenceManifest } from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";

const ORG = "10000000-0000-4000-8000-000000000001" as any;
const CASE_ID = "20000000-0000-4000-8000-000000000001" as any;
const VERSION_ID = "30000000-0000-4000-8000-000000000001" as any;
const OUTPUT_ID = "40000000-0000-4000-8000-000000000001" as any;

function output(): any {
  const modelSafe = { trust: "model_safe_context", workflow_state: "S40", references: [] } as const;
  return {
    organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4,
    response: { run_id: "50000000-0000-4000-8000-000000000001", output_id: OUTPUT_ID, output_schema_version: "capa_investigation_analysis_draft-1.0.0", status: "completed_draft", proposal: { evidence_gaps: [{ proposal_key: "P1", gap: "missing evidence", why_it_matters: "it matters", related_reference_keys: [], recommended_next_step: "collect evidence", human_review_question: "What evidence should be collected?" }], conflicting_information: [], assumptions: [], causal_hypotheses: [], alternative_hypotheses: [], investigation_recommendations: [] }, uncertainty_and_limitations: [], citations: [], warnings: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true },
    generation_trace: { trace_schema_version: "capa-ai-generation-trace-1.0.0", package: { package_schema_version: "capa-investigation-active-prompt-package-1.0.0", scope: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION_ID, record_version: 4, workflow_state: "S40" }, agent: { agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" }, trace: {}, generation_contract: { operation: "facilitate_root_cause", output_schema_version: "capa_investigation_analysis_draft-1.0.0" }, context_provenance: { model_safe_context: modelSafe } }, store: false },
    reference_manifest: createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest: [], model_safe_context: modelSafe }),
  };
}

describe("RepositoryCapaInvestigationActiveAdoptionSourceResolver", () => {
  it("derives the selected category from the immutable output", async () => {
    const result = await new RepositoryCapaInvestigationActiveAdoptionSourceResolver({ findById: async () => output() }).resolve({ organization_id: ORG, capa_case_id: CASE_ID, expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, proposal_keys: ["P1"] });
    expect(result).toMatchObject({ status: "resolved", selected_proposals: [{ proposal_key: "P1", proposal_category: "evidence_gap", resolved_reference_bindings: [] }] });
  });

  it("rejects duplicate and unknown proposal keys", async () => {
    const resolver = new RepositoryCapaInvestigationActiveAdoptionSourceResolver({ findById: async () => output() });
    await expect(resolver.resolve({ organization_id: ORG, capa_case_id: CASE_ID, expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, proposal_keys: ["P1", "P1"] })).resolves.toEqual({ status: "output_not_adoptable" });
    await expect(resolver.resolve({ organization_id: ORG, capa_case_id: CASE_ID, expected_case_version_id: VERSION_ID, expected_record_version: 4, output_id: OUTPUT_ID, proposal_keys: ["P2"] })).resolves.toEqual({ status: "output_not_adoptable" });
  });
});
