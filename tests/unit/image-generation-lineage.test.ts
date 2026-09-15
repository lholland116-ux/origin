import { describe, expect, it } from "vitest";
import { validateImageEditRequest } from "@/lib/image-generation/validation";
import {
  IMAGE_EDIT_OPERATION,
  validateImageEditLineage,
  validateImageEditSourceReference,
} from "@/lib/image-generation/lineage";
import type {
  ImageEditingProvider,
  ImageGenerationResult,
} from "@/lib/image-generation/provider";

const GENERATED_IMAGE_ID = "40000000-0000-4000-8000-000000000001";
const FIRST_EDIT_ID = "40000000-0000-4000-8000-000000000002";
const SECOND_EDIT_ID = "40000000-0000-4000-8000-000000000003";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";

function generatedSource(generatedImageId = GENERATED_IMAGE_ID) {
  return { kind: "generated_image", generatedImageId } as const;
}

function uploadedSource(messageId = MESSAGE_ID, ordinal = 1) {
  return { kind: "uploaded_image", messageId, ordinal } as const;
}

function validEditRequest(overrides: Record<string, unknown> = {}) {
  return {
    sourceImage: {
      bytes: new Uint8Array([1, 2, 3]),
      mimeType: "image/webp",
    },
    instruction: "Make the sky warmer.",
    ...overrides,
  };
}

