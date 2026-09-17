import { describe, expect, it } from "vitest";
import {
  buildOptimisticImageAttachments,
  getMaxPendingImages,
  getMessageImageSource,
  hasCanonicalChildImages,
  normalizeMessageImages,
  shouldApplyMessageLoad,
  type MessageImage,
  type PendingImage,
} from "@/app/chat/ChatClient";

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
});
