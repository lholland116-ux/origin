import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SupabaseCapaAuthorizationPolicy } from "../../lib/capa/authorization/supabase-capa-authorization-policy";
import { SupabaseAuditRepository } from "../../lib/database/supabase/supabase-audit-repository";
import { SupabaseQualityDataStage3ARepository } from "../../lib/database/supabase/supabase-quality-data-stage3a-repository";
import { SupabaseTransactionManager } from "../../lib/database/supabase/supabase-transactions";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";
import { getQualityDataExternalAiOptIn, transitionQualityDataExternalAiOptIn } from "../../lib/quality-data/quality-data-external-ai-opt-in-service";
import type { QualityDataStage3AServiceDependencies } from "../../lib/quality-data/quality-data-stage3a-service";
import { SupabaseCapaDurableContextResolver } from "../../lib/security/supabase-capa-durable-context";
import type { SupabaseCapaSessionFacts } from "../../lib/security/supabase-capa-context";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";

const ENABLED = process.env.QUALITY_DATA_DATABASE_INTEGRATION_TESTS === "true";
const DATABASE_URL = process.env.QUALITY_DATA_TEST_DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:57381/postgres";
const describeDatabase = ENABLED ? describe : describe.skip;
const NOW = new Date(Date.now() - 60_000);

function requireDisposableLoopbackDatabase(value: string): void {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Stage 3C integration requires a disposable loopback database."); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)
    || url.port !== "57381" || url.pathname !== "/postgres") throw new Error("Stage 3C integration is restricted to the disposable PostgreSQL fixture on 127.0.0.1:57381.");
}

function facts(userId: string): SupabaseCapaSessionFacts {
  return { verified_user_id: userId, authenticated_at: new Date(NOW.getTime() - 60 * 60_000).toISOString(), expires_at_epoch_seconds: (NOW.getTime() + 60 * 60_000) / 1000 };
}
function trace(key = randomUUID()): RequestTrace { return { request_id: randomUUID() as never, correlation_id: randomUUID() as never, idempotency_key: key as never }; }