describe("image-editing contracts and lineage", () => {
  it("accepts and discriminates generated-image and uploaded-image sources", () => {
    const generated = validateImageEditSourceReference(generatedSource());
    const uploaded = validateImageEditSourceReference(uploadedSource());

    expect(generated).toEqual({ success: true, source: generatedSource() });
    expect(uploaded).toEqual({ success: true, source: uploadedSource() });
    expect(generated.success && generated.source.kind).toBe("generated_image");
    expect(uploaded.success && uploaded.source.kind).toBe("uploaded_image");
  });

  it.each([
    { kind: "generated_image", generatedImageId: "" },
    { kind: "generated_image", generatedImageId: "   " },
  ])("rejects a generated source without a non-empty generatedImageId", (source) => {
    expect(validateImageEditSourceReference(source).success).toBe(false);
  });

  it("rejects an uploaded source without a non-empty messageId", () => {
    expect(
      validateImageEditSourceReference({
        kind: "uploaded_image",
        messageId: " \n",
        ordinal: 1,
      }).success,
    ).toBe(false);
  });

  it.each([0, -1, 1.5, NaN, Infinity, "1"])(
    "rejects uploaded ordinal %s because repository ordinals are one-based safe integers",
    (ordinal) => {
      expect(
        validateImageEditSourceReference(uploadedSource(MESSAGE_ID, ordinal as number)),
      ).toMatchObject({ success: false });
    },
  );

  it("does not accept storage paths or URLs as logical source references", () => {
    expect(
      validateImageEditSourceReference(
        generatedSource("generated/user/conversation/image.webp"),
      ).success,
    ).toBe(false);
    expect(
      validateImageEditSourceReference(
        uploadedSource("https://signed.example/image.webp"),
      ).success,
    ).toBe(false);
  });

  it("rejects ambiguous source objects that claim both source classes", () => {
    expect(
      validateImageEditSourceReference({
        kind: "generated_image",
        generatedImageId: GENERATED_IMAGE_ID,
        messageId: MESSAGE_ID,
        ordinal: 1,
      }).success,
    ).toBe(false);
    expect(
      validateImageEditSourceReference({
        kind: "uploaded_image",
        messageId: MESSAGE_ID,
        ordinal: 1,
        generatedImageId: GENERATED_IMAGE_ID,
      }).success,
    ).toBe(false);
  });

  it("preserves the exact human instruction and requires an explicit edit operation", () => {
    const instruction = "  Keep the subject unchanged; add a soft blue glow.  ";
    const result = validateImageEditLineage({
      operation: IMAGE_EDIT_OPERATION,
      source: generatedSource(),
      derivativeGeneratedImageId: FIRST_EDIT_ID,
      instruction,
    });

    expect(result).toEqual({
      success: true,
      lineage: {
        operation: "edit",
        source: generatedSource(),
        derivativeGeneratedImageId: FIRST_EDIT_ID,
        instruction,
      },
    });
    expect(
      validateImageEditLineage({
        operation: "generate",
        source: generatedSource(),
        derivativeGeneratedImageId: FIRST_EDIT_ID,
        instruction: "Edit this image.",
      }).success,
    ).toBe(false);
  });

  it("requires a derivative generated-image identity", () => {
    expect(
      validateImageEditLineage({
        operation: IMAGE_EDIT_OPERATION,
        source: generatedSource(),
        derivativeGeneratedImageId: " ",
        instruction: "Edit this image.",
      }).success,
    ).toBe(false);
  });

  it.each(["", " \n\t"])("rejects an empty edit instruction", (instruction) => {
    expect(
      validateImageEditLineage({
        operation: IMAGE_EDIT_OPERATION,
        source: generatedSource(),
        derivativeGeneratedImageId: FIRST_EDIT_ID,
        instruction,
      }).success,
    ).toBe(false);
  });

  it("validates provider edit input with supported source MIME and existing request boundaries", () => {
    const request = validateImageEditRequest({
      ...validEditRequest(),
      model: "flux-schnell",
      aspectRatio: "1:1",
      seed: 42,
    });

    expect(request).toMatchObject({
      success: true,
      request: {
        instruction: "Make the sky warmer.",
        sourceImage: { mimeType: "image/webp" },
        model: "flux-schnell",
        aspectRatio: "1:1",
        seed: 42,
      },
    });
    expect(validateImageEditRequest(validEditRequest({
      sourceImage: { bytes: new Uint8Array([1]), mimeType: "image/gif" },
    })).success).toBe(false);
    expect(validateImageEditRequest(validEditRequest({
      sourceImage: { bytes: new Uint8Array(), mimeType: "image/webp" },
    })).success).toBe(false);
    expect(validateImageEditRequest(validEditRequest({ storagePath: "user/image.webp" })).success).toBe(false);
    expect(validateImageEditRequest(validEditRequest({ sourceUrl: "https://signed.example/image.webp" })).success).toBe(false);
  });

  it("keeps editing as a separate provider contract while reusing the normalized result", async () => {
    const result: ImageGenerationResult = {
      provider: "test-editor",
      model: "test-model",
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    };
    const provider: ImageEditingProvider = {
      async editImage() {
        return result;
      },
    };

    await expect(
      provider.editImage({
        sourceImage: { bytes: new Uint8Array([4]), mimeType: "image/webp" },
        instruction: "Edit this image.",
      }),
    ).resolves.toBe(result);
  });

  it("represents uploaded-to-edit, generated-to-edit, and edit-to-edit without mutating prior lineage", () => {
    const uploadedEdit = {
      operation: IMAGE_EDIT_OPERATION,
      source: uploadedSource(),
      derivativeGeneratedImageId: FIRST_EDIT_ID,
      instruction: "Remove the background.",
    };
    const generatedEdit = {
      operation: IMAGE_EDIT_OPERATION,
      source: generatedSource(),
      derivativeGeneratedImageId: FIRST_EDIT_ID,
      instruction: "Add a sunset.",
    };
    const nextEdit = {
      operation: IMAGE_EDIT_OPERATION,
      source: generatedSource(FIRST_EDIT_ID),
      derivativeGeneratedImageId: SECOND_EDIT_ID,
      instruction: "Add soft rain.",
    };

    const priorGeneratedEdit = structuredClone(generatedEdit);
    expect(validateImageEditLineage(uploadedEdit).success).toBe(true);
    expect(validateImageEditLineage(generatedEdit).success).toBe(true);
    expect(validateImageEditLineage(nextEdit).success).toBe(true);
    expect(generatedEdit).toEqual(priorGeneratedEdit);
    expect(generatedEdit.derivativeGeneratedImageId).not.toBe(nextEdit.derivativeGeneratedImageId);
  });
});
