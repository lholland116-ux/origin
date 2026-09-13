import { describe, expect, it } from "vitest";
import {
  assertStoredImageCount,
  buildImageInputContent,
  ChatImageValidationError,
  normalizeChatImageInput,
  validateStoredImagePath,
} from "../../lib/chat/chat-image-attachments";

const USER_ID = "10000000-0000-4000-8000-000000000001";

function normalize(params: Record<string, unknown> = {}) {
  return normalizeChatImageInput({
    userId: USER_ID,
    ...params,
  });
}

describe("chat image attachment normalization", () => {
  it("normalizes a request without images", () => {
    expect(normalize()).toEqual({ source: "none", images: [] });
  });

  it("preserves the legacy singular image representation", () => {
    expect(
      normalize({
        imageBase64: "data:image/jpeg;base64,encoded",
        imagePath: `${USER_ID}/legacy.jpg`,
        imageName: "legacy.jpg",
      })
    ).toEqual({
      source: "legacy",
      imageBase64: "data:image/jpeg;base64,encoded",
      imagePath: `${USER_ID}/legacy.jpg`,
      imageName: "legacy.jpg",
    });
  });

  it("normalizes stored image metadata in order", () => {
    expect(
      normalize({
        images: [
          { imagePath: `${USER_ID}/one.jpg`, imageName: "one.jpg" },
          { imagePath: `${USER_ID}/two.png`, imageName: "two.png" },
        ],
      })
    ).toEqual({
      source: "stored",
      images: [
        { imagePath: `${USER_ID}/one.jpg`, imageName: "one.jpg" },
        { imagePath: `${USER_ID}/two.png`, imageName: "two.png" },
      ],
    });
  });

  it("rejects malformed arrays and array items containing base64", () => {
    expect(() => normalize({ images: "not-an-array" })).toThrowError(
      expect.objectContaining({ code: "INVALID_IMAGES" })
    );
    expect(() =>
      normalize({
        images: [
          {
            imagePath: `${USER_ID}/one.jpg`,
            imageName: "one.jpg",
            imageBase64: "data:image/jpeg;base64,encoded",
          },
        ],
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_IMAGES" }));
  });

  it("rejects mixed legacy and stored image representations", () => {
    expect(() =>
      normalize({
        imageBase64: "data:image/jpeg;base64,encoded",
        images: [{ imagePath: `${USER_ID}/one.jpg`, imageName: "one.jpg" }],
      })
    ).toThrowError(expect.objectContaining({ code: "MIXED_IMAGE_INPUT" }));
  });

  it("rejects duplicate paths and invalid path shapes", () => {
    expect(() =>
      normalize({
        images: [
          { imagePath: `${USER_ID}/one.jpg`, imageName: "one.jpg" },
          { imagePath: `${USER_ID}/one.jpg`, imageName: "copy.jpg" },
        ],
      })
    ).toThrowError(expect.objectContaining({ code: "DUPLICATE_IMAGE" }));

    for (const imagePath of [
      `${USER_ID}/../other.jpg`,
      `${USER_ID}\\other.jpg`,
      `${USER_ID}//other.jpg`,
      `other-user/other.jpg`,
    ]) {
      expect(() => validateStoredImagePath(imagePath, USER_ID)).toThrow(
        ChatImageValidationError
      );
    }
  });

  it("rejects overlong stored image metadata", () => {
    expect(() =>
      normalize({
        images: [
          {
            imagePath: `${USER_ID}/one.jpg`,
            imageName: "x".repeat(256),
          },
        ],
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_IMAGES" }));

    expect(() =>
      normalize({
        images: [
          {
            imagePath: `${USER_ID}/${"x".repeat(501)}`,
            imageName: "one.jpg",
          },
        ],
      })
    ).toThrowError(expect.objectContaining({ code: "INVALID_IMAGE" }));
  });

  it("enforces Free and Pro image limits without truncation", () => {
    const twoImages = [
      { imagePath: `${USER_ID}/one.jpg`, imageName: "one.jpg" },
      { imagePath: `${USER_ID}/two.jpg`, imageName: "two.jpg" },
    ];
    const threeImages = [
      ...twoImages,
      { imagePath: `${USER_ID}/three.jpg`, imageName: "three.jpg" },
    ];

    expect(() => assertStoredImageCount(twoImages, "free")).toThrowError(
      expect.objectContaining({ code: "IMAGE_LIMIT_EXCEEDED" })
    );
    expect(() => assertStoredImageCount(threeImages, "pro")).not.toThrow();
    expect(() => assertStoredImageCount([...threeImages, ...twoImages], "pro"))
      .toThrowError(expect.objectContaining({ code: "IMAGE_LIMIT_EXCEEDED" }));
  });

  it("builds ordered input_image items from resolved URLs only", () => {
    const content = buildImageInputContent("Inspect these images.", [
      "https://signed.example/one",
      "https://signed.example/two",
    ]);

    expect(content).toEqual([
      { type: "input_text", text: "Inspect these images." },
      { type: "input_image", image_url: "https://signed.example/one", detail: "auto" },
      { type: "input_image", image_url: "https://signed.example/two", detail: "auto" },
    ]);
    expect(JSON.stringify(content)).not.toContain("imageBase64");
    expect(JSON.stringify(content)).not.toContain("imagePath");
  });
});
