import { describe, expect, it } from "vitest";
import {
  buildCapaContainmentRiskReviewSubmission,
  EMPTY_CAPA_CONTAINMENT_RISK_REVIEW_DRAFT,
} from "../../app/capa/capa-containment-risk-review-draft";

function completeDraft() {
  return {
    ...EMPTY_CAPA_CONTAINMENT_RISK_REVIEW_DRAFT,
    actionRows:
      "hold-1 | containment | Hold affected inventory | quality-user-1 | 2026-08-29 | 2026-08-30 |  | in_progress | Prevent unintended use | hold-record-1, photo-1",
    products: "Device family A",
    processes: "Machining operation 40",
    dataImpact: "Inspection records under review",
    customerImpact: "No confirmed distribution",
    patientImpact: "No known patient impact",
    riskMethod: "QP-17",
    riskTerminologyVersion: "revision-6",
    riskResult: "Controlled pending investigation",
    riskRationale: "Immediate controls reduce exposure.",
    escalationRows:
      "Regulatory assessment | RA-2026-001 | resolved | Qualified review completed",
    approvalRationale: "I reviewed immediate controls, impact, risk, and escalation records.",
  };
}

describe("CAPA containment/risk review draft", () => {
  it("maps S20 working data to the existing controlled contract", () => {
    const result = buildCapaContainmentRiskReviewSubmission(completeDraft());
    expect(result.valid).toBe(true);
    if (!result.valid) return;
    expect(result.submission).toEqual({
      containmentRisk: {
        actions: [{
          action_id: "hold-1",
          action_type: "containment",
          description: "Hold affected inventory",
          owner_user_id: "quality-user-1",
          action_date: "2026-08-29",
          target_date: "2026-08-30",
          completed_date: null,
          status: "in_progress",
          rationale: "Prevent unintended use",
          supporting_evidence_references: ["hold-record-1", "photo-1"],
        }],
        impact_scope: {
          products: ["Device family A"],
          processes: ["Machining operation 40"],
          data: ["Inspection records under review"],
          customers: ["No confirmed distribution"],
          patients: ["No known patient impact"],
        },
        risk_evaluation: {
          method: "QP-17",
          terminology_version: "revision-6",
          result: "Controlled pending investigation",
          rationale: "Immediate controls reduce exposure.",
        },
        missing_risk_information: [],
        escalations: [{
          process: "Regulatory assessment",
          reference: "RA-2026-001",
          status: "resolved",
          rationale: "Qualified review completed",
        }],
      },
      approvalRationale:
        "I reviewed immediate controls, impact, risk, and escalation records.",
    });
  });

  it("requires human rationale without preselecting approval", () => {
    const result = buildCapaContainmentRiskReviewSubmission({
      ...completeDraft(), approvalRationale: "",
    });
    expect(result).toEqual({
      valid: false,
      field: "approvalRationale",
      message: "A human G-02 acceptance rationale is required.",
    });
    expect(EMPTY_CAPA_CONTAINMENT_RISK_REVIEW_DRAFT.approvalRationale).toBe("");
  });

  it("preserves unresolved risk information for server blocker evaluation", () => {
    const result = buildCapaContainmentRiskReviewSubmission({
      ...completeDraft(),
      missingRiskInformation: "Distribution exposure remains unknown.\nSupplier scope is pending.",
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect(
      result.submission.containmentRisk.missing_risk_information,
    ).toEqual(["Distribution exposure remains unknown.", "Supplier scope is pending."]);
  });

  it("rejects malformed controlled action rows", () => {
    const result = buildCapaContainmentRiskReviewSubmission({
      ...completeDraft(), actionRows: "not | enough | columns",
    });
    expect(result.valid).toBe(false);
  });
});
