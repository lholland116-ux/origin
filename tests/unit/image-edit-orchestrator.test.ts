import { describe, expect, it, vi } from "vitest";
import {
  createImageEditRequestFingerprint,
  ImageEditOrchestrationError,
  orchestrateImageEdit,
  type ImageEditClaim,
  type ImageEditOrchestratorDependencies,
  type ImageEditOrchestratorInput,
  type ImageEditUploadInput,
  type StaleAttemptResolution,
} from "../../lib/image-generation/image-edit-orchestrator";
import {
  ImageEditSourceResolverError,
  type ImageEditSourceResolverErrorCode,
} from "../../lib/image-generation/image-edit-source-resolver";
import { RunwareImageEditProviderError } from "../../lib/image-generation/providers/runware-image-edit";
import type { ResolvedImageEditSource } from "../../lib/image-generation/image-edit-source";
import {
  RUNWARE_IMAGE_EDIT_MODEL,
  RUNWARE_IMAGE_EDIT_PROVIDER,
} from "../../lib/image-generation/config";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const STALE_ATTEMPT_ID = "55555555-5555-4555-8555-555555555555";
const USER_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const ASSISTANT_MESSAGE_ID = "77777777-7777-4777-8777-777777777777";
const GENERATED_IMAGE_ID = "88888888-8888-4888-8888-888888888888";
const SOURCE_REFERENCE = {
  kind: "generated_image",
  generatedImageId: "original-image",
} as const;
const INPUT: ImageEditOrchestratorInput = {
  authenticatedUserId: USER_ID,
  conversationId: CONVERSATION_ID,
  sourceReference: SOURCE_REFERENCE,
  instruction: "Remove the red mug.",
  idempotencyKey: REQUEST_ID,
};
const SOURCE: ResolvedImageEditSource = {
  sourceReference: SOURCE_REFERENCE,
  conversationId: CONVERSATION_ID,
  bytes: new Uint8Array([1, 2, 3]),
  mimeType: "image/png",
  width: 640,
  height: 480,
  byteLength: 3,
};
const PROVIDER_RESULT = {
  provider: RUNWARE_IMAGE_EDIT_PROVIDER,
  model: RUNWARE_IMAGE_EDIT_MODEL,
  mimeType: "image/png",
  bytes: new Uint8Array([4, 5, 6]),
};

function claimedClaim(overrides: Partial<ImageEditClaim> = {}): ImageEditClaim {
  return {
    imageEditRequestId: REQUEST_ID,
    disposition: "claimed",
    attemptId: null,
    staleAttemptId: null,
    userMessageId: null,
    assistantMessageId: null,
    generatedImageId: null,
    status: "in_progress",
    ...overrides,
  };
}

function makeDependencies(
  overrides: Partial<ImageEditOrchestratorDependencies> = {},
) {
  const events: string[] = [];
  const claimImageEditRequest = vi.fn(async () => {
    events.push("claim");
    return claimedClaim();
  });
  const resolveStaleAttempt = vi.fn(
    async (attemptId: string): Promise<StaleAttemptResolution> => {
      events.push(`stale:${attemptId}`);
      return { status: "non_counting" };
    },
  );
  const releaseImageQuota = vi.fn(async (attemptId: string, reason: string) => {
    events.push(`release:${attemptId}:${reason}`);
    return true;
  });
  const reserveImageQuota = vi.fn(async () => {
    events.push("reserve");
    return { attemptId: ATTEMPT_ID };
  });
  const bindImageEditRequestAttempt = vi.fn(async () => {
    events.push("bind");
    return true;
  });
  const startImageGenerationAttempt = vi.fn(async () => {
    events.push("start");
    return true;
  });
  const resolveImageEditSource = vi.fn(async () => {
    events.push("resolve");
    return SOURCE;
  });
  const imageEditingProvider = {
    editImage: vi.fn(async () => {
      events.push("provider");
      return PROVIDER_RESULT;
    }),
  };
  const uploadDerivative = vi.fn(async () => {
    events.push("upload");
  });
  const removeDerivative = vi.fn(async () => {
    events.push("remove");
  });
  const failImageEditRequest = vi.fn(async () => {
    events.push("fail");
    return true;
  });
  const finalizeImageEdit = vi.fn(async () => {
    events.push("finalize");
    return {
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      generatedImageId: GENERATED_IMAGE_ID,
    };
  });

  const dependencies: ImageEditOrchestratorDependencies = {
    claimImageEditRequest,
    resolveStaleAttempt,
    releaseImageQuota,
    reserveImageQuota,
    bindImageEditRequestAttempt,
    startImageGenerationAttempt,
    resolveImageEditSource,
    imageEditingProvider,
    uploadDerivative,
    removeDerivative,
    failImageEditRequest,
    finalizeImageEdit,
    ...overrides,
  };

  return {
    dependencies,
    events,
    spies: {
      claimImageEditRequest,
      resolveStaleAttempt,
      releaseImageQuota,
      reserveImageQuota,
      bindImageEditRequestAttempt,
      startImageGenerationAttempt,
      resolveImageEditSource,
      imageEditingProvider,
      uploadDerivative,
      removeDerivative,
      failImageEditRequest,
      finalizeImageEdit,
    },
  };
}

