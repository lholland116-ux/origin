import { describe, expect, it, vi } from "vitest";
import type postgres from "postgres";

import { SupabaseCapaKnowledgeCitationReviewRepository } from
  "../../lib/database/supabase/supabase-capa-knowledge-citation-review-repository";
import { SupabaseTransactionManager } from
  "../../lib/database/supabase/supabase-transactions";

function harness() {
  const calls: { query: string; values: readonly unknown[] }[] = [];
  const responses: unknown[] = [];
  const tagged = vi.fn(async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    return responses.shift() ?? [];
  });
  const transaction = Object.assign(tagged, { json: (value: unknown) => value });
  const sql = Object.assign(tagged, {
    json: (value: unknown) => value,
    begin: vi.fn(async (
      _options: string,
      work: (value: postgres.TransactionSql) => Promise<unknown>,
    ) =>
      work(transaction as unknown as postgres.TransactionSql)),
  }) as unknown as postgres.Sql;
  return { sql, calls, enqueue: (...values: unknown[]) => responses.push(...values) };
}

const ORG = "10000000-0000-4000-8000-000000000001";
const CITATION_ID = "20000000-0000-5000-8000-000000000001";

function storedCitation() {
  return {
    organization_id: ORG,
    citation: {
      citation_id: CITATION_ID,
      claim_id: "30000000-0000-4000-8000-000000000001",
      evidence_id: "40000000-0000-4000-8000-000000000001",
      source_id: "50000000-0000-4000-8000-000000000001",
      source_version_id: "60000000-0000-4000-8000-000000000001",
      passage_id: "70000000-0000-4000-8000-000000000001",
      segmentation_version: "segmenter-1.0.0",
      locators: [{ kind: "section", label: "7.4" }],
      quoted_text_fingerprint: { algorithm: "sha256", value: "a".repeat(64) },
      relationship: "supports",
      retrieval_run_id: "80000000-0000-4000-8000-000000000001",
      retrieval_rank: 1,
      source_status_at_use: "current_effective",
      validation_status: "valid",
      validator_version: "validator-1.0.0",
      validated_at: "2026-08-25T15:00:00.000Z",
      validated_by: { actor_type: "human", actor_id: "assessor" },
      rendered_label: "Procedure; 7.4",
    },
    claim_text: "Effectiveness shall be verified.",
    recorded_at: "2026-08-25T15:00:01.000Z",
    recorded_by: { actor_type: "human", actor_id: "assessor" },
  } as never;
}

describe("Supabase CAPA citation-review repository", () => {
  it("appends a citation in the active transaction", async () => {
    const test = harness();
    test.enqueue([{ citation_id: CITATION_ID }]);
    const repository = new SupabaseCapaKnowledgeCitationReviewRepository(test.sql);
    const manager = new SupabaseTransactionManager(test.sql);
    const result = await manager.runInTransaction(
      { request_id: "r" as never, correlation_id: "c" as never },
      (transaction) => repository.appendCitation(transaction, storedCitation()),
    );
    expect(result).toEqual({ status: "appended" });
    expect(test.calls[0]?.query).toContain("insert into public.capa_knowledge_citations");
  });

  it("uses tenant scope for direct citation lookup", async () => {
    const test = harness();
    test.enqueue([]);
    const repository = new SupabaseCapaKnowledgeCitationReviewRepository(test.sql);
    expect(await repository.findCitationById(ORG as never, CITATION_ID as never))
      .toBeNull();
    expect(test.calls[0]?.query).toContain("where organization_id = ?");
    expect(test.calls[0]?.values).toContain(ORG);
  });

  it("rejects an unbounded review list", async () => {
    const repository = new SupabaseCapaKnowledgeCitationReviewRepository(
      harness().sql,
    );
    await expect(repository.listReviewsForCitation({
      organization_id: ORG as never,
      citation_id: CITATION_ID as never,
      limit: 101,
    })).rejects.toMatchObject({
      name: "CapaKnowledgeCitationReviewRepositoryError",
    });
  });
});
