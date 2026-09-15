import { describe, expect, it } from "vitest";
import { extractTextFromFile } from "@/lib/documents/extract-text";
import { DOCUMENT_LIMITS } from "@/lib/documents/config";

describe("plain-text document preservation", () => {
  it("preserves whitespace and newlines from pasted text", async () => {
    const content = "first line\r\n\r\nsecond line  \n`code`\n";

    await expect(
      extractTextFromFile(Buffer.from(content), "text/plain")
    ).resolves.toBe(content);
  });

  it("rejects a plain-text extraction that exceeds its explicit limit", async () => {
    await expect(
      extractTextFromFile(
        Buffer.from("x".repeat(DOCUMENT_LIMITS.maxExtractedTextLength + 1)),
        "text/plain"
      )
    ).rejects.toThrow(
      `Text document exceeds the supported size limit of ${DOCUMENT_LIMITS.maxExtractedTextLength} characters.`
    );
  });
});
