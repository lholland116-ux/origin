import { describe, expect, it, vi } from "vitest";
import { resolveAccountPlan } from "@/lib/capabilities/account-plan";
import {
  reserveDailyUsage,
  resolveDailyUsageLimits,
  utcUsageDate,
  type DailyUsageRpcClient,
} from "@/lib/capabilities/daily-usage";
import {
  preflightCapability,
  type CapabilityPreflightPolicy,
} from "@/lib/capabilities/preflight";
import { parseCapabilityServiceContext } from "@/lib/capabilities/service-context";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const RESOURCE_ID = "33333333-3333-4333-8333-333333333333";

function conversationContext(overrides: Record<string, unknown> = {}) {
  return parseCapabilityServiceContext({
    kind: "conversation",
    userId: USER_ID,
    conversationId: CONVERSATION_ID,
    ...overrides,
  });
}

function policy(overrides: Partial<CapabilityPreflightPolicy> = {}): CapabilityPreflightPolicy {
  return {
    isEnabled: () => true,
    isEntitled: () => true,
    checkConversationOwnership: async () => "owned",
    checkOwnership: async () => "owned",
    ...overrides,
  };
}

describe("capability service context contract", () => {
  it("accepts minimal and resource/reasoning-rich conversation contexts as JSON-safe IDs", () => {
    const minimal = conversationContext();
    expect(minimal.success).toBe(true);
    expect(JSON.parse(JSON.stringify(minimal.data))).toMatchObject({
      kind: "conversation",
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
    });

    const rich = conversationContext({
      attachmentRefs: [{ id: RESOURCE_ID, kind: "file" }],
      imageRefs: [{ id: RESOURCE_ID, kind: "image" }],
      artifactRefs: [{ id: RESOURCE_ID, kind: "artifact" }],
      reasoningMode: "medium",
      requestId: "request-123",
    });
    expect(rich.success).toBe(true);
    expect(rich.data).not.toHaveProperty("client");
  });

  it("distinguishes non-conversational execution from conversation/message persistence", () => {
    const result = parseCapabilityServiceContext({ kind: "execution", userId: USER_ID });
    expect(result.success).toBe(true);
    expect(result.data).not.toHaveProperty("conversationId");
    expect(parseCapabilityServiceContext({ kind: "conversation", userId: USER_ID }).success).toBe(false);
  });

  it("rejects malformed IDs, raw client fields, and non-JSON resource data", () => {
    expect(conversationContext({ userId: "not-a-uuid" }).success).toBe(false);
    expect(conversationContext({ attachmentRefs: [{ id: "bad", kind: "file" }] }).success).toBe(false);
    expect(conversationContext({ supabase: {} }).success).toBe(false);
    expect(conversationContext({ imageRefs: [{ id: RESOURCE_ID, kind: "image", bytes: "..." }] }).success).toBe(false);
  });
});

describe("authoritative account-plan resolution", () => {
  it("resolves genuine Free and Pro profiles", async () => {
    await expect(resolveAccountPlan({ userId: USER_ID, lookup: async () => ({ plan: "free" }) }))
      .resolves.toEqual({ kind: "resolved", userId: USER_ID, plan: "free" });
    await expect(resolveAccountPlan({ userId: USER_ID, lookup: async () => ({ plan: "pro" }) }))
      .resolves.toEqual({ kind: "resolved", userId: USER_ID, plan: "pro" });
  });

  it("keeps missing, malformed, and failed profile lookups distinct and fail-closed", async () => {
    await expect(resolveAccountPlan({ userId: USER_ID, lookup: async () => ({ plan: null }) }))
      .resolves.toEqual({ kind: "not_found" });
    await expect(resolveAccountPlan({ userId: USER_ID, lookup: async () => ({ plan: "enterprise" }) }))
      .resolves.toEqual({ kind: "invalid_account" });
    await expect(resolveAccountPlan({ userId: USER_ID, lookup: async () => ({ plan: "free", error: new Error() }) }))
      .resolves.toEqual({ kind: "lookup_failed" });
    await expect(resolveAccountPlan({ userId: USER_ID, lookup: async () => { throw new Error(); } }))
      .resolves.toEqual({ kind: "lookup_failed" });
  });
});

