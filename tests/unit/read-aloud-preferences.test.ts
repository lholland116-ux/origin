import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buildReadAloudVoiceOptions } from "@/components/chat/ReadAloudSettings";
import { findMatchingReadAloudVoice } from "@/lib/read-aloud";
import {
  DEFAULT_READ_ALOUD_PREFERENCES,
  getStoredReadAloudPreferences,
  parseReadAloudPreferences,
  READ_ALOUD_PREFERENCES_STORAGE_KEY,
  setStoredReadAloudPreferences,
  type ReadAloudPreferences,
} from "@/lib/read-aloud-preferences";

const settingsSource = readFileSync(
  "components/chat/ReadAloudSettings.tsx",
  "utf8",
);
const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");

function fakeVoice(
  voiceURI: string,
  name: string,
  lang: string,
  localService: boolean,
): SpeechSynthesisVoice {
  return { voiceURI, name, lang, localService, default: false };
}

function installStorage(initialValue: string | null = null) {
  let value = initialValue;
  const localStorage = {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key: string, nextValue: string) => {
      value = nextValue;
    }),
  };
  vi.stubGlobal("window", { localStorage });
  return localStorage;
}

describe("Read Aloud preferences and settings", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("persists Device Default as a null voice and restores valid rates", () => {
    const storage = installStorage();
    const preferences: ReadAloudPreferences = { voice: null, rate: 1.25 };

    setStoredReadAloudPreferences(preferences);

    expect(storage.setItem).toHaveBeenCalledWith(
      READ_ALOUD_PREFERENCES_STORAGE_KEY,
      JSON.stringify(preferences),
    );
    expect(getStoredReadAloudPreferences()).toEqual(preferences);
  });

  it.each([0.75, 1, 1.25, 1.5] as const)(
    "accepts the supported %s speech rate",
    (rate) => {
      expect(parseReadAloudPreferences({ voice: null, rate })).toEqual({
        voice: null,
        rate,
      });
    },
  );

  it("falls back for corrupt JSON, invalid rates, and invalid voice data", () => {
    installStorage("not JSON");
    expect(getStoredReadAloudPreferences()).toEqual(
      DEFAULT_READ_ALOUD_PREFERENCES,
    );
    expect(parseReadAloudPreferences({ voice: null, rate: 2 })).toEqual(
      DEFAULT_READ_ALOUD_PREFERENCES,
    );
    expect(
      parseReadAloudPreferences({
        voice: { voiceURI: "", name: "Voice", lang: "en-US" },
        rate: 1,
      }),
    ).toEqual(DEFAULT_READ_ALOUD_PREFERENCES);
  });

  it("survives unavailable localStorage reads and writes", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem: vi.fn(() => {
          throw new Error("blocked");
        }),
        setItem: vi.fn(() => {
          throw new Error("blocked");
        }),
      },
    });

    expect(getStoredReadAloudPreferences()).toEqual(
      DEFAULT_READ_ALOUD_PREFERENCES,
    );
    expect(() =>
      setStoredReadAloudPreferences({ voice: null, rate: 1 }),
    ).not.toThrow();
  });

  it("disambiguates duplicate voice labels without normally showing voiceURI", () => {
    const options = buildReadAloudVoiceOptions([
      fakeVoice("local:one", "Alex", "en-US", true),
      fakeVoice("remote:one", "Alex", "en-US", false),
      fakeVoice("local:two", "Alex", "en-US", true),
      fakeVoice("local:unique", "Sam", "en-GB", true),
    ]);

    expect(options.map((option) => option.label)).toEqual([
      "Alex — en-US — Local (1)",
      "Alex — en-US — Online",
      "Alex — en-US — Local (2)",
      "Sam — en-GB",
    ]);
    expect(options.map((option) => option.label).join(" ")).not.toContain(
      "local:",
    );
  });

  it("retains a missing saved voice preference for later restoration", () => {
    const saved: ReadAloudPreferences = {
      voice: { voiceURI: "voice:saved", name: "Saved", lang: "en-US" },
      rate: 1.5,
    };
    const storage = installStorage(JSON.stringify(saved));
    const restored = getStoredReadAloudPreferences();

    expect(findMatchingReadAloudVoice(restored.voice, [])).toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(
      findMatchingReadAloudVoice(restored.voice, [
        fakeVoice("voice:saved", "Saved", "en-US", true),
      ]),
    ).not.toBeNull();
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("places accessible Read Aloud controls by Theme in Profile/Settings", () => {
    const profileSettingsIndex = clientSource.indexOf(
      'aria-label="Profile and settings"',
    );
    const themeIndex = clientSource.indexOf("Theme", profileSettingsIndex);
    const settingsIndex = clientSource.indexOf(
      "<ReadAloudSettings",
      profileSettingsIndex,
    );
    const helpIndex = clientSource.indexOf('href="/help"', settingsIndex);

    expect(profileSettingsIndex).toBeGreaterThan(-1);
    expect(themeIndex).toBeGreaterThan(-1);
    expect(settingsIndex).toBeGreaterThan(themeIndex);
    expect(helpIndex).toBeGreaterThan(settingsIndex);
    expect(settingsSource).toContain('aria-expanded={open}');
    expect(settingsSource).toContain('aria-controls={controlsId}');
    expect(settingsSource).toContain("Device Default");
    expect(settingsSource).toContain("Loading available voices…");
    expect(settingsSource).toContain(
      "Saved voice unavailable — using Device Default",
    );
    expect(settingsSource).toContain("Preview voice");
  });
});
