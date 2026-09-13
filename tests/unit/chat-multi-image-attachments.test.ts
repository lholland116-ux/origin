import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildOptimisticImageAttachments,
  buildStoredImagePayload,
  canAddPendingImages,
  canSubmitWithPendingImages,
  getMaxPendingImages,
  getPendingImageCleanupPaths,
  removePendingImage,
  removeSubmittedPendingImages,
  restorePendingImageSnapshot,
  rollbackOptimisticMessages,
  validateImageBatch,
  type PendingImage,
} from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");

const image = (id: string, name = `${id}.jpg`): PendingImage => ({
  id,
  name,
  path: `user/${id}`,
  previewUrl: `data:image/jpeg;base64,${id}`,
});

describe("multi-image chat attachments", () => {
  it("enforces one image for Free and three for Pro", () => {
    expect(getMaxPendingImages("free")).toBe(1);
    expect(getMaxPendingImages("pro")).toBe(3);
    expect(getMaxPendingImages(undefined)).toBe(1);
    expect(canAddPendingImages(0, 1, "free")).toBe(true);
    expect(canAddPendingImages(1, 1, "free")).toBe(false);
    expect(canAddPendingImages(0, 3, "pro")).toBe(true);
    expect(canAddPendingImages(2, 1, "pro")).toBe(true);
    expect(canAddPendingImages(3, 1, "pro")).toBe(false);
  });

  it("validates the complete selection before upload", () => {
    expect(validateImageBatch([{ type: "image/jpeg", size: 10 }])).toBeNull();
    expect(validateImageBatch([{ type: "text/plain", size: 10 }])).toBe(
      "Please choose a valid image file."
    );
    expect(validateImageBatch([{ type: "image/jpeg", size: 15 * 1024 * 1024 + 1 }])).toBe(
      "Image file is too large."
    );
    expect(
      validateImageBatch([
        { type: "image/jpeg", size: 10 },
        { type: "text/plain", size: 10 },
      ])
    ).toBe("Please choose a valid image file.");
  });

  it("preserves ordered selection and removes only the requested image", () => {
    const selected = [image("one"), image("two"), image("three")];
    expect(buildStoredImagePayload(selected)).toEqual([
      { imagePath: "user/one", imageName: "one.jpg" },
      { imagePath: "user/two", imageName: "two.jpg" },
      { imagePath: "user/three", imageName: "three.jpg" },
    ]);
    expect(removePendingImage(selected, "two")).toEqual([selected[0], selected[2]]);
  });

  it("keeps preview URLs out of the request payload but includes them optimistically", () => {
    const selected = [image("one"), image("two")];
    expect(buildStoredImagePayload(selected)).toEqual([
      { imagePath: "user/one", imageName: "one.jpg" },
      { imagePath: "user/two", imageName: "two.jpg" },
    ]);
    expect(JSON.stringify(buildStoredImagePayload(selected))).not.toContain("data:image");
    expect(buildOptimisticImageAttachments(selected)).toEqual([
      {
        image_path: "user/one",
        image_name: "one.jpg",
        image_url: "data:image/jpeg;base64,one",
      },
      {
        image_path: "user/two",
        image_name: "two.jpg",
        image_url: "data:image/jpeg;base64,two",
      },
    ]);
  });

  it("supports image-only messages and rejects Web Search image submissions", () => {
    expect(canSubmitWithPendingImages("", 1, 0)).toBe(true);
    expect(canSubmitWithPendingImages("", 0, 0)).toBe(false);
    expect(clientSource).toContain('"Web Search mode does not support file upload."');
    expect(clientSource).toContain('useWebSearch || !hasImages ? {} : { images: payloadImages }');
    expect(clientSource).toContain('const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat"');
  });

  it("keeps batch cleanup and request rollback paths explicit", () => {
    expect(clientSource).toContain('"Could not upload all selected images."');
    expect(clientSource).toContain('await removePendingImageObjects(uploadedBatch, "upload-failure")');
    expect(clientSource).toContain("restorePendingImages(pendingImageSnapshot)");
    expect(clientSource).toContain("rollbackOptimisticMessages(prev, [optimisticUserId, assistantId])");
    expect(clientSource).toContain("clearSubmittedPendingImages(pendingImageSnapshot.map((image) => image.id))");
    expect(clientSource).toContain("responseAccepted = true");
  });

  it("keeps new submissions on the images[] contract without legacy singular fields", () => {
    expect(clientSource).toContain("buildStoredImagePayload(pendingImageSnapshot)");
    expect(clientSource).toContain("buildOptimisticImageAttachments(pendingImageSnapshot)");
    expect(clientSource).not.toContain("imageBase64: payloadImage");
    expect(clientSource).not.toContain("imagePath: payloadImagePath");
    expect(clientSource).not.toContain("imageName: payloadImageName");
  });

  it("clears only submitted images after successful HTTP acceptance", () => {
    const pending = [image("one"), image("two")];
    const remaining = removeSubmittedPendingImages(pending, ["one", "two"]);
    const messages = [
      { id: "previous", role: "assistant" },
      { id: "optimistic-user", role: "user" },
    ];

    expect(remaining).toEqual([]);
    expect(getPendingImageCleanupPaths(pending, "accepted")).toEqual([]);
    expect(messages).toContainEqual({ id: "optimistic-user", role: "user" });
    expect(pending.map((pendingImage) => pendingImage.id)).toEqual(["one", "two"]);
  });

  it("preserves attachments and prior messages when acceptance fails", () => {
    const snapshot = [image("one"), image("two")];
    const messages = [
      { id: "previous", role: "assistant" },
      { id: "failed-user", role: "user" },
      { id: "failed-assistant", role: "assistant" },
    ];

    const restored = restorePendingImageSnapshot([], snapshot);
    expect(restored).toEqual(snapshot);
    expect(restored[0]).toBe(snapshot[0]);
    expect(getPendingImageCleanupPaths(snapshot, "request-failure")).toEqual([]);
    expect(
      rollbackOptimisticMessages(messages, ["failed-user", "failed-assistant"])
    ).toEqual([{ id: "previous", role: "assistant" }]);
    expect(snapshot.map((pendingImage) => pendingImage.path)).toEqual([
      "user/one",
      "user/two",
    ]);
  });

  it("blocks a Pro-to-Free downgrade without discarding attachments", () => {
    const pending = [image("one"), image("two")];

    expect(canAddPendingImages(0, pending.length, "pro")).toBe(true);
    expect(pending.length > getMaxPendingImages("free")).toBe(true);
    expect(getPendingImageCleanupPaths(pending, "request-failure")).toEqual([]);
    expect(removePendingImage(pending, "two")).toEqual([pending[0]]);
    expect(canAddPendingImages(0, 1, "free")).toBe(true);
  });
});
