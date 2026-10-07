import { describe, expect, it } from "vitest";
import {
  buildOptimisticImageAttachments,
  getMaxPendingImages,
  getMessageImageSource,
  getLatestEditableImageContext,
  hasCanonicalChildImages,
  normalizeMessageImages,
  getUploadedImageEditSourceReference,
  reconcileSubmittedImageMessage,
  shouldApplyMessageLoad,
  type MessageImage,
  type PendingImage,
} from "@/app/chat/ChatClient";
import { selectIntelligenceRoute } from "@/lib/ai/intelligence-router";

const pendingImage = (id: string): PendingImage => ({
  id,
  name: `${id}.jpg`,
  path: `user/${id}`,
  previewUrl: `data:image/jpeg;base64,${id}`,
});

const durableImage = (id: string, ordinal?: number): MessageImage => ({
  image_path: `user/${id}`,
  image_name: `${id}.jpg`,
  image_url: `https://signed.example/${id}`,
  ...(ordinal === undefined ? {} : { ordinal }),
});

describe("durable multi-image chat history", () => {
  it("renders child images before a legacy singular image", () => {
    const message = {
      images: [durableImage("one")],
      has_child_images: true,
      image_url: "https://signed.example/legacy",
    };

    expect(getMessageImageSource(message)).toBe("children");
    expect(hasCanonicalChildImages(message)).toBe(true);
  });

  it("uses the legacy image when no child images exist", () => {
    expect(
      getMessageImageSource({
        images: [],
        has_child_images: false,
        image_url: "https://signed.example/legacy",
      })
    ).toBe("legacy");
  });

  it("does not duplicate a message that contains both representations", () => {
    const message = {
      images: [durableImage("one"), durableImage("two")],
      has_child_images: true,
      image_url: "https://signed.example/legacy",
    };

    expect(getMessageImageSource(message)).toBe("children");
    expect(normalizeMessageImages(message.images)).toHaveLength(2);
  });

  it("keeps optimistic and durable arrays compatible and ordered", () => {
    const optimistic = buildOptimisticImageAttachments([
      pendingImage("one"),
      pendingImage("two"),
      pendingImage("three"),
    ]);
    const durable = normalizeMessageImages([
      durableImage("one"),
      durableImage("two"),
      durableImage("three"),
    ]);

    expect(optimistic.map((image) => [image.image_path, image.image_name])).toEqual(
      durable.map((image) => [image.image_path, image.image_name])
    );
    expect(durable.map((image) => image.image_url)).toEqual([
      "https://signed.example/one",
      "https://signed.example/two",
      "https://signed.example/three",
    ]);
    expect(optimistic.every((image) => image.ordinal === undefined)).toBe(true);
  });

  it("preserves authoritative uploaded ordinals without using presentation position", () => {
    const durable = normalizeMessageImages([
      durableImage("three", 3),
      durableImage("one", 1),
    ]);

    expect(durable.map((image) => image.ordinal)).toEqual([3, 1]);
  });

  it("does not truncate historical images after a plan downgrade", () => {
    const historical = normalizeMessageImages([
      durableImage("one"),
      durableImage("two"),
      durableImage("three"),
    ]);

    expect(getMaxPendingImages("free")).toBe(1);
    expect(historical).toHaveLength(3);
  });

  it("replaces conversation state only for the latest load generation", () => {
    const conversationA = [durableImage("a")];
    const conversationB = [durableImage("b")];
    let messages = conversationA;

    if (shouldApplyMessageLoad(1, 2)) {
      messages = conversationA;
    }
    if (shouldApplyMessageLoad(2, 2)) {
      messages = conversationB;
    }

    expect(messages).toEqual(conversationB);
    expect(shouldApplyMessageLoad(1, 2)).toBe(false);
  });

  it("reconciles the accepted live message with its persisted identity and ordinals", () => {
    const optimisticUser = {
      id: "optimistic-user",
      role: "user" as const,
      content: "Review these images.",
      images: buildOptimisticImageAttachments([
        pendingImage("one"),
        pendingImage("two"),
      ]),
    };
    const persistedMessageId = "40000000-0000-4000-8000-000000000001";
    const reconciled = reconcileSubmittedImageMessage(
      [
        optimisticUser,
        { id: "optimistic-assistant", role: "assistant", content: "" },
      ],
      optimisticUser.id,
      persistedMessageId,
      [pendingImage("one"), pendingImage("two")],
    );

    expect(reconciled).toHaveLength(2);
    expect(reconciled.map((message) => message.id)).toEqual([
      persistedMessageId,
      "optimistic-assistant",
    ]);
    expect(reconciled[0]).toMatchObject({ has_child_images: true });
    expect(reconciled[0].images?.map((image) => image.ordinal)).toEqual([1, 2]);
    expect(
      getUploadedImageEditSourceReference(
        reconciled[0].id,
        reconciled[0].images?.[1] as MessageImage,
      ),
    ).toEqual({
      kind: "uploaded_image",
      messageId: persistedMessageId,
      ordinal: 2,
    });
    expect(reconciled[0].images?.map((image) => image.image_path)).toEqual([
      "user/one",
      "user/two",
    ]);
  });

  it("resolves the newest persisted editable image context without changing attachment metadata", () => {
    expect(
      getLatestEditableImageContext([
        {
          id: "older-user",
          role: "user",
          content: "Original image",
          images: [durableImage("older", 1)],
        },
        {
          id: "newer-assistant",
          role: "assistant",
          content: "Generated image",
          generatedImage: {
            id: "generated-image-id",
            url: "https://signed.example/generated",
            mimeType: "image/png",
          },
        },
      ]),
    ).toEqual({
      sourceReference: {
        kind: "generated_image",
        generatedImageId: "generated-image-id",
      },
      sourcePreview: "https://signed.example/generated",
      sourceLabel: "Generated image",
    });

    expect(
      getLatestEditableImageContext([
        {
          id: "legacy-user",
          role: "user",
          content: "Legacy image without durable ordinal",
          images: [durableImage("legacy")],
        },
      ]),
    ).toBeNull();
  });

  it("selects the deterministic newest generated image when a message has multiple images", () => {
    expect(
      getLatestEditableImageContext([
        {
          id: "assistant-with-images",
          role: "assistant",
          content: "",
          generatedImages: [
            {
              id: "older-generated-image",
              url: "https://signed.example/older.webp",
              mimeType: "image/webp",
            },
            {
              id: "newer-generated-image",
              url: "https://signed.example/newer.webp",
              mimeType: "image/png",
            },
          ],
        },
      ]),
    ).toEqual({
      sourceReference: {
        kind: "generated_image",
        generatedImageId: "newer-generated-image",
      },
      sourcePreview: "https://signed.example/newer.webp",
      sourceLabel: "Generated image",
    });
  });

  it("does not turn passive multi-image history into edit intent for unrelated prompts", () => {
    const imageContext = getLatestEditableImageContext([
      {
        id: "assistant-with-images",
        role: "assistant",
        content: "",
        generatedImages: [
          {
            id: "generated-a",
            url: "https://signed.example/a.webp",
            mimeType: "image/webp",
          },
          {
            id: "generated-b",
            url: "https://signed.example/b.webp",
            mimeType: "image/png",
          },
        ],
      },
    ]);

    expect(
      selectIntelligenceRoute({
        mode: "auto",
        prompt: "What should I change on my website?",
        hasImageContext: Boolean(imageContext),
        hasImageAttachment: false,
      }),
    ).toEqual({ route: "standard", reason: "default_standard" });
  });
});
