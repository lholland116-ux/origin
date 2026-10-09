import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUserById, from } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUserById: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc, from, auth: { admin: { getUserById } } }),
}));

import { createTrustedBackgroundExecutionAuthorizer } from "@/lib/agent-runtime/execution-authorizer";
import { resolveTrustedExecutionSubject } from "@/lib/agent-runtime/trusted-execution-subject";

const runId = "11111111-1111-4111-8111-111111111111";
const stepId = "standard-step";
const executionKey = "22222222-2222-4222-8222-222222222222";
const userId = "55555555-5555-4555-8555-555555555555";
const requestId = "44444444-4444-4444-8444-444444444444";
const conversationId = "66666666-6666-4666-8666-666666666666";
const userMessageId = "77777777-7777-4777-8777-777777777777";
const assistantMessageId = "88888888-8888-4888-8888-888888888888";
const acceptedFingerprint = "a".repeat(64);
const planFingerprint = "d".repeat(64);

function fixture(reasoningMode: string, plan: "free" | "pro" = "free") {
  const binding = { requestId, userId, conversationId, userMessageId, assistantMessageId };
  const rows: Record<string, unknown> = {
    execution_runs: {
      id: runId,
      user_id: userId,
      accepted_request_id: requestId,
      acceptance_fingerprint: acceptedFingerprint,
      idempotency_key: "idempotency-key",
      request_fingerprint: planFingerprint,
      runtime_context: { conversationId, reasoningMode, requestMessageBinding: binding },
      execution_plan: { steps: [{ id: stepId, capability: "standard" }] },
    },
    agent_request_acceptances: {
      request_id: requestId,
      user_id: userId,
      conversation_id: conversationId,
      user_message_id: userMessageId,
      assistant_message_id: assistantMessageId,
      idempotency_key: "idempotency-key",
      request_fingerprint: acceptedFingerprint,
      request_options: { reasoningMode },
    },
    profiles: { plan },
    conversations: { id: conversationId },
  };
  from.mockImplementation((table: string) => {
    const query = {
      select: () => query,
      eq: () => query,
      maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
    };
    return query;
  });
  rpc.mockResolvedValue({ data: [{ request_id: requestId, user_id: userId, conversation_id: conversationId,
    user_message_id: userMessageId, assistant_message_id: assistantMessageId, capability_id: "standard",
    reasoning_mode: reasoningMode, plan, attempt_number: 1, execution_key: executionKey }], error: null });
  getUserById.mockResolvedValue({ data: { user: { id: userId, banned_until: null, deleted_at: null } }, error: null });
  return binding;
}

describe("trusted background execution authorizer", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reuses current account and reasoning entitlements for a valid claimed run", async () => {
    const binding = fixture("medium");
    const subject = await resolveTrustedExecutionSubject({ runId, stepId, executionKey,
      claimId: "33333333-3333-4333-8333-333333333333", fencingGeneration: 2 });
    expect(subject).not.toBeNull();
    const authorizer = createTrustedBackgroundExecutionAuthorizer(subject!);
    const decision = await authorizer.authorize({
      executionId: runId,
      stepId,
      capabilityId: "standard",
      authenticatedUserId: userId,
      acceptedRequestId: requestId,
      acceptanceFingerprint: acceptedFingerprint,
      idempotencyKey: "idempotency-key",
      requestFingerprint: planFingerprint,
      conversationId,
      requestMessageBinding: binding,
      reasoningMode: "medium",
      resolvedInputs: [{ source: "user", value: "Please summarize this." }],
      resourceReferences: [],
      requestId,
    });
    expect(decision).toEqual({ allowed: true });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(from).toHaveBeenCalledWith("conversations");
  });

  it("denies a current Free-plan owner whose accepted request selected high reasoning", async () => {
    const binding = fixture("high");
    const subject = await resolveTrustedExecutionSubject({ runId, stepId, executionKey,
      claimId: "33333333-3333-4333-8333-333333333333", fencingGeneration: 2 });
    expect(subject).not.toBeNull();
    const authorizer = createTrustedBackgroundExecutionAuthorizer(subject!);
    const decision = await authorizer.authorize({
      executionId: runId,
      stepId,
      capabilityId: "standard",
      authenticatedUserId: userId,
      acceptedRequestId: requestId,
      acceptanceFingerprint: acceptedFingerprint,
      idempotencyKey: "idempotency-key",
      requestFingerprint: planFingerprint,
      conversationId,
      requestMessageBinding: binding,
      reasoningMode: "high",
      resolvedInputs: [{ source: "user", value: "Please summarize this." }],
      resourceReferences: [],
      requestId,
    });
    expect(decision).toEqual({ allowed: false, reasonCode: "denied" });
  });
});
