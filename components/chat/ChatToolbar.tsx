"use client";

import { Globe, MessageSquareText, Mic, Plus, SendHorizonal } from "lucide-react";
import Tooltip from "@/components/ui/Tooltip";

type ChatToolbarProps = {
  mode: "standard" | "web";
  onModeChange: (mode: "standard" | "web") => void;
  onMicClick: () => void;
  onNewChat: () => void;
  onSend: () => void;
  disabled?: boolean;
};

export default function ChatToolbar({
  mode,
  onModeChange,
  onMicClick,
  onNewChat,
  onSend,
  disabled = false,
}: ChatToolbarProps) {
  const activeChip =
    "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900";
  const inactiveChip =
    "border-zinc-300 bg-white text-zinc-700 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Tooltip content="Start a new conversation">
        <button
          type="button"
          onClick={onNewChat}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 px-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="New chat"
        >
          <Plus className="h-4 w-4" />
        </button>
      </Tooltip>

      <Tooltip content="General writing, brainstorming, and everyday help">
        <button
          type="button"
          onClick={() => onModeChange("standard")}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${
            mode === "standard" ? activeChip : inactiveChip
          }`}
          aria-pressed={mode === "standard"}
        >
          <MessageSquareText className="h-4 w-4" />
          Standard
        </button>
      </Tooltip>

      <Tooltip content="Use current online information when freshness matters">
        <button
          type="button"
          onClick={() => onModeChange("web")}
          className={`inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm font-medium transition ${
            mode === "web" ? activeChip : inactiveChip
          }`}
          aria-pressed={mode === "web"}
        >
          <Globe className="h-4 w-4" />
          Web Search
        </button>
      </Tooltip>

      <Tooltip content="Speak your message using your microphone">
        <button
          type="button"
          onClick={onMicClick}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-300 px-3 text-zinc-700 transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
          aria-label="Use microphone"
        >
          <Mic className="h-4 w-4" />
        </button>
      </Tooltip>

      <Tooltip content="Send your message">
        <button
          type="button"
          onClick={onSend}
          disabled={disabled}
          className="inline-flex h-10 items-center justify-center rounded-xl border border-zinc-900 bg-zinc-900 px-3 text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900"
          aria-label="Send message"
        >
          <SendHorizonal className="h-4 w-4" />
        </button>
      </Tooltip>
    </div>
  );
}