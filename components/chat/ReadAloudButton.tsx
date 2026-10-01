"use client";

import { Square, Volume2 } from "lucide-react";
import { useEffect, useState } from "react";
import Tooltip from "@/components/ui/Tooltip";
import {
  cleanTextForSpeech,
  getActiveReadAloudMessageId,
  isReadAloudSupported,
  startReadAloud,
  stopReadAloud,
  subscribeToReadAloud,
} from "@/lib/read-aloud";
import { getStoredReadAloudPreferences } from "@/lib/read-aloud-preferences";
import { getChatThemeHoverClass, type ChatTheme } from "@/lib/chat-themes";

type ReadAloudButtonProps = {
  messageId: string;
  text: string;
  theme: ChatTheme;
};

export default function ReadAloudButton({
  messageId,
  text,
  theme,
}: ReadAloudButtonProps) {
  const [supported, setSupported] = useState(false);
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null);

  useEffect(() => {
    const initializationTimeout = window.setTimeout(() => {
      setSupported(isReadAloudSupported());
      setActiveMessageId(getActiveReadAloudMessageId());
    }, 0);
    const unsubscribe = subscribeToReadAloud(() => {
      setActiveMessageId(getActiveReadAloudMessageId());
    });

    return () => {
      window.clearTimeout(initializationTimeout);
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    return () => {
      if (getActiveReadAloudMessageId() === messageId) {
        stopReadAloud();
      }
    };
  }, [messageId]);

  const speechText = cleanTextForSpeech(text);

  if (!supported || !speechText) return null;

  const isSpeaking = activeMessageId === messageId;
  const label = isSpeaking ? "Stop read aloud" : "Read aloud";

  return (
    <Tooltip theme={theme} content={label} touchSafe>
      <button
        type="button"
        onClick={() => {
          if (isSpeaking) {
            stopReadAloud();
          } else {
            startReadAloud(messageId, text, getStoredReadAloudPreferences());
          }
        }}
        className={[
          "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition focus:outline-none focus:ring-2 focus:ring-blue-400/50",
          theme.inputText,
          getChatThemeHoverClass(theme),
        ].join(" ")}
        aria-label={label}
        title={label}
      >
        {isSpeaking ? (
          <Square className="h-4 w-4" aria-hidden="true" />
        ) : (
          <Volume2 className="h-4 w-4" aria-hidden="true" />
        )}
        <span className="sr-only">{label}</span>
      </button>
    </Tooltip>
  );
}
