import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanTextForSpeech,
  getActiveReadAloudMessageId,
  isReadAloudSupported,
  startReadAloud,
  stopReadAloud,
} from "@/lib/read-aloud";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const buttonSource = readFileSync("components/chat/ReadAloudButton.tsx", "utf8");

class FakeUtterance {
  onend: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(public readonly text: string) {}
}

type FakeSpeechSynthesis = {
  cancel: ReturnType<typeof vi.fn>;
  speak: ReturnType<typeof vi.fn>;
};

function installSpeechMocks() {
  const utterances: FakeUtterance[] = [];
  const synthesis: FakeSpeechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn((utterance: FakeUtterance) => utterances.push(utterance)),
  };

  vi.stubGlobal("window", { speechSynthesis: synthesis });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

  return { synthesis, utterances };
}

describe("read aloud", () => {
  beforeEach(() => {
    stopReadAloud();
    vi.unstubAllGlobals();
  });

  it("removes fenced code and common Markdown syntax without changing source text", () => {
    const markdown = [
      "# Heading",
      "- **Important** [link](https://example.com)",
      "```ts",
      "const secret = true;",
      "```",
      "_spoken_ text",
    ].join("\n");

    expect(cleanTextForSpeech(markdown)).toBe("Heading Important link spoken text");
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

  it("stops speech immediately and clears the active message", () => {
    const { synthesis } = installSpeechMocks();

    startReadAloud("message-a", "First response");
    stopReadAloud();

    expect(synthesis.cancel).toHaveBeenCalledTimes(2);
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