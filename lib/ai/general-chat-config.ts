import type { ProviderChatReasoningEffort } from "./reasoning-mode";

/** The production default for Standard Chat and Web Search primary requests. */
export const GPT_6_LUNA_MODEL = "gpt-6-luna";

/** Kept as an immediate, non-destructive rollback target for the migration. */
export const GPT_5_6_LUNA_MODEL = "gpt-5.6-luna";

export const GENERAL_CHAT_MODEL = GPT_6_LUNA_MODEL;
export const GENERAL_CHAT_ROLLBACK_MODEL = GPT_5_6_LUNA_MODEL;

/**
 * Configured OpenAI model and reasoning effort for primary general-chat calls.
 * Planner-only callers may reuse it at low effort without changing chat routing.
 * Titles, CAPA, and document-intent planning intentionally do not use it.
 */
export function getGeneralChatConfig(effort: ProviderChatReasoningEffort) {
  return {
    model: GENERAL_CHAT_MODEL,
    reasoning: { effort },
  } as const;
}
