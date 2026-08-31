import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";
import { CapaParticipantEligibilityDataError,
  SupabaseCapaParticipantEligibilityRepository } from
  "../../lib/database/supabase/supabase-capa-participant-eligibility-repository";
import { SupabaseTransactionContextError } from
  "../../lib/database/supabase/supabase-transactions";
import { SupabaseTransactionManager } from
  "../../lib/database/supabase/supabase-transactions";

const ORG = "20000000-0000-4000-8000-000000000001" as never;
const USER_A = "10000000-0000-4000-8000-000000000002";
const USER_B = "10000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-01T12:00:00.000Z");

function harness(rows: unknown[]) {
  const calls: Array<{ query: string; values: readonly unknown[] }> = [];
  const tagged = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return rows;
  });
  return { sql: tagged as unknown as postgres.Sql, calls };
}

describe("Supabase CAPA participant eligibility repository", () => {
  it("returns deterministic unique opaque participants with null labels", async () => {
    const source = harness([{ user_id: USER_A }, { user_id: USER_B }, { user_id: USER_A }]);
    const repository = new SupabaseCapaParticipantEligibilityRepository(source.sql);
    await expect(repository.listEligibleInvestigationOwners(ORG, NOW)).resolves.toEqual([
      { user_id: USER_B, display_label: null },
      { user_id: USER_A, display_label: null },
    ]);
    expect(source.calls[0]!.values).toContain(ORG);
    expect(source.calls[0]!.query).toContain("membership.organization_id = ?");
    expect(source.calls[0]!.query).toContain("assignment.scope_code = 'ORGANIZATION'");
    expect(source.calls[0]!.query).toContain("assignment.role_id in ('CAPA_OWNER', 'CAPA_CONTRIBUTOR')");
    expect(source.calls[0]!.query).toContain("organization.status = 'active'");
    expect(source.calls[0]!.query).toContain("membership.status = 'active'");
    expect(source.calls[0]!.query).toContain("assignment.status = 'active'");
    expect(source.calls[0]!.query).toContain("role.status = 'active'");
  });

  it("fails closed for malformed rows", async () => {
    const source = harness([{ user_id: "not-a-uuid" }]);
    const repository = new SupabaseCapaParticipantEligibilityRepository(source.sql);
    await expect(repository.listEligibleInvestigationOwners(ORG, NOW))
      .rejects.toBeInstanceOf(CapaParticipantEligibilityDataError);
  });

  it("requires an authentic active transaction for commit-time validation", async () => {
    const source = harness([]);
    const repository = new SupabaseCapaParticipantEligibilityRepository(source.sql);
    await expect(repository.findIneligibleInvestigationOwnerIds({
      transaction_id: "forged", started_at: NOW.toISOString(), request_trace: {},
    } as never, ORG, [USER_A as never], NOW)).rejects.toBeInstanceOf(
      SupabaseTransactionContextError,
    );
  });

  it("issues tenant-scoped FOR SHARE eligibility locking through the active transaction", async () => {
    const transactionCalls: string[] = [];
    const transactionSql = vi.fn(async (strings: TemplateStringsArray) => {
      transactionCalls.push(strings.join("?").replace(/\s+/g, " ").trim());
      return [{ user_id: USER_A }];
    });
    const rootSql = Object.assign(vi.fn(), {
      begin: vi.fn(async (_options: string, work: (sql: unknown) => unknown) =>
        work(transactionSql)),
    }) as unknown as postgres.Sql;
    const repository = new SupabaseCapaParticipantEligibilityRepository(rootSql);
    const manager = new SupabaseTransactionManager(rootSql);
    const ineligible = await manager.runInTransaction({
      request_id: "request" as never, correlation_id: "correlation" as never,
    }, (transaction) => repository.findIneligibleInvestigationOwnerIds(
      transaction, ORG, [USER_A as never, USER_A as never], NOW,
    ));
    expect(ineligible).toEqual([]);
    expect(transactionCalls).toHaveLength(1);
    expect(transactionCalls[0]).toContain("membership.organization_id = ?");
    expect(transactionCalls[0]).toContain("for share of organization, membership, assignment, role");
  });
});
