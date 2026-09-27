let activeReadAloudMessageId: string | null = null;
const readAloudListeners = new Set<() => void>();

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

export function stopReadAloud(): void {
  if (isReadAloudSupported()) {
    window.speechSynthesis.cancel();
  }

  if (activeReadAloudMessageId === null) return;

  activeReadAloudMessageId = null;
  notifyReadAloudListeners();
}

export function startReadAloud(messageId: string, markdown: string): boolean {
  const text = cleanTextForSpeech(markdown);

  if (!isReadAloudSupported() || !text) return false;

  window.speechSynthesis.cancel();
  activeReadAloudMessageId = messageId;
  notifyReadAloudListeners();

  const utterance = new SpeechSynthesisUtterance(text);
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
