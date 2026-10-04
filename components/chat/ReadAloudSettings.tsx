"use client";

import { ChevronDown, ChevronUp, Volume2 } from "lucide-react";
import { useId, useState } from "react";
import {
  isReadAloudSupported,
  previewReadAloud,
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

export default function ReadAloudSettings({ theme }: { theme: ChatTheme }) {
  const controlsId = useId();
  const [open, setOpen] = useState(false);
  const [supported] = useState(isReadAloudSupported);
  const [preferences, setPreferences] = useState<ReadAloudPreferences>(() =>
    getStoredReadAloudPreferences(),
  );
  const [previewFailed, setPreviewFailed] = useState(false);

  function savePreferences(next: ReadAloudPreferences): void {
    setPreferences(next);
    setStoredReadAloudPreferences(next);
    setPreviewFailed(false);
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
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
                Preview Read Aloud
              </button>

              <div aria-live="polite" className={`min-h-4 text-xs ${theme.mutedText}`}>
                {previewFailed ? "Read Aloud preview could not be played." : ""}
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
