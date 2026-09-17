import { describe, expect, it, vi } from "vitest";
import {
  createImageEditRequestFingerprint,
  type ImageEditFinalizerInput,
} from "../../lib/image-generation/image-edit-orchestrator";
import {
  createImageEditFinalizer as createImageEditFinalizerFactory,
  ImageEditFinalizerError,
  type ImageEditFinalizerRpcClient,
} from "../../lib/image-generation/image-edit-finalizer";
import {
  RUNWARE_IMAGE_EDIT_MODEL,
  RUNWARE_IMAGE_EDIT_PROVIDER,
} from "../../lib/image-generation/config";

const REQUEST_ID = "11111111-1111-4111-8111-111111111111";
const ATTEMPT_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "33333333-3333-4333-8333-333333333333";
const GENERATED_SOURCE_ID = "44444444-4444-4444-8444-444444444444";
const UPLOADED_MESSAGE_ID = "55555555-5555-4555-8555-555555555555";
const USER_MESSAGE_ID = "66666666-6666-4666-8666-666666666666";
const ASSISTANT_MESSAGE_ID = "77777777-7777-4777-8777-777777777777";
const GENERATED_IMAGE_ID = "88888888-8888-4888-8888-888888888888";
const AUTHENTICATED_USER_ID = "99999999-9999-4999-8999-999999999999";
const INSTRUCTION = "  Remove the red mug and preserve the subject.  ";
const STORAGE_PATH =
  "generated/11111111-1111-4111-8111-111111111111/33333333-3333-4333-8333-333333333333/edit.png";

const GENERATED_INPUT: ImageEditFinalizerInput = {
  imageEditRequestId: REQUEST_ID,
  attemptId: ATTEMPT_ID,
  conversationId: CONVERSATION_ID,
  sourceReference: {
    kind: "generated_image",
    generatedImageId: GENERATED_SOURCE_ID,
  },
  instruction: INSTRUCTION,
  storagePath: STORAGE_PATH,
  mimeType: "image/png",
  provider: RUNWARE_IMAGE_EDIT_PROVIDER,
  model: RUNWARE_IMAGE_EDIT_MODEL,
  sourceGeneratedImageId: GENERATED_SOURCE_ID,
  sourceUploadedMessageId: null,
  sourceUploadedOrdinal: null,
};

const UPLOADED_INPUT: ImageEditFinalizerInput = {
  ...GENERATED_INPUT,
  sourceReference: {
    kind: "uploaded_image",
    messageId: UPLOADED_MESSAGE_ID,
    ordinal: 1,
  },
  sourceGeneratedImageId: null,
  sourceUploadedMessageId: UPLOADED_MESSAGE_ID,
  sourceUploadedOrdinal: 1,
};

const SUCCESS_ROW = {
  user_message_id: USER_MESSAGE_ID,
  assistant_message_id: ASSISTANT_MESSAGE_ID,
  generated_image_id: GENERATED_IMAGE_ID,
};

function makeRpcClient(
  response: { data: unknown; error: unknown } = {
    data: [SUCCESS_ROW],
    error: null,
  },
) {
  const rpc = vi.fn(
    async (
      ..._args: Parameters<ImageEditFinalizerRpcClient["rpc"]>
    ): Promise<Awaited<ReturnType<ImageEditFinalizerRpcClient["rpc"]>>> => {
      void _args;
      return response;
    },
  );
  return {
    client: { rpc } as ImageEditFinalizerRpcClient,
    rpc,
  };
}

function createImageEditFinalizer(
  client: ImageEditFinalizerRpcClient,
  authenticatedUserId = AUTHENTICATED_USER_ID,
) {
  return createImageEditFinalizerFactory(client, authenticatedUserId);
}

function expectedArgs(input: ImageEditFinalizerInput): Record<string, unknown> {
  const fingerprint = createImageEditRequestFingerprint({
    conversationId: input.conversationId,
    sourceReference: input.sourceReference,
    instruction: input.instruction,
  });

  return {
    p_authenticated_user_id: AUTHENTICATED_USER_ID,
    p_image_edit_request_id: input.imageEditRequestId,
    p_request_fingerprint: fingerprint,
    p_attempt_id: input.attemptId,
    p_conversation_id: input.conversationId,
    p_instruction: input.instruction,
    p_storage_path: input.storagePath,
    p_mime_type: input.mimeType,
    p_provider: input.provider,
    p_model: input.model,
    p_source_generated_image_id:
      input.sourceReference.kind === "generated_image"
        ? input.sourceReference.generatedImageId
        : null,
    p_source_uploaded_message_id:
      input.sourceReference.kind === "uploaded_image"
        ? input.sourceReference.messageId
        : null,
    p_source_uploaded_ordinal:
      input.sourceReference.kind === "uploaded_image"
        ? input.sourceReference.ordinal
        : null,
  };
}

async function expectFinalizerError(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(ImageEditFinalizerError);
}

