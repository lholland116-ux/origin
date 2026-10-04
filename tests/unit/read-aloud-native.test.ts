import { beforeEach, describe, expect, it, vi } from "vitest";

const nativeMocks = vi.hoisted(() => ({
  getPlatform: vi.fn(),
  isNativePlatform: vi.fn(),
  isPluginAvailable: vi.fn(),
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
    speak: nativeMocks.speak,
    stop: nativeMocks.stop,
  },
}));

import {
  getActiveReadAloudMessageId,
  isReadAloudSupported,
  previewReadAloud,
  READ_ALOUD_PREVIEW_TEXT,
  startReadAloud,
  stopReadAloud,
} from "@/lib/read-aloud";
import type { ReadAloudPreferences } from "@/lib/read-aloud-preferences";

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
      getVoices: vi.fn(),
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
    expect(startReadAloud("old-android", "No native plugin")).toBe(false);
    expect(previewReadAloud()).toBe(false);
    stopReadAloud();

    expect(nativeMocks.speak).not.toHaveBeenCalled();
    expect(nativeMocks.stop).not.toHaveBeenCalled();
  });

  it("uses the platform default voice and passes the saved rate", async () => {
    expect(
      startReadAloud("native-default", "# Native **speech**", { rate: 1.25 }),
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

  it("uses native preview options and replaces it with normal speech", async () => {
    const preferences: ReadAloudPreferences = { rate: 1.5 };

    expect(previewReadAloud(preferences)).toBe(true);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    expect(nativeMocks.speak.mock.calls[0]?.[0]).toMatchObject({
      text: READ_ALOUD_PREVIEW_TEXT,
      rate: 1.5,
    });
    expect(nativeMocks.speak.mock.calls[0]?.[0]).not.toHaveProperty("voice");
    expect(nativeMocks.speak.mock.calls[0]?.[0]).not.toHaveProperty("lang");

    startReadAloud("after-preview", "Normal speech", preferences);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledTimes(2));
    expect(nativeMocks.stop).toHaveBeenCalledTimes(2);
    expect(nativeMocks.speak.mock.calls[1]?.[0]).toMatchObject({
      text: "Normal speech",
    });
    expect(nativeMocks.speak.mock.calls[1]?.[0]).not.toHaveProperty("voice");
    expect(nativeMocks.speak.mock.calls[1]?.[0]).not.toHaveProperty("lang");
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

  it("handles native stop and speak errors without crashing", async () => {
    nativeMocks.stop.mockRejectedValue(new Error("stop unavailable"));
    nativeMocks.speak.mockRejectedValue(new Error("speak unavailable"));

    expect(startReadAloud("native-error", "Safe failure")).toBe(true);
    await vi.waitFor(() => expect(nativeMocks.speak).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(getActiveReadAloudMessageId()).toBeNull());
    expect(nativeMocks.speak.mock.calls[0]?.[0]).not.toHaveProperty("voice");
    expect(nativeMocks.speak.mock.calls[0]?.[0]).not.toHaveProperty("lang");
  });
});
