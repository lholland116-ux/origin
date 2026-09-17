import { describe, expect, it, vi } from "vitest";
import {
  createImageEditServerDependencies,
  type ImageEditServerDependencies,
} from "../../lib/image-generation/image-edit-server-dependencies";

const USER_ID = "11111111-1111-4111-8111-111111111111";
const CONVERSATION_ID = "22222222-2222-4222-8222-222222222222";
const REQUEST_ID = "33333333-3333-4333-8333-333333333333";
const ATTEMPT_ID = "44444444-4444-4444-8444-444444444444";
const SOURCE_ID = "55555555-5555-4555-8555-555555555555";
const MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const DERIVATIVE_ID = "77777777-7777-4777-8777-777777777777";
const IDENTITY = {
  kind: "generated_image",
  generatedImageId: SOURCE_ID,
} as const;

function query(data: unknown, error: unknown = null) {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(async () => ({ data, error })),
  };
  return builder;
}

function quotaRow(attemptId = ATTEMPT_ID) {
  return {
    attempt_id: attemptId,
    plan: "pro",
    daily_used: 1,
    daily_reserved: 0,
    daily_limit: 20,
    daily_remaining: 19,
    monthly_used: 1,
    monthly_reserved: 0,
    monthly_limit: 200,
    monthly_remaining: 199,
  };
}

function requestRow(attemptId: string | null = ATTEMPT_ID) {
  return {
    id: REQUEST_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    attempt_id: attemptId,
    status: "in_progress",
  };
}

function claimRow(
  overrides: Partial<{
    disposition: string;
    status: string;
    attempt_id: string | null;
    stale_attempt_id: string | null;
    user_message_id: string | null;
    assistant_message_id: string | null;
    generated_image_id: string | null;
  }> = {},
) {
  return {
    image_edit_request_id: REQUEST_ID,
    disposition: "claimed",
    attempt_id: null,
    stale_attempt_id: null,
    user_message_id: null,
    assistant_message_id: null,
    generated_image_id: null,
    status: "in_progress",
    ...overrides,
  };
}

function attemptRow(
  overrides: Partial<{
    id: string;
    user_id: string;
    conversation_id: string;
    status: string;
    expires_at: string;
    completed_at: string | null;
    released_at: string | null;
    release_reason: string | null;
  }> = {},
) {
  return {
    id: ATTEMPT_ID,
    user_id: USER_ID,
    conversation_id: CONVERSATION_ID,
    status: "released",
    expires_at: "2026-09-17T00:00:00.000Z",
    completed_at: null,
    released_at: "2026-09-17T00:01:00.000Z",
    release_reason: "expired",
    ...overrides,
  };
}

function makeSetup() {
  const authenticatedClient = {
    rpc: vi.fn(),
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: USER_ID } },
        error: null,
      })),
    },
    from: vi.fn(),
  };
  const storageBucket = {
    upload: vi.fn(async () => ({ data: { path: "ok" }, error: null })),
    remove: vi.fn(async () => ({ data: [], error: null })),
  };
  const serviceClient = {
    rpc: vi.fn(),
    from: vi.fn(),
    storage: {
      from: vi.fn(() => storageBucket),
    },
  };
  const dependencies = createImageEditServerDependencies({
    authenticatedClient,
    serviceClient,
    authenticatedUserId: USER_ID,
    conversationId: CONVERSATION_ID,
  });

  return { authenticatedClient, serviceClient, storageBucket, dependencies };
}

async function primeClaim(
  dependencies: ImageEditServerDependencies,
  authenticatedClient: ReturnType<typeof makeSetup>["authenticatedClient"],
) {
  authenticatedClient.rpc.mockResolvedValueOnce({
    data: [
      {
        image_edit_request_id: REQUEST_ID,
        disposition: "claimed",
        attempt_id: null,
        stale_attempt_id: ATTEMPT_ID,
        user_message_id: null,
        assistant_message_id: null,
        generated_image_id: null,
        status: "in_progress",
      },
    ],
    error: null,
  });
  await dependencies.claimImageEditRequest({
    conversationId: CONVERSATION_ID,
    idempotencyKey: REQUEST_ID,
    fingerprint: "a".repeat(64),
  });
}

