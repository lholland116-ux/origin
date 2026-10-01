import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
  isPluginAvailable: vi.fn(),
  getSupportedVoices: vi.fn(),
  speak: vi.fn(),
  stop: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    getPlatform: nativeMocks.getPlatform,
    isNativePlatform: nativeMocks.isNativePlatform,
    isPluginAvailable: nativeMocks.isPluginAvailable,
  },
}));

vi.mock("@capacitor-community/text-to-speech", () => ({
  QueueStrategy: { Flush: 0, Add: 1 },
  TextToSpeech: {
    getSupportedVoices: nativeMocks.getSupportedVoices,
    speak: nativeMocks.speak,
    stop: nativeMocks.stop,
  },
}));

import {
  getActiveReadAloudMessageId,
  isReadAloudSupported,
  previewReadAloud,
  READ_ALOUD_PREVIEW_TEXT,
  refreshAvailableReadAloudVoices,
  startReadAloud,
  stopReadAloud,
  subscribeToReadAloudVoices,
} from "@/lib/read-aloud";
import type { ReadAloudPreferences } from "@/lib/read-aloud-preferences";

function nativeVoice(
  voiceURI: string,
  name: string,
  lang: string,
  localService = true,
) {
  return { voiceURI, name, lang, localService, default: false };
}

async function waitForNativeStop(): Promise<void> {
  await vi.waitFor(() => expect(nativeMocks.stop).toHaveBeenCalled());
}

