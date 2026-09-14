import { describe, expect, it, vi } from "vitest";
import {
  hydrateGeneratedImageRows,
  isValidGeneratedImagePath,
  normalizeGeneratedImageMimeType,
} from "@/lib/chat/generated-image-history";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";
const MESSAGE_ID = "30000000-0000-4000-8000-000000000001";
const IMAGE_ID = "40000000-0000-4000-8000-000000000001";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: IMAGE_ID,
    message_id: MESSAGE_ID,
    conversation_id: CONVERSATION_ID,
    user_id: USER_ID,
    storage_path: `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`,
    mime_type: "image/webp",
    provider: "replicate",
    model: "black-forest-labs/flux-schnell",
    ...overrides,
  };
}

describe("durable generated-image history normalization", () => {
  it("hydrates safe generated metadata with a signed HTTPS URL", async () => {
    const sign = vi.fn(async () => "https://signed.example/generated.webp");

    await expect(
      hydrateGeneratedImageRows({
        rows: [row()],
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        sign,
      })
    ).resolves.toEqual(
      new Map([
        [
          MESSAGE_ID,
          {
            id: IMAGE_ID,
            url: "https://signed.example/generated.webp",
            mimeType: "image/webp",
            provider: "replicate",
            model: "black-forest-labs/flux-schnell",
          },
        ],
      ])
    );
    expect(sign).toHaveBeenCalledWith(
      `generated/${USER_ID}/${CONVERSATION_ID}/image.webp`
    );
  });

  it.each([
    ["wrong user", `generated/10000000-0000-4000-8000-000000000002/${CONVERSATION_ID}/image.webp`],
    ["wrong conversation", `generated/${USER_ID}/20000000-0000-4000-8000-000000000002/image.webp`],
    ["path traversal", `generated/${USER_ID}/${CONVERSATION_ID}/../image.webp`],
  ])("rejects %s storage paths", (_label, storagePath) => {
    expect(isValidGeneratedImagePath(storagePath, USER_ID, CONVERSATION_ID)).toBe(false);
  });

  it("rejects unsupported metadata without calling Storage signing", async () => {
    const sign = vi.fn(async () => "https://signed.example/should-not-exist");

    await expect(
      hydrateGeneratedImageRows({
        rows: [row({ mime_type: "image/gif" }), row({ provider: "provider secret" })],
        userId: USER_ID,
        conversationId: CONVERSATION_ID,
        sign,
      })
    ).resolves.toEqual(new Map());
    expect(sign).not.toHaveBeenCalled();
  });

  it("normalizes only the supported generated MIME types", () => {
    expect(normalizeGeneratedImageMimeType("image/webp; charset=binary")).toBe("image/webp");
    expect(normalizeGeneratedImageMimeType("image/png")).toBe("image/png");
    expect(normalizeGeneratedImageMimeType("image/jpeg")).toBe("image/jpeg");
    expect(normalizeGeneratedImageMimeType("image/svg+xml")).toBeNull();
  });
});
