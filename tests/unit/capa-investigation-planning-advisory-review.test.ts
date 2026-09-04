import { describe, expect, it } from "vitest";
import {
  buildCapaInvestigationPlanningAdvisoryReview,
  setCapaInvestigationPlanningAdvisoryReviewDependency,
  updateCapaInvestigationPlanningAdvisoryReviewCard,
  validateCapaInvestigationPlanningAdvisorySelection,
} from "../../app/capa/capa-investigation-planning-advisory-review";
import type { CapaInvestigationPlanAdvisoryProposal } from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";

const proposal = {
  investigation_questions: [
    { proposal_key: "P1", investigation_question: "What caused the deviation?", scope_relationship: "In scope", due_date_consideration: "Review schedule", human_review_question: "What confirms this?" },
    { proposal_key: "P2", investigation_question: "What evidence shows recurrence?", scope_relationship: "Related process", due_date_consideration: "Coordinate timing", human_review_question: "What supports recurrence?" },
  ],
  evidence_requests: [{ proposal_key: "P1", evidence_target: "Batch records", human_review_question: "Which records?" }],
  method_suggestions: [{ proposal_key: "P2", investigation_method: "Trend review", human_review_question: "Is this method adequate?" }],
  dependencies: [{ dependent_proposal_key: "P2", prerequisite_proposal_key: "P1", sequencing_recommendation: "Review P1 first", human_review_question: "Should P1 precede P2?" }],
  proposed_owner_role: [{ proposal_key: "P1", proposed_owner_role: "Investigator", suggested_sme_function: "Quality", human_review_question: "Who is eligible?" }],
  gaps: [],
} as unknown as CapaInvestigationPlanAdvisoryProposal;

describe("S30 advisory proposal review model", () => {
  it("joins by proposal key and keeps owner/date guidance non-authoritative", () => {
    const built = buildCapaInvestigationPlanningAdvisoryReview(proposal);
    expect(built).toMatchObject({ valid: true });
    if (!built.valid) return;
    expect(built.cards[0]).toMatchObject({ proposalKey: "P1", evidenceTarget: "Batch records", ownerUserId: "", dueDate: "", proposedOwnerRole: "Investigator" });
    expect(built.cards[1]).toMatchObject({ proposalKey: "P2", investigationMethod: "Trend review", dependencyProposalKeys: ["P1"] });
  });

  it("rejects ambiguous keyed components and invalid dependency graphs", () => {
    const duplicate = { ...proposal, evidence_requests: [...proposal.evidence_requests, proposal.evidence_requests[0]] };
    expect(buildCapaInvestigationPlanningAdvisoryReview(duplicate)).toMatchObject({ valid: false });
    const built = buildCapaInvestigationPlanningAdvisoryReview(proposal);
    if (!built.valid) return;
    expect(setCapaInvestigationPlanningAdvisoryReviewDependency(built.cards, "P1" as never, "P1" as never, true)).toBeNull();
    const cycle = setCapaInvestigationPlanningAdvisoryReviewDependency(built.cards, "P1" as never, "P2" as never, true);
    expect(cycle).toBeNull();
  });

  it("requires actual human owner/date and dependency closure", () => {
    const built = buildCapaInvestigationPlanningAdvisoryReview(proposal);
    if (!built.valid) throw new Error("fixture invalid");
    let cards = updateCapaInvestigationPlanningAdvisoryReviewCard(built.cards, "P2" as never, { selected: true });
    expect(validateCapaInvestigationPlanningAdvisorySelection(cards)).toMatchObject({ valid: false });
    cards = updateCapaInvestigationPlanningAdvisoryReviewCard(cards, "P2" as never, { evidenceTarget: "Evidence", ownerUserId: "OWNER", dueDate: "2026-10-01" });
    expect(validateCapaInvestigationPlanningAdvisorySelection(cards)).toMatchObject({ valid: false, message: expect.stringContaining("not selected") });
  });
});
