import { describe, expect, it } from "vitest";
import {
  assertProductionTarget,
  getDemonstrationScope,
  provisionWithAuthenticatedOperator,
  validateProvisioningResult,
} from "../../scripts/admin/provision-capa-demonstration-organization.mjs";
import { assertLocalQualificationUrl, totp } from "../../scripts/qualification/capa-demo-real-auth.mjs";

const operatorId = "30000000-0000-4000-8000-000000000003";
const organizationId = "40000000-0000-4000-8000-000000000004";
const targetUserId = "50000000-0000-4000-8000-000000000005";

function operator(scope: unknown) {
  return { id: operatorId, app_metadata: { capa_demo_provisioning: scope } };
}

describe("demonstration organization provisioning CLI contracts", () => {
  it("keeps the executable pinned to the production project", () => {
    expect(() => assertProductionTarget("https://cpmvnrirgstpttprjheb.supabase.co/")).not.toThrow();
    expect(() => assertProductionTarget("http://127.0.0.1:54321/")).toThrow();
    expect(() => assertProductionTarget("https://example.supabase.co/")).toThrow();
    expect(() => assertProductionTarget("https://cpmvnrirgstpttprjheb.supabase.co.evil.invalid/")).toThrow();
    expect(() => assertProductionTarget("https://operator@cpmvnrirgstpttprjheb.supabase.co/")).toThrow();
    expect(() => assertProductionTarget("https://cpmvnrirgstpttprjheb.supabase.co:8443/")).toThrow();
  });

  it("accepts only the explicitly approved disposable loopback API and database ports", () => {
    expect(assertLocalQualificationUrl("http://127.0.0.1:58321", "api").origin)
      .toBe("http://127.0.0.1:58321");
    expect(assertLocalQualificationUrl("postgresql://postgres:local@127.0.0.1:58322/postgres", "database").hostname)
      .toBe("127.0.0.1");
    for (const target of [
      "https://cpmvnrirgstpttprjheb.supabase.co/",
      "http://127.0.0.1:54321/",
      "http://localhost:58321/",
      "http://127.1:58321/",
      "http://0.0.0.0:58321/",
      "http://127.0.0.1:58322/",
      "http://127.0.0.1:58321/rest/v1",
      "http://127.0.0.1:58321/?redirect=https://example.invalid",
      "http://operator@127.0.0.1:58321/",
    ]) {
      expect(() => assertLocalQualificationUrl(target, "api")).toThrow();
    }
    expect(() => assertLocalQualificationUrl("postgresql://postgres:local@127.1:58322/postgres", "database")).toThrow();
    expect(() => assertLocalQualificationUrl("postgresql://postgres:local@127.0.0.1:54322/postgres", "database")).toThrow();
    expect(() => assertLocalQualificationUrl("postgresql://postgres:local@127.0.0.1:58322/postgres?sslmode=disable", "database")).toThrow();
  });

  it("computes the standard six-digit TOTP code from a synthetic test vector", () => {
    expect(totp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59000)).toBe("287082");
    expect(() => totp("not-base32", 59000)).toThrow();
  });

  it("uses the shared authenticated path and never dispatches after denied confirmation", async () => {
    const calls: string[] = [];
    const client = {
      auth: {
        signInWithPassword: async () => { calls.push("sign-in"); return { error: null }; },
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" }, error: null }) },
        getUser: async () => ({ data: { user: operator({
          enabled: true, organization_id: organizationId, target_user_id: targetUserId,
          organization_name: "Synthetic Demonstration Organization", authorization_policy_version: "policy-1.0.0",
        }) }, error: null }),
        signOut: async () => { calls.push("sign-out"); },
      },
      rpc: async () => { calls.push("rpc"); return { data: [], error: null }; },
    };
    await expect(provisionWithAuthenticatedOperator({
      client, email: "operator@example.invalid", password: "synthetic-password",
      getMfaCode: async () => "000000", authorize: async () => false,
    })).rejects.toThrow(/Confirmation did not match/);
    expect(calls).toEqual(["sign-in", "sign-out"]);
  });

  it("blocks AAL1 without a verified factor before reading scope or invoking the RPC", async () => {
    const calls: string[] = [];
    const client = {
      auth: {
        signInWithPassword: async () => ({ error: null }),
        mfa: {
          getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal1" }, error: null }),
          listFactors: async () => ({ data: { totp: [] }, error: null }),
        },
        getUser: async () => { calls.push("get-user"); return { data: null, error: null }; },
        signOut: async () => { calls.push("sign-out"); },
      },
      rpc: async () => { calls.push("rpc"); return { data: null, error: null }; },
    };
    await expect(provisionWithAuthenticatedOperator({
      client, email: "operator@example.invalid", password: "synthetic-password",
      getMfaCode: async () => "000000", authorize: async () => true,
    })).rejects.toThrow(/verified TOTP/);
    expect(calls).toEqual(["sign-out"]);
  });

  it("uses the same AAL2, server scope and fixed RPC path for successful provisioning", async () => {
    const calls: string[] = [];
    const client = {
      auth: {
        signInWithPassword: async () => { calls.push("sign-in"); return { error: null }; },
        mfa: { getAuthenticatorAssuranceLevel: async () => ({ data: { currentLevel: "aal2" }, error: null }) },
        getUser: async () => ({ data: { user: operator({
          enabled: true, organization_id: organizationId, target_user_id: targetUserId,
          organization_name: "Synthetic Demonstration Organization", authorization_policy_version: "policy-1.0.0",
        }) }, error: null }),
        signOut: async () => { calls.push("sign-out"); },
      },
      rpc: async (name: string) => {
        calls.push(name);
        return { data: [{
          provisioned_organization_id: organizationId,
          provisioned_membership_id: "60000000-0000-4000-8000-000000000006",
          owner_role_assignment_id: "70000000-0000-4000-8000-000000000007",
          administrator_role_assignment_id: "80000000-0000-4000-8000-000000000008",
          provisioning_audit_event_id: "90000000-0000-4000-8000-000000000009",
        }], error: null };
      },
    };
    const result = await provisionWithAuthenticatedOperator({
      client, email: "operator@example.invalid", password: "synthetic-password",
      getMfaCode: async () => "000000", authorize: async (scope: { organizationId: string }) => scope.organizationId === organizationId,
    });
    expect(result.organizationId).toBe(organizationId);
    expect(calls).toEqual(["sign-in", "capa_provision_demonstration_organization", "sign-out"]);
  });

  it("accepts only a complete enabled server-managed scope", () => {
    expect(getDemonstrationScope(operator({
      enabled: true,
      organization_id: organizationId,
      target_user_id: targetUserId,
      organization_name: "Synthetic Demonstration Organization",
      authorization_policy_version: "policy-1.0.0",
    }))).toEqual({
      organizationId,
      targetUserId,
      organizationName: "Synthetic Demonstration Organization",
      authorizationPolicyVersion: "policy-1.0.0",
    });
  });

  it("rejects a disabled, incomplete, or malformed scope", () => {
    expect(getDemonstrationScope(operator({ enabled: false }))).toBeNull();
    expect(getDemonstrationScope(operator({
      enabled: true,
      organization_id: organizationId,
      target_user_id: "not-a-uuid",
      organization_name: "Synthetic Demonstration Organization",
      authorization_policy_version: "policy-1.0.0",
    }))).toBeNull();
  });

  it("rejects using the operator identity as the demonstration account", () => {
    expect(getDemonstrationScope(operator({
      enabled: true,
      organization_id: organizationId,
      target_user_id: operatorId,
      organization_name: "Synthetic Demonstration Organization",
      authorization_policy_version: "policy-1.0.0",
    }))).toBeNull();
  });

  it("accepts one well-formed database result and exposes only required identifiers", () => {
    expect(validateProvisioningResult([{
      provisioned_organization_id: organizationId,
      provisioned_membership_id: "60000000-0000-4000-8000-000000000006",
      owner_role_assignment_id: "70000000-0000-4000-8000-000000000007",
      administrator_role_assignment_id: "80000000-0000-4000-8000-000000000008",
      provisioning_audit_event_id: "90000000-0000-4000-8000-000000000009",
    }])).toEqual({
      organizationId,
      auditEventId: "90000000-0000-4000-8000-000000000009",
    });
  });

  it("rejects empty, duplicate, malformed, or mismatched RPC results", () => {
    expect(validateProvisioningResult([])).toBeNull();
    expect(validateProvisioningResult([{}, {}])).toBeNull();
    expect(validateProvisioningResult([{
      provisioned_organization_id: "not-a-uuid",
      provisioned_membership_id: "60000000-0000-4000-8000-000000000006",
      owner_role_assignment_id: "70000000-0000-4000-8000-000000000007",
      administrator_role_assignment_id: "80000000-0000-4000-8000-000000000008",
      provisioning_audit_event_id: "90000000-0000-4000-8000-000000000009",
    }])).toBeNull();
  });
});
