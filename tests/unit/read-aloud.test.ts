import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanTextForSpeech,
  getActiveReadAloudMessageId,
  isReadAloudSupported,
  previewReadAloud,
  READ_ALOUD_PREVIEW_TEXT,
  startReadAloud,
  stopReadAloud,
} from "@/lib/read-aloud";
import type { ReadAloudPreferences } from "@/lib/read-aloud-preferences";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const buttonSource = readFileSync("components/chat/ReadAloudButton.tsx", "utf8");

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;
  voice: SpeechSynthesisVoice | null = null;
  lang = "";
  rate = 1;

  constructor(public readonly text: string) {}
}

type FakeSpeechSynthesis = {
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
  getVoices: ReturnType<typeof vi.fn>;
};

function installSpeechMocks() {
  const utterances: FakeUtterance[] = [];
  const synthesis: FakeSpeechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn((utterance: FakeUtterance) => utterances.push(utterance)),
    getVoices: vi.fn(),
  };

  vi.stubGlobal("window", { speechSynthesis: synthesis });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

  return { synthesis, utterances };
}

describe("read aloud", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    stopReadAloud();
  });

  it("removes fenced code and common Markdown syntax without changing source text", () => {
    const { utterances } = installSpeechMocks();
    const markdown = [
      "# Heading",
      "- **Important** [link](https://example.com)",
      "```ts",
      "const secret = true;",
      "```",
      "_spoken_ text",
    ].join("\n");

    expect(cleanTextForSpeech(markdown)).toBe("Heading Important link spoken text");
    expect(startReadAloud("message-a", markdown)).toBe(true);
    expect(utterances[0]?.text).toBe("Heading Important link spoken text");
    expect(markdown).toContain("const secret = true;");
  });

  it("cancels the current message before starting another", () => {
    const { synthesis, utterances } = installSpeechMocks();

    expect(startReadAloud("message-a", "First response")).toBe(true);
    expect(getActiveReadAloudMessageId()).toBe("message-a");
    expect(startReadAloud("message-b", "Second response")).toBe(true);

    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(getActiveReadAloudMessageId()).toBe("message-b");
    expect(utterances.map((utterance) => utterance.text)).toEqual([
      "First response",
      "Second response",
    ]);
  });

  it("uses the platform default voice and language while applying the saved rate", () => {
    const { synthesis, utterances } = installSpeechMocks();

    expect(startReadAloud("message-a", "Response", { rate: 0.75 })).toBe(true);
    expect(utterances[0]?.voice).toBeNull();
    expect(utterances[0]?.lang).toBe("");
    expect(utterances[0]?.rate).toBe(0.75);
    expect(synthesis.getVoices).not.toHaveBeenCalled();
  });

  it("previews with the platform default at the saved rate and cancels active speech", () => {
    const preferences: ReadAloudPreferences = { rate: 1.5 };
    const { synthesis, utterances } = installSpeechMocks();

    startReadAloud("message-a", "Active response");
    expect(previewReadAloud(preferences)).toBe(true);
    expect(getActiveReadAloudMessageId()).toBeNull();
    expect(utterances[1]?.text).toBe(READ_ALOUD_PREVIEW_TEXT);
    expect(utterances[1]?.voice).toBeNull();
    expect(utterances[1]?.lang).toBe("");
    expect(utterances[1]?.rate).toBe(1.5);
    expect(synthesis.getVoices).not.toHaveBeenCalled();
    expect(synthesis.cancel).toHaveBeenCalledTimes(2);

    startReadAloud("message-b", "New response", preferences);
    expect(synthesis.cancel).toHaveBeenCalledTimes(3);
    expect(getActiveReadAloudMessageId()).toBe("message-b");
  });

  it("stops speech immediately and clears the active message", () => {
    const { synthesis } = installSpeechMocks();

    startReadAloud("message-a", "First response");
    stopReadAloud();

    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
    expect(getActiveReadAloudMessageId()).toBeNull();
  });

  it("clears active state when speech ends or errors", () => {
    const { utterances } = installSpeechMocks();

    startReadAloud("message-a", "First response");
    utterances[0]?.onend?.();
    expect(getActiveReadAloudMessageId()).toBeNull();

    startReadAloud("message-b", "Second response");
    utterances[1]?.onerror?.();
    expect(getActiveReadAloudMessageId()).toBeNull();
  });

  it("finishes safely when the browser speech API is unsupported", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("SpeechSynthesisUtterance", undefined);

    expect(isReadAloudSupported()).toBe(false);
    expect(startReadAloud("message-a", "Response")).toBe(false);
    expect(getActiveReadAloudMessageId()).toBeNull();
  });

  it("renders Read Aloud for assistant messages while preserving other actions", () => {
    const assistantActionStart = clientSource.indexOf(
      'message.role === "assistant" && ('
    );
    const assistantActionSource = clientSource.slice(assistantActionStart);

    expect(clientSource).toContain("<ReadAloudButton");
    expect(assistantActionSource).toContain("<ReadAloudButton");
    expect(assistantActionSource).toContain("messageId={message.id}");
    expect(assistantActionSource).toContain("text={message.content}");
    expect(clientSource).not.toContain('message.role === "user" && (\n                            <ReadAloudButton');
    expect(clientSource).toContain('aria-label="Copy response"');
    expect(clientSource).toContain("Mark assistant response as helpful");
    expect(clientSource).toContain("Mark assistant response as not helpful");
    expect(buttonSource).toContain('"Read aloud"');
    expect(buttonSource).toContain('"Stop read aloud"');
    expect(buttonSource).toContain('aria-label={label}');
    expect(buttonSource).toContain('title={label}');
  });

  it("cancels speech on conversation changes and component cleanup", () => {
    expect(clientSource).toContain("return () => stopReadAloud();");
    expect(clientSource).toContain("[conversationId]");
    expect(buttonSource).toContain("getActiveReadAloudMessageId() === messageId");
    expect(buttonSource).toContain("stopReadAloud();");
  });
});
