#!/usr/bin/env node

// Disposable Supabase Auth/PostgREST qualification. The shell runner verifies
// Docker isolation before this process receives local-only keys through stdin.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";
import { provisionWithAuthenticatedOperator } from "../admin/provision-capa-demonstration-organization.mjs";

const API_PORT = "58321";
const DB_PORT = "58322";

export function assertLocalQualificationUrl(value, kind) {
  if (kind === "api") {
    assert.ok(value === "http://127.0.0.1:58321" || value === "http://127.0.0.1:58321/");
  } else if (kind === "database") {
    assert.match(value, /^postgres(?:ql)?:\/\/[^@/?#]+@127\.0\.0\.1:58322\/postgres$/);
  } else {
    throw new Error("invalid_local_transport_kind");
  }
  const parsed = new URL(value);
  assert.equal(parsed.hostname, "127.0.0.1");
  assert.equal(parsed.port, kind === "api" ? API_PORT : DB_PORT);
  assert.equal(parsed.pathname, kind === "api" ? "/" : "/postgres");
  assert.equal(parsed.search, "");
  assert.equal(parsed.hash, "");
  if (kind === "api") {
    assert.equal(parsed.username, "");
    assert.equal(parsed.password, "");
  }
  return parsed;
}

async function readLocalStatus() {
  let raw = "";
  for await (const chunk of process.stdin) {
    raw += chunk;
    if (raw.length > 32768) throw new Error("status_size");
  }
  const status = JSON.parse(raw);
  const api = status.API_URL ?? status.api_url;
  const database = status.DB_URL ?? status.db_url;
  const anonKey = status.ANON_KEY ?? status.anon_key;
  const serviceKey = status.SERVICE_ROLE_KEY ?? status.service_role_key;
  assert.equal(typeof anonKey, "string");
  assert.equal(typeof serviceKey, "string");
  assert.ok(anonKey.length > 20 && serviceKey.length > 20);
  const apiUrl = assertLocalQualificationUrl(api, "api");
  const databaseUrl = assertLocalQualificationUrl(database, "database");
  assert.equal(databaseUrl.username, "postgres");
  assert.ok(databaseUrl.password);
  return { apiUrl, databaseUrl, anonKey, serviceKey };
}

export function totp(secret, timestampMs = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  const decoded = [];
  for (const character of secret.replace(/=+$/, "").toUpperCase()) {
    const digit = alphabet.indexOf(character);
    if (digit < 0) throw new Error("totp_secret_format");
    value = (value << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      decoded.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(timestampMs / 30000)));
  const digest = createHmac("sha1", Buffer.from(decoded)).update(counter).digest();
  const offset = digest[digest.length - 1] & 15;
  return ((digest.readUInt32BE(offset) & 0x7fffffff) % 1000000).toString().padStart(6, "0");
}

async function nextTotpWindow() {
  const delay = 30000 - (Date.now() % 30000) + 600;
  await new Promise((resolve) => setTimeout(resolve, delay));
}

async function main() {
  for (const name of [
    "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SECRET_KEY",
    "SUPABASE_ACCESS_TOKEN", "SUPABASE_DB_PASSWORD", "SUPABASE_PROJECT_ID", "SUPABASE_PROJECT_REF",
    "DATABASE_URL", "POSTGRES_URL", "OPENAI_API_KEY",
  ]) {
    assert.equal(process.env[name], undefined, `inherited_${name}`);
  }
  assert.match(process.env.CAPA_DEMO_DISPOSABLE_PROJECT_ID ?? "", /^lvt-capa-auth-[a-z0-9-]+$/);
  const { apiUrl, databaseUrl, anonKey, serviceKey } = await readLocalStatus();
  const apiOrigin = apiUrl.origin;
  const localFetch = (input, init) => {
    const target = new URL(typeof input === "string" ? input : input.url);
    if (target.origin !== apiOrigin) throw new Error("external_request_rejected");
    const signals = [AbortSignal.timeout(15000), init?.signal, input instanceof Request ? input.signal : null].filter(Boolean);
    return fetch(input, { ...init, redirect: "manual", signal: AbortSignal.any(signals) });
  };
  const client = (key) => createClient(apiOrigin, key, {
    global: { fetch: localFetch },
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  const admin = client(serviceKey);
  const sql = postgres(databaseUrl.toString(), { ssl: false, max: 1, connect_timeout: 5 });
  const pass = (label) => process.stdout.write(`PASS ${label}\n`);
  try {
    const prerequisite = await sql`
      select to_regprocedure('public.capa_provision_demonstration_organization()') is not null as rpc,
        not has_function_privilege('authenticated', 'private.capa_provision_organization_owner(uuid,uuid,text,text,text)', 'EXECUTE') as legacy_denied,
        not has_function_privilege('service_role', 'private.capa_provision_organization_owner(uuid,uuid,text,text,text)', 'EXECUTE') as service_legacy_denied
    `;
    assert.ok(prerequisite[0].rpc && prerequisite[0].legacy_denied && prerequisite[0].service_legacy_denied);
    pass("isolated_migrations_and_legacy_grants");

    const suffix = randomUUID().slice(0, 8);
    const password = randomBytes(24).toString("base64url");
    const orgId = randomUUID();
    const targetResult = await admin.auth.admin.createUser({
      email: `target-${suffix}@example.invalid`, password, email_confirm: true,
      app_metadata: { lvtchat_synthetic_demo_identity: true },
    });
    assert.ifError(targetResult.error);
    const targetId = targetResult.data.user.id;
    const scope = {
      enabled: true, organization_id: orgId, target_user_id: targetId,
      organization_name: "Synthetic Demonstration Organization", authorization_policy_version: "policy-1.0.0",
    };
    const operatorEmail = `operator-${suffix}@example.invalid`;
    const operatorResult = await admin.auth.admin.createUser({
      email: operatorEmail, password, email_confirm: true,
      app_metadata: { capa_demo_provisioning: scope },
    });
    assert.ifError(operatorResult.error);
    const operatorId = operatorResult.data.user.id;
    const outsiderResult = await admin.auth.admin.createUser({
      email: `outsider-${suffix}@example.invalid`, password, email_confirm: true,
    });
    assert.ifError(outsiderResult.error);
    const outsiderId = outsiderResult.data.user.id;
    pass("synthetic_auth_users_created");

    const operator = client(anonKey);
    const signedIn = await operator.auth.signInWithPassword({ email: operatorEmail, password });
    assert.ifError(signedIn.error);
    const aal1 = await operator.auth.mfa.getAuthenticatorAssuranceLevel();
    assert.ifError(aal1.error);
    assert.equal(aal1.data.currentLevel, "aal1");
    assert.ok((await operator.rpc("capa_provision_demonstration_organization")).error);
    assert.equal((await sql`select count(*)::int as n from public.capa_organizations`)[0].n, 0);
    pass("genuine_aal1_denied_without_side_effects");

    const enrolled = await operator.auth.mfa.enroll({ factorType: "totp" });
    assert.ifError(enrolled.error);
    assert.ok(enrolled.data?.id && enrolled.data?.totp?.secret);
    const totpSecret = enrolled.data.totp.secret;
    const verified = await operator.auth.mfa.challengeAndVerify({ factorId: enrolled.data.id, code: totp(totpSecret) });
    assert.ifError(verified.error);
    const aal2 = await operator.auth.mfa.getAuthenticatorAssuranceLevel();
    assert.ifError(aal2.error);
    assert.equal(aal2.data.currentLevel, "aal2");
    const signedSession = (await operator.auth.getSession()).data.session;
    assert.ok(signedSession?.access_token);
    const signedClaims = JSON.parse(Buffer.from(signedSession.access_token.split(".")[1], "base64url").toString());
    assert.equal(signedClaims.aal, "aal2");
    assert.equal(signedClaims.sub, operatorId);
    pass("real_totp_and_signed_aal2_session");

    const parts = signedSession.access_token.split(".");
    parts[2] = `${parts[2][0] === "a" ? "b" : "a"}${parts[2].slice(1)}`;
    const forged = await localFetch(`${apiOrigin}/rest/v1/rpc/capa_provision_demonstration_organization`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${parts.join(".")}`, "Content-Type": "application/json" }, body: "{}",
    });
    assert.ok(forged.status === 401 || forged.status === 403);
    const legacy = await localFetch(`${apiOrigin}/rest/v1/rpc/capa_provision_organization_owner`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${signedSession.access_token}`, "Content-Type": "application/json" }, body: "{}",
    });
    assert.ok(legacy.status === 403 || legacy.status === 404);
    pass("forged_jwt_and_legacy_rpc_denied");

    await nextTotpWindow();
    const invoke = () => provisionWithAuthenticatedOperator({
      client: client(anonKey), email: operatorEmail, password,
      getMfaCode: async () => totp(totpSecret),
      authorize: async (authorizedScope) => {
        assert.equal(authorizedScope.organizationId, orgId);
        assert.equal(authorizedScope.targetUserId, targetId);
        return true;
      },
    });
    const created = await invoke();
    assert.equal(created.organizationId, orgId);
    const state = async () => {
      const [row] = await sql`
        select
          (select count(*)::int from public.capa_organizations where organization_id = ${orgId}) as organizations,
          (select count(*)::int from public.capa_organization_memberships where organization_id = ${orgId} and user_id = ${targetId}) as memberships,
          (select count(*)::int from public.capa_role_assignments where organization_id = ${orgId} and user_id = ${targetId} and role_id = 'CAPA_OWNER' and status = 'active') as owners,
          (select count(*)::int from public.capa_role_assignments where organization_id = ${orgId} and user_id = ${targetId} and role_id = 'CAPA_ORG_ADMIN' and status = 'active') as administrators,
          (select count(*)::int from public.capa_audit_events where organization_id = ${orgId} and event_type = 'CAPA-ORGANIZATION-PROVISIONED' and actor_id = ${operatorId}) as audits
      `;
      return row;
    };
    assert.deepEqual({ ...await state() }, { organizations: 1, memberships: 1, owners: 1, administrators: 1, audits: 1 });
    pass("signed_postgrest_provisioning_and_actor_audit");

    let auditMutationDenied = false;
    try {
      await sql`update public.capa_audit_events set reason = 'synthetic mutation check' where event_id = ${created.auditEventId}`;
    } catch (error) {
      auditMutationDenied = error?.code === "55000";
    }
    assert.ok(auditMutationDenied);
    assert.deepEqual({ ...await state() }, { organizations: 1, memberships: 1, owners: 1, administrators: 1, audits: 1 });
    pass("provisioning_audit_is_immutable");

    await nextTotpWindow();
    const replay = await invoke();
    assert.deepEqual(replay, created);
    assert.deepEqual({ ...await state() }, { organizations: 1, memberships: 1, owners: 1, administrators: 1, audits: 1 });
    pass("exact_idempotent_replay");

    const outsider = client(anonKey);
    assert.ifError((await outsider.auth.signInWithPassword({ email: `outsider-${suffix}@example.invalid`, password })).error);
    const outsiderFactor = await outsider.auth.mfa.enroll({ factorType: "totp" });
    assert.ifError(outsiderFactor.error);
    assert.ifError((await outsider.auth.mfa.challengeAndVerify({ factorId: outsiderFactor.data.id, code: totp(outsiderFactor.data.totp.secret) })).error);
    assert.equal((await outsider.auth.mfa.getAuthenticatorAssuranceLevel()).data.currentLevel, "aal2");
    assert.ok((await outsider.rpc("capa_provision_demonstration_organization")).error);
    pass("unauthorized_aal2_user_denied");

    assert.ifError((await admin.auth.admin.updateUserById(operatorId, { app_metadata: { capa_demo_provisioning: { ...scope, target_user_id: outsiderId } } })).error);
    assert.ok((await operator.rpc("capa_provision_demonstration_organization")).error);
    assert.ifError((await admin.auth.admin.updateUserById(operatorId, { app_metadata: { capa_demo_provisioning: { ...scope, enabled: false } } })).error);
    assert.ok((await operator.rpc("capa_provision_demonstration_organization")).error);
    assert.deepEqual({ ...await state() }, { organizations: 1, memberships: 1, owners: 1, administrators: 1, audits: 1 });
    pass("mismatched_and_revoked_scope_denied_without_partial_state");

    const expiry = signedClaims.exp * 1000;
    const remaining = Math.max(0, expiry - Date.now() + 1500);
    assert.ok(remaining <= 125000);
    if (remaining) await new Promise((resolve) => setTimeout(resolve, remaining));
    const expired = await localFetch(`${apiOrigin}/rest/v1/rpc/capa_provision_demonstration_organization`, {
      method: "POST", headers: { apikey: anonKey, Authorization: `Bearer ${signedSession.access_token}`, "Content-Type": "application/json" }, body: "{}",
    });
    assert.ok(expired.status === 401 || expired.status === 403);
    assert.deepEqual({ ...await state() }, { organizations: 1, memberships: 1, owners: 1, administrators: 1, audits: 1 });
    pass("expired_signed_jwt_denied_and_audit_unchanged");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => {
    process.stderr.write("BLOCKED: isolated real-Auth qualification failed; no credentials or server details printed.\n");
    process.exitCode = 1;
  });
}
