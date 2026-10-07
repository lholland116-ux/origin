/** Reserved prefix persisted only while an agent request's assistant turn is pending. */
export const PENDING_ASSISTANT_MESSAGE_PREFIX = "[[LVTCHAT-PENDING-AGENT-ASSISTANT-V1:";

export function createPendingAssistantMessageContent(requestId: string, userMessageId: string): string {
  return `${PENDING_ASSISTANT_MESSAGE_PREFIX}${requestId}:${userMessageId}]]`;
}

/** Pending request destinations are not user-visible turns; legacy empty artifact turns remain visible. */
export function isPendingAssistantMessage(message: { readonly role: string; readonly content: string }): boolean {
  return message.role === "assistant" && message.content.startsWith(PENDING_ASSISTANT_MESSAGE_PREFIX);
}

export function omitPendingAssistantMessages<T extends { readonly role: string; readonly content: string }>(
  messages: readonly T[],
): T[] {
  return messages.filter((message) => !isPendingAssistantMessage(message));
}
