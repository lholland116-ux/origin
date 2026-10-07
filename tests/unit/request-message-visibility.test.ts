import { describe, expect, it } from "vitest";
import {
  isPendingAssistantMessage,
  omitPendingAssistantMessages,
  createPendingAssistantMessageContent,
} from "@/lib/chat/request-message-visibility";

describe("pending assistant message visibility", () => {
  it("hides only the reserved pending destination and preserves legacy empty artifact turns", () => {
    const messages = [
      { id: "user", role: "user", content: "Please do this." },
      {
        id: "pending",
        role: "assistant",
        content: createPendingAssistantMessageContent("request-1", "user-message-1"),
      },
      { id: "legacy-image-only", role: "assistant", content: "" },
      { id: "complete", role: "assistant", content: "Done." },
    ] as const;

    expect(isPendingAssistantMessage(messages[1])).toBe(true);
    expect(isPendingAssistantMessage(messages[0])).toBe(false);
    expect(isPendingAssistantMessage(messages[2])).toBe(false);
    expect(isPendingAssistantMessage(messages[3])).toBe(false);
    expect(omitPendingAssistantMessages(messages).map(({ id }) => id)).toEqual(["user", "legacy-image-only", "complete"]);
  });
});
