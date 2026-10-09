import { beforeEach, describe, expect, it, vi } from "vitest";

const { rpc, getUserById } = vi.hoisted(() => ({
  rpc: vi.fn(),
  getUserById: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    rpc,
    auth: { admin: { getUserById } },
  }),
}));

import {
  isTrustedExecutionSubject,
  resolveTrustedExecutionSubject,
  type TrustedExecutionSubjectInput,
} from "@/lib/agent-runtime/trusted-execution-subject";
import { createGeneratedDocumentPersistenceServiceForExistingMessage } from "@/lib/ai/generated-document-persistence-service";

const INPUT: TrustedExecutionSubjectInput = {
  runId: "11111111-1111-4111-8111-111111111111",
  stepId: "image-step",
  executionKey: "22222222-2222-4222-8222-222222222222",
  claimId: "33333333-3333-4333-8333-333333333333",
  fencingGeneration: 2,
};

const ROW = {
  request_id: "44444444-4444-4444-8444-444444444444",
  user_id: "55555555-5555-4555-8555-555555555555",
  conversation_id: "66666666-6666-4666-8666-666666666666",
  user_message_id: "77777777-7777-4777-8777-777777777777",
  assistant_message_id: "88888888-8888-4888-8888-888888888888",
  capability_id: "image_generation",
  reasoning_mode: "medium",
  plan: "pro",
  attempt_number: 1,
  execution_key: INPUT.executionKey,
};

describe("trusted execution subject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    rpc.mockResolvedValue({ data: [ROW], error: null });
    getUserById.mockResolvedValue({
      data: { user: { id: ROW.user_id, banned_until: null, deleted_at: null } },
      error: null,
    });
  });

  it("derives the owner and message binding from PostgreSQL, not caller input", async () => {
    const subject = await resolveTrustedExecutionSubject(INPUT);
    expect(subject).toMatchObject({
      runId: INPUT.runId,
      userId: ROW.user_id,
      requestId: ROW.request_id,
      conversationId: ROW.conversation_id,
      userMessageId: ROW.user_message_id,
      assistantMessageId: ROW.assistant_message_id,
      capabilityId: "image_generation",
      plan: "pro",
    });
    expect(rpc).toHaveBeenCalledWith("resolve_trusted_agent_execution_subject", expect.objectContaining({
      p_run_id: INPUT.runId,
      p_claim_id: INPUT.claimId,
      p_fencing_generation: INPUT.fencingGeneration,
      p_allow_pending: true,
    }));
    expect(getUserById).toHaveBeenCalledWith(ROW.user_id);
  });

  it("fails closed for stale claims, missing owners, and disabled accounts", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "stale claim" } });
    await expect(resolveTrustedExecutionSubject(INPUT)).resolves.toBeNull();

    getUserById.mockResolvedValueOnce({ data: { user: null }, error: null });
    await expect(resolveTrustedExecutionSubject(INPUT)).resolves.toBeNull();

    getUserById.mockResolvedValueOnce({
      data: { user: { id: ROW.user_id, banned_until: "2999-01-01T00:00:00Z", deleted_at: null } },
      error: null,
    });
    await expect(resolveTrustedExecutionSubject(INPUT)).resolves.toBeNull();
  });

  it("uses claim-bound RPCs and rejects structural clones as trusted subjects", async () => {
    const subject = await resolveTrustedExecutionSubject(INPUT);
    expect(subject).not.toBeNull();
    expect(isTrustedExecutionSubject(subject)).toBe(true);
    expect(isTrustedExecutionSubject({ ...subject! })).toBe(false);

    rpc.mockResolvedValueOnce({ data: "99999999-9999-4999-8999-999999999999", error: null });
    await expect(subject!.reserveImageQuota()).resolves.toBe("99999999-9999-4999-8999-999999999999");
    expect(rpc).toHaveBeenLastCalledWith("reserve_trusted_image_generation_quota", expect.objectContaining({
      p_run_id: INPUT.runId,
      p_step_id: INPUT.stepId,
      p_execution_key: INPUT.executionKey,
      p_claim_id: INPUT.claimId,
      p_fencing_generation: INPUT.fencingGeneration,
    }));
  });

  it("revalidates the persisted claim before returning current authorization", async () => {
    const subject = await resolveTrustedExecutionSubject(INPUT);
    expect(await subject!.assertCurrent()).toBe(true);
    expect(rpc).toHaveBeenLastCalledWith("resolve_trusted_agent_execution_subject", expect.objectContaining({
      p_allow_pending: false,
    }));
  });

  it("reconciles a lost document-persistence acknowledgement without deleting the committed object", async () => {
    rpc.mockResolvedValue({ data: [{ ...ROW, capability_id: "document_generation" }], error: null });
    const subject = await resolveTrustedExecutionSubject(INPUT);
    expect(subject).not.toBeNull();
    const prior = {
      id: "99999999-9999-4999-8999-999999999999",
      userId: ROW.user_id,
      conversationId: ROW.conversation_id,
      messageId: ROW.assistant_message_id,
      generationRequestId: INPUT.executionKey,
      storagePath: `${ROW.user_id}/${ROW.conversation_id}/generated/99999999-9999-4999-8999-999999999999/report.txt`,
      filename: "report.txt",
      format: "txt" as const,
      mimeType: "text/plain",
      sizeBytes: 3,
      templateId: "simple-document",
      createdAt: "2026-10-07T12:00:00.000Z",
    };
    const remove = vi.fn(async () => undefined);
    const persist = createGeneratedDocumentPersistenceServiceForExistingMessage({
      createId: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      upload: vi.fn(async () => `${ROW.user_id}/${ROW.conversation_id}/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/report.txt`),
      persistChat: vi.fn(async () => null),
      persistChatForExistingMessage: vi.fn(async () => { throw new Error("acknowledgement lost"); }),
      remove,
      findById: vi.fn(async () => prior),
      findByRequest: vi.fn(async () => prior),
      download: vi.fn(async () => new Uint8Array([9, 8, 7])),
    });

    const result = await persist({
      userId: ROW.user_id,
      conversationId: ROW.conversation_id,
      generationRequestId: INPUT.executionKey,
      templateId: "simple-document",
      generatedOutput: { filename: "report.txt", format: "txt", mimeType: "text/plain", bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3 },
      assistantMessageId: ROW.assistant_message_id,
      trustedExecutionSubject: subject!,
    });

    expect(result.reference.artifactId).toBe(prior.id);
    expect(result.delivery.bytes).toEqual(new Uint8Array([9, 8, 7]));
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(expect.objectContaining({
      generatedDocumentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      storagePath: `${ROW.user_id}/${ROW.conversation_id}/generated/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/report.txt`,
    }));
  });
});