describe("image edit finalizer", () => {
  it("captures trusted authenticated identity in the service RPC payload", async () => {
    const { client, rpc } = makeRpcClient();
    const finalizer = createImageEditFinalizerFactory(client, AUTHENTICATED_USER_ID);

    await finalizer(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_authenticated_user_id: AUTHENTICATED_USER_ID,
    });
    expect(rpc.mock.calls[0]?.[1]).not.toHaveProperty("authenticatedUserId");
  });

  it("rejects an invalid trusted authenticated identity at factory creation", () => {
    expect(() =>
      createImageEditFinalizerFactory(
        makeRpcClient().client,
        "not-a-user-id",
      ),
    ).toThrow(ImageEditFinalizerError);
  });

  it("calls the sole authoritative RPC by its exact name", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc.mock.calls[0]?.[0]).toBe("complete_generated_image_edit");
  });

  it("maps the image-edit request identity", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_image_edit_request_id: REQUEST_ID,
    });
  });

  it("recomputes and maps the canonical request fingerprint", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject(expectedArgs(GENERATED_INPUT));
  });

  it("maps the attempt and conversation identities", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_attempt_id: ATTEMPT_ID,
      p_conversation_id: CONVERSATION_ID,
    });
  });

  it("preserves the exact instruction without trimming it", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_instruction: INSTRUCTION,
    });
  });

  it("maps the server-resolved storage path", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_storage_path: STORAGE_PATH,
    });
  });

  it("maps the fixed PNG MIME type", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_mime_type: "image/png",
    });
  });

  it("maps the fixed Runware provider", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_provider: "runware",
    });
  });

  it("maps the fixed Runware model", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_model: "runware:400@4",
    });
  });

  it("maps a generated source and clears uploaded source parameters", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_source_generated_image_id: GENERATED_SOURCE_ID,
      p_source_uploaded_message_id: null,
      p_source_uploaded_ordinal: null,
    });
  });

  it("maps an uploaded source and clears generated source parameters", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(UPLOADED_INPUT);

    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_source_generated_image_id: null,
      p_source_uploaded_message_id: UPLOADED_MESSAGE_ID,
      p_source_uploaded_ordinal: 1,
    });
  });

  it("maps every generated-source argument as one exact payload", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc).toHaveBeenCalledWith(
      "complete_generated_image_edit",
      expectedArgs(GENERATED_INPUT),
    );
  });

  it("maps every uploaded-source argument as one exact payload", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(UPLOADED_INPUT);

    expect(rpc).toHaveBeenCalledWith(
      "complete_generated_image_edit",
      expectedArgs(UPLOADED_INPUT),
    );
  });

  it("returns exactly the three durable IDs", async () => {
    const { client } = makeRpcClient();

    await expect(createImageEditFinalizer(client)(GENERATED_INPUT)).resolves.toEqual(
      {
        userMessageId: USER_MESSAGE_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        generatedImageId: GENERATED_IMAGE_ID,
      },
    );
  });

  it("normalizes successful UUID results", async () => {
    const { client } = makeRpcClient({
      data: [
        {
          user_message_id: USER_MESSAGE_ID.toUpperCase(),
          assistant_message_id: ASSISTANT_MESSAGE_ID.toUpperCase(),
          generated_image_id: GENERATED_IMAGE_ID.toUpperCase(),
        },
      ],
      error: null,
    });

    await expect(createImageEditFinalizer(client)(GENERATED_INPUT)).resolves.toEqual(
      {
        userMessageId: USER_MESSAGE_ID,
        assistantMessageId: ASSISTANT_MESSAGE_ID,
        generatedImageId: GENERATED_IMAGE_ID,
      },
    );
  });

  it("maps an RPC error to a controlled persistence failure", async () => {
    const { client } = makeRpcClient({
      data: null,
      error: { code: "P0001", message: "secret database detail" },
    });

    await expectFinalizerError(createImageEditFinalizer(client)(GENERATED_INPUT));
  });

  it("maps an RPC throw to a controlled persistence failure", async () => {
    const rpc = vi.fn(
      async (
        ..._args: Parameters<ImageEditFinalizerRpcClient["rpc"]>
      ): Promise<Awaited<ReturnType<ImageEditFinalizerRpcClient["rpc"]>>> => {
      void _args;
      throw new Error("secret database detail");
      },
    );

    await expectFinalizerError(
      createImageEditFinalizer({ rpc } as ImageEditFinalizerRpcClient)(GENERATED_INPUT),
    );
  });

  it.each([null, undefined])("rejects %s RPC data", async (data) => {
    const { client } = makeRpcClient({ data, error: null });

    await expectFinalizerError(createImageEditFinalizer(client)(GENERATED_INPUT));
  });

  it("rejects an empty RPC result", async () => {
    const { client } = makeRpcClient({ data: [], error: null });

    await expectFinalizerError(createImageEditFinalizer(client)(GENERATED_INPUT));
  });

  it("rejects multiple RPC result rows", async () => {
    const { client } = makeRpcClient({
      data: [SUCCESS_ROW, SUCCESS_ROW],
      error: null,
    });

    await expectFinalizerError(createImageEditFinalizer(client)(GENERATED_INPUT));
  });

  it("rejects a malformed RPC result object", async () => {
    const { client } = makeRpcClient({
      data: [{ user_message_id: USER_MESSAGE_ID }],
      error: null,
    });

    await expectFinalizerError(createImageEditFinalizer(client)(GENERATED_INPUT));
  });

  it("rejects an invalid durable UUID", async () => {
    const { client } = makeRpcClient({
      data: [
        {
          ...SUCCESS_ROW,
          generated_image_id: "not-a-uuid",
        },
      ],
      error: null,
    });

    await expectFinalizerError(createImageEditFinalizer(client)(GENERATED_INPUT));
  });

  it("never exposes raw RPC error details", async () => {
    const { client } = makeRpcClient({
      data: null,
      error: { code: "SECRET_CODE", message: "secret database detail" },
    });

    const error = await createImageEditFinalizer(client)(GENERATED_INPUT).catch(
      (value: unknown) => value,
    );

    expect(error).toBeInstanceOf(ImageEditFinalizerError);
    expect(error).not.toHaveProperty("cause");
    expect((error as Error).message).not.toContain("secret");
    expect((error as Error).message).toBe("The image edit could not be saved.");
  });

  it("performs no work other than the injected RPC call", async () => {
    const { client, rpc } = makeRpcClient();

    await createImageEditFinalizer(client)(GENERATED_INPUT);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(Object.keys(client)).toEqual(["rpc"]);
  });
});
