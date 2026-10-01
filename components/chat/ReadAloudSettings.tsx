"use client";

import { ChevronDown, ChevronUp, Volume2 } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import {
  findMatchingReadAloudVoice,
  getAvailableReadAloudVoices,
  isReadAloudSupported,
  previewReadAloud,
  refreshAvailableReadAloudVoices,
  subscribeToReadAloudVoices,
} from "@/lib/read-aloud";
import {
  getStoredReadAloudPreferences,
  READ_ALOUD_RATES,
  setStoredReadAloudPreferences,
  type ReadAloudPreferences,
  type ReadAloudRate,
} from "@/lib/read-aloud-preferences";
import {
  getChatThemeHoverClass,
  type ChatTheme,
} from "@/lib/chat-themes";

const DEVICE_DEFAULT_VALUE = "device-default";
const SAVED_VOICE_UNAVAILABLE_VALUE = "saved-voice-unavailable";

type VoiceOption = {
  readonly key: string;
  readonly label: string;
  readonly voice: SpeechSynthesisVoice;
};

function voiceKey(voice: SpeechSynthesisVoice): string {
  return JSON.stringify([voice.voiceURI, voice.name, voice.lang]);
}

export function buildReadAloudVoiceOptions(
  voices: readonly SpeechSynthesisVoice[],
): readonly VoiceOption[] {
  const baseLabels = voices.map((voice) => `${voice.name} — ${voice.lang}`);
  const baseCounts = new Map<string, number>();
  for (const label of baseLabels) {
    baseCounts.set(label, (baseCounts.get(label) ?? 0) + 1);
  }

  const qualifiedLabels = voices.map((voice, index) => {
    const base = baseLabels[index] ?? `${voice.name} — ${voice.lang}`;
    return (baseCounts.get(base) ?? 0) > 1
      ? `${base} — ${voice.localService ? "Local" : "Online"}`
      : base;
  });
  const qualifiedCounts = new Map<string, number>();
  for (const label of qualifiedLabels) {
    qualifiedCounts.set(label, (qualifiedCounts.get(label) ?? 0) + 1);
  }
  const occurrences = new Map<string, number>();

  return voices.map((voice, index) => {
    const qualified = qualifiedLabels[index] ?? `${voice.name} — ${voice.lang}`;
    const occurrence = (occurrences.get(qualified) ?? 0) + 1;
    occurrences.set(qualified, occurrence);
    const label =
      (qualifiedCounts.get(qualified) ?? 0) > 1
        ? `${qualified} (${occurrence})`
        : qualified;
    return { key: `${voiceKey(voice)}:${index}`, label, voice };
  });
}

