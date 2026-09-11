import { describe, expect, it, vi } from "vitest";
import {
  SupabaseCapaImplementationReviewDecisionRepository,
  SupabaseCapaImplementationReviewDecisionRepositoryError,
} from "../../lib/database/supabase/supabase-capa-implementation-review-decision-repository";

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
const AT = "2026-09-11T12:00:00.000Z";

function decision(overrides: Record<string, unknown> = {}): any {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    source_case_version_id: SOURCE,
    implementation_review_baseline_section_version_id: SECTION,
    schema_version: "capa-implementation-review-decision-1.0.0",
    decision: "accept",
    rationale: "The implementation evidence is ready for acceptance.",
    reviewer_user_id: REVIEWER,
    decided_at: AT,
    resulting_case_version_id: RESULT,
    transition_audit_event_id: AUDIT,
    ...overrides,
  };
}

function harness(...responses: unknown[]) {
  const queue = [...responses];
  const calls: Array<{
    readonly text: string;
    readonly values: readonly unknown[];
  }> = [];
  const sql = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({ text: strings.join("?"), values });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  });
  transactionSql = sql;
  return { sql: sql as never, calls, transaction: {} as never };
}

describe("Supabase CAPA implementation-review decision repository", () => {
  it("saves and maps an accept decision transactionally", async () => {
    const h = harness([decision()]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(h.sql)
        .saveDecision(h.transaction, decision()),
    ).resolves.toMatchObject({
      status: "saved",
      decision: decision(),
    });

    expect(h.calls[0]!.text).toMatch(
      /insert into public\.capa_implementation_review_decisions[\s\S]*on conflict[\s\S]*do nothing[\s\S]*returning/,
    );
    expect(h.calls[0]!.values).toEqual(
      expect.arrayContaining([ORG, CASE, SOURCE, SECTION, RESULT, AUDIT]),
    );
  });

  it("preserves return decisions and the exact baseline section identity", async () => {
    const h = harness([
      decision({
        decision: "return",
        implementation_review_baseline_section_version_id: SECTION,
        rationale: "The implementation evidence needs additional owner work.",
      }),
    ]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(h.sql)
        .saveDecision(
          h.transaction,
          decision({
            decision: "return",
            implementation_review_baseline_section_version_id: SECTION,
            rationale: "The implementation evidence needs additional owner work.",
          }),
        ),
    ).resolves.toMatchObject({
      status: "saved",
      decision: {
        decision: "return",
        implementation_review_baseline_section_version_id: SECTION,
      },
    });
  });

  it("finds a tenant/case/source-scoped committed decision", async () => {
    const found = harness([decision()]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(found.sql)
        .findDecision(ORG as never, CASE as never, SOURCE as never),
    ).resolves.toMatchObject(decision());
    expect(found.calls[0]!.values).toEqual([ORG, CASE, SOURCE]);

    const absent = harness([]);
    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(absent.sql)
        .findDecision(ORG as never, CASE as never, SOURCE as never),
    ).resolves.toBeNull();
  });

  it("reads through the transaction-scoped SQL client", async () => {
    const h = harness([decision()]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(h.sql)
        .findDecisionInTransaction(
          h.transaction,
          ORG as never,
          CASE as never,
          SOURCE as never,
        ),
    ).resolves.toMatchObject(decision());

    expect(h.calls[0]!.values).toEqual([ORG, CASE, SOURCE]);
    expect(transactionSql).toHaveBeenCalledOnce();
  });

  it("maps only the source-baseline collision to a controlled conflict", async () => {
    const h = harness([], [decision()]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(h.sql)
        .saveDecision(
          h.transaction,
          decision({ decision: "return" }),
        ),
    ).resolves.toMatchObject({
      status: "conflict",
      reason_code: "DECISION_ALREADY_COMMITTED",
      decision: decision(),
    });
    expect(h.calls).toHaveLength(2);
  });

  it("fails as a repository error when a conflict cannot be resolved", async () => {
    const h = harness([]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(h.sql)
        .saveDecision(h.transaction, decision()),
    ).rejects.toThrow(SupabaseCapaImplementationReviewDecisionRepositoryError);
  });

  it("does not convert unrelated database failures into duplicate conflicts", async () => {
    const databaseFailure = new Error("connection failed");
    const h = harness(databaseFailure);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(h.sql)
        .saveDecision(h.transaction, decision()),
    ).rejects.toThrow(SupabaseCapaImplementationReviewDecisionRepositoryError);
    expect(h.calls).toHaveLength(1);
  });

  it("rejects malformed persisted rows", async () => {
    const malformed = harness([
      {
        ...decision(),
        implementation_review_baseline_section_version_id: "not-a-uuid",
      },
    ]);

    await expect(
      new SupabaseCapaImplementationReviewDecisionRepository(malformed.sql)
        .findDecision(ORG as never, CASE as never, SOURCE as never),
    ).rejects.toThrow(SupabaseCapaImplementationReviewDecisionRepositoryError);
  });

  it("returns normalized frozen records for accept and return decisions", async () => {
    const acceptHarness = harness([decision()]);
    const accept = await new SupabaseCapaImplementationReviewDecisionRepository(
      acceptHarness.sql,
    ).findDecision(ORG as never, CASE as never, SOURCE as never);

    expect(accept).toMatchObject({ decision: "accept" });
    expect(Object.isFrozen(accept)).toBe(true);

    const returnHarness = harness([
      decision({
        decision: "return",
        rationale: "The implementation evidence needs additional owner work.",
      }),
    ]);
    const returned = await new SupabaseCapaImplementationReviewDecisionRepository(
      returnHarness.sql,
    ).findDecision(ORG as never, CASE as never, SOURCE as never);

    expect(returned).toMatchObject({
      decision: "return",
      implementation_review_baseline_section_version_id: SECTION,
    });
    expect(Object.isFrozen(returned)).toBe(true);
  });
});
