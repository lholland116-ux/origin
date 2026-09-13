import { describe, expect, it } from "vitest";
import {
  createOptimisticAssistantMessage,
  createOptimisticUserMessage,
  formatMessageTime,
  getMessageDisplayLabel,
  normalizeInitialMessages,
} from "@/app/chat/ChatClient";

describe("chat message metadata", () => {
  it("creates fresh user and assistant messages with one stable creation timestamp each", () => {
    const userMessage = createOptimisticUserMessage("user-1", "Hello");
    const assistantMessage = createOptimisticAssistantMessage("assistant-1");

    expect(userMessage).toMatchObject({
      role: "user",
      created_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(userMessage.created_at ?? ""))).toBe(false);

    expect(assistantMessage).toMatchObject({
      role: "assistant",
      created_at: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(assistantMessage.created_at ?? ""))).toBe(false);

    const streamedAssistant = { ...assistantMessage, content: "Partial response" };
    expect(streamedAssistant.created_at).toBe(assistantMessage.created_at);
  });

  it("uses LVTChat as the assistant display label without changing message roles", () => {
    expect(getMessageDisplayLabel("assistant")).toBe("LVTChat");
    expect(getMessageDisplayLabel("user")).toBe("You");
  });

  it("formats valid timestamps in the user's local time and omits missing values", () => {
    const createdAt = "2026-09-13T18:13:00.000Z";

    expect(formatMessageTime(createdAt)).toBe(
      new Date(createdAt).toLocaleTimeString([], {
        hour: "numeric",
        minute: "2-digit",
      })
    );
    expect(formatMessageTime()).toBeNull();
    expect(formatMessageTime(null)).toBeNull();
    expect(formatMessageTime("not-a-timestamp")).toBeNull();
  });

  it("preserves persisted created_at values during message normalization", () => {
    const createdAt = "2026-09-13T18:13:00.000Z";
    const [reloadedMessage] = normalizeInitialMessages([
      { id: "message-1", role: "assistant", content: "Saved", created_at: createdAt },
    ]);

    expect(reloadedMessage.created_at).toBe(createdAt);
    expect(formatMessageTime(reloadedMessage.created_at)).toBe(
      formatMessageTime(createdAt)
    );
  });
});
