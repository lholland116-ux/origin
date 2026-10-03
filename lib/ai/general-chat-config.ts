import type { AdaptiveReasoningEffort } from "./reasoning-effort";

export const GENERAL_CHAT_MODEL = "gpt-5.6-luna";

/**
 * OpenAI request configuration for a primary general-chat response only.
 * Titles, CAPA, and document-intent planning intentionally do not use it.
 */
export function getGeneralChatConfig(effort: AdaptiveReasoningEffort) {
  return {
    model: GENERAL_CHAT_MODEL,
    reasoning: { effort },
  } as const;
}
