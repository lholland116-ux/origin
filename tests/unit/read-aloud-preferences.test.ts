import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_READ_ALOUD_PREFERENCES,
  getStoredReadAloudPreferences,
  parseReadAloudPreferences,
  READ_ALOUD_PREFERENCES_STORAGE_KEY,
  setStoredReadAloudPreferences,
} from "@/lib/read-aloud-preferences";

const settingsSource = readFileSync(
  "components/chat/ReadAloudSettings.tsx",
  "utf8",
);
const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");

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

  it("defaults to normal playback speed", () => {
    expect(DEFAULT_READ_ALOUD_PREFERENCES).toEqual({ rate: 1 });
  });

  it("persists the playback rate and ignores legacy saved voice metadata", () => {
    const legacyPreferences = {
      voice: { voiceURI: "voice:saved", name: "Saved", lang: "fr-FR" },
      rate: 1.25,
    };
    const storage = installStorage(JSON.stringify(legacyPreferences));

    expect(getStoredReadAloudPreferences()).toEqual({ rate: 1.25 });
    setStoredReadAloudPreferences(getStoredReadAloudPreferences());

    expect(storage.setItem).toHaveBeenCalledWith(
      READ_ALOUD_PREFERENCES_STORAGE_KEY,
      JSON.stringify({ rate: 1.25 }),
    );
    expect(getStoredReadAloudPreferences()).toEqual({ rate: 1.25 });
  });

  it.each([0.75, 1, 1.25, 1.5] as const)(
    "accepts the supported %s speech rate",
    (rate) => {
      expect(parseReadAloudPreferences({ rate })).toEqual({ rate });
    },
  );

  it("falls back for corrupt JSON and invalid rates", () => {
    installStorage("not JSON");
    expect(getStoredReadAloudPreferences()).toEqual(
      DEFAULT_READ_ALOUD_PREFERENCES,
    );
    expect(parseReadAloudPreferences({ rate: 2 })).toEqual(
      DEFAULT_READ_ALOUD_PREFERENCES,
    );
  });

  it("preserves a valid rate even when legacy voice metadata is malformed", () => {
    expect(
      parseReadAloudPreferences({
        voice: { voiceURI: "", name: null, lang: [] },
        rate: 1.5,
      }),
    ).toEqual({ rate: 1.5 });
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
      setStoredReadAloudPreferences({ rate: 1 }),
    ).not.toThrow();
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
    expect(settingsSource).not.toContain("<select\n                  value={selectedVoiceValue}");
    expect(settingsSource).toContain("Speed");
    expect(settingsSource).toContain("Preview Read Aloud");
  });
});
