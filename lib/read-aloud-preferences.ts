export const READ_ALOUD_PREFERENCES_STORAGE_KEY =
  "lvtchat:read-aloud-preferences";

export const READ_ALOUD_RATES = [0.75, 1, 1.25, 1.5] as const;

export type ReadAloudRate = (typeof READ_ALOUD_RATES)[number];

export type ReadAloudPreferences = {
  readonly rate: ReadAloudRate;
};

export const DEFAULT_READ_ALOUD_PREFERENCES: ReadAloudPreferences = {
  rate: 1,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isReadAloudRate(value: unknown): value is ReadAloudRate {
  return READ_ALOUD_RATES.some((rate) => rate === value);
}

export function parseReadAloudPreferences(value: unknown): ReadAloudPreferences {
  if (!isRecord(value) || !isReadAloudRate(value.rate)) {
    return DEFAULT_READ_ALOUD_PREFERENCES;
  }

  // Ignore the legacy voice field so it can never override the platform default.
  return { rate: value.rate };
}

export function getStoredReadAloudPreferences(): ReadAloudPreferences {
  if (typeof window === "undefined") return DEFAULT_READ_ALOUD_PREFERENCES;

  try {
    const stored = window.localStorage.getItem(
      READ_ALOUD_PREFERENCES_STORAGE_KEY,
    );
    if (!stored) return DEFAULT_READ_ALOUD_PREFERENCES;
    return parseReadAloudPreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_READ_ALOUD_PREFERENCES;
  }
}

export function setStoredReadAloudPreferences(
  preferences: ReadAloudPreferences,
): void {
  if (typeof window === "undefined") return;

  const validated = parseReadAloudPreferences(preferences);
  try {
    window.localStorage.setItem(
      READ_ALOUD_PREFERENCES_STORAGE_KEY,
      JSON.stringify(validated),
    );
  } catch {
    // Read Aloud remains usable with in-memory preferences when storage fails.
  }
}
