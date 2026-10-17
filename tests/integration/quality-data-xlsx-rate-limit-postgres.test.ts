import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.QUALITY_DATA_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.QUALITY_DATA_TEST_DATABASE_URL
  ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;

function requireDisposableLoopbackDatabase(connectionString: string): void {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("Quality-data rate-limit qualification requires a local disposable PostgreSQL database."); }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.port === "57381" && parsed.pathname === "/postgres")) {
    throw new Error("Quality-data rate-limit qualification is restricted to the disposable loopback database on port 57381.");
  }
}

describeDatabase("quality-data XLSX shared rate-limit RPC (disposable loopback PostgreSQL only)", () => {
  let sql: postgres.Sql;
  const fixtureUsers = [randomUUID(), randomUUID()];
  let schemaReady = false;

  async function consume(userId: string, action: "inspect" | "preview" | "ingest"): Promise<boolean> {
    return sql.begin(async (transaction) => {
      await transaction`set local role service_role`;
      const rows = await transaction<{ allowed: boolean }[]>`
        select public.consume_quality_data_xlsx_api_rate_limit(${userId}::uuid, ${action}) as allowed
      `;
      return rows[0]?.allowed === true;
    });
  }

  async function acquireLease(userId: string): Promise<string | null> {
    const leaseId = randomUUID();
    const acquired = await sql.begin(async (transaction) => {
      await transaction`set local role service_role`;
      const rows = await transaction<{ acquired: boolean }[]>`
        select public.acquire_quality_data_xlsx_api_parse_slot(${leaseId}::uuid, ${userId}::uuid) as acquired
      `;
      return rows[0]?.acquired === true;
    });
    return acquired ? leaseId : null;
  }

  async function releaseLease(leaseId: string): Promise<boolean> {
    return sql.begin(async (transaction) => {
      await transaction`set local role service_role`;
      const rows = await transaction<{ released: boolean }[]>`
        select public.release_quality_data_xlsx_api_parse_slot(${leaseId}::uuid) as released
      `;
      return rows[0]?.released === true;
    });
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 8 });
    await sql`select 1`;
    const [functionRow] = await sql<{ all_present: boolean }[]>`
      select
        to_regprocedure('public.consume_quality_data_xlsx_api_rate_limit(uuid,text)') is not null
        and to_regprocedure('public.acquire_quality_data_xlsx_api_parse_slot(uuid,uuid)') is not null
        and to_regprocedure('public.release_quality_data_xlsx_api_parse_slot(uuid)') is not null as all_present
    `;
    if (!functionRow?.all_present) throw new Error("Apply the Stage 2D rate-limit migration to the disposable database before this opt-in test.");
    schemaReady = true;
  });

  afterAll(async () => {
    if (!sql) return;
    if (schemaReady) {
      await sql`delete from public.quality_data_xlsx_api_parse_leases where user_id = any(${fixtureUsers}::uuid[])`;
      await sql`delete from public.quality_data_xlsx_api_rate_windows where user_id = any(${fixtureUsers}::uuid[])`;
    }
    await sql.end({ timeout: 5 });
  });

  it("atomically admits at most five ingest requests per user in a fixed ten-minute window", async () => {
    const results = await Promise.all(Array.from({ length: 16 }, () => consume(fixtureUsers[0]!, "ingest")));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.filter((allowed) => !allowed)).toHaveLength(11);
  });

  it("enforces separate inspect/preview buckets and the twelve-request bound", async () => {
    const inspect = await Promise.all(Array.from({ length: 14 }, () => consume(fixtureUsers[1]!, "inspect")));
    expect(inspect.filter(Boolean)).toHaveLength(12);
    expect(await consume(fixtureUsers[1]!, "preview")).toBe(true);
  });

  it("limits simultaneous parsing to two shared leases and releases capacity", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, () => acquireLease(fixtureUsers[0]!)));
    const leases = attempts.filter((lease): lease is string => lease !== null);
    expect(leases).toHaveLength(2);
    expect(await acquireLease(fixtureUsers[1]!)).toBeNull();
    expect(await releaseLease(leases[0]!)).toBe(true);
    expect(await acquireLease(fixtureUsers[1]!)).toMatch(/^[0-9a-f-]{36}$/i);
  });

  it("restricts table and function access to the server role and keeps RLS enabled", async () => {
    const [row] = await sql<{
      rls_enabled: boolean;
      rls_forced: boolean;
      all_tables_rls_enabled: boolean;
      all_tables_rls_forced: boolean;
      all_service_execute: boolean;
      any_public_execute: boolean;
      any_anon_execute: boolean;
      any_authenticated_execute: boolean;
      any_table_read_grant: boolean;
    }[]>`
      select
        (select count(*) = 2 and bool_and(relrowsecurity) from pg_catalog.pg_class
          where oid in ('public.quality_data_xlsx_api_rate_windows'::regclass, 'public.quality_data_xlsx_api_parse_leases'::regclass)) as all_tables_rls_enabled,
        (select count(*) = 2 and bool_and(relforcerowsecurity) from pg_catalog.pg_class
          where oid in ('public.quality_data_xlsx_api_rate_windows'::regclass, 'public.quality_data_xlsx_api_parse_leases'::regclass)) as all_tables_rls_forced,
        (
          pg_catalog.has_function_privilege('service_role', 'public.consume_quality_data_xlsx_api_rate_limit(uuid,text)', 'EXECUTE')
          and pg_catalog.has_function_privilege('service_role', 'public.acquire_quality_data_xlsx_api_parse_slot(uuid,uuid)', 'EXECUTE')
          and pg_catalog.has_function_privilege('service_role', 'public.release_quality_data_xlsx_api_parse_slot(uuid)', 'EXECUTE')
        ) as all_service_execute,
        exists (
          select 1 from pg_catalog.pg_proc as function_row
          cross join lateral pg_catalog.aclexplode(coalesce(function_row.proacl, pg_catalog.acldefault('f', function_row.proowner))) AS grant_entry
          where function_row.oid in (
            'public.consume_quality_data_xlsx_api_rate_limit(uuid,text)'::regprocedure,
            'public.acquire_quality_data_xlsx_api_parse_slot(uuid,uuid)'::regprocedure,
            'public.release_quality_data_xlsx_api_parse_slot(uuid)'::regprocedure
          ) and grant_entry.grantee = 0 and grant_entry.privilege_type = 'EXECUTE'
        ) as any_public_execute,
        (
          pg_catalog.has_function_privilege('anon', 'public.consume_quality_data_xlsx_api_rate_limit(uuid,text)', 'EXECUTE')
          or pg_catalog.has_function_privilege('anon', 'public.acquire_quality_data_xlsx_api_parse_slot(uuid,uuid)', 'EXECUTE')
          or pg_catalog.has_function_privilege('anon', 'public.release_quality_data_xlsx_api_parse_slot(uuid)', 'EXECUTE')
        ) as any_anon_execute,
        (
          pg_catalog.has_function_privilege('authenticated', 'public.consume_quality_data_xlsx_api_rate_limit(uuid,text)', 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', 'public.acquire_quality_data_xlsx_api_parse_slot(uuid,uuid)', 'EXECUTE')
          or pg_catalog.has_function_privilege('authenticated', 'public.release_quality_data_xlsx_api_parse_slot(uuid)', 'EXECUTE')
        ) as any_authenticated_execute,
        (
          pg_catalog.has_table_privilege('service_role', 'public.quality_data_xlsx_api_rate_windows', 'SELECT')
          or pg_catalog.has_table_privilege('service_role', 'public.quality_data_xlsx_api_parse_leases', 'SELECT')
          or pg_catalog.has_table_privilege('authenticated', 'public.quality_data_xlsx_api_rate_windows', 'SELECT')
          or pg_catalog.has_table_privilege('authenticated', 'public.quality_data_xlsx_api_parse_leases', 'SELECT')
        ) as any_table_read_grant
    `;
    expect(row).toEqual({
      all_tables_rls_enabled: true,
      all_tables_rls_forced: true,
      all_service_execute: true,
      any_public_execute: false,
      any_anon_execute: false,
      any_authenticated_execute: false,
      any_table_read_grant: false,
    });
  });

  it("rejects unsupported action values instead of allowing a caller-selected higher limit", async () => {
    await expect(sql.begin(async (transaction) => {
      await transaction`set local role service_role`;
      return transaction`
        select public.consume_quality_data_xlsx_api_rate_limit(${fixtureUsers[0]}::uuid, 'unlimited')
      `;
    })).rejects.toThrow();
  });
});