function expectNoDownstreamWork(setup: ReturnType<typeof makeDependencies>): void {
  expect(setup.spies.resolveStaleAttempt).not.toHaveBeenCalled();
  expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
  expect(setup.spies.bindImageEditRequestAttempt).not.toHaveBeenCalled();
  expect(setup.spies.startImageGenerationAttempt).not.toHaveBeenCalled();
  expect(setup.spies.resolveImageEditSource).not.toHaveBeenCalled();
  expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
  expect(setup.spies.uploadDerivative).not.toHaveBeenCalled();
  expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
  expect(setup.spies.removeDerivative).not.toHaveBeenCalled();
  expect(setup.spies.releaseImageQuota).not.toHaveBeenCalled();
  expect(setup.spies.failImageEditRequest).not.toHaveBeenCalled();
}

async function expectError(
  operation: Promise<unknown>,
  code: string,
): Promise<ImageEditOrchestrationError> {
  const error = await operation.catch((value: unknown) => value);
  expect(error).toBeInstanceOf(ImageEditOrchestrationError);
  expect((error as ImageEditOrchestrationError).code).toBe(code);
  return error as ImageEditOrchestrationError;
}

function expectSyncError(operation: () => unknown, code: string): void {
  let caught: unknown;
  try {
    operation();
  } catch (error) {
    caught = error;
  }

  expect(caught).toBeInstanceOf(ImageEditOrchestrationError);
  expect((caught as ImageEditOrchestrationError).code).toBe(code);
}

