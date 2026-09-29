import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";
import {
  generatePdfArtifact,
  MAX_ARTIFACT_BYTES,
  validateGeneratedArtifact,
} from "@/lib/documents/generation";
import { extractTextFromFile } from "@/lib/documents/extract-text";
import type { StructuredDocumentRequest } from "@/lib/documents/generation";

const westernUnicode = "Résumé — naïve façade";
const typographicText = "“quoted text” — en dash — em dash";

function completeRequest(
  overrides: Partial<StructuredDocumentRequest & { format: "pdf" }> = {},
): StructuredDocumentRequest & { format: "pdf" } {
  return {
    format: "pdf",
    title: "Qualification Report",
    sections: [
      { type: "heading", level: 1, text: "Overview" },
      { type: "heading", level: 2, text: "Details" },
      { type: "heading", level: 3, text: "Notes" },
      { type: "paragraph", text: westernUnicode + " — " + typographicText },
      { type: "list", ordered: false, items: ["First item", "Second item"] },
      { type: "list", ordered: true, items: ["One", "Two"] },
      {
        type: "table",
        columns: ["Name", "Status"],
        rows: [
          ["Alpha", "Complete"],
          ["Beta", "Pending"],
        ],
      },
    ],
    ...overrides,
  };
}

describe("PDF generator", () => {
  it("generates a valid readable PDF with supported content and Unicode", async () => {
    const artifact = await generatePdfArtifact(completeRequest());
    const loaded = await PDFDocument.load(artifact.bytes);
    const readBack = await extractTextFromFile(Buffer.from(artifact.bytes), "application/pdf");

    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(artifact.bytes).subarray(0, 5).toString()).toBe("%PDF-");
    expect(loaded.getPageCount()).toBe(1);
    expect(artifact.filename).toBe("lvtchat-document.pdf");
    expect(artifact.mimeType).toBe("application/pdf");
    expect(artifact.format).toBe("pdf");
    expect(artifact.sizeBytes).toBe(artifact.bytes.byteLength);
    expect(readBack).toContain("Qualification Report");
    expect(readBack).toContain("Overview");
    expect(readBack).toContain("Details");
    expect(readBack).toContain("Notes");
    expect(readBack).toContain(westernUnicode);
    expect(readBack).toContain("quoted text");
    expect(readBack).toContain("First item");
    expect(readBack).toContain("One");
    expect(readBack).toContain("Alpha");
    expect(readBack).toContain("Pending");
  });

  it("wraps content and continues onto multiple pages", async () => {
    const paragraphs = Array.from(
      { length: 100 },
      (_, index) =>
        "Paragraph " +
        (index + 1) +
        ": This deliberately long report paragraph verifies metric-based wrapping and page continuation without dropping content.",
    );
    const artifact = await generatePdfArtifact(
      completeRequest({
        sections: [
          { type: "heading", level: 1, text: "Long report" },
          ...paragraphs.map((text) => ({ type: "paragraph" as const, text })),
        ],
      }),
    );
    const loaded = await PDFDocument.load(artifact.bytes);
    const readBack = await extractTextFromFile(Buffer.from(artifact.bytes), "application/pdf");

    expect(loaded.getPageCount()).toBeGreaterThan(1);
    expect(readBack).toContain("Paragraph 1");
    expect(readBack).toContain("Paragraph 100");
  });

  it("uses shared filename, MIME, and artifact validation behavior", async () => {
    const cases = [
      [undefined, "lvtchat-document.pdf"],
      ["report", "report.pdf"],
      ["report.docx", "report.pdf"],
      ["../../private/report.pdf", "_._private_report.pdf"],
      ["report.pdf.pdf", "report.pdf"],
    ] as const;

    for (const [filename, expected] of cases) {
      const artifact = await generatePdfArtifact(completeRequest({ filename }));
      expect(artifact.filename).toBe(expected);
      expect(artifact.filename).toMatch(/\.pdf$/);
      expect(artifact.filename).not.toContain("..");
    }

    const issues = validateGeneratedArtifact({
      filename: "large.pdf",
      mimeType: "application/pdf",
      bytes: new Uint8Array(MAX_ARTIFACT_BYTES + 1),
      sizeBytes: MAX_ARTIFACT_BYTES + 1,
      format: "pdf",
    });
    expect(issues).toContain("Artifact exceeds the maximum size.");
  });

  it("rejects unsupported CJK glyphs instead of corrupting PDF text", async () => {
    await expect(
      generatePdfArtifact(
        completeRequest({
          sections: [{ type: "paragraph", text: "日本語" }],
        }),
      ),
    ).rejects.toThrow(/unsupported character.*U\+65E5/i);
  });

  it("rejects malformed structured requests through shared validation", async () => {
    await expect(
      generatePdfArtifact(
        completeRequest({
          sections: [{ type: "heading", level: 4, text: "Invalid" }] as unknown as StructuredDocumentRequest["sections"],
        }),
      ),
    ).rejects.toThrow("invalid heading level");

    await expect(
      generatePdfArtifact(
        completeRequest({
          sections: [{ type: "table", columns: ["A", "B"], rows: [["only one"]] }],
        }),
      ),
    ).rejects.toThrow("table rows do not match");
  });
});
