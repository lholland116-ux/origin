import { describe, expect, it } from "vitest";
import {
  InMemoryCapaActionPlanReviewDecisionRepository,
} from "../../lib/database/in-memory/in-memory-capa-action-plan-review-decision-repository";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000001";
const SECTION = "40000000-0000-4000-8000-000000000001";
const RESULT = "50000000-0000-4000-8000-000000000001";
const REVIEWER = "60000000-0000-4000-8000-000000000001";
const AUDIT = "70000000-0000-4000-8000-000000000001";
const AT = "2026-09-09T12:00:00.000Z";
const TRANSACTION = {} as never;

function decision(overrides: Record<string, unknown> = {}): any {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    source_case_version_id: SOURCE,
    action_plan_section_version_id: SECTION,
    schema_version: "capa-action-plan-review-decision-1.0.0",
    decision: "approve",
    rationale: "The submitted action plan is suitable for implementation.",
    reviewer_user_id: REVIEWER,
    decided_at: AT,
    resulting_case_version_id: RESULT,
    transition_audit_event_id: AUDIT,
    ...overrides,
  };
}

describe("in-memory CAPA action-plan review decision repository", () => {
  it("saves and finds one tenant-scoped immutable decision", async () => {
    const repository = new InMemoryCapaActionPlanReviewDecisionRepository();
    await expect(repository.saveDecision(TRANSACTION, decision())).resolves.toMatchObject({ status: "saved", decision: decision() });
    await expect(repository.findDecision(ORG as never, CASE as never, SOURCE as never)).resolves.toMatchObject(decision());
    await expect(repository.findDecision("80000000-0000-4000-8000-000000000001" as never, CASE as never, SOURCE as never)).resolves.toBeNull();
  });

  it("rejects a second approve or return decision for the same S70 baseline", async () => {
    const repository = new InMemoryCapaActionPlanReviewDecisionRepository();
    await repository.saveDecision(TRANSACTION, decision());
    await expect(repository.saveDecision(TRANSACTION, decision({ decision: "return", rationale: "The plan needs revision." }))).resolves.toMatchObject({ status: "conflict", reason_code: "DECISION_ALREADY_COMMITTED", decision: decision() });
  });

  it("rejects malformed committed records before persistence", async () => {
    const repository = new InMemoryCapaActionPlanReviewDecisionRepository();
    await expect(repository.saveDecision(TRANSACTION, decision({ source_case_version_id: "not-a-uuid" }))).rejects.toThrow("action-plan review decision record is invalid");
    await expect(repository.saveDecision(TRANSACTION, decision({ rationale: "   " }))).rejects.toThrow("action-plan review decision record is invalid");
  });

  it("does not expose mutable stored state", async () => {
    const repository = new InMemoryCapaActionPlanReviewDecisionRepository();
    const saved = await repository.saveDecision(TRANSACTION, decision());
    if (saved.status !== "saved") throw new Error("expected saved decision");
    expect(Object.isFrozen(saved.decision)).toBe(true);
    const found = await repository.findDecision(ORG as never, CASE as never, SOURCE as never);
    expect(found).not.toBe(saved.decision);
  });
});