describeDatabase("Stage 3C external-AI opt-in and shared budget controls (disposable local DB only)", () => {
  let sql: postgres.Sql;
  let org: string; let otherOrg: string; let admin: string; let owner: string; let otherAdmin: string;
  let adminMembership: string; let ownerMembership: string; let otherAdminMembership: string;
  let resolver: SupabaseCapaDurableContextResolver;
  let service: QualityDataStage3AServiceDependencies;
  let repository: SupabaseQualityDataStage3ARepository;
  const rateUsers = [randomUUID(), randomUUID()];

  async function insertOrg(id: string, name: string): Promise<void> {
    await sql`insert into public.capa_organizations (
      organization_id, organization_name, authorization_policy_version, created_at, effective_at, updated_at,
      created_by_actor_type, created_by_actor_id, updated_by_actor_type, updated_by_actor_id
    ) values (${id}::uuid, ${name}, 'authorization-policy-1.0.0', ${NOW.toISOString()}::timestamptz,
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, 'system', 'stage3c-test', 'system', 'stage3c-test')`;
  }
  async function insertMember(orgId: string, userId: string, membershipId: string, role: string): Promise<void> {
    await sql`insert into public.capa_organization_memberships (
      membership_id, organization_id, user_id, status, effective_at, created_at, updated_at,
      created_by_actor_type, created_by_actor_id, updated_by_actor_type, updated_by_actor_id
    ) values (${membershipId}::uuid, ${orgId}::uuid, ${userId}::uuid, 'active', ${NOW.toISOString()}::timestamptz,
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, 'system', 'stage3c-test', 'system', 'stage3c-test')`;
    await sql`insert into public.capa_role_assignments (
      organization_id, membership_id, user_id, role_id, scope_code, status, effective_at, created_at, updated_at,
      granted_by_actor_type, granted_by_actor_id, grant_reason
    ) values (${orgId}::uuid, ${membershipId}::uuid, ${userId}::uuid, ${role}, 'ORGANIZATION', 'active',
      ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz, ${NOW.toISOString()}::timestamptz,
      'system', 'stage3c-test', 'Synthetic Stage 3C qualification')`;
  }
  async function context(userId: string) { return resolver.resolve(facts(userId), NOW); }
  async function command(userId: string, decision: "enabled" | "disabled", transition: number, key = randomUUID()) {
    return transitionQualityDataExternalAiOptIn(service, await context(userId), trace(key), {
      schema_version: "quality-data-external-ai-opt-in-1.0.0", decision,
      expected_transition_number: transition, rationale: `Synthetic ${decision} decision`,
    });
  }

  beforeAll(async () => {
    requireDisposableLoopbackDatabase(DATABASE_URL);
    sql = postgres(DATABASE_URL, { prepare: false, max: 8 });
    await sql`select 1`;
    org = randomUUID(); otherOrg = randomUUID(); admin = randomUUID(); owner = randomUUID(); otherAdmin = randomUUID();
    adminMembership = randomUUID(); ownerMembership = randomUUID(); otherAdminMembership = randomUUID();
    await insertOrg(org, "Synthetic Stage 3C"); await insertOrg(otherOrg, "Other Synthetic Stage 3C");
    await insertMember(org, admin, adminMembership, "CAPA_ORG_ADMIN");
    await insertMember(org, owner, ownerMembership, "CAPA_OWNER");
    await insertMember(otherOrg, otherAdmin, otherAdminMembership, "CAPA_ORG_ADMIN");
    resolver = new SupabaseCapaDurableContextResolver(sql);
    const policy = new SupabaseCapaAuthorizationPolicy(sql, { step_up_maximum_age_ms: 300_000, required_step_up_assurance: "MULTI_FACTOR" as never });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer(policy);
    repository = new SupabaseQualityDataStage3ARepository(sql);
    service = {
      repository, audit_repository: new SupabaseAuditRepository(sql), transaction_manager: new SupabaseTransactionManager(sql),
      authorizer, external_ai_transfer_authorizer: authorizer,
      ids: { audit_event_id: () => randomUUID() as never, uuid: randomUUID }, clock: { now: () => new Date(NOW) },
    };
  });

  afterAll(async () => {
    if (sql) await sql.end({ timeout: 5 });
  });

  it("denies by default and requires the distinct transfer permission for active CAPA_ORG_ADMIN", async () => {
    expect(await repository.findExternalAiOptInState(org)).toBeNull();
    expect((await getQualityDataExternalAiOptIn(service, await context(owner))).status).toBe("denied");
    const roleRows = await sql<{ role_id: string; allowed: boolean }[]>`
      select role_id, 'quality_data.external_ai.manage' = any(permissions) as allowed from public.capa_roles`;
    expect(roleRows.find((row) => row.role_id === "CAPA_ORG_ADMIN")?.allowed).toBe(true);
    expect(roleRows.filter((row) => row.role_id !== "CAPA_ORG_ADMIN").every((row) => !row.allowed)).toBe(true);
  });

  it("appends an auditable organization opt-in, supports idempotent replay, then revokes with a new transition", async () => {
    const enableKey = randomUUID();
    const enabled = await command(admin, "enabled", 0, enableKey);
    expect(enabled.status).toBe("applied");
    if (enabled.status !== "applied") return;
    expect(enabled.state).toMatchObject({ organization_id: org, decision: "enabled", transition_number: 1, actor_user_id: admin, actor_membership_id: adminMembership, rationale: "Synthetic enabled decision" });
    expect((await command(admin, "enabled", 0, enableKey)).status).toBe("already_recorded");
    expect((await command(admin, "disabled", 0)).status).toBe("conflict");
    const disabled = await command(admin, "disabled", 1);
    expect(disabled.status).toBe("applied");
    expect(await repository.findExternalAiOptInState(org)).toMatchObject({ decision: "disabled", transition_number: 2 });
    const rows = await sql<{ count: number }[]>`select count(*)::int as count from public.quality_data_external_ai_opt_in_events where organization_id = ${org}::uuid`;
    expect(rows[0]?.count).toBe(2);
  });

  it("serializes concurrent organization opt-in transitions and records only one event", async () => {
    const concurrentOrg = randomUUID(); const concurrentAdmin = randomUUID(); const concurrentMembership = randomUUID();
    await insertOrg(concurrentOrg, "Concurrent Synthetic Stage 3C");
    await insertMember(concurrentOrg, concurrentAdmin, concurrentMembership, "CAPA_ORG_ADMIN");
    const results = await Promise.all([
      command(concurrentAdmin, "enabled", 0),
      command(concurrentAdmin, "enabled", 0),
    ]);
    expect(results.map((result) => result.status).sort()).toEqual(["applied", "conflict"]);
    const rows = await sql<{ count: number }[]>`select count(*)::int as count from public.quality_data_external_ai_opt_in_events where organization_id = ${concurrentOrg}::uuid`;
    expect(rows[0]?.count).toBe(1);
  });

  it("keeps opt-in scoped to its organization and rejects non-admin or forged tenant access", async () => {
    expect((await command(owner, "enabled", 0)).status).toBe("denied");
    expect(await getQualityDataExternalAiOptIn(service, await context(otherAdmin))).toMatchObject({ status: "found", state: null });
    const forged = await context(admin);
    const forgedContext = { ...forged, tenant: { ...forged.tenant, organization_id: otherOrg as never } };
    expect((await getQualityDataExternalAiOptIn(service, forgedContext)).status).toBe("denied");
  });

  it("rejects direct event-table reads and updates through database privileges and immutability", async () => {
    const read = await sql.begin(async (tx) => {
      await tx`set local role service_role`;
      return tx`select * from public.quality_data_external_ai_opt_in_events`;
    }).then(() => "allowed", () => "denied");
    expect(read).toBe("denied");
    const update = await sql`select event_id from public.quality_data_external_ai_opt_in_events where organization_id = ${org}::uuid limit 1`;
    if (update[0]) await expect(sql`update public.quality_data_external_ai_opt_in_events set rationale = 'tampered' where event_id = ${update[0].event_id}::uuid`).rejects.toThrow();
    const [catalog] = await sql<{ rls: boolean; forced: boolean; no_authenticated_select: boolean }[]>`
      select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        not pg_catalog.has_table_privilege('authenticated', c.oid, 'select') as no_authenticated_select
      from pg_catalog.pg_class c where c.oid = 'public.quality_data_external_ai_opt_in_events'::regclass`;
    expect(catalog).toEqual({ rls: true, forced: true, no_authenticated_select: true });
  });

  it("enforces shared three-per-ten-minute AI interpretation limits and fails closed on unsupported actions", async () => {
    const consume = (userId: string, action: string) => sql.begin(async (tx) => {
      await tx`set local role service_role`;
      const rows = await tx<{ allowed: boolean }[]>`select public.consume_quality_data_xlsx_api_rate_limit(${userId}::uuid, ${action}) as allowed`;
      return rows[0]?.allowed === true;
    });
    const results = await Promise.all(Array.from({ length: 7 }, () => consume(rateUsers[0]!, "ai_interpretation")));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await consume(rateUsers[0]!, "analysis")).toBe(true);
    await expect(consume(rateUsers[1]!, "unbounded")).rejects.toThrow();
  });

  it("stores provider telemetry metadata without granting application-role access", async () => {
    const [row] = await sql<{ rls: boolean; forced: boolean; client_select: boolean; client_insert: boolean }[]>`
      select c.relrowsecurity as rls, c.relforcerowsecurity as forced,
        pg_catalog.has_table_privilege('authenticated', c.oid, 'select') as client_select,
        pg_catalog.has_table_privilege('authenticated', c.oid, 'insert') as client_insert
      from pg_catalog.pg_class c where c.oid = 'public.quality_data_ai_interpretation_telemetry'::regclass`;
    expect(row).toEqual({ rls: true, forced: true, client_select: false, client_insert: false });
  });

  it("restricts the shared request-limit RPC to the trusted service role", async () => {
    const [row] = await sql<{ service_execute: boolean; anon_execute: boolean; authenticated_execute: boolean; public_execute: boolean }[]>`
      select pg_catalog.has_function_privilege('service_role', function.oid, 'EXECUTE') as service_execute,
        pg_catalog.has_function_privilege('anon', function.oid, 'EXECUTE') as anon_execute,
        pg_catalog.has_function_privilege('authenticated', function.oid, 'EXECUTE') as authenticated_execute,
        exists (
          select 1 from pg_catalog.aclexplode(coalesce(function.proacl, pg_catalog.acldefault('f', function.proowner))) as grant_entry
          where grant_entry.grantee = 0 and grant_entry.privilege_type = 'EXECUTE'
        ) as public_execute
      from pg_catalog.pg_proc as function
      where function.oid = 'public.consume_quality_data_xlsx_api_rate_limit(uuid,text)'::regprocedure`;
    expect(row).toEqual({ service_execute: true, anon_execute: false, authenticated_execute: false, public_execute: false });
  });
});
