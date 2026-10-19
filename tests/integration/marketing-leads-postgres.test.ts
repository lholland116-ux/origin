import { createHash, randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ENABLED = process.env.MARKETING_LEADS_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.MARKETING_LEADS_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;

function requireDisposableLoopbackDatabase(connectionString: string): void {
  let parsed: URL;
  try { parsed = new URL(connectionString); } catch { throw new Error("Marketing lead qualification requires a disposable loopback PostgreSQL database."); }
  if (!(["postgres:", "postgresql:"].includes(parsed.protocol)
    && ["127.0.0.1", "localhost", "::1"].includes(parsed.hostname)
    && parsed.port === "57381" && parsed.pathname === "/postgres")) {
    throw new Error("Marketing lead integration tests are restricted to disposable PostgreSQL on 127.0.0.1:57381.");
  }
}

type LeadArgs = {
  p_lead_id: string;
  p_idempotency_key: string;
  p_request_fingerprint: string;
  p_email_fingerprint: string;
  p_name: string;
  p_business_email: string;
  p_company: string;
  p_role: string;
  p_workflow_problem: string;
  p_interest_type: "early_access" | "demo";
  p_current_process_tools: string | null;
  p_marketing_consent: boolean;
  p_source: string;
  p_utm_source: string | null;
  p_utm_medium: string | null;
  p_utm_campaign: string | null;
};

function fingerprint(): string {
  return createHash("sha256").update(randomUUID()).digest("hex");
}

function lead(overrides: Partial<LeadArgs> = {}): LeadArgs {
  const number = randomUUID().replaceAll("-", "").slice(0, 12);
  const key = randomUUID();
  const input: LeadArgs = {
    p_lead_id: randomUUID(),
    p_idempotency_key: key,
    p_request_fingerprint: fingerprint(),
    p_email_fingerprint: fingerprint(),
    p_name: `Synthetic ${number}`,
    p_business_email: `lead-${number}@example.test`,
    p_company: `Synthetic Company ${number}`,
    p_role: "Quality Engineer",
    p_workflow_problem: "Synthetic request describing a document review workflow.",
    p_interest_type: "demo",
    p_current_process_tools: null,
    p_marketing_consent: false,
    p_source: "other",
    p_utm_source: null,
    p_utm_medium: null,
    p_utm_campaign: null,
  };
  return { ...input, ...overrides };
}

describeDatabase("private marketing lead capture (disposable loopback PostgreSQL only)", () => {
  let sql: postgres.Sql;
  let ready = false;
  const submitted: LeadArgs[] = [];

  async function submit(args: LeadArgs): Promise<string> {
    submitted.push(args);
    return sql.begin(async (transaction) => {
      await transaction`set local role service_role`;
      const rows = await transaction<{ status: string }[]>`
        select public.submit_marketing_lead(
          ${args.p_lead_id}::uuid, ${args.p_idempotency_key}::uuid,
          ${args.p_request_fingerprint}, ${args.p_email_fingerprint},
          ${args.p_name}, ${args.p_business_email}, ${args.p_company}, ${args.p_role},
          ${args.p_workflow_problem}, ${args.p_interest_type}, ${args.p_current_process_tools},
          ${args.p_marketing_consent}, ${args.p_source}, ${args.p_utm_source}, ${args.p_utm_medium}, ${args.p_utm_campaign}
        ) as status
      `;
      return rows[0]?.status ?? "missing";
    });
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 12 });
    const [row] = await sql<{ present: boolean }[]>`
      select to_regclass('public.marketing_leads') is not null
        and to_regclass('public.marketing_lead_rate_limits') is not null
        and to_regclass('public.marketing_lead_global_rate_limits') is not null
        and to_regprocedure('public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)') is not null as present
    `;
    if (!row?.present) throw new Error("Apply both marketing lead migrations to the disposable database before this opt-in test.");
    ready = true;
  });

  afterAll(async () => {
    if (!sql) return;
    if (ready && submitted.length) {
      const ids = [...new Set(submitted.map((entry) => entry.p_idempotency_key))];
      const fingerprints = [...new Set(submitted.map((entry) => entry.p_email_fingerprint))];
      await sql`delete from public.marketing_leads where idempotency_key = any(${ids}::uuid[])`;
      await sql`delete from public.marketing_lead_rate_limits where fingerprint = any(${fingerprints}::text[])`;
      await sql`update public.marketing_lead_global_rate_limits set window_started_at = clock_timestamp(), request_count = 0 where singleton`;
    }
    await sql.end({ timeout: 5 });
  });

  it("keeps lead and rate-limit tables private and exposes only the submit RPC to service_role", async () => {
    const [row] = await sql<{
      lead_rls: boolean; lead_forced: boolean; rate_rls: boolean; rate_forced: boolean;
      global_rls: boolean; global_forced: boolean;
      operator_select: boolean; anon_no_table_privileges: boolean; authenticated_no_table_privileges: boolean;
      service_no_table_privileges: boolean; no_policies: boolean;
      public_table_grants: boolean; service_execute: boolean; public_execute: boolean; anon_execute: boolean; authenticated_execute: boolean; owner_is_postgres: boolean;
      security_definer: boolean; safe_function_configuration: boolean;
    }[]>`
      select
        lead.relrowsecurity as lead_rls, lead.relforcerowsecurity as lead_forced,
        rate.relrowsecurity as rate_rls, rate.relforcerowsecurity as rate_forced,
        global_rate.relrowsecurity as global_rls, global_rate.relforcerowsecurity as global_forced,
        pg_catalog.has_table_privilege('postgres', lead.oid, 'SELECT')
          AND pg_catalog.has_table_privilege('postgres', rate.oid, 'SELECT')
          AND pg_catalog.has_table_privilege('postgres', global_rate.oid, 'SELECT') as operator_select,
        NOT EXISTS (
          SELECT 1 FROM (VALUES (lead.oid), (rate.oid), (global_rate.oid)) AS target(table_oid)
          WHERE pg_catalog.has_table_privilege('anon', target.table_oid, 'SELECT')
            OR pg_catalog.has_table_privilege('anon', target.table_oid, 'INSERT')
            OR pg_catalog.has_table_privilege('anon', target.table_oid, 'UPDATE')
            OR pg_catalog.has_table_privilege('anon', target.table_oid, 'DELETE')
            OR pg_catalog.has_table_privilege('anon', target.table_oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege('anon', target.table_oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege('anon', target.table_oid, 'TRIGGER')
        ) as anon_no_table_privileges,
        NOT EXISTS (
          SELECT 1 FROM (VALUES (lead.oid), (rate.oid), (global_rate.oid)) AS target(table_oid)
          WHERE pg_catalog.has_table_privilege('authenticated', target.table_oid, 'SELECT')
            OR pg_catalog.has_table_privilege('authenticated', target.table_oid, 'INSERT')
            OR pg_catalog.has_table_privilege('authenticated', target.table_oid, 'UPDATE')
            OR pg_catalog.has_table_privilege('authenticated', target.table_oid, 'DELETE')
            OR pg_catalog.has_table_privilege('authenticated', target.table_oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege('authenticated', target.table_oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege('authenticated', target.table_oid, 'TRIGGER')
        ) as authenticated_no_table_privileges,
        NOT EXISTS (
          SELECT 1 FROM (VALUES (lead.oid), (rate.oid), (global_rate.oid)) AS target(table_oid)
          WHERE pg_catalog.has_table_privilege('service_role', target.table_oid, 'SELECT')
            OR pg_catalog.has_table_privilege('service_role', target.table_oid, 'INSERT')
            OR pg_catalog.has_table_privilege('service_role', target.table_oid, 'UPDATE')
            OR pg_catalog.has_table_privilege('service_role', target.table_oid, 'DELETE')
            OR pg_catalog.has_table_privilege('service_role', target.table_oid, 'TRUNCATE')
            OR pg_catalog.has_table_privilege('service_role', target.table_oid, 'REFERENCES')
            OR pg_catalog.has_table_privilege('service_role', target.table_oid, 'TRIGGER')
        ) as service_no_table_privileges,
        NOT EXISTS (
          SELECT 1 FROM pg_catalog.pg_policies AS policy
          WHERE policy.schemaname = 'public'
            AND policy.tablename IN ('marketing_leads', 'marketing_lead_rate_limits', 'marketing_lead_global_rate_limits')
        ) as no_policies,
        NOT EXISTS (
          SELECT 1
          FROM pg_catalog.pg_class AS relation
          CROSS JOIN LATERAL pg_catalog.aclexplode(coalesce(relation.relacl, pg_catalog.acldefault('r', relation.relowner))) AS grant_row
          WHERE relation.oid IN (lead.oid, rate.oid, global_rate.oid)
            AND grant_row.grantee = 0
        ) as public_table_grants,
        pg_catalog.has_function_privilege('service_role', 'public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)', 'EXECUTE') as service_execute,
        exists (select 1 from pg_catalog.pg_proc as p cross join lateral pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) as grant_row where p.oid = 'public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)'::regprocedure and grant_row.grantee = 0 and grant_row.privilege_type = 'EXECUTE') as public_execute,
        pg_catalog.has_function_privilege('anon', 'public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)', 'EXECUTE') as anon_execute,
        pg_catalog.has_function_privilege('authenticated', 'public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)', 'EXECUTE') as authenticated_execute,
        pg_catalog.pg_get_userbyid(p.proowner) = 'postgres' as owner_is_postgres,
        p.prosecdef as security_definer,
        p.proconfig @> ARRAY['search_path=""', 'statement_timeout=5s']::text[] as safe_function_configuration
      from pg_catalog.pg_class as lead
      cross join pg_catalog.pg_class as rate
      cross join pg_catalog.pg_class as global_rate
      cross join pg_catalog.pg_proc as p
      where lead.oid = 'public.marketing_leads'::regclass
        and rate.oid = 'public.marketing_lead_rate_limits'::regclass
        and global_rate.oid = 'public.marketing_lead_global_rate_limits'::regclass
        and p.oid = 'public.submit_marketing_lead(uuid,uuid,text,text,text,text,text,text,text,text,text,boolean,text,text,text,text)'::regprocedure
    `;
    expect(row).toEqual({ lead_rls: true, lead_forced: true, rate_rls: true, rate_forced: true,
      global_rls: true, global_forced: true,
      operator_select: true, anon_no_table_privileges: true, authenticated_no_table_privileges: true,
      service_no_table_privileges: true, no_policies: true, public_table_grants: true,
      service_execute: true, public_execute: false, anon_execute: false, authenticated_execute: false,
      owner_is_postgres: true, security_definer: true, safe_function_configuration: true });
  });

  it("accepts valid bounded submissions while keeping consent separate and exposing no row through the RPC", async () => {
    const args = lead({ p_marketing_consent: true, p_source: "workflow_preview", p_utm_source: "owned_site" });
    const noConsentArgs = lead({ p_marketing_consent: false });
    expect(await submit(noConsentArgs)).toBe("created");
    expect(await submit(args)).toBe("created");
    const [row] = await sql<{ count: number; consent_states_correct: boolean; source: string; name_length: number }[]>`
      select count(*)::int as count, bool_and(
        (marketing_consent and marketing_consent_recorded_at is not null)
        or (not marketing_consent and marketing_consent_recorded_at is null)
      ) as consent_states_correct,
        min(source) as source, max(char_length(name))::int as name_length
      from public.marketing_leads where idempotency_key = any(${[args.p_idempotency_key, noConsentArgs.p_idempotency_key]}::uuid[])
    `;
    expect(row).toEqual({ count: 2, consent_states_correct: true, source: "other", name_length: Math.max(args.p_name.length, noConsentArgs.p_name.length) });
  });

  it("serializes identical concurrent submissions and rejects idempotency-key payload changes", async () => {
    const args = lead();
    const results = await Promise.all([submit(args), submit({ ...args, p_lead_id: randomUUID() })]);
    expect(results.sort()).toEqual(["created", "duplicate"]);
    const changed = await submit({ ...args, p_lead_id: randomUUID(), p_request_fingerprint: fingerprint() });
    expect(changed).toBe("conflict");
    const [row] = await sql<{ count: number }[]>`select count(*)::int as count from public.marketing_leads where idempotency_key = ${args.p_idempotency_key}::uuid`;
    expect(row?.count).toBe(1);
  });

  it("enforces the shared per-email limit in the database", async () => {
    const emailFingerprint = fingerprint();
    const emailAttempts: string[] = [];
    for (let index = 0; index < 4; index++) {
      emailAttempts.push(await submit(lead({ p_email_fingerprint: emailFingerprint })));
    }
    expect(emailAttempts).toEqual(["created", "created", "created", "rate_limited"]);
  });

  it("enforces a concurrent global rolling-window cap without relying on client IP", async () => {
    await sql`update public.marketing_lead_global_rate_limits set window_started_at = clock_timestamp(), request_count = 99 where singleton`;
    const attempts = await Promise.all([submit(lead()), submit(lead())]);
    expect(attempts.sort()).toEqual(["created", "rate_limited"]);
    const [row] = await sql<{ request_count: number }[]>`select request_count from public.marketing_lead_global_rate_limits where singleton`;
    expect(row?.request_count).toBe(100);
  });

  it("denies direct reads, writes, and RPC execution to anonymous and authenticated roles", async () => {
    await expect(sql.begin(async (transaction) => {
      await transaction`set local role anon`;
      return transaction`select lead_id from public.marketing_leads limit 1`;
    })).rejects.toThrow();
    await expect(sql.begin(async (transaction) => {
      await transaction`set local role authenticated`;
      return transaction`insert into public.marketing_leads (lead_id, idempotency_key, request_fingerprint, name, business_email, company, role, workflow_problem, interest_type, source) values (${randomUUID()}::uuid, ${randomUUID()}::uuid, ${fingerprint()}, 'x', 'x@y.z', 'x', 'x', '12345678', 'demo', 'other')`;
    })).rejects.toThrow();
  });
});
