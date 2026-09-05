import { describe, expect, it } from "vitest";
import { buildCapaInvestigationActiveAdvisoryReview, updateCapaInvestigationActiveAdvisoryReviewCard, validateCapaInvestigationActiveAdvisorySelection } from "../../app/capa/capa-investigation-active-advisory-review";

const proposal = { evidence_gaps: [{ proposal_key: "P1", gap: "Missing record", why_it_matters: "It matters", related_reference_keys: ["R1"], recommended_next_step: "Review it", human_review_question: "Should this gap be addressed?" }], conflicting_information: [], assumptions: [], causal_hypotheses: [{ proposal_key: "P2", hypothesis: "A cause", suggested_role: "possible_root_cause", rationale: "Needs review", supporting_reference_keys: [], contradictory_reference_keys: [], human_review_question: "Should this be evaluated?" }], alternative_hypotheses: [], investigation_recommendations: [] } as never;
describe("S40 advisory review", () => {
  it("groups proposals while keeping references read-only and supports human content edits", () => {
    const built = buildCapaInvestigationActiveAdvisoryReview(proposal); expect(built.valid).toBe(true); if (!built.valid) return;
    const edited = updateCapaInvestigationActiveAdvisoryReviewCard(built.cards, "P1", { selected: true, adoptedContent: { gap: "Edited gap", why_it_matters: "Edited reason", recommended_next_step: "Edited step" } });
    expect(edited[0]?.referenceKeys).toEqual(["R1"]); expect(edited[0]?.adoptedContent).toEqual({ gap: "Edited gap", why_it_matters: "Edited reason", recommended_next_step: "Edited step" });
  });
  it("requires a human-selected causal role before adoption", () => {
    const built = buildCapaInvestigationActiveAdvisoryReview(proposal); if (!built.valid) throw new Error("fixture");
    const selected = updateCapaInvestigationActiveAdvisoryReviewCard(built.cards, "P2", { selected: true });
    expect(validateCapaInvestigationActiveAdvisorySelection(selected)).toMatchObject({ valid: false });
    const withRole = updateCapaInvestigationActiveAdvisoryReviewCard(selected, "P2", { humanCausalRole: "contributing_factor" });
    expect(validateCapaInvestigationActiveAdvisorySelection(withRole)).toMatchObject({ valid: true });
    const both = updateCapaInvestigationActiveAdvisoryReviewCard(withRole, "P1", { selected: true });
    expect(validateCapaInvestigationActiveAdvisorySelection(both)).toMatchObject({ valid: true });
  });
});
