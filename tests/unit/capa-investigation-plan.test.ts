import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_CANONICAL_BLOCKER_MAPPING,
  evaluateCapaInvestigationPlanGateReadiness,
  validateCapaInvestigationPlan,
} from "../../lib/capa/domain/capa-investigation-plan";

const OWNER = "10000000-0000-4000-8000-000000000001";
const SME = "10000000-0000-4000-8000-000000000002";

function item(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "INV-001",
    investigation_question: "What caused the observed result?",
    evidence_target: "Approved batch and equipment records",
    investigation_method: "Document review and structured interview",
    owner_user_id: OWNER,
    due_date: "2026-09-30",
    sme_user_ids: [SME],
    dependency_item_ids: [],
    scope_relationship: "Included batch and manufacturing line",
    status: "planned",
    disposition: null,
    disposition_rationale: null,
    draft_provenance: {
      source_type: "human",
      source_reference: null,
      adopted_by_user_id: null,
      adopted_at: null,
    },
    ...overrides,
  };
}

function validPlan(items = [item()]) {
  const result = validateCapaInvestigationPlan({ items });
  expect(result.status).toBe("valid");
  if (result.status !== "valid") throw new Error(result.reason_code);
  return result.value;
}

function expectInvalid(value: unknown, reason: string) {
  expect(validateCapaInvestigationPlan(value)).toEqual({
    status: "invalid",
    reason_code: reason,
  });
}

describe("CAPA investigation-plan validation", () => {
  it("accepts a valid single-item plan", () => {
    expect(validateCapaInvestigationPlan({ items: [item()] }).status).toBe("valid");
  });

  it("accepts a valid multi-item plan", () => {
    expect(validateCapaInvestigationPlan({
      items: [item(), item({ item_id: "INV-002", dependency_item_ids: ["INV-001"] })],
    }).status).toBe("valid");
  });

  it("accepts an empty plan as structurally valid", () => {
    expect(validateCapaInvestigationPlan({ items: [] }).status).toBe("valid");
  });

  it("rejects unknown plan and item fields", () => {
    expectInvalid({ items: [], override: true }, "INVALID_INVESTIGATION_PLAN_FIELDS");
    expectInvalid({ items: [item({ authority: "release" })] }, "INVALID_INVESTIGATION_PLAN_ITEM");
  });

  it("rejects duplicate item IDs", () => {
    expectInvalid({ items: [item(), item()] }, "DUPLICATE_INVESTIGATION_PLAN_ITEM_ID");
  });

  it.each([
    ["investigation_question", ""],
    ["evidence_target", " evidence"],
    ["investigation_method", 4],
    ["scope_relationship", ""],
  ])("rejects malformed %s", (field, value) => {
    expectInvalid({ items: [item({ [field]: value })] }, "INVALID_INVESTIGATION_PLAN_ITEM");
  });

  it("rejects an invalid owner identity", () => {
    expectInvalid({ items: [item({ owner_user_id: "user-1" })] }, "INVALID_PLAN_ITEM_OWNER");
  });

  it.each(["2026-02-30", "09/30/2026", ""])("rejects invalid date %s", (dueDate) => {
    expectInvalid({ items: [item({ due_date: dueDate })] }, "INVALID_PLAN_ITEM_DUE_DATE");
  });

  it("rejects duplicate SME references", () => {
    expectInvalid({ items: [item({ sme_user_ids: [SME, SME] })] }, "DUPLICATE_PLAN_ITEM_SME_REFERENCE");
  });

  it("rejects malformed and duplicate dependencies", () => {
    expectInvalid({ items: [item({ dependency_item_ids: [1] })] }, "INVALID_PLAN_ITEM_DEPENDENCIES");
    expectInvalid({ items: [item({ dependency_item_ids: ["INV-002", "INV-002"] })] }, "DUPLICATE_PLAN_ITEM_DEPENDENCY");
  });

  it("requires disposition and rationale together for cancelled items", () => {
    expectInvalid({ items: [item({ status: "cancelled" })] }, "INVALID_PLAN_ITEM_STATUS_DISPOSITION");
    expect(validateCapaInvestigationPlan({ items: [item({
      status: "cancelled",
      disposition: "NOT_REQUIRED",
      disposition_rationale: "Superseded by INV-002.",
    })] }).status).toBe("valid");
  });

  it("requires and confines disposition rationale to dispositioned states", () => {
    expectInvalid({ items: [item({ status: "dispositioned", disposition: "NOT_APPLICABLE" })] }, "INVALID_PLAN_ITEM_STATUS_DISPOSITION");
    expectInvalid({ items: [item({ disposition: "NOT_APPLICABLE", disposition_rationale: "Not needed." })] }, "INVALID_PLAN_ITEM_STATUS_DISPOSITION");
  });

  it("rejects non-ISO AI-proposal adoption timestamps", () => {
    expectInvalid({ items: [item({
      draft_provenance: {
        source_type: "ai_proposal",
        source_reference: "AG-PLAN:output-1",
        adopted_by_user_id: OWNER,
        adopted_at: "September 1, 2026",
      },
    })] }, "INVALID_PLAN_ITEM_PROVENANCE");
  });
});