describe("image edit request fingerprint", () => {
  it("is a deterministic lowercase SHA-256 of the fixed logical contract", () => {
    const first = createImageEditRequestFingerprint({
      conversationId: ` ${CONVERSATION_ID.toUpperCase()} `,
      sourceReference: {
        kind: "generated_image",
        generatedImageId: " original-image ",
      },
      instruction: "Remove the red mug.",
    });
    const second = createImageEditRequestFingerprint({
      conversationId: CONVERSATION_ID,
      sourceReference: SOURCE_REFERENCE,
      instruction: "Remove the red mug.",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes for every source or exact instruction change", () => {
    const base = createImageEditRequestFingerprint({
      conversationId: CONVERSATION_ID,
      sourceReference: SOURCE_REFERENCE,
      instruction: "Remove the red mug.",
    });

    expect(
      createImageEditRequestFingerprint({
        conversationId: "99999999-9999-4999-8999-999999999999",
        sourceReference: SOURCE_REFERENCE,
        instruction: "Remove the red mug.",
      }),
    ).not.toBe(base);
    expect(
      createImageEditRequestFingerprint({
        conversationId: CONVERSATION_ID,
        sourceReference: { kind: "generated_image", generatedImageId: "other-image" },
        instruction: "Remove the red mug.",
      }),
    ).not.toBe(base);
    expect(
      createImageEditRequestFingerprint({
        conversationId: CONVERSATION_ID,
        sourceReference: { kind: "uploaded_image", messageId: "message-1", ordinal: 1 },
        instruction: "Remove the red mug.",
      }),
    ).not.toBe(base);
    expect(
      createImageEditRequestFingerprint({
        conversationId: CONVERSATION_ID,
        sourceReference: { kind: "uploaded_image", messageId: "message-1", ordinal: 2 },
        instruction: "Remove the red mug.",
      }),
    ).not.toBe(base);
    expect(
      createImageEditRequestFingerprint({
        conversationId: CONVERSATION_ID,
        sourceReference: SOURCE_REFERENCE,
        instruction: "Remove the red mug!",
      }),
    ).not.toBe(base);
  });

  it("does not include the authenticated user or idempotency key", async () => {
    const first = makeDependencies();
    const second = makeDependencies();

    await orchestrateImageEdit(INPUT, first.dependencies);
    await orchestrateImageEdit(
      {
        ...INPUT,
        authenticatedUserId: "99999999-9999-4999-8999-999999999999",
        idempotencyKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      second.dependencies,
    );

    const firstClaim = first.spies.claimImageEditRequest.mock.calls[0] as unknown as
      | [{ fingerprint: string }]
      | undefined;
    const secondClaim = second.spies.claimImageEditRequest.mock.calls[0] as unknown as
      | [{ fingerprint: string }]
      | undefined;
    expect(firstClaim?.[0].fingerprint).toBe(secondClaim?.[0].fingerprint);
  });

  it("rejects blank, oversized, or invalid source input", () => {
    expectSyncError(
      () =>
        createImageEditRequestFingerprint({
          conversationId: CONVERSATION_ID,
          sourceReference: SOURCE_REFERENCE,
          instruction: "   ",
        }),
      "invalid_request",
    );
    expectSyncError(
      () =>
        createImageEditRequestFingerprint({
          conversationId: CONVERSATION_ID,
          sourceReference: SOURCE_REFERENCE,
          instruction: "x".repeat(4001),
        }),
      "invalid_request",
    );
    expectSyncError(
      () =>
        createImageEditRequestFingerprint({
          conversationId: CONVERSATION_ID,
          sourceReference: { kind: "unsupported" },
          instruction: "Edit it.",
        }),
      "invalid_request",
    );
  });
});

describe("image edit orchestration idempotency", () => {
  it("stops an in-progress request before reserve or any downstream work", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ disposition: "in_progress", status: "in_progress" }),
      ),
    });

    const result = await orchestrateImageEdit(INPUT, setup.dependencies);

    expect(result).toEqual({
      kind: "in_progress",
      disposition: "in_progress",
      status: "in_progress",
      conversationId: CONVERSATION_ID,
      imageEditRequestId: REQUEST_ID,
    });
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expect(setup.spies.uploadDerivative).not.toHaveBeenCalled();
    expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
    expectNoDownstreamWork(setup);
  });

  it("replays a completed request with durable IDs and never reruns it", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({
          disposition: "completed",
          status: "completed",
          userMessageId: USER_MESSAGE_ID,
          assistantMessageId: ASSISTANT_MESSAGE_ID,
          generatedImageId: GENERATED_IMAGE_ID,
        }),
      ),
    });

    const result = await orchestrateImageEdit(INPUT, setup.dependencies);

    expect(result).toEqual({
      kind: "completed_replay",
      disposition: "completed",
      status: "completed",
      conversationId: CONVERSATION_ID,
      imageEditRequestId: REQUEST_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      generatedImageId: GENERATED_IMAGE_ID,
    });
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expectNoDownstreamWork(setup);
  });

  it("does not rerun a completed request whose result IDs are unavailable", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ disposition: "completed", status: "completed" }),
      ),
    });

    await expect(
      orchestrateImageEdit(INPUT, setup.dependencies),
    ).resolves.toMatchObject({
      kind: "completed_result_unavailable",
      disposition: "completed",
    });
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
    expectNoDownstreamWork(setup);
  });

  it("returns a conflict without downstream work", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ disposition: "conflict", status: "failed" }),
      ),
    });

    await expect(orchestrateImageEdit(INPUT, setup.dependencies)).resolves.toMatchObject({
      kind: "conflict",
      disposition: "conflict",
    });
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expectNoDownstreamWork(setup);
  });

  it("fails closed for an unknown claim disposition", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ disposition: "unexpected", status: "unknown" }),
      ),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "internal_failure",
    );
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expectNoDownstreamWork(setup);
  });
});

