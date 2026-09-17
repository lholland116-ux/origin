import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildImageEditRequestBody,
  getImageEditErrorMessage,
  getUploadedImageEditSourceReference,
  isEligibleUploadedMessageImage,
  type ImageEditOperation,
  type MessageImage,
} from "@/app/chat/ChatClient";
import { getImageEditInstructionError } from "@/components/chat/ImageEditDialog";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const dialogSource = readFileSync("components/chat/ImageEditDialog.tsx", "utf8");
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const GENERATED_IMAGE_ID = "30000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "40000000-0000-4000-8000-000000000001";
const IMAGE_URL = "https://example.test/source.png";

const operation: Pick<
  ImageEditOperation,
  "conversationId" | "sourceReference" | "instruction"
> = {
  conversationId: CONVERSATION_ID,
  sourceReference: {
    kind: "generated_image",
    generatedImageId: GENERATED_IMAGE_ID,
  },
  instruction: "Remove the red mug without changing the table.",
};

function uploadedImage(ordinal?: number): MessageImage {
  return {
    image_path: "user/conversation/uploaded/source.png",
    image_name: "source.png",
    image_url: IMAGE_URL,
    ...(ordinal === undefined ? {} : { ordinal }),
  };
}

describe("image-edit UI contracts", () => {
  it("posts a generated-image identity and exact instruction without client-controlled storage data", () => {
    const body = buildImageEditRequestBody(operation, "50000000-0000-4000-8000-000000000001");

    expect(body).toEqual({
      conversationId: CONVERSATION_ID,
      sourceReference: {
        kind: "generated_image",
        generatedImageId: GENERATED_IMAGE_ID,
      },
      instruction: operation.instruction,
      idempotencyKey: "50000000-0000-4000-8000-000000000001",
    });
    expect(Object.keys(body).sort()).toEqual([
      "conversationId",
      "idempotencyKey",
      "instruction",
      "sourceReference",
    ]);
  });

  it("uses one-based durable ordinals for uploaded-image sources and rejects unsafe identities", () => {
    const image = uploadedImage(2);
    expect(isEligibleUploadedMessageImage(image)).toBe(true);
    expect(getUploadedImageEditSourceReference(MESSAGE_ID, image)).toEqual({
      kind: "uploaded_image",
      messageId: MESSAGE_ID,
      ordinal: 2,
    });

    expect(getUploadedImageEditSourceReference(MESSAGE_ID, uploadedImage())).toBeNull();
    expect(getUploadedImageEditSourceReference(MESSAGE_ID, uploadedImage(0))).toBeNull();
    expect(getUploadedImageEditSourceReference(MESSAGE_ID, uploadedImage(Number.NaN))).toBeNull();
    expect(getUploadedImageEditSourceReference(MESSAGE_ID, uploadedImage(Number.POSITIVE_INFINITY))).toBeNull();
    expect(getUploadedImageEditSourceReference(MESSAGE_ID, uploadedImage(1.5))).toBeNull();
    expect(getUploadedImageEditSourceReference("", image)).toBeNull();
  });

  it("preserves exact instructions and enforces the client validation boundary", () => {
    const exactInstruction = "  Keep this spacing exactly.  ";
    const exactOperation = { ...operation, instruction: exactInstruction };

    expect(getImageEditInstructionError(exactInstruction)).toBeNull();
    expect(
      buildImageEditRequestBody(exactOperation, "50000000-0000-4000-8000-000000000002").instruction,
    ).toBe(exactInstruction);
    expect(getImageEditInstructionError(" ")).toBe("Enter an instruction for this image.");
    expect(getImageEditInstructionError("x".repeat(4000))).toBeNull();
    expect(getImageEditInstructionError("x".repeat(4001))).toBe(
      "Instruction too long. Maximum 4000 characters.",
    );
  });

  it("maps bounded server outcomes without exposing raw backend or provider messages", () => {
    expect(getImageEditErrorMessage(404, "IMAGE_EDIT_SOURCE_UNAVAILABLE")).toEqual({
      message: "This image is no longer available to edit.",
      canRetry: false,
    });
    expect(getImageEditErrorMessage(409, "IMAGE_EDIT_IDEMPOTENCY_CONFLICT").canRetry).toBe(false);
    expect(getImageEditErrorMessage(410, "IMAGE_EDIT_RESULT_UNAVAILABLE").canRetry).toBe(false);
    expect(getImageEditErrorMessage(502, "IMAGE_EDIT_PROVIDER_FAILURE")).toEqual({
      message: "Image editing could not be completed. Try again.",
      canRetry: true,
    });
    expect(getImageEditErrorMessage(504, "IMAGE_EDIT_PROVIDER_TIMEOUT").canRetry).toBe(true);
    expect(getImageEditErrorMessage(429, "IMAGE_DAILY_LIMIT_REACHED", "free").message).toBe(
      "Daily image limit reached. Come back tomorrow or upgrade to Pro.",
    );
    expect(getImageEditErrorMessage(500, "INTERNAL_ERROR").message).not.toContain("INTERNAL_ERROR");
    expect(getImageEditErrorMessage(500, "INTERNAL_ERROR").message).not.toContain("provider");
  });

  it("keeps successful completion on durable message refresh and prevents concurrent POSTs", () => {
    expect(clientSource).toContain('fetch("/api/image-edit"');
    expect(clientSource).toContain("await refreshMessagesForConversation(");
    expect(clientSource).toContain("if (response.ok && response.status === 200 && responseStatus === \"completed\")");
    expect(clientSource).toContain("imageEditInFlightRef.current = true;");
    expect(clientSource).toContain("if (imageEditInFlightRef.current) return;");
    expect(clientSource).toContain("setImageEditOperationState(null);");
  });

  it("retains one operation key for accepted-in-progress retries and blocks conversation changes during POST", () => {
    expect(clientSource).toContain('response.status === 202 && responseStatus === "in_progress"');
    expect(clientSource).toContain("const idempotencyKey = current.idempotencyKey ?? createId();");
    expect(clientSource).toContain("status: \"in_progress\"");
    expect(clientSource).toContain("imageEditInFlightRef.current ||");
    expect(clientSource).toContain("if (loading || imageEditInFlightRef.current) return;");
  });

  it("exposes edit actions for generated images and ordinal-qualified uploaded images only", () => {
    expect(clientSource).toContain('aria-label="Edit image"');
    expect(clientSource).toContain('aria-label="Edit uploaded image"');
    expect(clientSource).toContain("getUploadedImageEditSourceReference(message.id, image)");
    expect(clientSource).toContain('kind: "generated_image"');
    expect(clientSource).toContain('imageEditOperation?.status === "submitting"');
  });

  it("provides an accessible focused dialog with touch-safe close and status behavior", () => {
    expect(dialogSource).toContain('role="dialog"');
    expect(dialogSource).toContain('aria-modal="true"');
    expect(dialogSource).toContain("aria-labelledby={titleId}");
    expect(dialogSource).toContain("aria-describedby={descriptionId}");
    expect(dialogSource).toContain("aria-busy={isSubmitting}");
    expect(dialogSource).toContain('aria-live="polite"');
    expect(dialogSource).toContain('aria-label="Close image edit dialog"');
    expect(dialogSource).toContain('event.key === "Escape"');
    expect(dialogSource).toContain("instructionRef.current?.focus()");
  });
});
