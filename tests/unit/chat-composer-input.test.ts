import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  createPastedTextAttachment,
  getComposerMessageLengthError,
  insertTextAtSelection,
  shouldConvertLargePasteToAttachment,
} from "@/app/chat/ChatClient";

const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");

describe("composer large-input handling", () => {
  it("keeps ordinary pastes inline and converts only oversized pastes", () => {
    expect(shouldConvertLargePasteToAttachment("x".repeat(2000))).toBe(false);
    expect(shouldConvertLargePasteToAttachment("x".repeat(2001))).toBe(true);
  });

  it("preserves existing instructions, selection replacement, and exact newlines", () => {
    const pastedText = "line one\r\n\r\nline two  \nline three";

    expect(insertTextAtSelection("Review: old", pastedText, 8, 11)).toBe(
      `Review: ${pastedText}`,
    );
    expect(insertTextAtSelection("Review this", pastedText, 11, 11)).toBe(
      `Review this${pastedText}`,
    );
  });

  it("materializes the full oversized paste as a governed text attachment", async () => {
    const pastedText = "first line\n\nconst value = `preserve this`;\n" + "x".repeat(2001);
    const attachment = createPastedTextAttachment(pastedText);

    expect(attachment.name).toBe("pasted-text.txt");
    expect(attachment.type).toBe("text/plain");
    expect(await attachment.text()).toBe(pastedText);
  });

  it("fails explicitly above the request boundary instead of truncating", () => {
    expect(getComposerMessageLengthError(4000)).toBeNull();
    expect(getComposerMessageLengthError(4001)).toBe(
      "Message too long. Maximum 4000 characters.",
    );
  });

  it("removes browser maxLength truncation and wires the large-paste handler", () => {
    expect(clientSource).toContain("onPaste={handleComposerPaste}");
    expect(clientSource).toContain("handleFilesSelected([pastedFile])");
    expect(clientSource).toContain("setComposerDocuments(sentDocuments)");
    expect(clientSource).not.toContain("maxLength={MAX_INPUT_LENGTH}");
    expect(clientSource).toContain("MAX_REQUEST_MESSAGE_LENGTH = 4000");
  });
});
