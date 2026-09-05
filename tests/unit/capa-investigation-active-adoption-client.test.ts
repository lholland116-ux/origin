import { describe, expect, it } from "vitest";
import { createInvestigationActiveAdoptionAttempt, parseInvestigationActiveAdoptionSuccess, submitInvestigationActiveAdoptionAttempt } from "../../app/capa/capa-investigation-active-adoption-client";

const CASE = "10000000-0000-4000-8000-000000000001"; const VERSION = "20000000-0000-4000-8000-000000000001"; const OUTPUT = "30000000-0000-4000-8000-000000000001"; const USER = "40000000-0000-4000-8000-000000000001"; const ADOPTION = "50000000-0000-4000-8000-000000000001";
describe("S40 adoption browser client", () => {
  it("uses the exact request body and safe response projection", async () => {
    const attempt = createInvestigationActiveAdoptionAttempt({ caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, currentUserId: USER, idempotencyKey: "s40-retry", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }] });
    expect(attempt).not.toBeNull();
    const body = { status: "adopted", records: [{ adoption_id: ADOPTION, proposal_key: "P1", proposal_category: "evidence_gap", adopted_item: { proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review records" } }, adopted_at: "2026-09-05T12:00:00.000Z", adopted_by_user_id: USER }], correlation_id: "60000000-0000-4000-8000-000000000001" };
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
  it("fails closed before transport for duplicate or malformed P# selections", () => {
    const input = { caseId: CASE, currentVersionId: VERSION, recordVersion: 4, outputId: OUTPUT, idempotencyKey: "s40-retry", selectedItems: [{ proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Matters", recommended_next_step: "Review" } }] };
    expect(createInvestigationActiveAdoptionAttempt({ ...input, selectedItems: [...input.selectedItems, ...input.selectedItems] })).toBeNull();
    expect(createInvestigationActiveAdoptionAttempt({ ...input, selectedItems: [{ ...input.selectedItems[0], proposal_key: "not-a-proposal" }] })).toBeNull();
  });
});
