import { afterEach, describe, expect, it } from "vitest";
import {
  CHAT_THEMES,
  DEFAULT_CHAT_THEME_ID,
  getChatThemeById,
} from "@/lib/chat-themes";
import { getStoredChatThemeId } from "@/lib/chat-theme-storage";

const originalWindow = globalThis.window;

function mockStoredTheme(themeId: string | null): void {
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => themeId,
      },
    },
  });
}

afterEach(() => {
  if (originalWindow === undefined) {
    Reflect.deleteProperty(globalThis, "window");
    return;
  }

  globalThis.window = originalWindow;
});

describe("chat theme defaults and persistence", () => {
  it("uses Midnight Blue when no saved preference exists", () => {
    expect(DEFAULT_CHAT_THEME_ID).toBe("midnight-blue");
    expect(getStoredChatThemeId()).toBe("midnight-blue");
    expect(getChatThemeById(getStoredChatThemeId()).id).toBe("midnight-blue");
  });

  it.each([
    ["light", "light"],
    ["default-dark", "default-dark"],
    ["midnight-blue", "midnight-blue"],
    ["emerald", "emerald"],
    ["purple", "purple"],
    ["warm-gray", "warm-gray"],
  ])("preserves a saved %s preference", (savedThemeId, expectedThemeId) => {
    mockStoredTheme(savedThemeId);

    expect(getChatThemeById(getStoredChatThemeId()).id).toBe(expectedThemeId);
  });

  it("falls back to Midnight Blue for an invalid saved preference", () => {
    mockStoredTheme("corrupt-theme-value");

    expect(getChatThemeById(getStoredChatThemeId()).id).toBe("midnight-blue");
  });

  it("labels the legacy dark theme simply Dark", () => {
    const darkTheme = CHAT_THEMES.find((theme) => theme.id === "default-dark");

    expect(darkTheme?.label).toBe("Dark");
    expect(CHAT_THEMES.map((theme) => theme.label)).not.toContain("Default Dark");
    expect(
      CHAT_THEMES.find((theme) => theme.id === "midnight-blue")?.label,
    ).toBe("Midnight Blue");
  });

  it("keeps Light first with a readable light palette", () => {
    expect(CHAT_THEMES.map((theme) => theme.label)).toEqual([
      "Light",
      "Dark",
      "Midnight Blue",
      "Emerald",
      "Purple",
      "Warm Gray",
    ]);

    const lightTheme = CHAT_THEMES[0];
    expect(lightTheme.id).toBe("light");
    expect(lightTheme.inputText).toBe("text-slate-900");
    expect(lightTheme.mutedText).toBe("text-slate-600");
    expect(lightTheme.panelBorder).toBe("border-slate-200");
  });
});