describe("Android native Read Aloud adapter", () => {
  beforeEach(async () => {
    nativeMocks.isNativePlatform.mockReturnValue(true);
    nativeMocks.getPlatform.mockReturnValue("android");
    nativeMocks.isPluginAvailable.mockReturnValue(true);
    nativeMocks.stop.mockResolvedValue(undefined);
    nativeMocks.speak.mockResolvedValue(undefined);
    nativeMocks.getSupportedVoices.mockResolvedValue({ voices: [] });

    stopReadAloud();
    await waitForNativeStop();
    vi.clearAllMocks();
  });

  it("keeps the browser adapter selected outside native Capacitor Android", () => {
    nativeMocks.isNativePlatform.mockReturnValue(false);
    nativeMocks.getPlatform.mockReturnValue("web");
    const utterances: Array<{ text: string; rate: number }> = [];
    const synthesis = {
      cancel: vi.fn(),
      speak: vi.fn((utterance: { text: string; rate: number }) =>
        utterances.push(utterance),
      ),
      getVoices: vi.fn(() => []),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    class FakeUtterance {
      onend: (() => void) | null = null;
      onerror: (() => void) | null = null;
      rate = 1;
      voice: SpeechSynthesisVoice | null = null;
      constructor(public readonly text: string) {}
    }
    vi.stubGlobal("window", { speechSynthesis: synthesis });
    vi.stubGlobal("SpeechSynthesisUtterance", FakeUtterance);

    expect(startReadAloud("web-message", "Browser speech")).toBe(true);
    expect(synthesis.speak).toHaveBeenCalledOnce();
    expect(utterances[0]?.text).toBe("Browser speech");
    expect(nativeMocks.speak).not.toHaveBeenCalled();
  });

  it("disables Read Aloud safely in an older Android binary without the plugin", async () => {
    nativeMocks.isPluginAvailable.mockReturnValue(false);

    expect(isReadAloudSupported()).toBe(false);
    await expect(refreshAvailableReadAloudVoices()).resolves.toEqual([]);
    const voiceUpdates: SpeechSynthesisVoice[][] = [];
    const unsubscribe = subscribeToReadAloudVoices((voices) => {
      voiceUpdates.push([...voices]);
    });
    expect(startReadAloud("old-android", "No native plugin")).toBe(false);
    expect(previewReadAloud()).toBe(false);
    stopReadAloud();

    expect(voiceUpdates).toEqual([[]]);
    expect(nativeMocks.getSupportedVoices).not.toHaveBeenCalled();
    expect(nativeMocks.speak).not.toHaveBeenCalled();
    expect(nativeMocks.stop).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("selects native Android and maps getSupportedVoices results", async () => {
    nativeMocks.getSupportedVoices.mockResolvedValue({
      voices: [nativeVoice("android:one", "Android One", "en-US", false)],
    });

    expect(isReadAloudSupported()).toBe(true);
    await expect(refreshAvailableReadAloudVoices()).resolves.toEqual([
      {
        voiceURI: "android:one",
        name: "Android One",
        lang: "en-US",
        localService: false,
        default: false,
      },
    ]);
  });

  it("uses native Device Default and passes the selected rate", async () => {
    expect(
      startReadAloud("native-default", "# Native **speech**", {
        voice: null,
        rate: 1.25,
      }),
    ).toBe(true);

    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    expect(nativeMocks.speak).toHaveBeenCalledWith({
      text: "Native speech",
      rate: 1.25,
      pitch: 1,
      volume: 1,
      queueStrategy: 0,
    });
  });

  it("matches a saved native voice and resolves its current index at speak time", async () => {
    const saved: ReadAloudPreferences = {
      voice: { voiceURI: "android:saved", name: "Saved", lang: "en-US" },
      rate: 0.75,
    };
    const other = nativeVoice("android:other", "Other", "en-GB");
    const savedVoice = nativeVoice("android:saved", "Saved", "en-US");
    nativeMocks.getSupportedVoices.mockResolvedValue({
      voices: [other, savedVoice],
    });

    startReadAloud("native-one", "First", saved);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    expect(nativeMocks.speak.mock.calls[0]?.[0]).toMatchObject({
      voice: 1,
      lang: "en-US",
    });

    const renamedSavedVoice = nativeVoice(
      "android:saved",
      "Renamed Saved Voice",
      "fr-FR",
    );
    nativeMocks.getSupportedVoices.mockResolvedValue({
      voices: [renamedSavedVoice, other],
    });
    startReadAloud("native-two", "Second", saved);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledTimes(2));
    expect(nativeMocks.speak.mock.calls[1]?.[0]).toMatchObject({
      voice: 0,
      lang: "fr-FR",
    });
  });

  it("falls back to Device Default when a saved native voice is missing", async () => {
    nativeMocks.getSupportedVoices.mockResolvedValue({
      voices: [nativeVoice("android:other", "Other", "en-US")],
    });

    startReadAloud("native-missing", "Fallback", {
      voice: { voiceURI: "android:missing", name: "Missing", lang: "fr-FR" },
      rate: 1,
    });

    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    const options = nativeMocks.speak.mock.calls[0]?.[0];
    expect(options).not.toHaveProperty("voice");
    expect(options).not.toHaveProperty("lang");
  });

  it("uses native preview options and replaces it with normal speech", async () => {
    const voice = nativeVoice("android:preview", "Preview", "en-US");
    const preferences: ReadAloudPreferences = {
      voice: { voiceURI: voice.voiceURI, name: voice.name, lang: voice.lang },
      rate: 1.5,
    };
    nativeMocks.getSupportedVoices.mockResolvedValue({ voices: [voice] });

    expect(previewReadAloud(preferences)).toBe(true);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    expect(nativeMocks.speak.mock.calls[0]?.[0]).toMatchObject({
      text: READ_ALOUD_PREVIEW_TEXT,
      rate: 1.5,
      voice: 0,
    });

    startReadAloud("after-preview", "Normal speech", preferences);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledTimes(2));
    expect(nativeMocks.stop).toHaveBeenCalledTimes(2);
    expect(nativeMocks.speak.mock.calls[1]?.[0]).toMatchObject({
      text: "Normal speech",
      voice: 0,
    });
  });

  it("stops native speech and clears active state", async () => {
    let finishSpeech: (() => void) | undefined;
    nativeMocks.speak.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishSpeech = resolve;
        }),
    );

    startReadAloud("native-active", "Long speech");
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    expect(getActiveReadAloudMessageId()).toBe("native-active");

    stopReadAloud();
    await vi.waitFor(() => expect(nativeMocks.stop).toHaveBeenCalledTimes(2));
    expect(getActiveReadAloudMessageId()).toBeNull();
    finishSpeech?.();
  });

  it("refreshes native subscribers and removes listeners cleanly", async () => {
    const updates: SpeechSynthesisVoice[][] = [];
    nativeMocks.getSupportedVoices.mockResolvedValue({
      voices: [nativeVoice("android:one", "One", "en-US")],
    });
    const unsubscribe = subscribeToReadAloudVoices((voices) => {
      updates.push([...voices]);
    });

    await vi.waitFor(() =>
      expect(updates.at(-1)?.[0]?.voiceURI).toBe("android:one"),
    );
    unsubscribe();
    const updateCount = updates.length;
    nativeMocks.getSupportedVoices.mockResolvedValue({
      voices: [nativeVoice("android:two", "Two", "en-GB")],
    });
    await refreshAvailableReadAloudVoices();
    expect(updates).toHaveLength(updateCount);
  });

  it("handles native enumeration and speak errors without crashing", async () => {
    nativeMocks.stop.mockRejectedValue(new Error("stop unavailable"));
    nativeMocks.getSupportedVoices.mockRejectedValue(
      new Error("voices unavailable"),
    );
    nativeMocks.speak.mockRejectedValue(new Error("speak unavailable"));

    expect(startReadAloud("native-error", "Safe failure")).toBe(true);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(getActiveReadAloudMessageId()).toBeNull());
    expect(nativeMocks.speak.mock.calls[0]?.[0]).not.toHaveProperty("voice");
  });
});