describe("image edit server dependency adapters", () => {
  it("claims through the authenticated RPC with the exact payload", async () => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc.mockResolvedValue({
      data: [
        {
          image_edit_request_id: REQUEST_ID,
          disposition: "claimed",
          attempt_id: null,
          stale_attempt_id: null,
          user_message_id: null,
          assistant_message_id: null,
          generated_image_id: null,
          status: "in_progress",
        },
      ],
      error: null,
    });

    await expect(
      setup.dependencies.claimImageEditRequest({
        conversationId: CONVERSATION_ID,
        idempotencyKey: REQUEST_ID,
        fingerprint: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ imageEditRequestId: REQUEST_ID });
    expect(setup.authenticatedClient.rpc).toHaveBeenCalledWith(
      "claim_image_edit_request",
      {
        p_conversation_id: CONVERSATION_ID,
        p_idempotency_key: REQUEST_ID,
        p_request_fingerprint: "b".repeat(64),
      },
    );
  });

  it.each([
    ["empty result", []],
    ["multiple results", [{ image_edit_request_id: REQUEST_ID }, { image_edit_request_id: REQUEST_ID }]],
    ["unknown disposition", [{ image_edit_request_id: REQUEST_ID, disposition: "unknown", status: "in_progress" }]],
    ["malformed UUID", [{ image_edit_request_id: "not-a-uuid", disposition: "claimed", status: "in_progress" }]],
  ])("fails closed for a claim %s", async (_label, data) => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc.mockResolvedValue({ data, error: null });

    await expect(
      setup.dependencies.claimImageEditRequest({
        conversationId: CONVERSATION_ID,
        idempotencyKey: REQUEST_ID,
        fingerprint: "c".repeat(64),
      }),
    ).rejects.toThrow("IMAGE_EDIT_CLAIM_FAILED");
  });

  it.each([
    ["claimed + in_progress", claimRow()],
    [
      "reclaimed claimed + in_progress",
      claimRow({ stale_attempt_id: ATTEMPT_ID }),
    ],
    ["in_progress + in_progress before bind", claimRow({ disposition: "in_progress" })],
    [
      "in_progress + in_progress after bind",
      claimRow({ disposition: "in_progress", attempt_id: ATTEMPT_ID }),
    ],
    [
      "completed + completed with durable results",
      claimRow({
        disposition: "completed",
        status: "completed",
        attempt_id: ATTEMPT_ID,
        user_message_id: MESSAGE_ID,
        assistant_message_id: DERIVATIVE_ID,
        generated_image_id: SOURCE_ID,
      }),
    ],
    [
      "completed + completed after result deletion",
      claimRow({ disposition: "completed", status: "completed" }),
    ],
    ["conflict + in_progress", claimRow({ disposition: "conflict" })],
    ["conflict + failed", claimRow({ disposition: "conflict", status: "failed" })],
    ["conflict + completed", claimRow({ disposition: "conflict", status: "completed" })],
  ] as const)("accepts SQL-valid claim shape: %s", async (_label, row) => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(
      setup.dependencies.claimImageEditRequest({
        conversationId: CONVERSATION_ID,
        idempotencyKey: REQUEST_ID,
        fingerprint: "e".repeat(64),
      }),
    ).resolves.toMatchObject({
      disposition: row.disposition,
      status: row.status,
    });
  });

  it.each([
    ["completed + in_progress", claimRow({ disposition: "completed" })],
    ["in_progress + completed", claimRow({ disposition: "in_progress", status: "completed" })],
    ["claimed + completed", claimRow({ status: "completed" })],
    ["claimed + failed", claimRow({ status: "failed" })],
    [
      "in_progress with stale attempt",
      claimRow({ disposition: "in_progress", stale_attempt_id: ATTEMPT_ID }),
    ],
    [
      "conflict with attempt",
      claimRow({ disposition: "conflict", attempt_id: ATTEMPT_ID }),
    ],
    [
      "conflict with durable result",
      claimRow({ disposition: "conflict", user_message_id: MESSAGE_ID }),
    ],
  ] as const)("rejects SQL-impossible claim shape: %s", async (_label, row) => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc.mockResolvedValue({ data: [row], error: null });

    await expect(
      setup.dependencies.claimImageEditRequest({
        conversationId: CONVERSATION_ID,
        idempotencyKey: REQUEST_ID,
        fingerprint: "f".repeat(64),
      }),
    ).rejects.toThrow("IMAGE_EDIT_CLAIM_FAILED");
    expect(setup.authenticatedClient.rpc).toHaveBeenCalledOnce();
  });

  it("contains claim RPC failures without exposing the raw error", async () => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc.mockRejectedValue(
      new Error("database secret and SQL details"),
    );

    const error = await setup.dependencies
      .claimImageEditRequest({
        conversationId: CONVERSATION_ID,
        idempotencyKey: REQUEST_ID,
        fingerprint: "d".repeat(64),
      })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({ message: "IMAGE_EDIT_CLAIM_FAILED" });
    expect(String(error)).not.toContain("database secret");
  });

  it("binds and fails requests through authenticated RPCs", async () => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: true, error: null });

    await expect(
      setup.dependencies.bindImageEditRequestAttempt({
        imageEditRequestId: REQUEST_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toBe(true);
    await expect(
      setup.dependencies.failImageEditRequest(REQUEST_ID, "provider_failure"),
    ).resolves.toBe(true);
    expect(setup.authenticatedClient.rpc).toHaveBeenNthCalledWith(
      1,
      "bind_image_edit_request_attempt",
      { p_image_edit_request_id: REQUEST_ID, p_attempt_id: ATTEMPT_ID },
    );
    expect(setup.authenticatedClient.rpc).toHaveBeenNthCalledWith(
      2,
      "fail_image_edit_request",
      { p_image_edit_request_id: REQUEST_ID, p_failure_code: "provider_failure" },
    );
  });

  it("fails closed for false or malformed bind responses", async () => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc
      .mockResolvedValueOnce({ data: false, error: null })
      .mockResolvedValueOnce({ data: null, error: null });

    await expect(
      setup.dependencies.bindImageEditRequestAttempt({
        imageEditRequestId: REQUEST_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).resolves.toBe(false);
    await expect(
      setup.dependencies.bindImageEditRequestAttempt({
        imageEditRequestId: REQUEST_ID,
        attemptId: ATTEMPT_ID,
      }),
    ).rejects.toThrow("IMAGE_EDIT_BIND_FAILED");
  });

  it("maps quota metadata and starts the fixed Runware operation", async () => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc
      .mockResolvedValueOnce({ data: [quotaRow()], error: null })
      .mockResolvedValueOnce({ data: true, error: null })
      .mockResolvedValueOnce({ data: false, error: null });

    await expect(setup.dependencies.reserveImageQuota(CONVERSATION_ID)).resolves.toEqual({
      attemptId: ATTEMPT_ID,
    });
    await expect(
      setup.dependencies.startImageGenerationAttempt({
        attemptId: ATTEMPT_ID,
        provider: "runware",
        model: "runware:400@4",
      }),
    ).resolves.toBe(true);
    await expect(setup.dependencies.releaseImageQuota(ATTEMPT_ID, "provider_failure"))
      .resolves.toBe(false);
    expect(setup.authenticatedClient.rpc).toHaveBeenNthCalledWith(
      2,
      "start_image_generation_attempt",
      {
        p_attempt_id: ATTEMPT_ID,
        p_provider: "runware",
        p_model: "runware:400@4",
      },
    );
    expect(setup.authenticatedClient.rpc).toHaveBeenNthCalledWith(
      3,
      "release_image_generation_quota",
      { p_attempt_id: ATTEMPT_ID, p_reason: "provider_failure" },
    );
  });

  it.each([
    "IMAGE_DAILY_LIMIT_REACHED",
    "IMAGE_MONTHLY_LIMIT_REACHED",
  ] as const)("preserves stable quota error %s", async (quotaCode) => {
    const setup = makeSetup();
    setup.authenticatedClient.rpc.mockResolvedValue({
      data: null,
      error: { message: quotaCode },
    });

    await expect(setup.dependencies.reserveImageQuota(CONVERSATION_ID))
      .rejects.toThrow(quotaCode);
    expect(setup.dependencies.getLastQuotaErrorCode()).toBe(quotaCode);
  });

  it("uploads and removes only server-derived PNG derivative paths", async () => {
    const setup = makeSetup();
    const storagePath = `generated/${USER_ID}/${CONVERSATION_ID}/${DERIVATIVE_ID}.png`;
    const bytes = new Uint8Array([1, 2, 3]);

    await setup.dependencies.uploadDerivative({
      bucket: "chat-images",
      storagePath,
      bytes,
      mimeType: "image/png",
      cacheControl: "3600",
      upsert: false,
    });
    await setup.dependencies.removeDerivative({
      bucket: "chat-images",
      storagePath,
    });

    expect(setup.serviceClient.storage.from).toHaveBeenCalledWith("chat-images");
    expect(setup.storageBucket.upload).toHaveBeenCalledWith(storagePath, bytes, {
      contentType: "image/png",
      cacheControl: "3600",
      upsert: false,
    });
    expect(setup.storageBucket.remove).toHaveBeenCalledWith([storagePath]);
  });

  it("rejects a source-like or foreign derivative cleanup path", async () => {
    const setup = makeSetup();
    const foreignPath = `generated/99999999-9999-4999-8999-999999999999/${CONVERSATION_ID}/${DERIVATIVE_ID}.png`;

    await expect(
      setup.dependencies.removeDerivative({ bucket: "chat-images", storagePath: foreignPath }),
    ).rejects.toThrow("IMAGE_EDIT_STORAGE_INVALID");
    expect(setup.storageBucket.remove).not.toHaveBeenCalled();
  });

  it("proves released and succeeded stale attempts are non-counting", async () => {
    for (const row of [
      attemptRow(),
      attemptRow({
        status: "succeeded",
        completed_at: "2026-09-17T00:01:00.000Z",
        released_at: null,
        release_reason: null,
      }),
    ]) {
      const setup = makeSetup();
      await primeClaim(setup.dependencies, setup.authenticatedClient);
      const requestQuery = query(requestRow());
      const attemptQuery = query(row);
      setup.serviceClient.from
        .mockReturnValueOnce(requestQuery)
        .mockReturnValueOnce(attemptQuery);

      await expect(setup.dependencies.resolveStaleAttempt(ATTEMPT_ID)).resolves.toEqual({
        status: "non_counting",
      });
    }
  });

  it("treats an active reserved attempt as ambiguous", async () => {
    const setup = makeSetup();
    await primeClaim(setup.dependencies, setup.authenticatedClient);
    setup.serviceClient.from
      .mockReturnValueOnce(query(requestRow()))
      .mockReturnValueOnce(
        query(
          attemptRow({
            status: "reserved",
            expires_at: "2999-01-01T00:00:00.000Z",
            released_at: null,
            release_reason: null,
          }),
        ),
      );

    await expect(setup.dependencies.resolveStaleAttempt(ATTEMPT_ID)).resolves.toEqual({
      status: "ambiguous",
    });
    expect(setup.authenticatedClient.rpc).toHaveBeenCalledTimes(1);
  });

  it("releases expired reservations and requires an authoritative reread", async () => {
    const setup = makeSetup();
    await primeClaim(setup.dependencies, setup.authenticatedClient);
    setup.authenticatedClient.rpc.mockResolvedValueOnce({ data: true, error: null });
    setup.serviceClient.from
      .mockReturnValueOnce(query(requestRow()))
      .mockReturnValueOnce(
        query(
          attemptRow({
            status: "reserved",
            expires_at: "2020-01-01T00:00:00.000Z",
            released_at: null,
            release_reason: null,
          }),
        ),
      )
      .mockReturnValueOnce(query(attemptRow()));

    await expect(setup.dependencies.resolveStaleAttempt(ATTEMPT_ID)).resolves.toEqual({
      status: "non_counting",
    });
    expect(setup.authenticatedClient.rpc).toHaveBeenNthCalledWith(
      2,
      "release_image_generation_quota",
      { p_attempt_id: ATTEMPT_ID, p_reason: "expired" },
    );
    expect(setup.serviceClient.from).toHaveBeenCalledTimes(3);
  });

  it("never treats a raw false release result as stale safety proof", async () => {
    const setup = makeSetup();
    await primeClaim(setup.dependencies, setup.authenticatedClient);
    setup.authenticatedClient.rpc.mockResolvedValueOnce({ data: false, error: null });
    setup.serviceClient.from
      .mockReturnValueOnce(query(requestRow()))
      .mockReturnValueOnce(
        query(
          attemptRow({
            status: "reserved",
            expires_at: "2020-01-01T00:00:00.000Z",
            released_at: null,
            release_reason: null,
          }),
        ),
      )
      .mockReturnValueOnce(
        query(
          attemptRow({
            status: "reserved",
            expires_at: "2020-01-01T00:00:00.000Z",
            released_at: null,
            release_reason: null,
          }),
        ),
      );

    await expect(setup.dependencies.resolveStaleAttempt(ATTEMPT_ID)).resolves.toEqual({
      status: "ambiguous",
    });
  });

  it.each([
    ["missing attempt", null],
    ["owner mismatch", attemptRow({ user_id: "99999999-9999-4999-8999-999999999999" })],
    ["conversation mismatch", attemptRow({ conversation_id: "99999999-9999-4999-8999-999999999999" })],
    ["request relationship mismatch", requestRow(null)],
    ["malformed status", attemptRow({ status: "unknown" })],
  ] as const)("returns ambiguous for %s", async (label, attempt) => {
    const setup = makeSetup();
    await primeClaim(setup.dependencies, setup.authenticatedClient);
    setup.serviceClient.from.mockReturnValueOnce(query(requestRow()));
    if (label === "missing attempt") {
      setup.serviceClient.from.mockReturnValueOnce(query(null));
    } else if (label === "request relationship mismatch") {
      setup.serviceClient.from.mockReset();
      setup.serviceClient.from
        .mockReturnValueOnce(query(requestRow(null)))
        .mockReturnValueOnce(query(attemptRow()));
    } else {
      setup.serviceClient.from.mockReturnValueOnce(query(attempt));
    }

    await expect(setup.dependencies.resolveStaleAttempt(ATTEMPT_ID)).resolves.toEqual({
      status: "ambiguous",
    });
  });

  it("uses the existing source resolver and the service-role finalizer boundary", async () => {
    const setup = makeSetup();
    setup.authenticatedClient.from.mockReturnValue(query(null));

    await expect(
      setup.dependencies.resolveImageEditSource?.({
        conversationId: CONVERSATION_ID,
        sourceReference: { kind: "generated_image", generatedImageId: "bad" },
      }),
    ).rejects.toMatchObject({ code: "conversation_not_found" });
    expect(setup.authenticatedClient.auth.getUser).toHaveBeenCalledOnce();

    setup.serviceClient.rpc.mockResolvedValue({
      data: [
        {
          user_message_id: MESSAGE_ID,
          assistant_message_id: DERIVATIVE_ID,
          generated_image_id: SOURCE_ID,
        },
      ],
      error: null,
    });
    const result = await setup.dependencies.finalizeImageEdit({
      imageEditRequestId: REQUEST_ID,
      attemptId: ATTEMPT_ID,
      conversationId: CONVERSATION_ID,
      sourceReference: IDENTITY,
      instruction: "Remove the mark.",
      storagePath: `generated/${USER_ID}/${CONVERSATION_ID}/${DERIVATIVE_ID}.png`,
      mimeType: "image/png",
      provider: "runware",
      model: "runware:400@4",
      sourceGeneratedImageId: SOURCE_ID,
      sourceUploadedMessageId: null,
      sourceUploadedOrdinal: null,
    });
    expect(result).toEqual({
      userMessageId: MESSAGE_ID,
      assistantMessageId: DERIVATIVE_ID,
      generatedImageId: SOURCE_ID,
    });
    expect(setup.serviceClient.rpc).toHaveBeenCalledWith(
      "complete_generated_image_edit",
      expect.objectContaining({
        p_authenticated_user_id: USER_ID,
        p_source_generated_image_id: SOURCE_ID,
      }),
    );
  });
});
