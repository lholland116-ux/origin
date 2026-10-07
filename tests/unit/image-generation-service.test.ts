import { describe, expect, it, vi } from "vitest";
import {
  createImageGenerationService,
  createImageGenerationServiceForExistingMessages,
  ImageGenerationServiceError,
  type ImageGenerationServiceDependencies,
} from "@/lib/ai/image-generation-service";
import type { ImageGenerationResult } from "@/lib/image-generation/provider";
import { ReplicateFluxSchnellProviderError } from "@/lib/image-generation/providers/replicate-flux-schnell";

const USER_ID = "a1000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "b1000000-0000-4000-8000-000000000001";
const ATTEMPT_ID = "c1000000-0000-4000-8000-000000000001";
const USER_MESSAGE_ID = "d1000000-0000-4000-8000-000000000001";
const ASSISTANT_MESSAGE_ID = "d1000000-0000-4000-8000-000000000002";
const IMAGE_ID = "d1000000-0000-4000-8000-000000000003";
const STORAGE_ID = "e1000000-0000-4000-8000-000000000001";
const BYTES = new Uint8Array([1, 2, 3, 4]);

const input = {
  userId: USER_ID,
  conversationId: CONVERSATION_ID,
  request: { prompt: "A quiet mountain lake" },
};

function setup(overrides: Partial<ImageGenerationServiceDependencies> = {}) {
  const generateImage = vi.fn(async () => ({
    provider: "replicate",
    model: "flux-schnell",
    mimeType: "image/webp",
    bytes: BYTES,
  } satisfies ImageGenerationResult));
  const dependencies: ImageGenerationServiceDependencies = {
    verifyConversation: vi.fn(async () => true),
    reserveQuota: vi.fn(async () => ATTEMPT_ID),
    startAttempt: vi.fn(async () => true),
    releaseQuota: vi.fn(async () => undefined),
    createProvider: () => ({ generateImage }),
    uploadImage: vi.fn(async () => undefined),
    completeGeneration: vi.fn(async () => [{
      user_message_id: USER_MESSAGE_ID,
      assistant_message_id: ASSISTANT_MESSAGE_ID,
      generated_image_id: IMAGE_ID,
    }]),
    completeGenerationForExistingMessages: vi.fn(async () => [{
      user_message_id: USER_MESSAGE_ID,
      assistant_message_id: ASSISTANT_MESSAGE_ID,
      generated_image_id: IMAGE_ID,
    }]),
    removeImage: vi.fn(async () => undefined),
    createId: () => STORAGE_ID,
    logFailure: vi.fn(),
    ...overrides,
  };
  return { dependencies, generateImage, run: createImageGenerationService(dependencies) };
}