describe("capability preflight policy", () => {
  const free = { kind: "resolved", userId: USER_ID, plan: "free" } as const;
  const pro = { kind: "resolved", userId: USER_ID, plan: "pro" } as const;

  it("allows entitled requests and reuses current Free/Pro reasoning authorization", async () => {
    const context = conversationContext().data!;
    expect(await preflightCapability({ context, capabilityId: "standard", account: free, policy: policy() }))
      .toEqual({ kind: "allowed", plan: "free" });
    expect(await preflightCapability({
      context,
      capabilityId: "standard",
      account: free,
      reasoning: { kind: "valid", mode: "high" },
      policy: policy(),
    })).toEqual({ kind: "denied", reason: "reasoning_not_entitled" });
    expect(await preflightCapability({
      context,
      capabilityId: "standard",
      account: pro,
      reasoning: { kind: "valid", mode: "high" },
      policy: policy(),
    })).toEqual({ kind: "allowed", plan: "pro" });
  });

  it("fails closed for unauthenticated/unresolved accounts, disabled or unentitled capabilities", async () => {
    const context = conversationContext().data!;
    expect(await preflightCapability({ context: null, capabilityId: "standard", account: free, policy: policy() }))
      .toEqual({ kind: "denied", reason: "unauthenticated" });
    expect(await preflightCapability({ context, capabilityId: "standard", account: { kind: "lookup_failed" }, policy: policy() }))
      .toEqual({ kind: "denied", reason: "account_state_unavailable" });
    expect(await preflightCapability({ context, capabilityId: "unknown", account: free, policy: policy() }))
      .toEqual({ kind: "denied", reason: "capability_disabled" });
    expect(await preflightCapability({ context, capabilityId: "standard", account: free, policy: policy({ isEnabled: () => false }) }))
      .toEqual({ kind: "denied", reason: "capability_disabled" });
    expect(await preflightCapability({ context, capabilityId: "standard", account: free, policy: policy({ isEntitled: () => false }) }))
      .toEqual({ kind: "denied", reason: "capability_not_entitled" });
  });

  it("rejects a resolved plan bound to a different user", async () => {
    const otherAccount = { kind: "resolved", userId: RESOURCE_ID, plan: "pro" } as const;
    expect(await preflightCapability({
      context: conversationContext().data!,
      capabilityId: "standard",
      account: otherAccount,
      policy: policy(),
    })).toEqual({ kind: "denied", reason: "account_state_unavailable" });
  });

  it("requires ownership evidence for capability resources and reports unavailable checks safely", async () => {
    const context = conversationContext({ attachmentRefs: [{ id: RESOURCE_ID, kind: "file" }] }).data!;
    const checkOwnership = vi.fn(async (userId: string) => {
      expect(userId).toBe(USER_ID);
      return "not_owned" as const;
    });
    expect(await preflightCapability({ context, capabilityId: "file_analysis", account: free, policy: policy({ checkOwnership }) }))
      .toEqual({ kind: "denied", reason: "resource_not_owned" });
    expect(checkOwnership).toHaveBeenCalledWith(USER_ID, { id: RESOURCE_ID, kind: "file" });

    expect(await preflightCapability({
      context: conversationContext().data!,
      capabilityId: "image_editing",
      account: free,
      policy: policy(),
    })).toEqual({ kind: "denied", reason: "resource_unavailable" });
    expect(await preflightCapability({
      context: conversationContext({ attachmentRefs: [{ id: RESOURCE_ID, kind: "file" }] }).data!,
      capabilityId: "image_editing",
      account: free,
      policy: policy(),
    })).toEqual({ kind: "denied", reason: "resource_unavailable" });
  });

  it("binds conversational preflight to user plus conversation ID", async () => {
    const checkConversationOwnership = vi.fn(async (userId: string, conversationId: string) => {
      expect(userId).toBe(USER_ID);
      expect(conversationId).toBe(CONVERSATION_ID);
      return "not_owned" as const;
    });
    expect(await preflightCapability({
      context: conversationContext().data!,
      capabilityId: "standard",
      account: free,
      policy: policy({ checkConversationOwnership }),
    })).toEqual({ kind: "denied", reason: "resource_not_owned" });
    expect(checkConversationOwnership).toHaveBeenCalledWith(USER_ID, CONVERSATION_ID);
  });

  it("distinguishes unavailable and exhausted non-mutating quota preflight", async () => {
    const context = conversationContext().data!;
    expect(await preflightCapability({
      context,
      capabilityId: "standard",
      account: free,
      policy: policy({ checkQuotaEligibility: async () => "unavailable" }),
    })).toEqual({ kind: "denied", reason: "quota_unavailable" });
    expect(await preflightCapability({
      context,
      capabilityId: "standard",
      account: free,
      policy: policy({ checkQuotaEligibility: async () => "limit_reached" }),
    })).toEqual({ kind: "denied", reason: "quota_limit_reached" });
  });

  it("keeps current Standard and Web Search invocations conversation-bound", async () => {
    const execution = parseCapabilityServiceContext({ kind: "execution", userId: USER_ID }).data!;
    for (const capabilityId of ["standard", "web_search"]) {
      await expect(preflightCapability({ context: execution, capabilityId, account: free, policy: policy() }))
        .resolves.toEqual({ kind: "denied", reason: "conversation_required" });
    }
  });
});

