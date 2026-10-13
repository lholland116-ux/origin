import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseExecutionStore } from "@/lib/database/supabase/supabase-execution-store";

const ENABLED = process.env.RUN_SCOPED_EXECUTION_DISCOVERY_POSTGRES_TESTS === "true";
const DATABASE_URL = process.env.RUN_SCOPED_EXECUTION_DISCOVERY_DATABASE_URL;
const TARGET_RUN_ID = "b2000000-0000-4000-8000-000000000001";
const OTHER_RUN_ID = "b2000000-0000-4000-8000-000000000002";
const describeDatabase = ENABLED ? describe : describe.skip;

function requireIsolatedFixture(): string {
  if (!DATABASE_URL) throw new Error("The run-scoped discovery PostgreSQL URL is required when this test is enabled.");
  const parsed = new URL(DATABASE_URL);
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.port === "57242" && parsed.pathname === "/postgres")) {
    throw new Error("Run-scoped discovery integration tests require disposable loopback PostgreSQL port 57242 and database postgres.");
  }
  return DATABASE_URL;
}

describeDatabase("run-scoped execution discovery (disposable PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let store: SupabaseExecutionStore;

  beforeAll(async () => {
    sql = postgres(requireIsolatedFixture(), { prepare: false, max: 2 });
    await sql`SELECT 1`;
    store = new SupabaseExecutionStore(sql);
  });

  afterAll(async () => { await sql?.end({ timeout: 2 }); });

  it("returns only the requested accepted run and keeps discovery service-only", async () => {
    const target = await store.discoverExecutionWorkForRun({ runId: TARGET_RUN_ID, limit: 10 });
    const other = await store.discoverExecutionWorkForRun({ runId: OTHER_RUN_ID, limit: 10 });
    expect(target).toEqual([expect.objectContaining({ runId: TARGET_RUN_ID, stepId: "one", kind: "runnable" })]);
    expect(other).toEqual([expect.objectContaining({ runId: OTHER_RUN_ID, stepId: "two", kind: "runnable" })]);

    const [privileges] = await sql<{ security_definer: boolean; safe_search_path: boolean;
      service_role_execute: boolean; anon_execute: boolean; authenticated_execute: boolean }[]>`
      SELECT p.prosecdef AS security_definer,
        p.proconfig @> ARRAY['search_path=""']::text[] AS safe_search_path,
        has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_execute,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute
      FROM pg_catalog.pg_proc AS p
      JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'discover_agent_execution_work_for_run'
    `;
    expect(privileges).toEqual({
      security_definer: true,
      safe_search_path: true,
      service_role_execute: true,
      anon_execute: false,
      authenticated_execute: false,
    });
  });

  it("rejects malformed run identifiers without querying another run", async () => {
    expect(await store.discoverExecutionWorkForRun({ runId: "not-a-uuid", limit: 10 })).toEqual([]);
    expect(await store.discoverExecutionWorkForRun({ runId: TARGET_RUN_ID, limit: 101 })).toEqual([]);
  });
});