export default function ReadAloudSettings({ theme }: { theme: ChatTheme }) {
  const controlsId = useId();
  const [open, setOpen] = useState(false);
  const [supported] = useState(isReadAloudSupported);
  const [voices, setVoices] = useState<readonly SpeechSynthesisVoice[]>([]);
  const [preferences, setPreferences] = useState<ReadAloudPreferences>(() =>
    getStoredReadAloudPreferences(),
  );
  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    return subscribeToReadAloudVoices(setVoices);
  }, []);

  const voiceOptions = useMemo(
    () => buildReadAloudVoiceOptions(voices),
    [voices],
  );
  const matchedVoice = findMatchingReadAloudVoice(preferences.voice, voices);
  const savedVoiceUnavailable =
    preferences.voice !== null && voices.length > 0 && matchedVoice === null;
  const selectedVoiceValue = matchedVoice
    ? voiceOptions.find((option) => option.voice === matchedVoice)?.key ??
      DEVICE_DEFAULT_VALUE
    : savedVoiceUnavailable
      ? SAVED_VOICE_UNAVAILABLE_VALUE
      : DEVICE_DEFAULT_VALUE;

  function savePreferences(next: ReadAloudPreferences): void {
    setPreferences(next);
    setStoredReadAloudPreferences(next);
    setPreviewFailed(false);
  }

  function handleVoiceChange(value: string): void {
    if (value === DEVICE_DEFAULT_VALUE) {
      savePreferences({ ...preferences, voice: null });
      return;
    }

    const selected = voiceOptions.find((option) => option.key === value)?.voice;
    if (!selected) return;
    savePreferences({
      ...preferences,
      voice: {
        voiceURI: selected.voiceURI,
        name: selected.name,
        lang: selected.lang,
      },
    });
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => {
          const nextOpen = !open;
          setOpen(nextOpen);
          if (nextOpen) {
            setVoices(getAvailableReadAloudVoices());
            void refreshAvailableReadAloudVoices().then(setVoices);
          }
        }}
        className={[
          "flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-medium transition",
          theme.mutedText,
          getChatThemeHoverClass(theme),
          "focus:outline-none focus:ring-2 focus:ring-white/20",
        ].join(" ")}
        aria-expanded={open}
        aria-controls={controlsId}
      >
        <span className="flex items-center gap-2">
          <Volume2 className="h-4 w-4" aria-hidden="true" />
          Read Aloud
        </span>
        {open ? (
          <ChevronUp className="h-4 w-4" aria-hidden="true" />
        ) : (
          <ChevronDown className="h-4 w-4" aria-hidden="true" />
        )}
      </button>

      {open ? (
        <section
          id={controlsId}
          aria-label="Read Aloud settings"
          className={[
            "mt-2 space-y-3 rounded-xl border p-3",
            theme.panelBorder,
          ].join(" ")}
        >
          {!supported ? (
            <p className={`text-xs ${theme.mutedText}`} role="status">
              Read Aloud is not available in this browser.
            </p>
          ) : (
            <>
              <label className={`block text-xs font-medium ${theme.inputText}`}>
                Voice
                <select
                  value={selectedVoiceValue}
                  onChange={(event) => handleVoiceChange(event.target.value)}
                  className={[
                    "mt-1 min-h-10 w-full rounded-lg border px-2 text-sm",
                    theme.inputBg,
                    theme.inputBorder,
                    theme.inputText,
                  ].join(" ")}
                >
                  <option value={DEVICE_DEFAULT_VALUE}>Device Default</option>
                  {savedVoiceUnavailable ? (
                    <option value={SAVED_VOICE_UNAVAILABLE_VALUE} disabled>
                      Saved voice unavailable (using Device Default)
                    </option>
                  ) : null}
                  {voiceOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className={`block text-xs font-medium ${theme.inputText}`}>
                Speed
                <select
                  value={preferences.rate}
                  onChange={(event) =>
                    savePreferences({
                      ...preferences,
                      rate: Number(event.target.value) as ReadAloudRate,
                    })
                  }
                  className={[
                    "mt-1 min-h-10 w-full rounded-lg border px-2 text-sm",
                    theme.inputBg,
                    theme.inputBorder,
                    theme.inputText,
                  ].join(" ")}
                >
                  {READ_ALOUD_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}×
                    </option>
                  ))}
                </select>
              </label>

              <button
                type="button"
                onClick={() => setPreviewFailed(!previewReadAloud(preferences))}
                className={[
                  "min-h-10 w-full rounded-lg border px-3 py-2 text-sm font-semibold transition",
                  theme.inputBorder,
                  theme.inputText,
                  getChatThemeHoverClass(theme),
                  "focus:outline-none focus:ring-2 focus:ring-blue-400/50",
                ].join(" ")}
              >
                Preview voice
              </button>

              <div aria-live="polite" className={`min-h-4 text-xs ${theme.mutedText}`}>
                {voices.length === 0
                  ? "Loading available voices… If none appear, native voices may be unavailable."
                  : savedVoiceUnavailable
                    ? "Saved voice unavailable — using Device Default"
                    : previewFailed
                      ? "Voice preview could not be played."
                      : ""}
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
