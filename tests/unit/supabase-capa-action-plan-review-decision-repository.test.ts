import { describe, expect, it, vi } from "vitest";
import {
  SupabaseCapaActionPlanReviewDecisionRepository,
  SupabaseCapaActionPlanReviewDecisionRepositoryError,
} from "../../lib/database/supabase/supabase-capa-action-plan-review-decision-repository";

let transactionSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({
  requireSupabaseTransaction: vi.fn(() => transactionSql),
}));

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const SOURCE = "30000000-0000-4000-8000-000000000001";
const SECTION = "40000000-0000-4000-8000-000000000001";
const RESULT = "50000000-0000-4000-8000-000000000001";
const REVIEWER = "60000000-0000-4000-8000-000000000001";
const AUDIT = "70000000-0000-4000-8000-000000000001";
const AT = "2026-09-09T12:00:00.000Z";

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

function harness(...responses: unknown[]) {
  const queue = [...responses];
  const calls: Array<{ readonly text: string; readonly values: readonly unknown[] }> = [];
  const sql = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("?"), values });
    return queue.shift() ?? [];
  });
  transactionSql = sql;
  return { sql: sql as never, calls, transaction: {} as never };
}

describe("Supabase CAPA action-plan review decision repository", () => {
  it("inserts the committed decision transactionally", async () => {
    const h = harness([decision()]);
    await expect(new SupabaseCapaActionPlanReviewDecisionRepository(h.sql).saveDecision(h.transaction, decision())).resolves.toMatchObject({ status: "saved", decision: decision() });
    expect(h.calls[0]!.text).toMatch(/insert into public\.capa_action_plan_review_decisions[\s\S]*on conflict[\s\S]*do nothing[\s\S]*returning/);
    expect(h.calls[0]!.values).toEqual(expect.arrayContaining([ORG, CASE, SOURCE, SECTION, RESULT, AUDIT]));
  });

  it("maps a source-baseline uniqueness collision to a controlled conflict", async () => {
    const h = harness([], [decision()]);
    await expect(new SupabaseCapaActionPlanReviewDecisionRepository(h.sql).saveDecision(h.transaction, decision({ decision: "return" }))).resolves.toMatchObject({ status: "conflict", reason_code: "DECISION_ALREADY_COMMITTED", decision: decision() });
    expect(h.calls).toHaveLength(2);
  });

  it("finds one tenant-scoped decision and treats absence as null", async () => {
    const found = harness([decision()]);
    await expect(new SupabaseCapaActionPlanReviewDecisionRepository(found.sql).findDecision(ORG as never, CASE as never, SOURCE as never)).resolves.toMatchObject(decision());
    expect(found.calls[0]!.values).toEqual([ORG, CASE, SOURCE]);
    const absent = harness([]);
    await expect(new SupabaseCapaActionPlanReviewDecisionRepository(absent.sql).findDecision(ORG as never, CASE as never, SOURCE as never)).resolves.toBeNull();
  });

  it("fails closed for malformed caller and returned rows", async () => {
    const caller = harness();
    await expect(new SupabaseCapaActionPlanReviewDecisionRepository(caller.sql).saveDecision(caller.transaction, decision({ decision: "defer" }))).rejects.toThrow(SupabaseCapaActionPlanReviewDecisionRepositoryError);
    expect(caller.calls).toHaveLength(0);
    const returned = harness([{ ...decision(), rationale: "   " }]);
    await expect(new SupabaseCapaActionPlanReviewDecisionRepository(returned.sql).saveDecision(returned.transaction, decision())).rejects.toThrow(SupabaseCapaActionPlanReviewDecisionRepositoryError);
  });
});
