export function formatTimestamp(value: string) {
  try {
    return new Date(value).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function buildConversationTitle(input: string) {
  const trimmed = input.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New Chat";
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}...` : trimmed;
}