import {
  DEFAULT_READ_ALOUD_PREFERENCES,
  type ReadAloudPreferences,
  type ReadAloudVoicePreference,
} from "@/lib/read-aloud-preferences";

let activeReadAloudMessageId: string | null = null;
const readAloudListeners = new Set<() => void>();

export const READ_ALOUD_PREVIEW_TEXT =
  "Hello from LVTChat. This is a preview of your selected voice.";

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

export function getAvailableReadAloudVoices(): SpeechSynthesisVoice[] {
  if (!isReadAloudSupported()) return [];

  try {
    return Array.from(window.speechSynthesis.getVoices());
  } catch {
    return [];
  }
}

export function subscribeToReadAloudVoices(
  listener: (voices: readonly SpeechSynthesisVoice[]) => void,
): () => void {
  listener(getAvailableReadAloudVoices());
  if (!isReadAloudSupported()) return () => undefined;

  const synthesis = window.speechSynthesis;
  const refresh = () => listener(getAvailableReadAloudVoices());
  synthesis.addEventListener("voiceschanged", refresh);
  return () => synthesis.removeEventListener("voiceschanged", refresh);
}

export function findMatchingReadAloudVoice(
  preference: ReadAloudVoicePreference | null,
  voices: readonly SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  if (preference === null) return null;

  return (
    voices.find(
      (voice) =>
        voice.voiceURI === preference.voiceURI &&
        voice.name === preference.name &&
        voice.lang === preference.lang,
    ) ??
    voices.find((voice) => voice.voiceURI === preference.voiceURI) ??
    null
  );
}

function createReadAloudUtterance(
  text: string,
  preferences: ReadAloudPreferences,
): SpeechSynthesisUtterance {
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = findMatchingReadAloudVoice(
    preferences.voice,
    getAvailableReadAloudVoices(),
  );
  if (voice) utterance.voice = voice;
  utterance.rate = preferences.rate;
  return utterance;
}

export function stopReadAloud(): void {
  if (isReadAloudSupported()) {
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

  window.speechSynthesis.cancel();
  activeReadAloudMessageId = messageId;
  notifyReadAloudListeners();

  const utterance = createReadAloudUtterance(text, preferences);
  const finish = () => {
    if (activeReadAloudMessageId !== messageId) return;

    activeReadAloudMessageId = null;
    notifyReadAloudListeners();
  };

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
