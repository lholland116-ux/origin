import { describe, expect, it } from "vitest";
import {
  CAPA_ACTION_PLAN_READINESS_BLOCKER_CODES,
  CAPA_ACTION_PLAN_SCHEMA_VERSION,
  CAPA_ACTION_PLAN_SECTION_TYPE,
  CAPA_ACTION_STATUSES,
  CAPA_ACTION_TYPES,
  evaluateCapaActionPlanReadiness,
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../../lib/capa/domain/capa-action-plan";

const OWNER_ID = "60000000-0000-4000-8000-000000000001";
const ADOPTER_ID = "60000000-0000-4000-8000-000000000002";

function humanProvenance() {
  return {
    source_type: "human",
    source_reference: null,
    adopted_by_user_id: null,
    adopted_at: null,
  };
}

function aiProvenance(adopted = false) {
  return {
    source_type: "ai_proposal",
    source_reference: "ai-output-1",
    adopted_by_user_id: adopted ? ADOPTER_ID : null,
    adopted_at: adopted ? "2026-09-08T12:00:00.000Z" : null,
  };
}

function action(overrides: Record<string, unknown> = {}) {
  return {
    item_id: "A-1",
    action_type: "corrective",
    description: "Revise the controlled process.",
    linked_targets: [{
      target_type: "cause",
      target_id: "CAUSE-1",
      rationale: "Addresses the approved cause.",
    }],
    owner_user_id: OWNER_ID,
    due_date: "2026-10-01",
    status: "planned",
    deliverable: "Approved revised procedure.",
    implementation_evidence: "Training record and released procedure.",
    dependency_item_ids: [],
    unintended_consequence_assessment: "Assess downstream process impact.",
    effectiveness_check_required: false,
    draft_provenance: humanProvenance(),
    ...overrides,
  };
}

function effectivenessCheck(overrides: Record<string, unknown> = {}) {
  return {
    check_id: "CHECK-1",
    action_item_ids: ["A-1"],
    acceptance_criteria: "No repeat events in three consecutive lots.",
    evaluation_method: "Trend review.",
    data_source: "Nonconformance database.",
    timing: "90 days after implementation.",
    responsible_role: "Quality Engineering",
    sample_or_rationale: "All applicable lots.",
    draft_provenance: humanProvenance(),
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    items: [action()],
    effectiveness_checks: [],
    ...overrides,
  };
}

function validValue(input: unknown = plan()): CapaActionPlanContent {
  const result = validateCapaActionPlan(input);
  expect(result.status).toBe("valid");
  if (result.status !== "valid") throw new Error("Expected a valid plan");
  return result.value;
}

describe("CAPA S60 action-plan domain contract", () => {
  it("exposes the controlled section, schema, action types, and statuses", () => {
    expect(CAPA_ACTION_PLAN_SECTION_TYPE).toBe("CAPA.ACTION_PLAN");
    expect(CAPA_ACTION_PLAN_SCHEMA_VERSION).toBe("capa-action-plan-1.0.0");
    expect(CAPA_ACTION_TYPES).toEqual([
      "corrective",
      "preventive",
      "correction",
      "containment",
    ]);
    expect(CAPA_ACTION_STATUSES).toEqual([
      "planned",
      "approved",
      "in_progress",
      "implemented",
      "verified",
      "cancelled",
      "overdue",
    ]);
  });

  it("accepts an empty draft structure and freezes the normalized output", () => {
    const result = validateCapaActionPlan({
      items: [],
      effectiveness_checks: [],
    });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(result.value).toEqual({ items: [], effectiveness_checks: [] });
    expect(Object.isFrozen(result.value)).toBe(true);
    expect(Object.isFrozen(result.value.items)).toBe(true);
    expect(Object.isFrozen(result.value.effectiveness_checks)).toBe(true);
  });

  it("accepts a fully ready plan with dependencies and effectiveness coverage", () => {
    const result = validateCapaActionPlan({
      items: [
        action({
          effectiveness_check_required: true,
        }),
        action({
          item_id: "A-2",
          action_type: "preventive",
          dependency_item_ids: ["A-1"],
          linked_targets: [{
            target_type: "gap",
            target_id: "GAP-1",
            rationale: "Closes the identified gap.",
          }],
        }),
      ],
      effectiveness_checks: [effectivenessCheck()],
    });

    expect(result.status).toBe("valid");
    if (result.status !== "valid") return;
    expect(evaluateCapaActionPlanReadiness(result.value)).toEqual({
      status: "ready_for_review",
    });
    expect(Object.isFrozen(result.value.items[0])).toBe(true);
    expect(Object.isFrozen(result.value.items[0].linked_targets)).toBe(true);
    expect(Object.isFrozen(result.value.items[0].linked_targets[0])).toBe(true);
    expect(Object.isFrozen(result.value.items[0].draft_provenance)).toBe(true);
    expect(Object.isFrozen(result.value.effectiveness_checks[0])).toBe(true);
  });

  it.each([
    ["non-object", null, "INVALID_ACTION_PLAN_OBJECT"],
    ["unexpected top-level key", { items: [], effectiveness_checks: [], extra: true }, "INVALID_ACTION_PLAN_FIELDS"],
    ["non-array items", { items: {}, effectiveness_checks: [] }, "INVALID_ACTION_PLAN_ITEMS"],
    ["non-array checks", { items: [], effectiveness_checks: {} }, "INVALID_ACTION_PLAN_EFFECTIVENESS_CHECKS"],
  ])("rejects %s with an exact structural reason", (_label, input, reason) => {
    const result = validateCapaActionPlan(input);
    expect(result.status).toBe("invalid");
    if (result.status === "invalid") {
      expect(result.reason_code).toBe(reason);
    }
  });

  it("rejects unexpected action keys, duplicate IDs, invalid status, and invalid action type", () => {
    expect(validateCapaActionPlan({
      ...plan(),
      items: [{ ...action(), extra: true }],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_ITEM" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action(), action()],
    })).toMatchObject({ status: "invalid", reason_code: "DUPLICATE_ACTION_ITEM_ID" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({ status: "complete" })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_STATUS" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({ action_type: "not a controlled code" })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_TYPE" });
  });

  it("allows organization-approved action codes while validating links and duplicate links", () => {
    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({ action_type: "organization_specific_action" })],
    }).status).toBe("valid");

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({
        linked_targets: [{ target_type: "unknown", target_id: "R-1", rationale: "Reason." }],
      })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_LINK" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({
        linked_targets: [
          { target_type: "risk", target_id: "R-1", rationale: "First rationale." },
          { target_type: "risk", target_id: "R-1", rationale: "Duplicate target." },
        ],
      })],
    })).toMatchObject({ status: "invalid", reason_code: "DUPLICATE_ACTION_LINK" });
  });

  it("validates owner, due date, dependencies, and provenance", () => {
    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({ owner_user_id: "not-a-uuid" })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_OWNER" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({ due_date: "2026-02-30" })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_DUE_DATE" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({ dependency_item_ids: ["A-2", "A-2"] })],
    })).toMatchObject({ status: "invalid", reason_code: "DUPLICATE_ACTION_DEPENDENCY" });

    expect(validateCapaActionPlan({
      ...plan(),
      items: [action({
        draft_provenance: {
          ...humanProvenance(),
          adopted_by_user_id: OWNER_ID,
        },
      })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_ACTION_PROVENANCE" });
  });

  it("validates effectiveness-check shape, IDs, and action references", () => {
    expect(validateCapaActionPlan({
      ...plan(),
      effectiveness_checks: [effectivenessCheck({ extra: true })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_EFFECTIVENESS_CHECK" });

    expect(validateCapaActionPlan({
      ...plan(),
      effectiveness_checks: [effectivenessCheck(), effectivenessCheck()],
    })).toMatchObject({ status: "invalid", reason_code: "DUPLICATE_EFFECTIVENESS_CHECK_ID" });

    expect(validateCapaActionPlan({
      ...plan(),
      effectiveness_checks: [effectivenessCheck({ action_item_ids: ["A-404"] })],
    })).toMatchObject({ status: "invalid", reason_code: "INVALID_EFFECTIVENESS_ACTION_REFERENCES" });

    expect(validateCapaActionPlan({
      ...plan(),
      effectiveness_checks: [effectivenessCheck({ action_item_ids: ["A-1", "A-1"] })],
    })).toMatchObject({ status: "invalid", reason_code: "DUPLICATE_EFFECTIVENESS_ACTION_REFERENCE" });
  });

  it("blocks missing dependencies, self-dependencies, and dependency cycles", () => {
    const missing = validValue({
      ...plan(),
      items: [action({ dependency_item_ids: ["A-404"] })],
    });
    expect(evaluateCapaActionPlanReadiness(missing)).toMatchObject({
      status: "blocked",
      blocker_codes: ["MISSING_DEPENDENCY_TARGET"],
    });

    const self = validValue({
      ...plan(),
      items: [action({ dependency_item_ids: ["A-1"] })],
    });
    expect(evaluateCapaActionPlanReadiness(self)).toMatchObject({
      status: "blocked",
      blocker_codes: ["SELF_DEPENDENCY", "DEPENDENCY_CYCLE"],
    });

    const cycle = validValue({
      ...plan(),
      items: [
        action({ dependency_item_ids: ["A-2"] }),
        action({ item_id: "A-2", dependency_item_ids: ["A-1"] }),
      ],
    });
    expect(evaluateCapaActionPlanReadiness(cycle)).toMatchObject({
      status: "blocked",
      blocker_codes: ["DEPENDENCY_CYCLE"],
    });
  });

  it("blocks unadopted AI proposals and required effectiveness gaps", () => {
    const ai = validValue({
      ...plan(),
      items: [action({
        effectiveness_check_required: true,
        draft_provenance: aiProvenance(),
      })],
    });
    expect(evaluateCapaActionPlanReadiness(ai)).toMatchObject({
      status: "blocked",
      blocker_codes: [
        "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
        "MISSING_REQUIRED_EFFECTIVENESS_CHECK",
      ],
    });

    const missingCriteria = validValue({
      ...plan(),
      items: [action({ effectiveness_check_required: true })],
      effectiveness_checks: [effectivenessCheck({ acceptance_criteria: null })],
    });
    expect(evaluateCapaActionPlanReadiness(missingCriteria)).toMatchObject({
      status: "blocked",
      blocker_codes: ["MISSING_EFFECTIVENESS_ACCEPTANCE_CRITERIA"],
    });
  });

  it("reports invalid effectiveness references during readiness and orders blockers deterministically", () => {
    const invalidReferencePlan = {
      items: validValue().items,
      effectiveness_checks: [{
        check_id: "CHECK-1",
        action_item_ids: ["A-404"],
        acceptance_criteria: null,
        evaluation_method: null,
        data_source: null,
        timing: null,
        responsible_role: null,
        sample_or_rationale: null,
        draft_provenance: humanProvenance(),
      }],
    } as unknown as CapaActionPlanContent;
    expect(evaluateCapaActionPlanReadiness(invalidReferencePlan)).toMatchObject({
      status: "blocked",
      blocker_codes: ["INVALID_EFFECTIVENESS_ACTION_REFERENCE"],
    });

    const incomplete = validValue({
      ...plan(),
      items: [action({
        action_type: null,
        description: null,
        linked_targets: [],
        owner_user_id: null,
        due_date: null,
        deliverable: null,
        implementation_evidence: null,
        unintended_consequence_assessment: null,
        effectiveness_check_required: true,
        draft_provenance: aiProvenance(),
      })],
    });
    const readiness = evaluateCapaActionPlanReadiness(incomplete);
    expect(readiness).toEqual({
      status: "blocked",
      blocker_codes: [
        "UNLINKED_ACTION",
        "MISSING_ACTION_TYPE",
        "MISSING_ACTION_DESCRIPTION",
        "UNASSIGNED_ACTION",
        "MISSING_ACTION_DUE_DATE",
        "MISSING_ACTION_DELIVERABLE",
        "MISSING_IMPLEMENTATION_EVIDENCE",
        "MISSING_UNINTENDED_CONSEQUENCE_ASSESSMENT",
        "AI_PROPOSAL_NOT_HUMAN_ADOPTED",
        "MISSING_REQUIRED_EFFECTIVENESS_CHECK",
      ],
    });
    if (readiness.status === "blocked") {
      expect(readiness.blocker_codes).toEqual(
        CAPA_ACTION_PLAN_READINESS_BLOCKER_CODES.filter((code) =>
          readiness.blocker_codes.includes(code),
        ),
      );
    }
  });
});
