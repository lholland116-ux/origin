import { randomFillSync } from "node:crypto";
import ExcelJS from "exceljs";
import { unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import {
  generateDocxArtifact,
  generateMarkdownArtifact,
  generatePdfArtifact,
  generatePptxArtifact,
  generateTextArtifact,
  generateTemplateOutput,
  generateXlsxArtifact,
  generateZipArtifact,
  getDocumentMimeType,
  MAX_ARTIFACT_BYTES,
  DocumentGenerationValidationError,
  type GeneratedArtifact,
} from "@/lib/documents/generation";

function textArtifact(
  filename: string,
  content = "test artifact",
): GeneratedArtifact {
  const bytes = new TextEncoder().encode(content);
  return {
    filename,
    mimeType: getDocumentMimeType("txt"),
    bytes,
    sizeBytes: bytes.byteLength,
    format: "txt",
  };
}

function packageRequest(
  entries: readonly GeneratedArtifact[],
  filename?: string,
) {
  return { format: "zip" as const, filename, entries };
}

describe("ZIP document generation", () => {
  it("creates a valid single-entry ZIP artifact and normalizes filenames safely", () => {
    const artifact = generateZipArtifact(
      packageRequest([textArtifact("report.txt", "hello ZIP")], "report.pdf.zip"),
    );

    expect(artifact.filename).toBe("report.zip");
    expect(artifact.mimeType).toBe("application/zip");
    expect(artifact.format).toBe("zip");
    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.sizeBytes).toBe(artifact.bytes.length);
    expect(Array.from(artifact.bytes.slice(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const extracted = unzipSync(artifact.bytes);
    expect(Object.keys(extracted)).toEqual(["report.txt"]);
    expect(new TextDecoder().decode(extracted["report.txt"])).toBe("hello ZIP");
  });

  it("packages all six generated document formats with exact read-back bytes and order", async () => {
    const artifacts = await Promise.all([
      Promise.resolve(
        generateTextArtifact({
          format: "txt",
          filename: "notes.txt",
          content: "Plain text",
        }),
      ),
      Promise.resolve(
        generateMarkdownArtifact({
          format: "md",
          filename: "readme.md",
          content: "# Markdown\n\nContent",
        }),
      ),
      generateDocxArtifact({
        format: "docx",
        filename: "report.docx",
        sections: [{ type: "paragraph", text: "DOCX content" }],
      }),
      generatePdfArtifact({
        format: "pdf",
        filename: "report.pdf",
        sections: [{ type: "paragraph", text: "PDF content" }],
      }),
      generateXlsxArtifact({
        format: "xlsx",
        filename: "data.xlsx",
        sheets: [{ name: "Data", columns: ["Value"], rows: [["XLSX content"]] }],
      }),
      generatePptxArtifact({
        format: "pptx",
        filename: "slides.pptx",
        slides: [{ type: "title", title: "PPTX content" }],
      }),
    ]);
    const artifact = generateZipArtifact(packageRequest(artifacts, "all-formats"));
    const extracted = unzipSync(artifact.bytes);

    expect(Object.keys(extracted)).toEqual(artifacts.map((entry) => entry.filename));
    for (const entry of artifacts) {
      expect(Array.from(extracted[entry.filename])).toEqual(Array.from(entry.bytes));
    }
  });

  it("preserves native comparison scalar types in XLSX inside a multi-format ZIP", async () => {
    const artifact = await generateTemplateOutput({
      templateId: "comparison-report",
      formats: ["txt", "pdf", "xlsx"],
      packageAsZip: true,
      variables: {
        title: "ZIP Comparison Qualification",
        firstColumnHeader: "Name",
        items: [
          { name: "Laptop" },
          { name: "Monitor" },
          { name: "Keyboard" },
          { name: "00123" },
          { name: "=SUM(A1:A2)" },
        ],
        criteria: ["Quantity", "Price"],
        summary: "A typed comparison packaged in multiple formats.",
        comparisons: [
          { item: "Laptop", values: [2, 899.99] },
          { item: "Monitor", values: [4, 249.5] },
          { item: "Keyboard", values: [6, 79.95] },
          { item: "00123", values: [true, null] },
          { item: "=SUM(A1:A2)", values: [1, 0] },
        ],
        observations: ["Native scalar types are preserved for XLSX."],
      },
    });
    const extracted = unzipSync(artifact.bytes);
    const entryNames = Object.keys(extracted);
    const txtName = entryNames.find((name) => name.endsWith(".txt"));
    const pdfName = entryNames.find((name) => name.endsWith(".pdf"));
    const xlsxName = entryNames.find((name) => name.endsWith(".xlsx"));

    expect(artifact.format).toBe("zip");
    expect(entryNames).toHaveLength(3);
    expect(txtName).toBeDefined();
    expect(pdfName).toBeDefined();
    expect(xlsxName).toBeDefined();
    if (!txtName || !pdfName || !xlsxName) throw new Error("Expected TXT, PDF, and XLSX ZIP entries.");

    expect(new TextDecoder().decode(extracted[txtName])).toContain("Name | Quantity | Price");
    expect(Array.from(extracted[pdfName]?.slice(0, 5) ?? [])).toEqual([0x25, 0x50, 0x44, 0x46, 0x2d]);
    expect(Array.from(extracted[xlsxName]?.slice(0, 4) ?? [])).toEqual([0x50, 0x4b, 0x03, 0x04]);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      Buffer.from(extracted[xlsxName]) as unknown as Parameters<typeof workbook.xlsx.load>[0],
    );
    const sheet = workbook.getWorksheet("Comparison");
    expect(sheet?.getRow(1).values).toEqual([undefined, "Name", "Quantity", "Price"]);

    const quantityCells = [sheet?.getCell("B2"), sheet?.getCell("B3"), sheet?.getCell("B4")];
    const priceCells = [sheet?.getCell("C2"), sheet?.getCell("C3"), sheet?.getCell("C4")];
    quantityCells.forEach((cell) => expect(cell?.type).toBe(ExcelJS.ValueType.Number));
    priceCells.forEach((cell) => expect(cell?.type).toBe(ExcelJS.ValueType.Number));
    expect(quantityCells.reduce((total, cell) => total + Number(cell?.value), 0)).toBe(12);
    expect(priceCells.reduce((total, cell) => total + Number(cell?.value), 0)).toBeCloseTo(1229.44, 10);

    expect(sheet?.getCell("A5").type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell("A5").value).toBe("00123");
    expect(sheet?.getCell("B5").type).toBe(ExcelJS.ValueType.Boolean);
    expect(sheet?.getCell("B5").value).toBe(true);
    expect(sheet?.getCell("C5").value).toBeNull();
    expect(sheet?.getCell("A6").type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell("A6").value).toBe("'=SUM(A1:A2)");
  });

  it("supports deterministic empty and custom filename semantics", () => {
    expect(() => generateZipArtifact(packageRequest([]))).toThrow(
      DocumentGenerationValidationError,
    );
    expect(generateZipArtifact(packageRequest([textArtifact("a.txt")])).filename).toBe(
      "lvtchat-document.zip",
    );
    expect(
      generateZipArtifact(packageRequest([textArtifact("a.txt")], "../reports.zip")).filename,
    ).not.toMatch(/[\\/]/);
    expect(
      generateZipArtifact(packageRequest([textArtifact("a.txt")], "reports.txt")).filename,
    ).toBe("reports.zip");
  });

  it("rejects duplicate, unsafe, unsupported, malformed, and nested entries", () => {
    const base = textArtifact("report.txt");

    expect(() => generateZipArtifact(packageRequest([base, base]))).toThrow(
      /unique/,
    );
    expect(() =>
      generateZipArtifact(
        packageRequest([{ ...base, filename: "../report.txt" }]),
      ),
    ).toThrow(/unsafe/);
    expect(() =>
      generateZipArtifact(
        packageRequest([{ ...base, filename: "/tmp/report.txt" }]),
      ),
    ).toThrow(/unsafe/);
    expect(() =>
      generateZipArtifact(
        packageRequest([{ ...base, format: "exe" as never }]),
      ),
    ).toThrow(/unsupported/);
    expect(() =>
      generateZipArtifact(
        packageRequest([{ ...base, mimeType: getDocumentMimeType("pdf") }]),
      ),
    ).toThrow(/MIME/);
    expect(() =>
      generateZipArtifact(packageRequest([{ ...base, sizeBytes: base.sizeBytes + 1 }])),
    ).toThrow(/size/);
    expect(() =>
      generateZipArtifact(
        packageRequest([
          {
            ...base,
            filename: "nested.zip",
            format: "zip",
            mimeType: getDocumentMimeType("zip"),
          },
        ]),
      ),
    ).toThrow(/Nested ZIP/);
  });

  it("enforces entry-count, total-uncompressed, and final archive-size limits", () => {
    const small = textArtifact("small.txt");
    expect(() =>
      generateZipArtifact(
        packageRequest(Array.from({ length: 21 }, (_, index) => ({
          ...small,
          filename: `entry-${index}.txt`,
        }))),
      ),
    ).toThrow(/too many entries/);

    const tenMiB = new Uint8Array(MAX_ARTIFACT_BYTES);
    for (let index = 0, state = 0x12345678; index < tenMiB.length; index += 1) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      tenMiB[index] = state & 0xff;
    }
    randomFillSync(tenMiB);
    const largeEntry = {
      ...small,
      filename: "large.txt",
      bytes: tenMiB,
      sizeBytes: tenMiB.byteLength,
    };
    expect(() =>
      generateZipArtifact(
        packageRequest(Array.from({ length: 6 }, (_, index) => ({
          ...largeEntry,
          filename: `large-${index}.txt`,
        }))),
      ),
    ).toThrow(/total uncompressed/);
    expect(() => generateZipArtifact(packageRequest([largeEntry]))).toThrow(
      /maximum size/,
    );
  });
});