describe("Image Generation application service", () => {
  it("performs owned conversation, quota, attempt, provider, storage, and persistence once and returns a reference", async () => {
    const { dependencies, generateImage, run } = setup();
    const result = await run(input);

    expect(dependencies.verifyConversation).toHaveBeenCalledWith({ userId: USER_ID, conversationId: CONVERSATION_ID });
    expect(dependencies.reserveQuota).toHaveBeenCalledOnce();
    expect(dependencies.reserveQuota).toHaveBeenCalledWith(CONVERSATION_ID);
    expect(dependencies.startAttempt).toHaveBeenCalledOnce();
    expect(dependencies.startAttempt).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, provider: "replicate", model: "flux-schnell" });
    expect(generateImage).toHaveBeenCalledOnce();
    expect(dependencies.uploadImage).toHaveBeenCalledOnce();
    expect(dependencies.completeGeneration).toHaveBeenCalledOnce();
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(result.reference).toEqual({
      kind: "generated_image",
      imageId: IMAGE_ID,
      conversationId: CONVERSATION_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      mimeType: "image/webp",
      provider: "replicate",
      model: "flux-schnell",
    });
    expect(JSON.parse(JSON.stringify(result.reference))).toEqual(result.reference);
    expect(result.reference).not.toHaveProperty("bytes");
    expect(result.reference).not.toHaveProperty("storagePath");
    expect(result.responseBytes).toEqual(BYTES);
  });

  it("denies an unowned conversation before quota, provider, storage, or persistence work", async () => {
    const { dependencies, generateImage, run } = setup({ verifyConversation: vi.fn(async () => false) });
    await expect(run(input)).rejects.toMatchObject({ code: "conversation_not_found" });
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
    expect(dependencies.uploadImage).not.toHaveBeenCalled();
    expect(dependencies.completeGeneration).not.toHaveBeenCalled();
  });

  it("maps quota denial before provider work", async () => {
    const { dependencies, generateImage, run } = setup({
      reserveQuota: vi.fn(async () => { throw new Error("IMAGE_DAILY_LIMIT_REACHED"); }),
    });
    await expect(run(input)).rejects.toMatchObject({ code: "daily_limit_reached", status: 429 });
    expect(generateImage).not.toHaveBeenCalled();
    expect(dependencies.uploadImage).not.toHaveBeenCalled();
  });

  it("releases the reserved attempt after provider errors without leaking provider text", async () => {
    const generateImage = vi.fn(async () => {
      throw new ReplicateFluxSchnellProviderError("provider_failure", "secret provider body");
    });
    const { dependencies, run } = setup({ createProvider: () => ({ generateImage }) });
    await expect(run(input)).rejects.toMatchObject({ code: "provider_failure", message: "The image generation provider could not complete the request." });
    expect(dependencies.releaseQuota).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, reason: "provider_failure" });
    expect(dependencies.uploadImage).not.toHaveBeenCalled();
    expect(dependencies.completeGeneration).not.toHaveBeenCalled();
  });

  it("rejects invalid provider output and releases quota without storage mutation", async () => {
    const { dependencies, run } = setup({
      createProvider: () => ({ generateImage: vi.fn(async () => ({ ...({} as ImageGenerationResult), provider: "bad provider!", model: "m", mimeType: "image/gif", bytes: BYTES })) }),
    });
    await expect(run(input)).rejects.toBeInstanceOf(ImageGenerationServiceError);
    expect(dependencies.releaseQuota).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, reason: "invalid_provider_output" });
    expect(dependencies.uploadImage).not.toHaveBeenCalled();
  });

  it("releases quota on storage failure and never persists", async () => {
    const { dependencies, run } = setup({ uploadImage: vi.fn(async () => { throw new Error("private storage detail"); }) });
    await expect(run(input)).rejects.toMatchObject({ code: "storage_failure" });
    expect(dependencies.releaseQuota).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, reason: "storage_failure" });
    expect(dependencies.completeGeneration).not.toHaveBeenCalled();
  });

  it("cleans storage and releases quota when durable persistence fails", async () => {
    const { dependencies, run } = setup({ completeGeneration: vi.fn(async () => { throw new Error("private database detail"); }) });
    await expect(run(input)).rejects.toMatchObject({ code: "persistence_failure" });
    expect(dependencies.removeImage).toHaveBeenCalledWith(`generated/${USER_ID}/${CONVERSATION_ID}/${STORAGE_ID}.webp`);
    expect(dependencies.releaseQuota).toHaveBeenCalledWith({ attemptId: ATTEMPT_ID, reason: "persistence_failure" });
  });

  it("completes image generation against the supplied messages without using direct-chat persistence", async () => {
    const { dependencies, generateImage } = setup({
      completeGenerationForExistingMessages: vi.fn(async () => [{
        user_message_id: USER_MESSAGE_ID,
        assistant_message_id: ASSISTANT_MESSAGE_ID,
        generated_image_id: IMAGE_ID,
      }]),
    });
    const run = createImageGenerationServiceForExistingMessages(dependencies);

    const result = await run({
      ...input,
      userMessageId: USER_MESSAGE_ID.toUpperCase(),
      assistantMessageId: ASSISTANT_MESSAGE_ID,
    });

    expect(dependencies.reserveQuota).toHaveBeenCalledOnce();
    expect(dependencies.startAttempt).toHaveBeenCalledOnce();
    expect(generateImage).toHaveBeenCalledOnce();
    expect(dependencies.uploadImage).toHaveBeenCalledOnce();
    expect(dependencies.completeGeneration).not.toHaveBeenCalled();
    expect(dependencies.completeGenerationForExistingMessages).toHaveBeenCalledWith(expect.objectContaining({
      attemptId: ATTEMPT_ID,
      conversationId: CONVERSATION_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      storagePath: `generated/${USER_ID}/${CONVERSATION_ID}/${STORAGE_ID}.webp`,
    }));
    expect(dependencies.releaseQuota).not.toHaveBeenCalled();
    expect(result.reference).toMatchObject({
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      imageId: IMAGE_ID,
    });
  });

  it.each([
    ["malformed", "not-a-uuid", ASSISTANT_MESSAGE_ID],
    ["same user and assistant", USER_MESSAGE_ID, USER_MESSAGE_ID],
  ])("rejects %s existing message linkage before reserving quota", async (_label, userMessageId, assistantMessageId) => {
    const { dependencies, generateImage } = setup();
    const run = createImageGenerationServiceForExistingMessages(dependencies);

    await expect(run({ ...input, userMessageId, assistantMessageId })).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(dependencies.verifyConversation).not.toHaveBeenCalled();
    expect(dependencies.reserveQuota).not.toHaveBeenCalled();
    expect(generateImage).not.toHaveBeenCalled();
    expect(dependencies.completeGenerationForExistingMessages).not.toHaveBeenCalled();
  });
});
