import { describe, expect, it } from "vitest";
import { constructCapaInvestigationActiveAdoption } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import { CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION } from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";
import { materializeCapaInvestigationActiveAdoptions } from "../../lib/capa/application/capa-investigation-active-adoption-workspace-materializer";

const ids = { org: "10000000-0000-4000-8000-000000000001", case: "20000000-0000-4000-8000-000000000001", version: "30000000-0000-4000-8000-000000000001", output: "40000000-0000-4000-8000-000000000001", user: "50000000-0000-4000-8000-000000000001" };
const empty = { ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null } } as const;
const humanEvidence = { item_id: "E-1", information_class: "user_provided_statement" as const, statement: "Human evidence", evidence_status: "current" as const, assumption_status: null, gap_status: null, conflict_status: null, provenance: { source_type: "human" as const, source_reference: null, adopted_by_user_id: null, adopted_at: null }, owner_user_id: null, information_date: null, source_version: null, context: null, linked_capa_objects: [], supporting_item_ids: [], contradictory_item_ids: [], conflict_item_ids: [], material_to_conclusion: false, critical_to_conclusion: false, recommended_next_step: null, target_date: null, human_disposition: null };
function persisted(category: "evidence_gap" | "assumption" | "investigation_recommendation" | "alternative_hypothesis" | "causal_hypothesis", adoptionId: string, role?: "proposed_root_cause" | "contributing_factor") {
  const content = category === "evidence_gap" ? { gap: "Gap", why_it_matters: "Why", recommended_next_step: "Next" } : category === "assumption" ? { assumption: "Assumption", verification_question: "What should be checked?" } : category === "investigation_recommendation" ? { recommendation: "Recommendation", rationale: "Rationale" } : { hypothesis: "Hypothesis", rationale: "Rationale" };
  const adoption = constructCapaInvestigationActiveAdoption({ adoption_id: adoptionId as never, organization_id: ids.org as never, capa_case_id: ids.case as never, case_version_id: ids.version as never, record_version: 4, output_id: ids.output as never, proposal_key: "P1", proposal_category: category, adopted_item: { proposal_key: "P1", adopted_content: content, ...(role === undefined ? {} : { human_causal_role: role }) }, resolved_reference_bindings: [], reference_manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION, reference_manifest_fingerprint_algorithm: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, reference_manifest_sha256: "a".repeat(64), adopted_at: "2026-09-05T12:00:00.000Z" as never, adopted_by: { actor_type: "human", actor_id: ids.user }, request_id: "60000000-0000-4000-8000-000000000001" as never, correlation_id: "70000000-0000-4000-8000-000000000001" as never, idempotency_key: "K" as never, workflow_mutated: false, controlled_record_mutated: false, gate_approved: false });
  return { adoption, request_fingerprint: "b".repeat(64) as never, record_fingerprint: "c".repeat(64) as never, audit_event_id: "80000000-0000-4000-8000-000000000001" as never };
}
describe("S40 adoption workspace materializer", () => {
  it.each([["evidence_gap", "missing_information"], ["assumption", "assumption"], ["investigation_recommendation", "ai_recommendation"]] as const)("materializes %s as a deterministic Ledger item", (category, informationClass) => {
    const result = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [persisted(category, "90000000-0000-4000-8000-000000000001")] });
    expect(result.changed).toBe(true);
    expect(result.ledger.items[0]).toMatchObject({ item_id: "LED-90000000-0000-4000-8000-000000000001", information_class: informationClass, provenance: { source_type: "ai_proposal", source_reference: "90000000-0000-4000-8000-000000000001" } });
  });
  it.each([["proposed_root_cause"], ["contributing_factor"]] as const)("preserves the human causal role %s", (role) => {
    const result = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [persisted("causal_hypothesis", "90000000-0000-4000-8000-000000000002", role)] });
    expect(result.root_cause_package.hypotheses[0]).toMatchObject({ hypothesis_id: "HYP-90000000-0000-4000-8000-000000000002", causal_role: role });
  });
  it("materializes alternative hypotheses without human role", () => {
    const result = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [persisted("alternative_hypothesis", "90000000-0000-4000-8000-000000000003")] });
    expect(result.root_cause_package.hypotheses[0]?.causal_role).toBe("alternative_hypothesis");
  });
  it("replays the exact adoption without changing the workspace", () => {
    const record = persisted("evidence_gap", "90000000-0000-4000-8000-000000000004");
    const first = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [record] });
    const replay = materializeCapaInvestigationActiveAdoptions({ ledger: first.ledger, root_cause_package: first.root_cause_package, adoptions: [record] });
    expect(replay.changed).toBe(false);
    expect(replay).toMatchObject({ ledger: first.ledger, root_cause_package: first.root_cause_package });
  });
  it("fails closed when a causal adoption has no recorded human role", () => {
    expect(() => materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [persisted("causal_hypothesis", "90000000-0000-4000-8000-000000000005")] })).toThrow();
  });
  it("fails closed for duplicate adoption provenance", () => {
    const record = persisted("evidence_gap", "90000000-0000-4000-8000-000000000006");
    expect(() => materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [record, record] })).toThrow();
  });
  it.each([
    ["source_type", { source_type: "human" as const, source_reference: null, adopted_by_user_id: null, adopted_at: null }],
    ["source_reference", { source_type: "ai_proposal" as const, source_reference: "90000000-0000-4000-8000-000000000099", adopted_by_user_id: ids.user, adopted_at: "2026-09-05T12:00:00.000Z" }],
    ["adopted_by_user_id", { source_type: "ai_proposal" as const, source_reference: "90000000-0000-4000-8000-000000000007", adopted_by_user_id: "50000000-0000-4000-8000-000000000099", adopted_at: "2026-09-05T12:00:00.000Z" }],
    ["adopted_at", { source_type: "ai_proposal" as const, source_reference: "90000000-0000-4000-8000-000000000007", adopted_by_user_id: ids.user, adopted_at: "2026-09-05T13:00:00.000Z" }],
  ] as const)("rejects already-materialized Ledger provenance tampering in %s", (field, provenance) => {
    const record = persisted("evidence_gap", "90000000-0000-4000-8000-000000000007");
    const first = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [record] });
    const item = { ...first.ledger.items[0]!, provenance } as never;
    expect(() => materializeCapaInvestigationActiveAdoptions({ ledger: { items: [item] }, root_cause_package: first.root_cause_package, adoptions: [record] })).toThrow();
  });
  it.each([
    ["source_type", { source_type: "human" as const, source_reference: null, adopted_by_user_id: null, adopted_at: null }],
    ["source_reference", { source_type: "ai_proposal" as const, source_reference: "90000000-0000-4000-8000-000000000099", adopted_by_user_id: ids.user, adopted_at: "2026-09-05T12:00:00.000Z" }],
    ["adopted_by_user_id", { source_type: "ai_proposal" as const, source_reference: "90000000-0000-4000-8000-000000000008", adopted_by_user_id: "50000000-0000-4000-8000-000000000099", adopted_at: "2026-09-05T12:00:00.000Z" }],
    ["adopted_at", { source_type: "ai_proposal" as const, source_reference: "90000000-0000-4000-8000-000000000008", adopted_by_user_id: ids.user, adopted_at: "2026-09-05T13:00:00.000Z" }],
  ] as const)("rejects already-materialized hypothesis provenance tampering in %s", (field, provenance) => {
    const record = persisted("causal_hypothesis", "90000000-0000-4000-8000-000000000008", "contributing_factor");
    const first = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [record] });
    const hypothesis = { ...first.root_cause_package.hypotheses[0]!, provenance } as never;
    expect(() => materializeCapaInvestigationActiveAdoptions({ ledger: empty.ledger, root_cause_package: { hypotheses: [hypothesis], root_cause_not_confirmed: null }, adoptions: [record] })).toThrow();
  });
  it("preserves legitimate human edits on a replayed Ledger adoption", () => {
    const record = persisted("evidence_gap", "90000000-0000-4000-8000-000000000007");
    const first = materializeCapaInvestigationActiveAdoptions({ ledger: { items: [humanEvidence] }, root_cause_package: empty.root_cause_package, adoptions: [record] });
    const original = first.ledger.items.find((item) => item.provenance.source_reference === record.adoption.adoption_id)!;
    const edited = { ...original, gap_status: "resolved" as const, critical_to_conclusion: true, target_date: "2026-09-30", supporting_item_ids: ["E-1"], human_disposition: { user_id: ids.user, disposition_at: "2026-09-05T13:00:00.000Z", rationale: "Human review completed" } };
    const replay = materializeCapaInvestigationActiveAdoptions({ ledger: { items: [humanEvidence, edited] }, root_cause_package: first.root_cause_package, adoptions: [record] });
    expect(replay.changed).toBe(false);
    expect(replay.ledger.items).toHaveLength(2);
    expect(replay.ledger.items.find((item) => item.item_id === edited.item_id)).toEqual(edited);
  });
  it("preserves legitimate human edits on a replayed hypothesis adoption", () => {
    const record = persisted("causal_hypothesis", "90000000-0000-4000-8000-000000000008", "contributing_factor");
    const first = materializeCapaInvestigationActiveAdoptions({ ledger: { items: [humanEvidence] }, root_cause_package: empty.root_cause_package, adoptions: [record] });
    const original = first.root_cause_package.hypotheses[0]!;
    const edited = { ...original, status: "unresolved" as const, responsible_user_id: ids.user, material_to_package: true, supporting_evidence_item_ids: ["E-1"] };
    const replay = materializeCapaInvestigationActiveAdoptions({ ledger: { items: [humanEvidence] }, root_cause_package: { hypotheses: [edited], root_cause_not_confirmed: null }, adoptions: [record] });
    expect(replay.changed).toBe(false);
    expect(replay.root_cause_package.hypotheses).toEqual([edited]);
  });
  it.each(["item_id", "information_class", "statement", "context", "recommended_next_step"] as const)("rejects immutable Ledger tampering in %s", (field) => {
    const record = persisted("evidence_gap", "90000000-0000-4000-8000-000000000009");
    const first = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [record] });
    const item = { ...first.ledger.items[0]!, [field]: field === "item_id" ? "LED-tampered" : field === "information_class" ? "assumption" : field === "recommended_next_step" ? "Different next step" : "Different immutable content" } as never;
    expect(() => materializeCapaInvestigationActiveAdoptions({ ledger: { items: [item] }, root_cause_package: first.root_cause_package, adoptions: [record] })).toThrow();
  });
  it.each(["hypothesis_id", "statement", "rationale", "causal_role"] as const)("rejects immutable hypothesis tampering in %s", (field) => {
    const record = persisted("causal_hypothesis", "90000000-0000-4000-8000-000000000010", "proposed_root_cause");
    const first = materializeCapaInvestigationActiveAdoptions({ ...empty, adoptions: [record] });
    const hypothesis = { ...first.root_cause_package.hypotheses[0]!, [field]: field === "hypothesis_id" ? "HYP-tampered" : field === "causal_role" ? "contributing_factor" : "Different immutable content" } as never;
    expect(() => materializeCapaInvestigationActiveAdoptions({ ledger: empty.ledger, root_cause_package: { hypotheses: [hypothesis], root_cause_not_confirmed: null }, adoptions: [record] })).toThrow();
  });
  it("rejects an adoption represented in the wrong collection", () => {
    const record = persisted("evidence_gap", "90000000-0000-4000-8000-000000000011");
    const wrongHypothesis = { hypothesis_id: `HYP-${record.adoption.adoption_id}`, statement: "Gap", status: "proposed" as const, causal_role: "alternative_hypothesis" as const, rationale: "Why", responsible_user_id: null, supporting_evidence_item_ids: [], contradictory_evidence_item_ids: [], linked_assumption_item_ids: [], linked_gap_item_ids: [], linked_conflict_item_ids: [], material_to_package: false, provenance: { source_type: "ai_proposal" as const, source_reference: record.adoption.adoption_id, adopted_by_user_id: ids.user, adopted_at: "2026-09-05T12:00:00.000Z" } };
    expect(() => materializeCapaInvestigationActiveAdoptions({ ...empty, root_cause_package: { hypotheses: [wrongHypothesis], root_cause_not_confirmed: null }, adoptions: [record] })).toThrow();
  });
});