describe("pilot G-03 investigation-plan readiness", () => {
  it("releases a valid planned single-item plan", () => {
    expect(evaluateCapaInvestigationPlanGateReadiness(validPlan())).toEqual({
      status: "ready_for_release",
    });
  });

  it("releases a valid planned multi-item plan", () => {
    const plan = validPlan([
      item(),
      item({ item_id: "INV-002", dependency_item_ids: ["INV-001"] }),
    ]);
    expect(evaluateCapaInvestigationPlanGateReadiness(plan)).toEqual({
      status: "ready_for_release",
    });
  });

  it("allows a properly dispositioned item", () => {
    const plan = validPlan([
      item({
        status: "dispositioned",
        disposition: "NOT_APPLICABLE",
        disposition_rationale: "Question resolved by the controlled scope record.",
      }),
    ]);
    expect(evaluateCapaInvestigationPlanGateReadiness(plan)).toEqual({ status: "ready_for_release" });
  });

  it("blocks an empty plan", () => {
    expect(evaluateCapaInvestigationPlanGateReadiness(validPlan([]))).toEqual({
      status: "blocked",
      blocker_codes: ["EMPTY_INVESTIGATION_PLAN"],
    });
  });

  it.each([
    ["investigation_question", "MISSING_INVESTIGATION_QUESTION"],
    ["evidence_target", "MISSING_EVIDENCE_TARGET"],
    ["investigation_method", "MISSING_INVESTIGATION_METHOD"],
    ["owner_user_id", "UNASSIGNED_INVESTIGATION_PLAN_ITEM"],
    ["due_date", "MISSING_INVESTIGATION_DUE_DATE"],
    ["scope_relationship", "MISSING_SCOPE_RELATIONSHIP"],
  ])("blocks missing %s", (field, blocker) => {
    const result = evaluateCapaInvestigationPlanGateReadiness(validPlan([item({ [field]: null })]));
    expect(result).toEqual({ status: "blocked", blocker_codes: [blocker] });
  });

  it("blocks a missing dependency target and self-dependency", () => {
    expect(evaluateCapaInvestigationPlanGateReadiness(validPlan([
      item({ dependency_item_ids: ["MISSING", "INV-001"] }),
    ]))).toEqual({
      status: "blocked",
      blocker_codes: ["MISSING_DEPENDENCY_TARGET", "SELF_DEPENDENCY", "DEPENDENCY_CYCLE"],
    });
  });

  it("blocks direct and multi-item dependency cycles", () => {
    const direct = validPlan([
      item({ item_id: "A", dependency_item_ids: ["B"] }),
      item({ item_id: "B", dependency_item_ids: ["A"] }),
    ]);
    expect(evaluateCapaInvestigationPlanGateReadiness(direct)).toMatchObject({ blocker_codes: ["DEPENDENCY_CYCLE"] });

    const multi = validPlan([
      item({ item_id: "A", dependency_item_ids: ["B"] }),
      item({ item_id: "B", dependency_item_ids: ["C"] }),
      item({ item_id: "C", dependency_item_ids: ["A"] }),
    ]);
    expect(evaluateCapaInvestigationPlanGateReadiness(multi)).toMatchObject({ blocker_codes: ["DEPENDENCY_CYCLE"] });
  });

  it("uses deterministic blocker ordering", () => {
    const result = evaluateCapaInvestigationPlanGateReadiness(validPlan([item({
      investigation_question: null,
      evidence_target: null,
      investigation_method: null,
      owner_user_id: null,
      due_date: null,
      scope_relationship: null,
      status: "in_progress",
    })]));
    expect(result).toEqual({
      status: "blocked",
      blocker_codes: [
        "MISSING_INVESTIGATION_QUESTION",
        "MISSING_EVIDENCE_TARGET",
        "MISSING_INVESTIGATION_METHOD",
        "UNASSIGNED_INVESTIGATION_PLAN_ITEM",
        "MISSING_INVESTIGATION_DUE_DATE",
        "MISSING_SCOPE_RELATIONSHIP",
        "INVESTIGATION_EXECUTION_ALREADY_STARTED",
      ],
    });
  });

  it("blocks pre-release in-progress and completed execution states", () => {
    expect(evaluateCapaInvestigationPlanGateReadiness(validPlan([item({ status: "in_progress" })]))).toMatchObject({
      blocker_codes: ["INVESTIGATION_EXECUTION_ALREADY_STARTED"],
    });
    expect(evaluateCapaInvestigationPlanGateReadiness(validPlan([item({ status: "completed" })]))).toMatchObject({
      blocker_codes: ["INVESTIGATION_EXECUTION_COMPLETED_BEFORE_RELEASE"],
    });
  });

  it("allows a properly cancelled item to remain in plan history", () => {
    expect(evaluateCapaInvestigationPlanGateReadiness(validPlan([item({
      status: "cancelled",
      disposition: "WITHDRAWN",
      disposition_rationale: "No longer in scope.",
    })]))).toEqual({ status: "ready_for_release" });
  });

  it("allows mixed planned, dispositioned, and cancelled items", () => {
    const plan = validPlan([
      item(),
      item({
        item_id: "INV-002",
        status: "dispositioned",
        disposition: "NOT_APPLICABLE",
        disposition_rationale: "Resolved by controlled scope review.",
      }),
      item({
        item_id: "INV-003",
        status: "cancelled",
        disposition: "WITHDRAWN",
        disposition_rationale: "Duplicate of INV-001.",
      }),
    ]);
    expect(evaluateCapaInvestigationPlanGateReadiness(plan)).toEqual({
      status: "ready_for_release",
    });
  });

  it("requires human adoption of AI-proposed draft content", () => {
    const proposed = validPlan([item({
      draft_provenance: {
        source_type: "ai_proposal",
        source_reference: "AG-PLAN:output-1",
        adopted_by_user_id: null,
        adopted_at: null,
      },
    })]);
    expect(evaluateCapaInvestigationPlanGateReadiness(proposed)).toMatchObject({ blocker_codes: ["AI_PROPOSAL_NOT_HUMAN_ADOPTED"] });

    const adopted = validPlan([item({
      draft_provenance: {
        source_type: "ai_proposal",
        source_reference: "AG-PLAN:output-1",
        adopted_by_user_id: OWNER,
        adopted_at: "2026-09-01T12:00:00.000Z",
      },
    })]);
    expect(evaluateCapaInvestigationPlanGateReadiness(adopted)).toEqual({ status: "ready_for_release" });
  });

  it("maps only controlled missing-data semantics and exposes no criticality or override", () => {
    expect(CAPA_INVESTIGATION_PLAN_CANONICAL_BLOCKER_MAPPING).toEqual({
      EMPTY_INVESTIGATION_PLAN: "B-01",
      MISSING_INVESTIGATION_QUESTION: "B-01",
      MISSING_EVIDENCE_TARGET: "B-01",
      MISSING_INVESTIGATION_METHOD: "B-01",
      UNASSIGNED_INVESTIGATION_PLAN_ITEM: "B-01",
      MISSING_INVESTIGATION_DUE_DATE: "B-01",
      MISSING_SCOPE_RELATIONSHIP: "B-01",
      MISSING_DEPENDENCY_TARGET: "B-01",
    });
    expect(Object.keys(CAPA_INVESTIGATION_PLAN_CANONICAL_BLOCKER_MAPPING).some((key) => key.includes("CRITICAL"))).toBe(false);
    expect(evaluateCapaInvestigationPlanGateReadiness).toHaveLength(1);
  });
});
