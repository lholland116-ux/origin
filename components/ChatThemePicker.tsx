"use client";

import { CHAT_THEMES } from "@/lib/chat-themes";

type ChatThemePickerProps = {
  selectedThemeId: string;
  onChange: (themeId: string) => void;
  className?: string;
};

function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export default function ChatThemePicker({
  selectedThemeId,
  onChange,
  className,
}: ChatThemePickerProps) {
  return (
    <div className={cn("space-y-3", className)}>
      <div>
        <h3 className="text-sm font-semibold text-white">Chat Theme</h3>
        <p className="mt-1 text-xs text-zinc-400">
          Choose the look of your chat window.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {CHAT_THEMES.map((theme) => {
          const isSelected = theme.id === selectedThemeId;

          return (
            <button
              key={theme.id}
              type="button"
              onClick={() => onChange(theme.id)}
              className={cn(
                "rounded-2xl border p-3 text-left transition focus:outline-none focus:ring-2 focus:ring-white/30",
                isSelected
                  ? "border-white/40 bg-white/10"
                  : "border-zinc-700 bg-zinc-900/70 hover:bg-zinc-800/80"
              )}
              aria-pressed={isSelected}
            >
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-white">{theme.label}</p>
                  <p className="mt-1 text-xs text-zinc-400">{theme.id}</p>
                </div>

                {isSelected ? (
                  <span className="rounded-full border border-emerald-500/30 bg-emerald-500/15 px-2 py-1 text-[10px] font-medium text-emerald-300">
                    Selected
                  </span>
                ) : null}
              </div>

              <div className="mt-3 rounded-xl border border-white/10 p-2">
                <div className={cn("rounded-lg p-2", theme.pageBg)}>
                  <div
                    className={cn(
                      "rounded-md border p-2",
                      theme.panelBg,
                      theme.panelBorder
                    )}
                  >
                    <div className="space-y-2">
                      <div
                        className={cn(
                          "max-w-[75%] rounded-2xl px-3 py-2 text-xs",
                          theme.assistantBubble,
                          theme.assistantText
                        )}
                      >
                        Assistant message
                      </div>
                      <div
                        className={cn(
                          "ml-auto max-w-[75%] rounded-2xl px-3 py-2 text-xs",
                          theme.userBubble,
                          theme.userText
                        )}
                      >
                        User message
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}