export type AdaptiveReasoningEffort = "low" | "medium" | "high";

export type AdaptiveReasoningRoute = "standard" | "web_search";

export type AdaptiveReasoningInput = {
  route: AdaptiveReasoningRoute;
  message: string;
  hasDocuments?: boolean;
  hasImages?: boolean;
};

const HIGH_REASONING_PATTERNS = [
  /\b(?:analy[sz]e|analysis|analy[sz]ing)\b/,
  /\b(?:compare|comparison|trade-?offs?|synthesi[sz]e|synthesis)\b/,
  /\b(?:debug|debugging|troubleshoot(?:ing)?|diagnos(?:e|is|tic))\b/,
  /\broot[-\s]?cause\b/,
  /\b(?:architecture|architectural)\b.*\b(?:trade-?offs?|design|compare|evaluate|review)\b|\b(?:system design|design trade-?offs?)\b/,
  /\b(?:risk assessment|assess(?:ment)?|evaluate|evaluation)\b.*\b(?:risk|risks|regulatory|compliance)\b/,
  /\b(?:multi[-\s]?step|step[-\s]?by[-\s]?step)\b.*\b(?:plan|migration|implementation|rollout|dependencies?)\b/,
  /\b(?:migration|implementation|rollout)\s+plan\b/,
  /\b(?:code|typescript|javascript|python|sql|algorithm|complexity)\b.*\b(?:analy[sz]e|review|debug|diagnos(?:e|is)|design|refactor|concurrency|performance)\b/,
];

const LOW_REASONING_PATTERN =
  /^(?:please\s+)?(?:(?:can|could|would)\s+you\s+|help\s+me\s+)?(?:rewrite|rephrase|proofread|translate|extract|format|convert|shorten|condense|summarize|summarise|label|classify|categorize|categorise|tag|(?:correct|fix)\s+(?:the\s+)?(?:grammar|spelling))\b/;

function normalizeMessage(message: string): string {
  return message.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Selects effort from the user's current request only. Route and attachment
 * metadata are deliberately not escalation signals: ordinary requests should
 * behave the same in Standard and Web Search, with or without attachments.
 */
export function selectReasoningEffort(
  input: AdaptiveReasoningInput,
): AdaptiveReasoningEffort {
  const message = normalizeMessage(input.message);

  if (!message) {
    return "medium";
  }

  if (HIGH_REASONING_PATTERNS.some((pattern) => pattern.test(message))) {
    return "high";
  }

  if (LOW_REASONING_PATTERN.test(message)) {
    return "low";
  }

  return "medium";
}
