import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatImageGenerationCounter,
  formatImageGenerationUsageDetail,
  getUploadedMessageImageGridClass,
  shouldShowImageGenerationCounter,
} from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");

const imageUsage = {
  plan: "pro" as const,
  daily: { used: 5, reserved: 0, limit: 20, remaining: 15 },
  monthly: { used: 17, reserved: 0, limit: 200, remaining: 183 },
};

describe("chat image-generation presentation", () => {
  it("shows the counter only when Image mode has authoritative usage", () => {
    expect(shouldShowImageGenerationCounter(false, imageUsage)).toBe(false);
    expect(shouldShowImageGenerationCounter(true, undefined)).toBe(false);
    expect(shouldShowImageGenerationCounter(true, imageUsage)).toBe(true);
  });

  it.each([
    [15, "15 images left today"],
    [1, "1 image left today"],
    [0, "0 images left today"],
  ])("formats the daily remaining count for %s", (remaining, expected) => {
    expect(formatImageGenerationCounter(remaining)).toBe(expected);
  });

  it("uses the server-provided daily and monthly values for detail", () => {
    expect(formatImageGenerationUsageDetail(imageUsage)).toBe(
      "Images today: 5 / 20\nImages this month: 17 / 200",
    );
  });

  it("keeps quota detail behind an adjacent touch-safe info control", () => {
    expect(clientSource).toContain("<ImageGenerationUsageDetails");
    expect(clientSource).toContain('aria-label="Image usage details"');
    expect(clientSource).toContain('aria-haspopup="dialog"');
    expect(clientSource).toContain('role="dialog"');
    expect(clientSource).toContain("touchSafe");
    expect(clientSource).not.toContain(
      "formatImageGenerationUsageDetail(imageUsage)}</span>",
    );
  });

  it("keeps a zero daily remaining state visible", () => {
    expect(
      formatImageGenerationCounter(0),
    ).toBe("0 images left today");
    expect(
      shouldShowImageGenerationCounter(true, {
        ...imageUsage,
        daily: { ...imageUsage.daily, remaining: 0 },
      }),
    ).toBe(true);
  });

  it("keeps uploaded image layouts intentional for one, two, and three images", () => {
    expect(getUploadedMessageImageGridClass(1)).toBe("grid-cols-1 sm:max-w-md");
    expect(getUploadedMessageImageGridClass(2)).toBe("grid-cols-2");
    expect(getUploadedMessageImageGridClass(3)).toBe("grid-cols-2 sm:grid-cols-3");
  });

  it("keeps generated images responsive and preloads only the latest candidate", () => {
    expect(clientSource).toContain('priority={isLatestMessage}');
    expect(clientSource).toContain('sizes="(max-width: 768px) calc(100vw - 2rem), 768px"');
    expect(clientSource).toContain("max-h-[min(70vh,640px)] max-w-full object-contain");
    expect(clientSource).toContain('aria-label="Download image"');
    expect(clientSource).toContain('aria-label="Regenerate image"');
  });

  it("keeps the existing usage refresh lifecycle for generation and regeneration", () => {
    expect(clientSource).toContain("await fetchUsage();");
    expect(clientSource).toContain("formatImageGenerationCounter(dailyRemaining)");
    expect(clientSource).toContain("formatImageGenerationUsageDetail(usage)");
    expect(clientSource).toContain("imageGenerationUsage.daily.remaining");
    expect(
      clientSource.match(/error instanceof ImageGenerationClientError && error\.status === 429/g),
    ).toHaveLength(2);
    expect(clientSource).not.toContain("daily.remaining > 20");
    expect(clientSource).not.toContain("monthly.remaining > 200");
  });

  it("preserves generated-action ownership and uploaded-image rendering paths", () => {
    expect(clientSource).toContain(
      'message.role === "assistant" && message.generatedImage?.id',
    );
    expect(clientSource).toContain('messageImageSource === "children"');
    expect(clientSource).toContain('alt={image.image_name || "Uploaded image"}');
    expect(clientSource).toContain('alt={message.image_name || "Uploaded image"}');
  });

  it("keeps assistant replies borderless while retaining the user bubble border", () => {
    expect(clientSource).toContain(
      '"min-w-0 max-w-full rounded-xl p-3 break-words [overflow-wrap:anywhere]"',
    );
    expect(clientSource).not.toContain(
      '"min-w-0 max-w-full rounded-xl border p-3 break-words [overflow-wrap:anywhere]"',
    );
    expect(clientSource).toContain(
      '"max-w-full rounded-2xl border border-white/15 px-3 py-2.5 break-words [overflow-wrap:anywhere]"',
    );
    expect(clientSource).toContain(
      'message.role === "assistant" && message.generatedImage?.id',
    );
    expect(clientSource).toContain('const endpoint = useWebSearch ? "/api/chat-web" : "/api/chat"');
    expect(clientSource).toContain('aria-label="Download image"');
    expect(clientSource).toContain('aria-label="Regenerate image"');
    expect(clientSource).toContain('alt={image.image_name || "Uploaded image"}');
    expect(clientSource).toContain('alt={message.image_name || "Uploaded image"}');
  });

  it("places mode and Help controls in the sidebar and keeps mobile navigation minimal", () => {
    const modeSourceStart = clientSource.indexOf("function renderSidebarModeActions");
    const modeSourceEnd = clientSource.indexOf("function renderSidebarActions", modeSourceStart);
    const modeSource = clientSource.slice(modeSourceStart, modeSourceEnd);

    expect(modeSource).toContain("Standard");
    expect(modeSource).toContain("Web Search");
    expect(modeSource).toContain("Create image");
    expect(modeSource).not.toContain(">Image</");
    expect(modeSource).toContain('aria-label="Help"');
    expect(modeSource).toContain("aria-pressed={standardActive}");
    expect(modeSource).toContain("aria-pressed={useWebSearch}");
    expect(modeSource).toContain("aria-pressed={useImageGeneration}");
    expect(clientSource).toContain("{renderSidebarActions()}");
    expect(clientSource).toContain("{renderSidebarUtilityActions(true)}");
    expect(clientSource).toContain('className="flex h-12 shrink-0 items-center px-3 md:hidden"');
    expect(clientSource).toContain('aria-label="Open menu"');
    expect(clientSource).not.toContain("headerProfileTriggerRef");
    expect(clientSource).not.toContain('z-20 border-b backdrop-blur');
    expect(clientSource).toContain("overflow-x-hidden");
  });
});
