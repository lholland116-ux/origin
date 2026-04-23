import { DEFAULT_CHAT_THEME_ID } from "@/lib/chat-themes";

const STORAGE_KEY = "lvtchat:chat-theme";

export function getStoredChatThemeId(): string {
  if (typeof window === "undefined") {
    return DEFAULT_CHAT_THEME_ID;
  }

  const value = window.localStorage.getItem(STORAGE_KEY);
  return value || DEFAULT_CHAT_THEME_ID;
}

export function setStoredChatThemeId(themeId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(STORAGE_KEY, themeId);
}