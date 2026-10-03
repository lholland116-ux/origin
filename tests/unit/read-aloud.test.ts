import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanTextForSpeech,
  findMatchingReadAloudVoice,
  getAvailableReadAloudVoices,
  getActiveReadAloudMessageId,
  isReadAloudSupported,
  previewReadAloud,
  READ_ALOUD_PREVIEW_TEXT,
  startReadAloud,
  stopReadAloud,
  subscribeToReadAloudVoices,
} from "@/lib/read-aloud";
import type {
  ReadAloudPreferences,
  ReadAloudVoicePreference,
} from "@/lib/read-aloud-preferences";

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
  addEventListener: ReturnType<typeof vi.fn>;
  removeEventListener: ReturnType<typeof vi.fn>;
};

function fakeVoice(
  voiceURI: string,
  name: string,
  lang: string,
  localService = true,
): SpeechSynthesisVoice {
  return { voiceURI, name, lang, localService, default: false };
}

function installSpeechMocks(initialVoices: SpeechSynthesisVoice[] = []) {
  const utterances: FakeUtterance[] = [];
  let voices = initialVoices;
  const voiceListeners = new Set<EventListener>();
  const synthesis: FakeSpeechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn((utterance: FakeUtterance) => utterances.push(utterance)),
    getVoices: vi.fn(() => voices),
    addEventListener: vi.fn((event: string, listener: EventListener) => {
      if (event === "voiceschanged") voiceListeners.add(listener);
    }),
    removeEventListener: vi.fn((event: string, listener: EventListener) => {
      if (event === "voiceschanged") voiceListeners.delete(listener);
    }),
  };

  vi.stubGlobal("window", { speechSynthesis: synthesis });
  vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

  return {
    synthesis,
    utterances,
    setVoices(nextVoices: SpeechSynthesisVoice[]) {
      voices = nextVoices;
    },
    emitVoicesChanged() {
      voiceListeners.forEach((listener) => listener(new Event("voiceschanged")));
    },
  };
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

  it("enumerates voices immediately, refreshes on voiceschanged, and cleans up", () => {
    const voice = fakeVoice("voice:one", "Voice One", "en-US");
    const { synthesis, setVoices, emitVoicesChanged } = installSpeechMocks();
    const updates: SpeechSynthesisVoice[][] = [];
    const unsubscribe = subscribeToReadAloudVoices((voices) => {
      updates.push([...voices]);
    });

    expect(updates).toEqual([[]]);
    expect(getAvailableReadAloudVoices()).toEqual([]);
    setVoices([voice]);
    emitVoicesChanged();
    expect(updates).toEqual([[], [voice]]);

    unsubscribe();
    setVoices([]);
    emitVoicesChanged();
    expect(updates).toEqual([[], [voice]]);
    expect(synthesis.addEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
    expect(synthesis.removeEventListener).toHaveBeenCalledWith(
      "voiceschanged",
      expect.any(Function),
    );
  });

  it("matches a saved voice exactly before falling back to voiceURI", () => {
    const original = fakeVoice("voice:one", "Original", "en-US");
    const changed = fakeVoice("voice:one", "Renamed", "en-GB");
    const exactPreference: ReadAloudVoicePreference = {
      voiceURI: original.voiceURI,
      name: original.name,
      lang: original.lang,
    };

    expect(findMatchingReadAloudVoice(exactPreference, [changed, original])).toBe(
      original,
    );
    expect(findMatchingReadAloudVoice(exactPreference, [changed])).toBe(changed);
    expect(
      findMatchingReadAloudVoice(
        { ...exactPreference, voiceURI: "voice:missing" },
        [original],
      ),
    ).toBeNull();
    expect(findMatchingReadAloudVoice(null, [original])).toBeNull();
  });

  it("applies the selected rate and leaves Device Default voice unset", () => {
    const { utterances } = installSpeechMocks([
      fakeVoice("voice:one", "Voice One", "en-US"),
    ]);

    expect(
      startReadAloud("message-a", "Response", { voice: null, rate: 0.75 }),
    ).toBe(true);
    expect(utterances[0]?.voice).toBeNull();
    expect(utterances[0]?.lang).toBe("");
    expect(utterances[0]?.rate).toBe(0.75);
  });

  it("binds and normalizes the selected voice language for browser speech", () => {
    const voice = fakeVoice(
      "voice:bg",
      "Bulgarian Bulgaria",
      "bg_BG",
    );
    const { utterances } = installSpeechMocks([voice]);

    expect(
      startReadAloud("message-bg", "Response", {
        voice: {
          voiceURI: voice.voiceURI,
          name: voice.name,
          lang: voice.lang,
        },
        rate: 1,
      }),
    ).toBe(true);

    expect(utterances[0]?.voice).toBe(voice);
    expect(utterances[0]?.lang).toBe("bg-BG");
  });

  it("restores exact and voiceURI-matched saved voices", () => {
    const exact = fakeVoice("voice:one", "Voice One", "en-US");
    const renamed = fakeVoice("voice:two", "Renamed Voice", "en-GB");
    const { utterances } = installSpeechMocks([exact, renamed]);

    startReadAloud("message-a", "Exact", {
      voice: { voiceURI: "voice:one", name: "Voice One", lang: "en-US" },
      rate: 1,
    });
    startReadAloud("message-b", "URI fallback", {
      voice: { voiceURI: "voice:two", name: "Old Name", lang: "en-US" },
      rate: 1.25,
    });

    expect(utterances[0]?.voice).toBe(exact);
    expect(utterances[1]?.voice).toBe(renamed);
    expect(utterances[1]?.rate).toBe(1.25);
  });

  it("uses Device Default while a saved voice is missing and restores it later", () => {
    const restored = fakeVoice("voice:saved", "Saved Voice", "en-US");
    const preferences: ReadAloudPreferences = {
      voice: {
        voiceURI: restored.voiceURI,
        name: restored.name,
        lang: restored.lang,
      },
      rate: 1,
    };
    const { utterances, setVoices, emitVoicesChanged } = installSpeechMocks();

    startReadAloud("message-a", "Before voices load", preferences);
    expect(utterances[0]?.voice).toBeNull();

    setVoices([restored]);
    emitVoicesChanged();
    startReadAloud("message-b", "After voices load", preferences);
    expect(utterances[1]?.voice).toBe(restored);
  });

  it("previews with saved options, cancels active speech, and is replaced by normal speech", () => {
    const voice = fakeVoice("voice:preview", "Preview Voice", "en-US");
    const preferences: ReadAloudPreferences = {
      voice: { voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang },
      rate: 1.5,
    };
    const { synthesis, utterances } = installSpeechMocks([voice]);

    startReadAloud("message-a", "Active response");
    expect(previewReadAloud(preferences)).toBe(true);
    expect(getActiveReadAloudMessageId()).toBeNull();
    expect(utterances[1]?.text).toBe(READ_ALOUD_PREVIEW_TEXT);
    expect(utterances[1]?.voice).toBe(voice);
    expect(utterances[1]?.rate).toBe(1.5);
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
