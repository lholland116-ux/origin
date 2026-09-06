import { describe, expect, it } from "vitest";
import { createInvestigationActiveAdoptionAttempt, parseInvestigationActiveAdoptionSuccess, submitInvestigationActiveAdoptionAttempt } from "../../app/capa/capa-investigation-active-adoption-client";

const CASE = "10000000-0000-4000-8000-000000000001"; const VERSION = "20000000-0000-4000-8000-000000000001"; const OUTPUT = "30000000-0000-4000-8000-000000000001"; const USER = "40000000-0000-4000-8000-000000000001"; const ADOPTION = "50000000-0000-4000-8000-000000000001";
const TIME = "2026-09-05T12:00:00.000Z";
function causalAttempt() {
  return createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, currentUserId: USER, idempotencyKey: "s40-causal", selectedItems: [{ proposal_key: "P1", adopted_content: { hypothesis: "Hypothesis", rationale: "Rationale" }, human_causal_role: "proposed_root_cause" }], selectedCategories: { P1: "causal_hypothesis" } });
}
function validWorkspace() {
  return { draft_revision: 1, case_version_id: VERSION, record_version: 4, evidence_assumption_ledger: { items: [] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: TIME };
}
function causalResponse(status: "adopted" | "already_adopted" = "adopted", overrides: Record<string, unknown> = {}) {
  return { status, records: [{ adoption_id: ADOPTION, proposal_key: "P1", proposal_category: "causal_hypothesis", adopted_item: { proposal_key: "P1", adopted_content: { hypothesis: "Hypothesis", rationale: "Rationale" }, human_causal_role: "proposed_root_cause" }, adopted_at: TIME, adopted_by_user_id: USER }], workspace: validWorkspace(), correlation_id: "60000000-0000-4000-8000-000000000001", ...overrides };
}
describe("S40 adoption browser client", () => {
  it("uses the exact request body and safe response projection", async () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, currentUserId: USER, idempotencyKey: "s40-retry", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }] });
    expect(attempt).not.toBeNull();
    const body = { status: "adopted", records: [{ adoption_id: ADOPTION, proposal_key: "P1", proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }, adopted_at: "2026-09-05T12:00:00.000Z", adopted_by_user_id: USER }], workspace: { draft_revision: 1, case_version_id: VERSION, record_version: 4, evidence_assumption_ledger: { items: [{ item_id: "LED-1", information_class: "missing_information", statement: "Gap", evidence_status: null, assumption_status: null, gap_status: "open", conflict_status: null, provenance: { source_type: "ai_proposal", source_reference: ADOPTION, adopted_by_user_id: USER, adopted_at: "2026-09-05T12:00:00.000Z" }, owner_user_id: null, information_date: null, source_version: null, context: "Matters", linked_capa_objects: [], supporting_item_ids: [], contradictory_item_ids: [], conflict_item_ids: [], material_to_conclusion: false, critical_to_conclusion: false, recommended_next_step: "Review records", target_date: null, human_disposition: null }] }, root_cause_package: { hypotheses: [], root_cause_not_confirmed: null }, updated_at: "2026-09-05T12:00:00.000Z" }, correlation_id: "60000000-0000-4000-8000-000000000001" };
    let sent = ""; let key = "";
    const result = await submitInvestigationActiveAdoptionAttempt(attempt!, async (_url, init) => { sent = String(init?.body); key = new Headers(init?.headers).get("Idempotency-Key") ?? ""; return new Response(JSON.stringify(body), { status: 201 }); });
    expect(result.status).toBe("adopted"); expect(key).toBe("s40-retry"); expect(JSON.parse(sent).selected_items).toEqual([{ proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }]);
  });
  it("rejects duplicate safe proposal records", () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "s40-retry", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }, { proposal_key: "P2", adopted_content: { gap: "Gap2", why_it_matters: "Matters2", recommended_next_step: "Review records2" } }] });
    const record = (key: string, id: string) => ({ adoption_id: id, proposal_key: key, proposal_category: "evidence_gap", adopted_item: { proposal_key: key, adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }, adopted_at: "2026-09-05T12:00:00.000Z", adopted_by_user_id: USER });
    const result = parseInvestigationActiveAdoptionSuccess({ status: "adopted", records: [record("P1", ADOPTION), record("P1", "70000000-0000-4000-8000-000000000001")], correlation_id: "60000000-0000-4000-8000-000000000001" }, attempt!);
    expect(result.status).toBe("failed");
  });
  it.each([201, 200])("accepts a valid %s response with strict causal adoption and workspace validation", (status) => {
    const attempt = causalAttempt();
    expect(attempt).not.toBeNull();
    const result = parseInvestigationActiveAdoptionSuccess(causalResponse(status === 201 ? "adopted" : "already_adopted"), attempt!);
    expect(result).toMatchObject({ status: status === 201 ? "adopted" : "already_adopted", workspace: validWorkspace() });
    if (result.status !== "failed") {
      expect(result.records).toHaveLength(1);
      expect(result.records[0]).toMatchObject({ adoption_id: ADOPTION, proposal_key: "P1", proposal_category: "causal_hypothesis", adopted_at: TIME, adopted_by_user_id: USER, adopted_item: { proposal_key: "P1", adopted_content: { hypothesis: "Hypothesis", rationale: "Rationale" }, human_causal_role: "proposed_root_cause" } });
    }
  });
  it("rejects duplicate adoption IDs even when proposal keys are unique", () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "s40-ids", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap" } }, { proposal_key: "P2", adopted_content: { gap: "Gap" } }] });
    const base = causalResponse("adopted");
    const result = parseInvestigationActiveAdoptionSuccess({ ...base, records: [base.records[0], { ...base.records[0], proposal_key: "P2" }] }, attempt!);
    expect(result).toMatchObject({ status: "failed", code: "INVALID_ADOPTION_RESPONSE" });
  });
  it.each([
    ["malformed workspace", { ...validWorkspace(), draft_revision: 0 }],
    ["missing workspace", undefined],
    ["wrong workspace shape", { ...validWorkspace(), root_cause_package: {} }],
  ])("rejects a %s", (_label, invalidWorkspace) => {
    const result = parseInvestigationActiveAdoptionSuccess(causalResponse("adopted", { workspace: invalidWorkspace }), causalAttempt()!);
    expect(result).toMatchObject({ status: "failed", code: "INVALID_ADOPTION_RESPONSE" });
  });
  it("rejects a wrong causal role", () => {
    const result = parseInvestigationActiveAdoptionSuccess(causalResponse("adopted", { records: [{ ...causalResponse().records[0], adopted_item: { ...causalResponse().records[0].adopted_item, human_causal_role: "contributing_factor" } }] }), causalAttempt()!);
    expect(result).toMatchObject({ status: "failed", code: "INVALID_ADOPTION_RESPONSE" });
  });
  it("rejects an invalid role string independently of the selected item type", () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "s40-invalid-role", selectedItems: [{ proposal_key: "P1", adopted_content: { hypothesis: "Hypothesis", rationale: "Rationale" }, human_causal_role: "invalid" as never }] });
    const response = causalResponse("adopted", { records: [{ ...causalResponse().records[0], adopted_item: { ...causalResponse().records[0].adopted_item, human_causal_role: "invalid" } }] });
    expect(parseInvestigationActiveAdoptionSuccess(response, attempt!)).toMatchObject({ status: "failed", code: "INVALID_ADOPTION_RESPONSE" });
  });
  it("rejects an unexpected role on a non-causal category", () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "s40-non-causal-role", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap" }, human_causal_role: "proposed_root_cause" }] });
    const record = { ...causalResponse().records[0], proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "Gap" }, human_causal_role: "proposed_root_cause" } };
    expect(parseInvestigationActiveAdoptionSuccess({ ...causalResponse(), records: [record] }, attempt!)).toMatchObject({ status: "failed", code: "INVALID_ADOPTION_RESPONSE" });
  });
  it("fails closed before transport for duplicate or malformed P# selections", () => {
    const input = { caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "s40-retry", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review" } }] };
    expect(createInvestigationActiveAdoptionAttempt({ ...input, selectedItems: [...input.selectedItems, ...input.selectedItems] })).toBeNull();
    expect(createInvestigationActiveAdoptionAttempt({ ...input, selectedItems: [{ ...input.selectedItems[0], proposal_key: "not-a-proposal" }] })).toBeNull();
  });
});
