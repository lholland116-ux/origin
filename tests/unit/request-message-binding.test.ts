import { describe, expect, it, vi } from "vitest";
import {
  createRequestMessageBindingService,
  RequestMessageBindingError,
  type RequestMessageBindingServiceDependencies,
} from "@/lib/agent-runtime/request-message-binding";

const seed = {
  requestId: "a2000000-0000-4000-8000-000000000001",
  userId: "a2000000-0000-4000-8000-000000000002",
  conversationId: "b2000000-0000-4000-8000-000000000001",
  userMessageId: "c2000000-0000-4000-8000-000000000001",
};
const assistantMessageId = "c2000000-0000-4000-8000-000000000002";

function dependencies(overrides: Partial<RequestMessageBindingServiceDependencies> = {}) {
  return {
    createAssistantDestination: vi.fn(async () => assistantMessageId),
    validateBinding: vi.fn(async () => true),
    finalizeAssistantMessage: vi.fn(async () => undefined),
    ...overrides,
  } satisfies RequestMessageBindingServiceDependencies;
}

describe("request-scoped persisted message binding", () => {
  it("creates a binding only after the database returns and validates a persisted assistant destination", async () => {
    const deps = dependencies();
    const service = createRequestMessageBindingService(deps);

    const binding = await service.create(seed);

    expect(binding).toEqual({ ...seed, assistantMessageId });
    expect(deps.createAssistantDestination).toHaveBeenCalledOnce();
    expect(deps.createAssistantDestination).toHaveBeenCalledWith({
      requestId: seed.requestId,
      userId: seed.userId,
      conversationId: seed.conversationId,
      userMessageId: seed.userMessageId,
    });
    expect(deps.validateBinding).toHaveBeenCalledWith(binding);
    expect(Object.isFrozen(binding)).toBe(true);
  });

  it.each([
    ["requestId", "not-a-uuid"],
    ["userId", "not-a-uuid"],
    ["conversationId", "not-a-uuid"],
    ["userMessageId", "not-a-uuid"],
  ])("rejects malformed %s before creating a destination", async (field, value) => {
    const deps = dependencies();
    const service = createRequestMessageBindingService(deps);
    await expect(service.create({ ...seed, [field]: value })).rejects.toMatchObject({ code: "invalid_binding" });
    expect(deps.createAssistantDestination).not.toHaveBeenCalled();
  });

  it("fails closed when the persisted pair is missing, crossed, or not owned by the authenticated caller", async () => {
    const deps = dependencies({ validateBinding: vi.fn(async () => false) });
    const service = createRequestMessageBindingService(deps);
    await expect(service.create(seed)).rejects.toMatchObject({ code: "message_unavailable" });
    await expect(service.validate({ ...seed, assistantMessageId })).rejects.toMatchObject({ code: "message_unavailable" });
  });

  it("does not accept identical user and assistant IDs", async () => {
    const deps = dependencies({ createAssistantDestination: vi.fn(async () => seed.userMessageId) });
    const service = createRequestMessageBindingService(deps);
    await expect(service.create(seed)).rejects.toMatchObject({ code: "invalid_binding" });
    expect(deps.validateBinding).not.toHaveBeenCalled();
  });

  it("finalizes the same-message binding and delegates replay semantics to the RPC", async () => {
    const deps = dependencies();
    const service = createRequestMessageBindingService(deps);
    const binding = { ...seed, assistantMessageId };
    await service.finalize({ ...binding, finalText: "One final response." });
    expect(deps.validateBinding).not.toHaveBeenCalled();
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledOnce();
    expect(deps.finalizeAssistantMessage).toHaveBeenCalledWith({ ...binding, finalText: "One final response." });
  });

  it("rejects blank/oversized final text and safely maps conflicting RPC finalization", async () => {
    const deps = dependencies({
      finalizeAssistantMessage: vi.fn(async () => { throw new RequestMessageBindingError("finalization_conflict"); }),
    });
    const service = createRequestMessageBindingService(deps);
    const binding = { ...seed, assistantMessageId };
    await expect(service.finalize({ ...binding, finalText: "  " })).rejects.toMatchObject({ code: "invalid_binding" });
    await expect(service.finalize({ ...binding, finalText: "[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:invalid]]" })).rejects.toMatchObject({ code: "invalid_binding" });
    await expect(service.finalize({ ...binding, finalText: "x".repeat(200_001) })).rejects.toMatchObject({ code: "invalid_binding" });
    await expect(service.finalize({ ...binding, finalText: "A different replay." })).rejects.toMatchObject({ code: "finalization_conflict" });
  });
});
