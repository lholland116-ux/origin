import { describe, expect, it } from "vitest";
import {
  formatMessageTime,
  getMessageDisplayLabel,
} from "@/app/chat/ChatClient";

describe("chat message metadata", () => {
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
});
