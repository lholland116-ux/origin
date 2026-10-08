import { describe, expect, it, vi } from "vitest";
import {
  agentRequestAcceptanceInputSchema,
  createAgentRequestAcceptanceService,
  fingerprintAgentRequest,
  type RequestAcceptanceDependencies,
} from "@/lib/agent-runtime/request-acceptance";

const USER_ID = "a3000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "b3000000-0000-4000-8000-000000000001";
const REQUEST_KEY = "d3000000-0000-4000-8000-000000000001";
const ACCEPTED = {
  kind: "accepted",
  replayed: false,
  idempotencyKey: REQUEST_KEY,
  requestId: "d3000000-0000-4000-8000-000000000002",
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  userMessageId: "c3000000-0000-4000-8000-000000000001",
  assistantMessageId: "c3000000-0000-4000-8000-000000000002",
  usageDate: "2026-10-08",
};

const input = {
  conversationId: CONVERSATION_ID,
  idempotencyKey: REQUEST_KEY,
  message: "  Analyze the uploaded report.  ",
  documentIds: ["e3000000-0000-4000-8000-000000000001"],
  images: [{ imagePath: `${USER_ID}/chat/photo.png`, imageName: "photo.png" }],
  requestOptions: { routingMode: "auto" as const, reasoningMode: "medium" as const },
};

function dependencies(overrides: Partial<RequestAcceptanceDependencies> = {}) {
  return {
    authenticate: vi.fn(async () => USER_ID),
    accept: vi.fn(async () => ({ data: ACCEPTED, error: null })),
    now: () => new Date("2026-10-08T23:59:59.000Z"),
    env: { NODE_ENV: "production", FREE_DAILY_MESSAGE_LIMIT: "20", PRO_DAILY_MESSAGE_LIMIT: "300" },
    ...overrides,
  } satisfies RequestAcceptanceDependencies;
}

describe("atomic Agent Runtime request acceptance contract", () => {
  it("validates, fingerprints, authenticates, and asks the database to accept one complete request", async () => {
    const deps = dependencies();
    const result = await createAgentRequestAcceptanceService(deps).accept(input);

    expect(result).toEqual({
      kind: "accepted",
      replayed: false,
      idempotencyKey: REQUEST_KEY,
      requestFingerprint: fingerprintAgentRequest(agentRequestAcceptanceInputSchema.parse(input)),
      binding: {
        requestId: ACCEPTED.requestId,
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        userMessageId: ACCEPTED.userMessageId,
        assistantMessageId: ACCEPTED.assistantMessageId,
      },
      usageDate: "2026-10-08",
    });
    expect(deps.accept).toHaveBeenCalledWith(expect.objectContaining({
      userId: USER_ID,
      conversationId: CONVERSATION_ID,
      idempotencyKey: REQUEST_KEY,
      requestFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/),
      message: "Analyze the uploaded report.",
      documentIds: input.documentIds,
      images: [{ storage_path: `${USER_ID}/chat/photo.png`, image_name: "photo.png" }],
      usageDate: "2026-10-08",
      freeDailyLimit: 20,
      proDailyLimit: 300,
    }));
  });

  it("fingerprints all normalized execution-affecting fields instead of deduplicating by prompt", () => {
    const first = agentRequestAcceptanceInputSchema.parse(input);
    expect(fingerprintAgentRequest(first)).toBe(fingerprintAgentRequest({
      ...first,
      requestOptions: { reasoningMode: "medium", routingMode: "auto" },
    }));
    expect(fingerprintAgentRequest(first)).not.toBe(fingerprintAgentRequest({ ...first, message: "A different request." }));
    expect(fingerprintAgentRequest(first)).not.toBe(fingerprintAgentRequest({ ...first, documentIds: [] }));
    expect(fingerprintAgentRequest(first)).not.toBe(fingerprintAgentRequest({
      ...first,
      requestOptions: { routingMode: "standard", reasoningMode: "medium" },
    }));
  });

  it("rejects duplicate or malformed attachment references before authentication or RPC", async () => {
    const deps = dependencies();
    const service = createAgentRequestAcceptanceService(deps);
    expect(await service.accept({ ...input, documentIds: [input.documentIds[0], input.documentIds[0]] })).toEqual({ kind: "invalid_request" });
    expect(await service.accept({ ...input, images: [input.images[0], input.images[0]] })).toEqual({ kind: "invalid_request" });
    expect(deps.authenticate).not.toHaveBeenCalled();
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("does not accept caller-supplied owner identity", async () => {
    const deps = dependencies();
    const result = await createAgentRequestAcceptanceService(deps).accept({ ...input, userId: "a3000000-0000-4000-8000-000000000099" });
    expect(result).toEqual({ kind: "invalid_request" });
    expect(deps.accept).not.toHaveBeenCalled();
  });

  it("fails closed on missing authentication and reports deterministic fingerprint conflicts", async () => {
    expect(await createAgentRequestAcceptanceService(dependencies({ authenticate: vi.fn(async () => null) })).accept(input))
      .toEqual({ kind: "unauthorized" });
    expect(await createAgentRequestAcceptanceService(dependencies({
      accept: vi.fn(async () => ({ data: null, error: { message: "REQUEST_IDEMPOTENCY_CONFLICT" } })),
    })).accept(input)).toEqual({ kind: "idempotency_conflict" });
  });

  it("preserves a committed replay identity and maps quota exhaustion without creating another binding", async () => {
    const replay = { ...ACCEPTED, replayed: true };
    const replayResult = await createAgentRequestAcceptanceService(dependencies({
      accept: vi.fn(async () => ({ data: replay, error: null })),
      now: () => new Date("2026-10-09T00:00:01.000Z"),
    })).accept(input);
    expect(replayResult).toMatchObject({
      kind: "accepted",
      replayed: true,
      usageDate: "2026-10-08",
      requestFingerprint: fingerprintAgentRequest(agentRequestAcceptanceInputSchema.parse(input)),
    });

    const limited = await createAgentRequestAcceptanceService(dependencies({
      accept: vi.fn(async () => ({ data: { kind: "limit_reached", messageCount: 20 }, error: null })),
    })).accept(input);
    expect(limited).toEqual({ kind: "limit_reached", messageCount: 20 });
  });

  it("uses the existing development-only usage-limit bypass without exposing it in request input", async () => {
    const deps = dependencies({ env: { NODE_ENV: "development" } });
    await createAgentRequestAcceptanceService(deps).accept(input);
    expect(deps.accept).toHaveBeenCalledWith(expect.objectContaining({
      freeDailyLimit: 2_147_483_647,
      proDailyLimit: 2_147_483_647,
    }));
  });
});
