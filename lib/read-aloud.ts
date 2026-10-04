import {
  DEFAULT_READ_ALOUD_PREFERENCES,
  type ReadAloudPreferences,
} from "@/lib/read-aloud-preferences";
import {
  isNativeAndroidReadAloudAvailable,
  isNativeAndroidReadAloudRuntime,
  startNativeReadAloud,
  stopNativeReadAloud,
} from "@/lib/read-aloud-native";

let activeReadAloudMessageId: string | null = null;
const readAloudListeners = new Set<() => void>();

export const READ_ALOUD_PREVIEW_TEXT =
  "Hello from LVTChat. This is a Read Aloud preview.";

function notifyReadAloudListeners(): void {
  readAloudListeners.forEach((listener) => listener());
}

export function cleanTextForSpeech(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[([^\]]*)\]\([^\)\n]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\([^\)\n]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\s*:\s*\S+/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^\s{0,3}#{1,6}\s+/gm, "")
    .replace(/^\s{0,3}(?:[-*+]|\d+[.)])\s+/gm, "")
    .replace(/^\s{0,3}>\s?/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/[\*_~`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function isReadAloudSupported(): boolean {
  if (isNativeAndroidReadAloudRuntime()) {
    return isNativeAndroidReadAloudAvailable();
  }

  return (
    typeof window !== "undefined" &&
    "speechSynthesis" in window &&
    typeof SpeechSynthesisUtterance !== "undefined"
  );
}

export function getActiveReadAloudMessageId(): string | null {
  return activeReadAloudMessageId;
}

export function subscribeToReadAloud(listener: () => void): () => void {
  readAloudListeners.add(listener);
  return () => readAloudListeners.delete(listener);
}

function createReadAloudUtterance(
  text: string,
  preferences: ReadAloudPreferences,
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = preferences.rate;
  return utterance;
}

export function stopReadAloud(): void {
  if (isNativeAndroidReadAloudRuntime()) {
    if (isNativeAndroidReadAloudAvailable()) stopNativeReadAloud();
  } else if (isReadAloudSupported()) {
    window.speechSynthesis.cancel();
  }

  if (activeReadAloudMessageId === null) return;

  activeReadAloudMessageId = null;
  notifyReadAloudListeners();
}

export function startReadAloud(
  messageId: string,
  markdown: string,
  preferences: ReadAloudPreferences = DEFAULT_READ_ALOUD_PREFERENCES,
): boolean {
  const text = cleanTextForSpeech(markdown);

  if (!isReadAloudSupported() || !text) return false;

  const finish = () => {
    if (activeReadAloudMessageId !== messageId) return;

    activeReadAloudMessageId = null;
    notifyReadAloudListeners();
  };

  if (isNativeAndroidReadAloudRuntime()) {
    activeReadAloudMessageId = messageId;
    notifyReadAloudListeners();
    startNativeReadAloud(text, preferences, finish);
    return true;
  }

  window.speechSynthesis.cancel();
  activeReadAloudMessageId = messageId;
  notifyReadAloudListeners();

  const utterance = createReadAloudUtterance(text, preferences);

  utterance.onend = finish;
  utterance.onerror = finish;

  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    finish();
    return false;
  }

  return true;
}

export function previewReadAloud(
  preferences: ReadAloudPreferences = DEFAULT_READ_ALOUD_PREFERENCES,
): boolean {
  if (!isReadAloudSupported()) return false;

  if (isNativeAndroidReadAloudRuntime()) {
    if (activeReadAloudMessageId !== null) {
      activeReadAloudMessageId = null;
      notifyReadAloudListeners();
    }
    startNativeReadAloud(
      READ_ALOUD_PREVIEW_TEXT,
      preferences,
      () => undefined,
    );
    return true;
  }

  stopReadAloud();
  const utterance = createReadAloudUtterance(
    READ_ALOUD_PREVIEW_TEXT,
    preferences,
  );

  try {
    window.speechSynthesis.speak(utterance);
  } catch {
    return false;
  }

  return true;
}