describe("image edit orchestration lifecycle", () => {
  it("releases a stale attempt before reserving a new one", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ staleAttemptId: STALE_ATTEMPT_ID }),
      ),
    });

    await orchestrateImageEdit(INPUT, setup.dependencies);

    expect(setup.events.slice(0, 3)).toEqual([
      "stale:55555555-5555-4555-8555-555555555555",
      "reserve",
      "bind",
    ]);
    expect(setup.spies.resolveStaleAttempt).toHaveBeenCalledWith(STALE_ATTEMPT_ID);
    expect(setup.spies.releaseImageQuota).not.toHaveBeenCalled();
  });

  it("continues only when stale cleanup explicitly proves non-counting", async () => {
    const releaseImageQuota = vi.fn(async () => false);
    const resolveStaleAttempt = vi.fn(async (): Promise<StaleAttemptResolution> => ({
      status: "non_counting",
    }));
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ staleAttemptId: STALE_ATTEMPT_ID }),
      ),
      resolveStaleAttempt,
      releaseImageQuota,
    });

    await expect(orchestrateImageEdit(INPUT, setup.dependencies)).resolves.toMatchObject({
      kind: "completed",
    });
    expect(setup.spies.reserveImageQuota).toHaveBeenCalledOnce();
    expect(resolveStaleAttempt).toHaveBeenCalledWith(STALE_ATTEMPT_ID);
    expect(releaseImageQuota).not.toHaveBeenCalled();
  });

  it("does not reserve after an ambiguous stale resolution", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ staleAttemptId: STALE_ATTEMPT_ID }),
      ),
      resolveStaleAttempt: vi.fn(async (): Promise<StaleAttemptResolution> => ({
        status: "ambiguous",
      })),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "internal_failure",
    );
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.bindImageEditRequestAttempt).not.toHaveBeenCalled();
    expect(setup.spies.startImageGenerationAttempt).not.toHaveBeenCalled();
    expect(setup.spies.resolveImageEditSource).not.toHaveBeenCalled();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expect(setup.spies.uploadDerivative).not.toHaveBeenCalled();
    expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
  });

  it("fails closed for an unknown or malformed stale resolution", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ staleAttemptId: STALE_ATTEMPT_ID }),
      ),
      resolveStaleAttempt: vi.fn(async () => ({ status: "unexpected" }) as unknown as StaleAttemptResolution),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "internal_failure",
    );
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expect(setup.spies.uploadDerivative).not.toHaveBeenCalled();
    expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
  });

  it("stops before reserve when stale cleanup fails", async () => {
    const setup = makeDependencies({
      claimImageEditRequest: vi.fn(async () =>
        claimedClaim({ staleAttemptId: STALE_ATTEMPT_ID }),
      ),
      resolveStaleAttempt: vi.fn(async () => {
        throw new Error("release failed");
      }),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "internal_failure",
    );
    expect(setup.spies.reserveImageQuota).not.toHaveBeenCalled();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expect(setup.spies.failImageEditRequest).toHaveBeenCalledWith(
      REQUEST_ID,
      "internal_failure",
    );
  });

  it("uses the required order, trusted dimensions, fixed provider, and safe storage contract", async () => {
    const setup = makeDependencies();
    const result = await orchestrateImageEdit(INPUT, setup.dependencies);

    expect(result).toEqual({
      kind: "completed",
      disposition: "claimed",
      status: "completed",
      conversationId: CONVERSATION_ID,
      imageEditRequestId: REQUEST_ID,
      userMessageId: USER_MESSAGE_ID,
      assistantMessageId: ASSISTANT_MESSAGE_ID,
      generatedImageId: GENERATED_IMAGE_ID,
    });
    expect(setup.events).toEqual([
      "claim",
      "reserve",
      "bind",
      "start",
      "resolve",
      "provider",
      "upload",
      "finalize",
    ]);
    expect(setup.spies.startImageGenerationAttempt).toHaveBeenCalledWith({
      attemptId: ATTEMPT_ID,
      provider: RUNWARE_IMAGE_EDIT_PROVIDER,
      model: RUNWARE_IMAGE_EDIT_MODEL,
    });
    expect(setup.spies.resolveImageEditSource).toHaveBeenCalledWith({
      conversationId: CONVERSATION_ID,
      sourceReference: SOURCE_REFERENCE,
    });
    expect(setup.spies.imageEditingProvider.editImage).toHaveBeenCalledWith({
      sourceImage: { bytes: SOURCE.bytes, mimeType: "image/png" },
      instruction: INPUT.instruction,
      width: 640,
      height: 480,
      model: RUNWARE_IMAGE_EDIT_MODEL,
    });

    const uploadCall = setup.spies.uploadDerivative.mock.calls[0] as unknown as
      | [ImageEditUploadInput]
      | undefined;
    const upload = uploadCall?.[0];
    expect(upload).toBeDefined();
    if (!upload) throw new Error("expected upload");
    expect(upload).toMatchObject({
      bucket: "chat-images",
      mimeType: "image/png",
      cacheControl: "3600",
      upsert: false,
    });
    expect(upload.storagePath).toMatch(
      new RegExp(`^generated/${USER_ID}/${CONVERSATION_ID}/[0-9a-f-]+\\.png$`),
    );
    expect(upload.bytes).toEqual(PROVIDER_RESULT.bytes);
    expect(Object.keys(result).sort()).toEqual([
      "assistantMessageId",
      "conversationId",
      "disposition",
      "generatedImageId",
      "imageEditRequestId",
      "kind",
      "status",
      "userMessageId",
    ]);
  });

  it("passes uploaded source identity and exact instruction to the finalizer", async () => {
    const sourceReference = {
      kind: "uploaded_image",
      messageId: "uploaded-message",
      ordinal: 1,
    } as const;
    const source: ResolvedImageEditSource = {
      ...SOURCE,
      sourceReference,
    };
    const setup = makeDependencies({
      resolveImageEditSource: vi.fn(async () => source),
    });

    await orchestrateImageEdit(
      { ...INPUT, sourceReference, instruction: "  Keep this exact.  " },
      setup.dependencies,
    );

    expect(setup.spies.finalizeImageEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceReference,
        sourceGeneratedImageId: null,
        sourceUploadedMessageId: "uploaded-message",
        sourceUploadedOrdinal: 1,
        instruction: "  Keep this exact.  ",
      }),
    );
  });

  it("normalizes only server-resolved source dimensions", async () => {
    const setup = makeDependencies({
      resolveImageEditSource: vi.fn(async () => ({
        ...SOURCE,
        width: 1000,
        height: 500,
      })),
    });

    await orchestrateImageEdit(INPUT, setup.dependencies);

    expect(setup.spies.imageEditingProvider.editImage).toHaveBeenCalledWith(
      expect.objectContaining({ width: 1008, height: 496 }),
    );
  });

  it("does not reserve or call the provider when image quota is exhausted", async () => {
    const setup = makeDependencies({
      reserveImageQuota: vi.fn(async () => {
        throw new Error("IMAGE_DAILY_LIMIT_REACHED");
      }),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "quota_exhausted",
    );
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    expect(setup.spies.failImageEditRequest).toHaveBeenCalledWith(
      REQUEST_ID,
      "quota_reservation_failed",
    );
  });

  it("fails safely on a generic quota reservation error", async () => {
    const setup = makeDependencies({
      reserveImageQuota: vi.fn(async () => {
        throw new Error("database unavailable");
      }),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "internal_failure",
    );
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
  });

  it("releases and fails the request when binding the reserved attempt fails", async () => {
    const setup = makeDependencies({
      bindImageEditRequestAttempt: vi.fn(async () => false),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "persistence_failure",
    );
    expect(setup.spies.releaseImageQuota).toHaveBeenCalledWith(
      ATTEMPT_ID,
      "persistence_failure",
    );
    expect(setup.spies.failImageEditRequest).toHaveBeenCalledWith(
      REQUEST_ID,
      "persistence_failure",
    );
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
  });

  it("releases and fails the request when starting the attempt fails", async () => {
    const setup = makeDependencies({
      startImageGenerationAttempt: vi.fn(async () => false),
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "attempt_start_failed",
    );
    expect(setup.spies.releaseImageQuota).toHaveBeenCalledWith(
      ATTEMPT_ID,
      "internal_failure",
    );
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
  });
});

describe("image edit source and provider failures", () => {
  it.each([
    ["unauthenticated", "source_forbidden", "source_forbidden", "request_aborted"],
    ["conversation_not_found", "source_forbidden", "source_forbidden", "request_aborted"],
    ["invalid_source_reference", "invalid_request", "invalid_request", "request_aborted"],
    ["source_not_found", "source_not_found", "source_not_found", "request_aborted"],
    ["malformed_source_metadata", "source_not_found", "source_not_found", "request_aborted"],
    ["storage_object_missing", "source_not_found", "source_not_found", "request_aborted"],
    ["invalid_source_image", "invalid_source", "invalid_request", "request_aborted"],
    ["storage_download_failed", "internal_failure", "internal_failure", "internal_failure"],
    ["database_query_failed", "internal_failure", "internal_failure", "internal_failure"],
  ] as const)(
    "maps resolver code %s to a bounded outcome",
    async (resolverCode, errorCode, failureCode, releaseReason) => {
      const setup = makeDependencies({
        resolveImageEditSource: vi.fn(async () => {
          throw new ImageEditSourceResolverError(
            resolverCode as ImageEditSourceResolverErrorCode,
          );
        }),
      });

      await expectError(
        orchestrateImageEdit(INPUT, setup.dependencies),
        errorCode,
      );
      expect(setup.spies.releaseImageQuota).toHaveBeenCalledWith(
        ATTEMPT_ID,
        releaseReason,
      );
      expect(setup.spies.failImageEditRequest).toHaveBeenCalledWith(
        REQUEST_ID,
        failureCode,
      );
      expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["invalid_request", "invalid_request", "invalid_request", "request_aborted"],
    ["configuration", "provider_configuration", "provider_configuration", "provider_failure"],
    ["timeout", "provider_timeout", "provider_timeout", "provider_failure"],
    ["provider_failure", "provider_failure", "provider_failure", "provider_failure"],
    ["invalid_output", "invalid_provider_output", "invalid_provider_output", "invalid_provider_output"],
  ] as const)(
    "maps Runware code %s to a bounded outcome",
    async (providerCode, errorCode, failureCode, releaseReason) => {
      const setup = makeDependencies({
        imageEditingProvider: {
          editImage: vi.fn(async () => {
            throw new RunwareImageEditProviderError(
              providerCode,
              "provider detail must not escape",
            );
          }),
        },
      });

      const error = await expectError(
        orchestrateImageEdit(INPUT, setup.dependencies),
        errorCode,
      );
      expect(error.message).not.toContain("provider detail");
      expect(setup.spies.releaseImageQuota).toHaveBeenCalledWith(
        ATTEMPT_ID,
        releaseReason,
      );
      expect(setup.spies.failImageEditRequest).toHaveBeenCalledWith(
        REQUEST_ID,
        failureCode,
      );
      expect(setup.spies.uploadDerivative).not.toHaveBeenCalled();
    },
  );

  it("rejects a malformed provider result at the orchestration boundary", async () => {
    const setup = makeDependencies({
      imageEditingProvider: {
        editImage: vi.fn(async () => ({
          provider: RUNWARE_IMAGE_EDIT_PROVIDER,
          model: RUNWARE_IMAGE_EDIT_MODEL,
          mimeType: "image/jpeg",
          bytes: new Uint8Array([1]),
        })),
      },
    });

    await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "invalid_provider_output",
    );
    expect(setup.spies.releaseImageQuota).toHaveBeenCalledWith(
      ATTEMPT_ID,
      "invalid_provider_output",
    );
    expect(setup.spies.uploadDerivative).not.toHaveBeenCalled();
  });
});

describe("image edit compensation", () => {
  it("removes an uploaded derivative, releases quota, and fails the request on storage failure", async () => {
    const setup = makeDependencies({
      uploadDerivative: vi.fn(async () => {
        throw new Error("storage detail must not escape");
      }),
    });

    const error = await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "storage_failure",
    );
    expect(error.message).not.toContain("storage detail");
    expect(setup.spies.removeDerivative).toHaveBeenCalledWith(
      expect.objectContaining({ bucket: "chat-images" }),
    );
    expect(setup.spies.releaseImageQuota).toHaveBeenCalledWith(
      ATTEMPT_ID,
      "storage_failure",
    );
    expect(setup.spies.failImageEditRequest).toHaveBeenCalledWith(
      REQUEST_ID,
      "storage_failure",
    );
    expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
  });

  it("returns a controlled persistence error while completing best-effort compensation", async () => {
    const setup = makeDependencies({
      finalizeImageEdit: vi.fn(async () => {
        throw new Error("finalizer detail");
      }),
    });

    const error = await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "persistence_failure",
    );
    expect(error).not.toHaveProperty("cause");
    expect(setup.events.slice(-3)).toEqual(["remove", `release:${ATTEMPT_ID}:persistence_failure`, "fail"]);
  });

  it("does not mask a primary failure when derivative cleanup itself fails", async () => {
    const logger = vi.fn();
    const setup = makeDependencies({
      finalizeImageEdit: vi.fn(async () => {
        throw new Error("primary finalizer failure");
      }),
      removeDerivative: vi.fn(async () => {
        throw new Error("cleanup failure");
      }),
      logger,
    });

    const error = await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "persistence_failure",
    );
    expect(error).not.toHaveProperty("cause");
    expect(logger).toHaveBeenCalledWith(
      "image_edit_derivative_cleanup_failed",
      expect.objectContaining({
        code: "storage_failure",
        attemptId: ATTEMPT_ID,
        provider: RUNWARE_IMAGE_EDIT_PROVIDER,
        model: RUNWARE_IMAGE_EDIT_MODEL,
      }),
    );
    expect(logger.mock.calls.flat()).not.toContain(INPUT.instruction);
  });

  it("preserves the controlled provider error when quota release throws", async () => {
    const providerEdit = vi.fn(async () => {
      throw new RunwareImageEditProviderError(
        "provider_failure",
        "provider detail",
      );
    });
    const releaseImageQuota = vi.fn(async () => {
      throw new Error("quota cleanup detail");
    });
    const failImageEditRequest = vi.fn(async () => true);
    const setup = makeDependencies({
      imageEditingProvider: {
        editImage: providerEdit,
      },
      releaseImageQuota,
      failImageEditRequest,
    });

    const error = await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "provider_failure",
    );
    expect(error.message).not.toContain("quota cleanup detail");
    expect(error).not.toHaveProperty("cause");
    expect(releaseImageQuota).toHaveBeenCalledOnce();
    expect(failImageEditRequest).toHaveBeenCalledOnce();
    expect(providerEdit).toHaveBeenCalledOnce();
    expect(setup.spies.finalizeImageEdit).not.toHaveBeenCalled();
  });

  it("preserves the controlled source error when failure transition throws", async () => {
    const failImageEditRequest = vi.fn(async () => {
      throw new Error("failure transition detail");
    });
    const setup = makeDependencies({
      resolveImageEditSource: vi.fn(async () => {
        throw new ImageEditSourceResolverError("source_not_found");
      }),
      failImageEditRequest,
    });

    const error = await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "source_not_found",
    );
    expect(error.message).not.toContain("failure transition detail");
    expect(error).not.toHaveProperty("cause");
    expect(setup.spies.releaseImageQuota).toHaveBeenCalledOnce();
    expect(failImageEditRequest).toHaveBeenCalledOnce();
    expect(setup.spies.imageEditingProvider.editImage).not.toHaveBeenCalled();
  });

  it("keeps the controlled persistence error when every finalizer cleanup step throws", async () => {
    const finalizeImageEdit = vi.fn(async () => {
      throw new Error("finalizer detail");
    });
    const removeDerivative = vi.fn(async () => {
      throw new Error("remove detail");
    });
    const releaseImageQuota = vi.fn(async () => {
      throw new Error("release detail");
    });
    const failImageEditRequest = vi.fn(async () => {
      throw new Error("fail detail");
    });
    const setup = makeDependencies({
      removeDerivative,
      releaseImageQuota,
      failImageEditRequest,
      finalizeImageEdit,
    });

    const error = await expectError(
      orchestrateImageEdit(INPUT, setup.dependencies),
      "persistence_failure",
    );

    expect(error.message).not.toMatch(/remove detail|release detail|fail detail|finalizer detail/);
    expect(error).not.toHaveProperty("cause");
    expect(removeDerivative).toHaveBeenCalledOnce();
    expect(releaseImageQuota).toHaveBeenCalledOnce();
    expect(failImageEditRequest).toHaveBeenCalledOnce();
    expect(setup.spies.imageEditingProvider.editImage).toHaveBeenCalledOnce();
    expect(setup.spies.uploadDerivative).toHaveBeenCalledOnce();
    expect(finalizeImageEdit).toHaveBeenCalledOnce();
  });
});
