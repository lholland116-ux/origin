import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  formatMessageUsage,
  formatMessageUsageDetail,
  formatImageGenerationCounter,
  formatImageGenerationUsageDetail,
  getProfileDisplayName,
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
    expect(clientSource).toContain('ariaLabel="Image usage details"');
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

  it("renders an image quota warning once when the same safe error is also in uiError", () => {
    expect(clientSource).toContain(
      "!(isImageLimitReached && uiError === imageQuotaLimitMessage)",
    );
    expect(clientSource).toContain("{imageQuotaLimitMessage ??");
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

  it("places mode controls in the sidebar and keeps mobile navigation minimal", () => {
    const modeSourceStart = clientSource.indexOf("function renderSidebarModeActions");
    const modeSourceEnd = clientSource.indexOf("function renderSidebarActions", modeSourceStart);
    const modeSource = clientSource.slice(modeSourceStart, modeSourceEnd);

    expect(modeSource).toContain("Standard");
    expect(modeSource).toContain("Web Search");
    expect(modeSource).toContain("Create image");
    expect(modeSource).not.toContain(">Image</");
    expect(modeSource).not.toContain('aria-label="Help"');
    expect(modeSource).toContain("aria-pressed={standardActive}");
    expect(modeSource).toContain("aria-pressed={useWebSearch}");
    expect(modeSource).toContain("aria-pressed={useImageGeneration}");
    expect(clientSource).toContain("{renderSidebarActions()}");
    expect(clientSource).toContain("{renderSidebarUtilityActions(true)}");
    expect(clientSource).toContain('href="/help"');
    expect(clientSource).toContain('className="flex h-12 shrink-0 items-center px-3 md:hidden"');
    expect(clientSource).toContain('aria-label="Open menu"');
    expect(clientSource).not.toContain("headerProfileTriggerRef");
    expect(clientSource).not.toContain('z-20 border-b backdrop-blur');
    expect(clientSource).toContain("overflow-x-hidden");
  });

  it("uses a bounded mobile drawer while preserving the desktop sidebar width", () => {
    const mobileDrawerStart = clientSource.indexOf(
      '<div className="fixed inset-0 z-50 flex md:hidden">',
    );
    const mobileDrawerEnd = clientSource.indexOf(
      "        {renderProfileSettingsMenu()}",
      mobileDrawerStart,
    );
    const mobileDrawerSource = clientSource.slice(mobileDrawerStart, mobileDrawerEnd);

    expect(mobileDrawerSource).toContain("w-[min(18rem,78vw)]");
    expect(mobileDrawerSource).toContain("max-w-[calc(100vw-1rem)]");
    expect(mobileDrawerSource).toContain("min-w-0");
    expect(mobileDrawerSource).toContain("overflow-hidden");
    expect(mobileDrawerSource).not.toContain("w-80");
    expect(clientSource).toContain(
      'hidden h-full w-64 shrink-0 border-r md:flex md:flex-col',
    );
    expect(mobileDrawerSource).toContain("{renderSidebarUtilityActions(true)}");
  });

  it("normalizes sidebar action labels to the Chat History typography", () => {
    const sidebarModeStart = clientSource.indexOf("function renderSidebarModeActions");
    const sidebarActionsStart = clientSource.indexOf("function renderSidebarActions");
    const profileMenuStart = clientSource.indexOf("function renderProfileSettingsMenu");
    const sidebarModeSource = clientSource.slice(sidebarModeStart, sidebarActionsStart);
    const profileMenuSource = clientSource.slice(profileMenuStart, sidebarModeStart);
    const newChatStart = clientSource.indexOf("function renderNewChatAction");
    const sidebarUtilityStart = clientSource.indexOf("function renderSidebarUtilityActions");
    const newChatSource = clientSource.slice(newChatStart, sidebarUtilityStart);

    expect(clientSource).toContain('const SIDEBAR_LABEL_CLASS = "text-sm font-medium";');
    expect(clientSource).toContain(
      '<div className="truncate text-sm font-medium">{conversationTitle}</div>',
    );
    expect(newChatSource).toContain("SIDEBAR_LABEL_CLASS");
    expect(newChatSource).toContain("min-h-12 w-full");
    expect(sidebarModeSource).toContain("getModeButtonClass(activeTheme");
    expect(sidebarModeSource).toContain("Standard");
    expect(sidebarModeSource).toContain("Web Search");
    expect(sidebarModeSource).toContain("Create image");
    expect(sidebarModeSource).not.toContain("Help");
    expect(clientSource).toContain(
      "inline-flex h-10 items-center gap-1.5 rounded-full",
    );
    expect(profileMenuSource).toContain("SIDEBAR_LABEL_CLASS");
    expect(profileMenuSource).toContain("Theme");
    expect(profileMenuSource).toContain("Help");
    expect(profileMenuSource).toContain("Account");
    expect(profileMenuSource).toContain("Upgrade to Pro");
    expect(profileMenuSource).toContain("Sign Out");
    expect(profileMenuSource).toContain("px-3 py-2");
  });

  it("moves the authoritative message counter into the composer", () => {
    expect(formatMessageUsage({ used: 10, limit: 300 })).toBe(
      "290 messages left today",
    );
    expect(formatMessageUsage({ used: 3, limit: 20 })).toBe(
      "17 messages left today",
    );
    expect(formatMessageUsage({ used: 19, limit: 20 })).toBe(
      "1 message left today",
    );
    expect(formatMessageUsage({ used: 20, limit: 20 })).toBe(
      "0 messages left today",
    );
    expect(formatMessageUsageDetail({ used: 10, limit: 300 })).toBe(
      "Messages today: 10 / 300",
    );

    const messageUsageStart = clientSource.indexOf("function renderMessageUsage");
    const messageUsageEnd = clientSource.indexOf(
      "function renderSidebarActions",
      messageUsageStart,
    );
    const messageUsageSource = clientSource.slice(messageUsageStart, messageUsageEnd);
    const composerStart = clientSource.indexOf("<form");
    const composerEnd = clientSource.indexOf("</form>", composerStart);
    const composerSource = clientSource.slice(composerStart, composerEnd);

    expect(messageUsageSource).toContain(
      "if (useImageGeneration || !usage || usage.limit <= 0) return null;",
    );
    expect(messageUsageSource).toContain('aria-label="Message usage"');
    expect(messageUsageSource).toContain("formatMessageUsage(usage)");
    expect(messageUsageSource).toContain(
      "<MessageUsageDetails usage={usage} theme={activeTheme} />",
    );
    expect(messageUsageSource).toContain(
      "flex min-w-0 max-w-full flex-1 items-center gap-1.5 text-xs",
    );
    expect(composerSource).toContain("{renderMessageUsage()}");
    expect(composerSource).toContain("{renderImageGenerationUsage()}");
    expect(composerSource.indexOf("{renderMessageUsage()}")).toBeGreaterThan(
      composerSource.indexOf("<textarea"),
    );
    expect(composerSource.indexOf("{renderImageGenerationUsage()}")).toBeGreaterThan(
      composerSource.indexOf("<textarea"),
    );
    expect(composerSource.indexOf("{renderMessageUsage()}")).toBeGreaterThan(
      composerSource.indexOf("TOOLTIP_TEXT.mic"),
    );
    expect(composerSource.indexOf("{renderImageGenerationUsage()}")).toBeGreaterThan(
      composerSource.indexOf("TOOLTIP_TEXT.mic"),
    );
    expect(composerSource).toContain("<div className=\"ml-auto\">");
    expect(clientSource.match(/\{renderMessageUsage\(\)\}/g)).toHaveLength(1);
    expect(clientSource).toContain("Standard");
    expect(clientSource).toContain("Web Search");
    expect(clientSource).toContain("Create image");
    expect(clientSource).toContain('ariaLabel="Message usage details"');
    expect(clientSource).toContain("formatMessageUsageDetail(usage)");
    expect(clientSource).toContain("formatImageGenerationCounter(dailyRemaining)");
    expect(clientSource).toContain("ImageGenerationUsageDetails usage={imageUsage} theme={activeTheme}");
    expect(clientSource).not.toContain("Messages this month:");

    const mobileTopStart = clientSource.indexOf("<div data-profile-sidebar");
    const mobileTopEnd = clientSource.indexOf("{renderSidebarActions()}", mobileTopStart);
    const mobileTopSource = clientSource.slice(mobileTopStart, mobileTopEnd);
    const desktopTopStart = clientSource.indexOf("<aside data-profile-sidebar");
    const desktopTopEnd = clientSource.indexOf("{renderSidebarActions()}", desktopTopStart);
    const desktopTopSource = clientSource.slice(desktopTopStart, desktopTopEnd);

    expect(mobileTopSource).not.toContain("messages used today");
    expect(mobileTopSource).not.toContain("Free Plan");
    expect(mobileTopSource).not.toContain("Pro Plan");
    expect(desktopTopSource).not.toContain("messages used today");
    expect(desktopTopSource).not.toContain("Free Plan");
    expect(desktopTopSource).not.toContain("Pro Plan");
  });

  it("removes the conversation document counter without changing composer uploads", () => {
    expect(clientSource).not.toContain("documents in this conversation");
    expect(clientSource).not.toContain("conversationDocuments");
    expect(clientSource).toContain("<form");
    expect(clientSource).toContain("<textarea");
    expect(clientSource).toContain("{renderMessageUsage()}");
    expect(clientSource).toContain("<DocumentUploadButton");
    expect(clientSource).toContain('plan === "pro"');
    expect(clientSource).toContain('"/api/documents/upload"');
    expect(clientSource).toContain("File uploads are a Pro feature");
    expect(clientSource).toContain('aria-label="Attach image"');
  });

  it("emphasizes profile identity and Chat History with existing theme tokens", () => {
    expect(getProfileDisplayName("jane.doe@example.com")).toBe("Jane Doe");

    const profileTriggerStart = clientSource.indexOf("function renderSidebarUtilityActions");
    const profileMenuStart = clientSource.indexOf("function renderProfileSettingsMenu");
    const sidebarStart = clientSource.indexOf("function renderSidebarModeActions", profileMenuStart);
    const profileTriggerSource = clientSource.slice(profileTriggerStart, profileMenuStart);
    const profileMenuSource = clientSource.slice(profileMenuStart, sidebarStart);

    expect(profileTriggerSource).toContain(
      'className="min-w-0 flex-1 truncate font-semibold text-white"',
    );
    expect(profileTriggerSource).toContain('text-[11px] text-white/50');
    expect(profileMenuSource).toContain("getProfileDisplayName(userEmail)");
    expect(profileMenuSource).toContain("truncate text-sm font-semibold text-white");
    expect(profileMenuSource).toContain("mt-0.5 truncate text-sm font-semibold text-white");
    expect(profileMenuSource).toContain("mt-0.5 text-xs");
    expect(clientSource).toContain("activeTheme.badge");
    expect(clientSource).toContain("bg-white/[0.08] text-white");
  });

  it("constrains the profile menu to the active sidebar or mobile drawer", () => {
    const profileMenuStart = clientSource.indexOf("function renderProfileSettingsMenu");
    const profileMenuEnd = clientSource.indexOf("function renderSidebarModeActions", profileMenuStart);
    const profileMenuSource = clientSource.slice(profileMenuStart, profileMenuEnd);

    expect(clientSource).toContain('trigger.closest<HTMLElement>("[data-profile-sidebar]")');
    expect(clientSource).toContain("PROFILE_MENU_HORIZONTAL_INSET");
    expect(clientSource).toContain("width: rect.width - PROFILE_MENU_HORIZONTAL_INSET * 2");
    expect(profileMenuSource).toContain("profileMenuPosition.width || undefined");
    expect(profileMenuSource).toContain("max-w-[calc(100vw-1.5rem)]");
    expect(profileMenuSource).not.toContain("w-[min(22rem,calc(100vw-1.5rem))]");
    expect(profileMenuSource).not.toContain("overflow-hidden");
    expect(clientSource).toContain("<div data-profile-sidebar");
    expect(clientSource).toContain("<aside data-profile-sidebar");
    expect(clientSource).toContain("setProfileMenuOpen(true)");
    expect(clientSource).toContain("handleOutsidePointerDown");
    expect(clientSource).toContain('if (event.key === "Escape")');
    expect(clientSource).toContain("w-[min(18rem,78vw)]");
    expect(clientSource).toContain(
      'hidden h-full w-64 shrink-0 border-r md:flex md:flex-col',
    );
  });

  it("keeps theme choices readable inside the narrow profile menu", () => {
    const themePickerStart = clientSource.indexOf("function ChatThemePicker");
    const themePickerEnd = clientSource.indexOf("function SourcesDisclosure", themePickerStart);
    const themePickerSource = clientSource.slice(themePickerStart, themePickerEnd);

    expect(themePickerSource).toContain('aria-label="Chat theme picker"');
    expect(themePickerSource).toContain("grid grid-cols-1 gap-1.5");
    expect(themePickerSource).toContain("min-h-11 w-full");
    expect(themePickerSource).toContain("SIDEBAR_LABEL_CLASS");
    expect(themePickerSource).toContain("item.pageBg");
    expect(themePickerSource).toContain("item.assistantBubble");
    expect(themePickerSource).toContain("item.userBubble");
    expect(themePickerSource).toContain("aria-pressed={active}");
    expect(themePickerSource).toContain("onChange(item.id)");
    expect(themePickerSource).not.toContain("sm:grid-cols-2");
    expect(themePickerSource).not.toContain("xl:grid-cols-3");
    expect(themePickerSource).not.toContain("max-h-[calc(100dvh-310px)]");
    expect(themePickerSource).not.toContain("overflow-y-auto");
  });
});
