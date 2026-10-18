import { describe, expect, it, vi } from "vitest";
import type { CapaRequestContext } from "../../lib/security/supabase-capa-context";
import type { RoleId } from "../../lib/capa/domain/capa-types";
import { PolicyBackedQualityDataIngestionAuthorizer } from "../../lib/quality-data/quality-data-authorization";

const NOW = new Date("2026-10-16T12:00:00.000Z");
const USER = "10000000-0000-4000-8000-000000000001";
const ORG = "10000000-0000-4000-8000-000000000002";
const MEMBERSHIP = "10000000-0000-4000-8000-000000000003";

function context(role = "CAPA_ORG_ADMIN", overrides: Record<string, unknown> = {}): CapaRequestContext {
  return {
    owner_user_id: USER as never,
    authentication: {
      principal: { principal_type: "human", user_id: USER as never },
      session_id: "session-1" as never,
      authentication_method: "SUPABASE_SESSION" as never,
      assurance_level: "SINGLE_FACTOR" as never,
      authenticated_at: "2026-10-16T11:00:00.000Z" as never,
      expires_at: "2026-10-16T13:00:00.000Z" as never,
    },
    tenant: {
      organization_id: ORG as never,
      access_grant_id: MEMBERSHIP as never,
      access_path: "SUPABASE_MEMBERSHIP" as never,
      authorization_policy_version: "policy-1.0.0",
      resolved_at: NOW.toISOString() as never,
      role_assignments: [{
        role_assignment_id: "10000000-0000-4000-8000-000000000004" as never,
        role_id: role as RoleId,
        scope: "ORGANIZATION" as never,
        effective_at: "2026-10-16T10:00:00.000Z" as never,
        ...overrides,
      }],
    },
  };
}

