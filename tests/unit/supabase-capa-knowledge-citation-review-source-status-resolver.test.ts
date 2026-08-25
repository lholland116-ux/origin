import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

import {
  SupabaseCapaKnowledgeCitationReviewSourceStatusResolver,
} from "../../lib/database/supabase/supabase-capa-knowledge-citation-review-source-status-resolver";

function harness(rows: unknown[]) {
  const calls: { query: string; values: readonly unknown[] }[] = [];
  const sql = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return rows;
  }) as unknown as postgres.Sql;
  return { sql, calls };
}

const input = {
  organization_id: "10000000-0000-4000-8000-000000000001",
  source_id: "20000000-0000-4000-8000-000000000001",
  source_version_id: "30000000-0000-4000-8000-000000000001",
} as never;

describe("Supabase CAPA citation-review source-status resolver", () => {
  it("returns one controlled status from an exact scoped source chain", async () => {
    const test = harness([{ status: "current_effective" }]);
    const resolver =
      new SupabaseCapaKnowledgeCitationReviewSourceStatusResolver(test.sql);
    await expect(resolver.resolveSourceStatus(input))
      .resolves.toBe("current_effective");
    expect(test.calls[0]?.query).toContain("source.source_id = ?");
    expect(test.calls[0]?.query).toContain("version.source_version_id = ?");
    expect(test.calls[0]?.query).toContain("source.organization_id = ?");
  });

  it("returns null for missing or ambiguous scoped records", async () => {
    const missing =
      new SupabaseCapaKnowledgeCitationReviewSourceStatusResolver(
        harness([]).sql,
      );
    const ambiguous =
      new SupabaseCapaKnowledgeCitationReviewSourceStatusResolver(
        harness([{ status: "current_effective" }, { status: "draft" }]).sql,
      );
    await expect(missing.resolveSourceStatus(input)).resolves.toBeNull();
    await expect(ambiguous.resolveSourceStatus(input)).resolves.toBeNull();
  });

  it("rejects an uncontrolled database status", async () => {
    const resolver =
      new SupabaseCapaKnowledgeCitationReviewSourceStatusResolver(
        harness([{ status: "invented" }]).sql,
      );
    await expect(resolver.resolveSourceStatus(input)).resolves.toBeNull();
  });
});
