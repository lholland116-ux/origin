import { describe, expect, it } from "vitest";
import {
  getGeneralChatConfig,
  GENERAL_CHAT_MODEL,
} from "@/lib/ai/general-chat-config";
import {
  selectReasoningEffort,
  type AdaptiveReasoningEffort,
  type AdaptiveReasoningInput,
} from "@/lib/ai/reasoning-effort";

function select(message: string, overrides: Partial<AdaptiveReasoningInput> = {}) {
  return selectReasoningEffort({ route: "standard", message, ...overrides });
}

describe("selectReasoningEffort", () => {
  it.each([
    "Rewrite this paragraph more clearly.",
    "Proofread this email.",
    "Correct the grammar in this email.",
    "Translate this into Spanish.",
    "Extract the invoice number from this text.",
    "Format this as bullet points.",
    "Condense this supplied text.",
    "Classify these support tickets by category.",
  ])("selects low for a clearly bounded transformation: %s", (message) => {
    expect(select(message)).toBe("low");
  });

  it.each([
    ["What is photosynthesis?", {}],
    ["What is software architecture?", {}],
    ["What are regulatory requirements?", {}],
    ["What is the latest Node.js version?", { route: "web_search" as const }],
    ["What does this document say?", { hasDocuments: true }],
    ["What is shown here?", { hasImages: true }],
    ["What is 7 + 8?", {}],
    ["Help me with this.", {}],
    ["neutral text ".repeat(1_000), {}],
  ] as const)("selects medium for ordinary or unmatched input: %s", (message, overrides) => {
    expect(select(message, overrides)).toBe("medium");
  });

  it.each([
    "Analyze the root cause of this validation failure.",
    "Compare these architectures and explain the tradeoffs.",
    "Debug this TypeScript error and identify the likely cause.",
    "Assess the regulatory risks and propose a mitigation strategy.",
    "Create a multi-step migration plan and explain the dependencies.",
    "Analyze this TypeScript implementation for concurrency bugs.",
  ])("selects high for clear complex reasoning: %s", (message) => {
    expect(select(message)).toBe("high");
  });

  it.each([
    "Rewrite this analysis and identify the root cause",
    "Summarize these architecture tradeoffs and recommend a migration plan",
  ])("lets complex reasoning override transformation cues: %s", (message) => {
    expect(select(message)).toBe("high");
  });

  it("is mode-invariant when the message itself does not warrant another level", () => {
    const message = "What is photosynthesis?";

    expect(select(message, { route: "standard" })).toBe("medium");
    expect(select(message, { route: "web_search" })).toBe("medium");
  });

  it("does not let attachments alone escalate effort", () => {
    const message = "What is this about?";

    expect(select(message)).toBe("medium");
    expect(select(message, { hasDocuments: true })).toBe("medium");
    expect(select(message, { hasImages: true })).toBe("medium");
    expect(select(message, { hasDocuments: true, hasImages: true })).toBe("medium");
  });

  it("is deterministic, case-insensitive, and treats blank input as medium", () => {
    const input: AdaptiveReasoningInput = {
      route: "web_search",
      message: "DEBUG THIS TYPESCRIPT ERROR",
      hasDocuments: true,
    };

    expect(selectReasoningEffort(input)).toBe("high");
    expect(selectReasoningEffort(input)).toBe(selectReasoningEffort(input));
    expect(select("   \n\t  ")).toBe("medium");
  });
});

describe("getGeneralChatConfig", () => {
  it.each(["low", "medium", "high"] as const)(
    "returns only the shared primary general-chat configuration for %s effort",
    (effort: AdaptiveReasoningEffort) => {
      expect(getGeneralChatConfig(effort)).toEqual({
        model: GENERAL_CHAT_MODEL,
        reasoning: { effort },
      });
      expect(Object.keys(getGeneralChatConfig(effort))).toEqual(["model", "reasoning"]);
    },
  );

  it("keeps the shared model fixed at the current general-chat model", () => {
    expect(GENERAL_CHAT_MODEL).toBe("gpt-5.6-luna");
  });
});