describe("quality-data authorization", () => {
  it("requires active CAPA_ORG_ADMIN and the dedicated database permission", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "allow" });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    const result = await authorizer.authorize(context(), NOW);
    expect(result).toEqual({ allowed: true, organization_id: ORG, membership_id: MEMBERSHIP, uploader_user_id: USER });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: "ingest_quality_data_source",
      purpose: "QUALITY_DATA_SOURCE_INGESTION",
      resource: expect.objectContaining({ organization_id: ORG }),
    }));
  });

  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR", "CAPA_REVIEWER", "CAPA_AUDITOR"])(
    "rejects %s even when CAPA case permissions exist",
    async (role) => {
      const evaluate = vi.fn();
      const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
      await expect(authorizer.authorize(context(role), NOW)).resolves.toEqual({
        allowed: false,
        reason_code: "ACTIVE_ORG_ADMIN_REQUIRED",
      });
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it("rejects expired organization-admin assignments", async () => {
    const evaluate = vi.fn();
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    await expect(authorizer.authorize(context("CAPA_ORG_ADMIN", {
      expires_at: "2026-10-16T11:59:00.000Z" as never,
    }), NOW)).resolves.toEqual({ allowed: false, reason_code: "ACTIVE_ORG_ADMIN_REQUIRED" });
  });

  it("rejects an inactive session or a policy denial", async () => {
    const policy = { evaluate: vi.fn().mockResolvedValue({ decision: "deny" }) };
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer(policy as never);
    const expired = context();
    (expired.authentication as { expires_at: string }).expires_at = "2026-10-16T11:00:00.000Z";
    await expect(authorizer.authorize(expired, NOW)).resolves.toEqual({ allowed: false, reason_code: "SESSION_INACTIVE" });
    await expect(authorizer.authorize(context(), NOW)).resolves.toEqual({ allowed: false, reason_code: "QUALITY_DATA_PERMISSION_DENIED" });
  });

  it("evaluates dataset reads using the independent read permission", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "allow" });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    await expect(authorizer.authorizeRead(context(), NOW)).resolves.toEqual({
      allowed: true,
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      uploader_user_id: USER,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: "read_quality_data_source",
      purpose: "QUALITY_DATA_SOURCE_READ",
      resource: expect.objectContaining({ organization_id: ORG }),
    }));
  });

  it("requires the separate analytical-approval operation and permission", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "allow" });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    await expect(authorizer.authorizeApproval(context(), NOW)).resolves.toEqual({
      allowed: true,
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      uploader_user_id: USER,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: "approve_quality_data_version",
      purpose: "QUALITY_DATA_VERSION_ANALYTICAL_APPROVAL",
    }));
    expect(evaluate).not.toHaveBeenCalledWith(expect.objectContaining({
      operation: "read_quality_data_source",
    }));
  });

  it("requires the distinct external-provider transfer permission for an active administrator", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "allow" });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    await expect(authorizer.authorizeExternalAiTransfer(context(), NOW)).resolves.toEqual({
      allowed: true,
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      uploader_user_id: USER,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: "manage_quality_data_external_ai_transfer",
      purpose: "QUALITY_DATA_EXTERNAL_AI_TRANSFER_AUTHORIZATION",
    }));

    const denied = new PolicyBackedQualityDataIngestionAuthorizer({
      evaluate: vi.fn().mockResolvedValue({ decision: "deny" }),
    } as never);
    await expect(denied.authorizeExternalAiTransfer(context(), NOW)).resolves.toEqual({
      allowed: false,
      reason_code: "QUALITY_DATA_PERMISSION_DENIED",
    });
  });

  it("requires the distinct human intelligence-review permission for an active organization administrator", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "allow" });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    await expect(authorizer.authorizeIntelligenceReview(context(), NOW)).resolves.toEqual({
      allowed: true,
      organization_id: ORG,
      membership_id: MEMBERSHIP,
      uploader_user_id: USER,
    });
    expect(evaluate).toHaveBeenCalledWith(expect.objectContaining({
      operation: "review_quality_data_intelligence",
      purpose: "QUALITY_DATA_INTELLIGENCE_HUMAN_REVIEW",
    }));
    const denied = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate: vi.fn().mockResolvedValue({ decision: "deny" }) } as never);
    await expect(denied.authorizeIntelligenceReview(context(), NOW)).resolves.toEqual({
      allowed: false,
      reason_code: "QUALITY_DATA_PERMISSION_DENIED",
    });
  });

  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR", "CAPA_REVIEWER", "CAPA_AUDITOR"])(
    "denies intelligence review to %s even if it has read access",
    async (role) => {
      const evaluate = vi.fn();
      const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
      await expect(authorizer.authorizeIntelligenceReview(context(role), NOW)).resolves.toEqual({
        allowed: false,
        reason_code: "ACTIVE_ORG_ADMIN_REQUIRED",
      });
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR", "CAPA_REVIEWER", "CAPA_AUDITOR"])(
    "denies external-provider transfer authorization to %s",
    async (role) => {
      const evaluate = vi.fn();
      const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
      await expect(authorizer.authorizeExternalAiTransfer(context(role), NOW)).resolves.toEqual({
        allowed: false,
        reason_code: "ACTIVE_ORG_ADMIN_REQUIRED",
      });
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR", "CAPA_REVIEWER", "CAPA_AUDITOR"])(
    "denies analytical approval to %s even when other quality permissions might exist",
    async (role) => {
      const evaluate = vi.fn();
      const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
      await expect(authorizer.authorizeApproval(context(role), NOW)).resolves.toEqual({
        allowed: false,
        reason_code: "ACTIVE_ORG_ADMIN_REQUIRED",
      });
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it("denies approval when the distinct database permission is absent", async () => {
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({
      evaluate: vi.fn().mockResolvedValue({ decision: "deny" }),
    } as never);
    await expect(authorizer.authorizeApproval(context(), NOW)).resolves.toEqual({
      allowed: false,
      reason_code: "QUALITY_DATA_PERMISSION_DENIED",
    });
  });

  it.each(["CAPA_OWNER", "CAPA_CONTRIBUTOR", "CAPA_REVIEWER", "CAPA_AUDITOR"])(
    "denies quality-data reads for %s regardless of its other permissions",
    async (role) => {
      const evaluate = vi.fn();
      const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
      await expect(authorizer.authorizeRead(context(role), NOW)).resolves.toEqual({
        allowed: false,
        reason_code: "ACTIVE_ORG_ADMIN_REQUIRED",
      });
      expect(evaluate).not.toHaveBeenCalled();
    },
  );

  it("rejects inactive administrator assignments and denied read permissions", async () => {
    const evaluate = vi.fn().mockResolvedValue({ decision: "deny" });
    const authorizer = new PolicyBackedQualityDataIngestionAuthorizer({ evaluate } as never);
    await expect(authorizer.authorizeRead(context("CAPA_ORG_ADMIN", {
      expires_at: "2026-10-16T11:59:00.000Z" as never,
    }), NOW)).resolves.toEqual({ allowed: false, reason_code: "ACTIVE_ORG_ADMIN_REQUIRED" });
    await expect(authorizer.authorizeRead(context(), NOW)).resolves.toEqual({
      allowed: false,
      reason_code: "QUALITY_DATA_PERMISSION_DENIED",
    });
    expect(evaluate).toHaveBeenCalledTimes(1);
  });
});