describe("atomic daily usage service contract", () => {
  const account = { kind: "resolved", userId: USER_ID, plan: "free" } as const;
  const limits = { free: 2, pro: 300 } as const;

  function rpcClient(data: unknown, error: unknown | null = null): DailyUsageRpcClient {
    return { rpc: vi.fn(async () => ({ data, error })) };
  }

  it("defaults to unchanged plan limits and uses the UTC daily boundary", () => {
    expect(resolveDailyUsageLimits({})).toEqual({ free: 20, pro: 300 });
    expect(utcUsageDate(new Date("2026-10-06T23:59:59.000Z"))).toBe("2026-10-06");
  });

  it("maps reservation, limit, account, and storage outcomes without treating errors as quota denial", async () => {
    const allowed = rpcClient([{ allowed: true, message_count: 2 }]);
    await expect(reserveDailyUsage({ client: allowed, userId: USER_ID, account, date: "2026-10-06", limits }))
      .resolves.toEqual({ kind: "reserved", messageCount: 2 });
    expect(allowed.rpc).toHaveBeenCalledWith("reserve_daily_usage", {
      p_user_id: USER_ID,
      p_date: "2026-10-06",
      p_limit: 2,
    });

    const development = rpcClient([{ allowed: true, message_count: 3 }]);
    await reserveDailyUsage({
      client: development,
      userId: USER_ID,
      account,
      date: "2026-10-06",
      limits,
      enforceLimit: false,
    });
    expect(development.rpc).toHaveBeenCalledWith("reserve_daily_usage", {
      p_user_id: USER_ID,
      p_date: "2026-10-06",
      p_limit: 2_147_483_647,
    });

    await expect(reserveDailyUsage({
      client: rpcClient([{ allowed: false, message_count: 2 }]),
      userId: USER_ID,
      account,
      date: "2026-10-06",
      limits,
    })).resolves.toEqual({ kind: "limit_reached", messageCount: 2 });
    await expect(reserveDailyUsage({
      client: rpcClient(null, new Error("db unavailable")),
      userId: USER_ID,
      account,
      date: "2026-10-06",
      limits,
    })).resolves.toEqual({ kind: "storage_error" });
    await expect(reserveDailyUsage({
      client: allowed,
      userId: USER_ID,
      account: { kind: "lookup_failed" },
      date: "2026-10-06",
      limits,
    })).resolves.toEqual({ kind: "account_unavailable" });
  });

  it("makes exactly one atomic RPC call per accepted request and rejects malformed RPC responses", async () => {
    const client = rpcClient([{ allowed: true, message_count: 1 }]);
    await Promise.all([
      reserveDailyUsage({ client, userId: USER_ID, account, date: "2026-10-06", limits }),
      reserveDailyUsage({ client, userId: USER_ID, account, date: "2026-10-06", limits }),
    ]);
    expect(client.rpc).toHaveBeenCalledTimes(2);
    await expect(reserveDailyUsage({
      client: rpcClient([{ allowed: "yes", message_count: 1 }]),
      userId: USER_ID,
      account,
      date: "2026-10-06",
      limits,
    })).resolves.toEqual({ kind: "storage_error" });
    await expect(reserveDailyUsage({
      client,
      userId: USER_ID,
      account,
      date: "2026-02-30",
      limits,
    })).resolves.toEqual({ kind: "storage_error" });
  });
});
