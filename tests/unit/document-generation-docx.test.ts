import mammoth from "mammoth";
import { describe, expect, it } from "vitest";
import {
  generateDocxArtifact,
  MAX_ARTIFACT_BYTES,
  validateGeneratedArtifact,
} from "@/lib/documents/generation";
import type { StructuredDocumentRequest } from "@/lib/documents/generation";

const unicodeText = "Résumé — naïve façade — 日本語 — “quoted text”";

function completeRequest(
  overrides: Partial<StructuredDocumentRequest & { format: "docx" }> = {},
): StructuredDocumentRequest & { format: "docx" } {
  return {
    format: "docx",
    title: "Qualification Report",
    sections: [
      { type: "heading", level: 1, text: "Overview" },
      { type: "heading", level: 2, text: "Details" },
      { type: "heading", level: 3, text: "Notes" },
      { type: "paragraph", text: unicodeText },
      { type: "list", ordered: false, items: ["First", "Second"] },
      { type: "list", ordered: true, items: ["One", "Two"] },
      {
        type: "table",
        columns: ["Name", "Status"],
        rows: [
          ["Alpha", "Complete"],
          ["Beta", "Pending 日本語"],
        ],
      },
    ],
    ...overrides,
  };
}

describe("DOCX generator", () => {
  it("generates a readable in-memory DOCX with all supported content", async () => {
    const artifact = await generateDocxArtifact(completeRequest());
    const readBack = await mammoth.extractRawText({
      buffer: Buffer.from(artifact.bytes),
    });

    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
    expect(Array.from(artifact.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(artifact.filename).toBe("lvtchat-document.docx");
    expect(artifact.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(artifact.format).toBe("docx");
    expect(artifact.sizeBytes).toBe(artifact.bytes.byteLength);

    expect(readBack.value).toContain("Qualification Report");
    expect(readBack.value).toContain("Overview");
    expect(readBack.value).toContain("Details");
    expect(readBack.value).toContain("Notes");
    expect(readBack.value).toContain(unicodeText);
    expect(readBack.value).toContain("First");
    expect(readBack.value).toContain("Second");
    expect(readBack.value).toContain("One");
    expect(readBack.value).toContain("Two");
    expect(readBack.value).toContain("Alpha");
    expect(readBack.value).toContain("Pending 日本語");
  });

  it("normalizes default, custom, wrong-extension, and traversal filenames", async () => {
    const cases = [
      [undefined, "lvtchat-document.docx"],
      ["report", "report.docx"],
      ["report.pdf", "report.docx"],
      ["../../private/report.docx", "_._private_report.docx"],
    ] as const;

    for (const [filename, expected] of cases) {
      const artifact = await generateDocxArtifact(completeRequest({ filename }));
      expect(artifact.filename).toBe(expected);
      expect(artifact.filename).toMatch(/\.docx$/);
      expect(artifact.filename).not.toContain("..");
    }
  });

  it("rejects malformed sections before returning an artifact", async () => {
    await expect(
      generateDocxArtifact(
        completeRequest({
          sections: [
            { type: "heading", level: 4, text: "Invalid" },
          ] as unknown as StructuredDocumentRequest["sections"],
        }),
      ),
    ).rejects.toThrow("invalid heading level");

    await expect(
      generateDocxArtifact(
        completeRequest({
          sections: [
            { type: "table", columns: ["A", "B"], rows: [["only one"]] },
          ],
        }),
      ),
    ).rejects.toThrow("table rows do not match");
  });

  it("retains the global artifact size boundary", () => {
    const issues = validateGeneratedArtifact({
      filename: "large.docx",
      mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      bytes: new Uint8Array(MAX_ARTIFACT_BYTES + 1),
      sizeBytes: MAX_ARTIFACT_BYTES + 1,
      format: "docx",
    });

    expect(issues).toContain("Artifact exceeds the maximum size.");
  });
});
