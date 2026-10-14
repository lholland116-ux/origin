import mammoth from "mammoth";
import { strFromU8, unzipSync } from "fflate";
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

  it("renders report Markdown as formatted Word OOXML without changing values", async () => {
    const report = [
      "# Quarterly Revenue Report",
      "",
      "## Revenue performance",
      "",
      "Revenue increased from Q1 to Q2 and then decreased from Q2 to Q3.",
      "",
      "# Executive Summary",
      "",
      "| Comparison | Revenue change | Percentage change |",
      "| --- | ---: | ---: |",
      "| Q1 to Q2 | +50 | +25% |",
      "| Q2 to Q3 | -25 | -10% |",
      "| Q1 to Q3 | +25 | +12.5% |",
      "",
      "**Key finding:** Revenue moved from 200 to 250, then to 225 (−25, −10%) →.",
      "",
      "- Revenue grew by 25% in Q2.",
      "- Revenue remained above the Q1 baseline in Q3.",
      "",
      "1. Review the Q2 increase.",
      "2. Monitor the Q3 decrease.",
    ].join("\n");
    const artifact = await generateDocxArtifact({
      format: "docx",
      title: "Quarterly Revenue Report",
      filename: "quarterly-revenue-report.docx",
      sections: [{ type: "paragraph", text: report }],
    });

    const archive = unzipSync(Buffer.from(artifact.bytes));
    const documentXml = strFromU8(archive["word/document.xml"]!);
    const numberingXml = strFromU8(archive["word/numbering.xml"]!);
    const tableXml = documentXml.match(/<w:tbl\b[\s\S]*?<\/w:tbl>/)?.[0];
    const cells = [...(tableXml ?? "").matchAll(/<w:tc\b[\s\S]*?<\/w:tc>/g)].map(([cell]) => cell);
    const readBack = await mammoth.extractRawText({ buffer: Buffer.from(artifact.bytes) });

    expect(artifact.filename).toBe("quarterly-revenue-report.docx");
    expect(artifact.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(artifact.format).toBe("docx");
    expect(artifact.sizeBytes).toBe(artifact.bytes.byteLength);
    expect(artifact.sizeBytes).toBeLessThanOrEqual(MAX_ARTIFACT_BYTES);

    expect(documentXml).toMatch(/<w:pStyle w:val="Title"\/>/);
    expect(documentXml).toMatch(/<w:sz w:val="38"\/>/);
    expect(documentXml).toMatch(/<w:pStyle w:val="Heading1"\/>/);
    expect(documentXml).toMatch(/<w:pStyle w:val="Heading2"\/>/);
    expect(numberingXml).toContain('<w:numFmt w:val="bullet"/>');
    expect(numberingXml).toContain('<w:numFmt w:val="decimal"/>');
    expect(documentXml).toContain("<w:tbl>");
    expect(documentXml).toContain("<w:tblBorders>");
    expect(documentXml).toContain("<w:tcMar>");
    expect(documentXml).toContain("<w:numPr>");
    expect(documentXml).toContain("<w:jc w:val=\"right\"/>");
    expect(cells).toHaveLength(12);
    expect(cells.find((cell) => /<w:t[^>]*>-25<\/w:t>/.test(cell))).toContain("<w:jc w:val=\"right\"/>");

    expect(documentXml).not.toContain("# Quarterly Revenue Report");
    expect(documentXml).not.toContain("## Revenue performance");
    expect(documentXml).not.toContain("| Q1 to Q2 |");
    expect(documentXml).not.toContain("| --- | ---:");
    expect(documentXml).not.toContain("**Key finding:**");
    expect(documentXml.match(/Quarterly Revenue Report/g)).toHaveLength(1);
    expect(readBack.value).toContain("Q1 to Q2");
    expect(readBack.value).toContain("200");
    expect(readBack.value).toContain("250");
    expect(readBack.value).toContain("225");
    expect(readBack.value).toContain("+50");
    expect(readBack.value).toContain("+25%");
    expect(readBack.value).toContain("-25");
    expect(readBack.value).toContain("-10%");
    expect(readBack.value).toContain("+12.5%");
    expect(readBack.value).toContain("Revenue moved from 200 to 250, then to 225 (−25, −10%) →.");
    expect(readBack.value).toContain("Review the Q2 increase.");
    expect(readBack.value).toContain("Monitor the Q3 decrease.");
    expect(documentXml.match(/<w:p[ >]/g)?.length).toBeGreaterThan(12);
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
