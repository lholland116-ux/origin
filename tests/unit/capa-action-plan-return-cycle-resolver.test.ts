import { describe, expect, it, vi } from "vitest";
import { createCapaActionPlanReturnCycleResolver } from "../../lib/capa/application/capa-action-plan-return-cycle-resolver";

const ORG = "10000000-0000-4000-8000-000000000001" as never;
const CASE = "20000000-0000-4000-8000-000000000001" as never;
const S70 = "30000000-0000-4000-8000-000000000001" as never;
const S60 = "30000000-0000-4000-8000-000000000002" as never;
const AUDIT = "50000000-0000-4000-8000-000000000001" as never;

function setup(overrides: Record<string, unknown> = {}) {
  const capaRepository = {
    findCaseById: vi.fn(async () => ({ organization_id: ORG, capa_case_id: CASE, current_version_id: S60, status: "S60", record_version: 4 })),
    findCaseVersionById: vi.fn(async (_org: unknown, _case: unknown, id: unknown) => id === S60
      ? ({ organization_id: ORG, capa_case_id: CASE, case_version_id: S60, status: "S60", version_number: 4, parent_version_id: S70 })
      : ({ organization_id: ORG, capa_case_id: CASE, case_version_id: S70, status: "S70", version_number: 3 })),
    ...overrides,
  } as any;
  const reviewDecisionRepository = {
    findDecision: vi.fn(async () => ({ organization_id: ORG, capa_case_id: CASE, source_case_version_id: S70, decision: "return", resulting_case_version_id: S60, transition_audit_event_id: AUDIT })),
  } as any;
  return { resolver: createCapaActionPlanReturnCycleResolver({ capa_repository: capaRepository, review_decision_repository: reviewDecisionRepository }), capaRepository, reviewDecisionRepository };
}

describe("S60 action-plan return-cycle resolver", () => {
  it("resolves the exact authoritative S70 return decision for the current S60 version", async () => {
    const test = setup();
    await expect(test.resolver.resolve({ organization_id: ORG, capa_case_id: CASE })).resolves.toEqual({ status: "active", cycle: { return_transition_audit_event_id: AUDIT, source_case_version_id: S70, resulting_case_version_id: S60 } });
    expect(test.reviewDecisionRepository.findDecision).toHaveBeenCalledWith(ORG, CASE, S70);
  });

  it("fails closed when the decision is not the return that produced the current S60 version", async () => {
    const test = setup();
    test.reviewDecisionRepository.findDecision.mockResolvedValue({ organization_id: ORG, capa_case_id: CASE, source_case_version_id: S70, decision: "approve", resulting_case_version_id: S60, transition_audit_event_id: AUDIT });
    await expect(test.resolver.resolve({ organization_id: ORG, capa_case_id: CASE })).resolves.toEqual({ status: "invalid", reason_code: "INVALID_ACTION_PLAN_RETURN_CYCLE_PROVENANCE" });
  });
});
