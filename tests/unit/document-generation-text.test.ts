import { describe, expect, it } from "vitest";
import {
  generateMarkdownArtifact,
  generateTextArtifact,
} from "@/lib/documents/generation";
import type {
  MarkdownDocumentRequest,
  TextDocumentRequest,
} from "@/lib/documents/generation";

function decodeArtifact(artifact: { bytes: Uint8Array }): string {
  return new TextDecoder().decode(artifact.bytes);
}

describe("TXT and Markdown generators", () => {
  it("generates exact UTF-8 TXT content with safe defaults", () => {
    const content = "Résumé — naïve façade — 日本語\nsecond line";
    const artifact = generateTextArtifact({ format: "txt", content });

    expect(decodeArtifact(artifact)).toBe(content);
    expect(artifact.filename).toBe("lvtchat-document.txt");
    expect(artifact.mimeType).toBe("text/plain; charset=utf-8");
    expect(artifact.format).toBe("txt");
    expect(artifact.bytes.slice(0, 3)).not.toEqual(new Uint8Array([0xef, 0xbb, 0xbf]));
    expect(artifact.sizeBytes).toBe(artifact.bytes.byteLength);
  });

  it("normalizes a requested TXT filename and supports empty content", () => {
    const artifact = generateTextArtifact({
      format: "txt",
      filename: "../meeting-notes.md",
      content: "",
    });

    expect(artifact.filename).toMatch(/\.txt$/);
    expect(artifact.filename).not.toContain("..");
    expect(decodeArtifact(artifact)).toBe("");
    expect(artifact.sizeBytes).toBe(0);
  });

  it("generates Markdown without rendering or changing Markdown syntax", () => {
    const content = [
      "# Heading",
      "",
      "- unordered item",
      "1. ordered item",
      "",
      "| Name | Value |",
      "| --- | --- |",
      "| A\\|B | 日本語 |",
    ].join("\n");
    const artifact = generateMarkdownArtifact({ format: "md", content });

    expect(decodeArtifact(artifact)).toBe(content);
    expect(artifact.filename).toBe("lvtchat-document.md");
    expect(artifact.mimeType).toBe("text/markdown; charset=utf-8");
    expect(artifact.format).toBe("md");
    expect(artifact.sizeBytes).toBe(new TextEncoder().encode(content).byteLength);
  });

  it("normalizes a requested Markdown filename", () => {
    const artifact = generateMarkdownArtifact({
      format: "md",
      filename: "report.txt.txt",
      content: "plain Markdown",
    });

    expect(artifact.filename).toBe("report.md");
  });

  it("rejects malformed TXT and Markdown requests before encoding", () => {
    expect(() =>
      generateTextArtifact({
        format: "txt",
        content: undefined,
      } as unknown as TextDocumentRequest),
    ).toThrow("Document content is required.");

    expect(() =>
      generateMarkdownArtifact({
        format: "md",
        content: undefined,
      } as unknown as MarkdownDocumentRequest),
    ).toThrow("Document content is required.");
  });
});
