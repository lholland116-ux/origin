import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { getMessageCopyValue } from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
const messageContentSource = readFileSync(
  "components/chat/ChatMessageContent.tsx",
  "utf8"
);
const tooltipSource = readFileSync("components/ui/Tooltip.tsx", "utf8");

describe("chat message and composer actions", () => {
  it("uses the assistant response content for message-level copying", () => {
    expect(getMessageCopyValue({ content: "  Assistant response  " })).toBe(
      "Assistant response"
    );
  });

  it("places user and assistant copy icons below the response without changing code copy", () => {
    const messageRenderStart = clientSource.indexOf("{messages.map((message) => {");
    const contentPosition = clientSource.indexOf(
      "<ChatMessageContent",
      messageRenderStart
    );
    const userCopyIconPosition = clientSource.indexOf("<CopyIcon", contentPosition);
    const assistantCopyIconPosition = clientSource.indexOf(
      "<CopyIcon",
      userCopyIconPosition + 1
    );
    const messageHeader = clientSource.slice(messageRenderStart, contentPosition);

    expect(messageRenderStart).toBeGreaterThanOrEqual(0);
    expect(contentPosition).toBeGreaterThan(messageRenderStart);
    expect(userCopyIconPosition).toBeGreaterThan(contentPosition);
    expect(assistantCopyIconPosition).toBeGreaterThan(userCopyIconPosition);
    expect(messageHeader).not.toContain('aria-label="Copy message"');
    expect((clientSource.match(/aria-label="Copy message"/g) ?? []).length).toBe(1);
    expect(clientSource).toContain('aria-label="Copy response"');
    expect(clientSource).toContain('<Tooltip content="Copy message" touchSafe>');
    expect(clientSource).toContain('<Tooltip content="Copy response" touchSafe>');
    expect(clientSource).not.toContain(">Copy</button>");
    expect(messageContentSource).toContain('aria-label="Copy code"');
    expect(messageContentSource).toContain("<CopyIcon");
    expect(messageContentSource).toContain('<Tooltip content="Copy code" touchSafe>');
    expect(messageContentSource).not.toContain(">Copy code</button>");
    expect(clientSource).not.toMatch(/aria-label="Copy message"[\s\S]{0,500}title=/);
    expect(clientSource).not.toMatch(/aria-label="Copy response"[\s\S]{0,500}title=/);
    expect(messageContentSource).not.toMatch(/aria-label="Copy code"[\s\S]{0,500}title=/);
    expect(tooltipSource).toContain('window.matchMedia("(hover: hover) and (pointer: fine)")');
    expect(tooltipSource).toContain("if (!canShow) setOpen(false);");
  });

  it("keeps the send button accessible without the persistent send tooltip", () => {
    expect(clientSource).toContain('aria-label="Send your message"');
    expect(clientSource).not.toContain("<Tooltip content={TOOLTIP_TEXT.send}>");
  });
});
