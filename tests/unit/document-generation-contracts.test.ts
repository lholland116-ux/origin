import { describe, expect, it } from "vitest";
import {
  DOCUMENT_FORMATS,
  DOCUMENT_MIME_TYPES,
  MAX_ARTIFACT_BYTES,
  MAX_FILENAME_LENGTH,
  MAX_ZIP_ENTRIES,
  MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES,
  assertValidGenerationRequest,
  isSafeFilename,
  normalizeWorkbookCell,
  sanitizeFilename,
  validateGenerationRequest,
  validateGeneratedArtifact,
  validateZipPackage,
  validateWorksheetName,
} from "@/lib/documents/generation";
import type {
  DocumentGenerationRequest,
  GeneratedArtifact,
  ZipPackageRequest,
} from "@/lib/documents/generation";

const validSections = [
  { type: "heading", level: 1, text: "Report" },
  { type: "paragraph", text: "Summary" },
  { type: "list", ordered: false, items: ["One", "Two"] },
  { type: "table", columns: ["Name", "Value"], rows: [["A", "1"]] },
] as const;

function artifact(
  filename: string,
  format: GeneratedArtifact["format"] = "txt",
  sizeBytes = 1,
): GeneratedArtifact {
  const mimeType = DOCUMENT_MIME_TYPES[format];
  return {
    filename,
    mimeType,
    bytes: new Uint8Array([1]),
    sizeBytes,
    format,
  };
}

describe("document generation contracts", () => {
  it("defines the supported formats and exact MIME registry", () => {
    expect(DOCUMENT_FORMATS).toEqual(["txt", "md", "docx", "pdf", "xlsx", "pptx", "zip"]);
    expect(DOCUMENT_MIME_TYPES).toEqual({
      txt: "text/plain; charset=utf-8",
      md: "text/markdown; charset=utf-8",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      pdf: "application/pdf",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      zip: "application/zip",
    });
  });

  it("sanitizes defaults, traversal, controls, extensions, reserved names, and length", () => {
    expect(sanitizeFilename(undefined, "txt")).toBe("lvtchat-document.txt");
    expect(sanitizeFilename("../../report.md", "md")).not.toContain("..");
    expect(sanitizeFilename("bad" + String.fromCharCode(0) + "name.txt", "txt")).toBe("badname.txt");
    expect(sanitizeFilename("report.txt.txt", "md")).toBe("report.md");
    expect(sanitizeFilename("slides", "pptx")).toBe("slides.pptx");
    expect(sanitizeFilename("slides.pdf.pptx", "pptx")).toBe("slides.pptx");
    expect(sanitizeFilename("../../slides.pptx", "pptx")).not.toContain("..");
    expect(isSafeFilename("slides.pptx", "pptx")).toBe(true);
    expect(sanitizeFilename("CON", "txt")).toBe("lvtchat-document.txt");

    const longFilename = sanitizeFilename("x".repeat(300), "pdf");
    expect(longFilename).toHaveLength(MAX_FILENAME_LENGTH);
    expect(longFilename).toMatch(/\.pdf$/);
    expect(isSafeFilename("report.md", "md")).toBe(true);
    expect(isSafeFilename("../report.md", "md")).toBe(false);
  });

  it("validates structured sections and rejects mismatched table rows", () => {
    const request: DocumentGenerationRequest = {
      format: "pdf",
      filename: "report.pdf",
      sections: validSections,
    };
    expect(validateGenerationRequest(request)).toEqual([]);
    expect(() => assertValidGenerationRequest(request)).not.toThrow();

    const invalidRequest: DocumentGenerationRequest = {
      format: "pdf",
      sections: [
        { type: "table", columns: ["A", "B"], rows: [["only one"]] },
      ],
    };
    expect(validateGenerationRequest(invalidRequest)).toContain(
      "Section 1 table rows do not match the columns."
    );
  });

  it("validates workbook sheet names, bounds, and duplicate names", () => {
    expect(validateWorksheetName("Summary")).toBeNull();
    expect(validateWorksheetName("Bad/Name")).toBeTruthy();
    expect(validateWorksheetName("x".repeat(32))).toBeTruthy();

    const request: DocumentGenerationRequest = {
      format: "xlsx",
      sheets: [
        { name: "Summary", columns: ["A"], rows: [["value"]] },
        { name: "Summary", columns: ["A"], rows: [["value"]] },
      ],
    };
    expect(validateGenerationRequest(request)).toContain("Worksheet names must be unique.");
  });

  it("neutralizes formula-like strings without changing numeric negatives", () => {
    const quote = String.fromCharCode(39);
    expect(normalizeWorkbookCell("=SUM(A1:A2)")).toBe(quote + "=SUM(A1:A2)");
    expect(normalizeWorkbookCell("+cmd")).toBe(quote + "+cmd");
    expect(normalizeWorkbookCell("-cmd")).toBe(quote + "-cmd");
    expect(normalizeWorkbookCell("@reference")).toBe(quote + "@reference");
    expect(normalizeWorkbookCell(-10)).toBe(-10);
  });

  it("validates PPTX artifacts and ZIP entries", () => {
    const pptx = artifact("slides.pptx", "pptx");
    expect(validateGeneratedArtifact(pptx)).toEqual([]);
    expect(validateZipPackage({ format: "zip", entries: [pptx] })).toEqual([]);
  });

  it("validates ZIP entry count, duplicate names, nesting, and total size", () => {
    const duplicateRequest: ZipPackageRequest = {
      format: "zip",
      entries: [artifact("same.txt"), artifact("same.txt")],
    };
    expect(validateZipPackage(duplicateRequest)).toContain(
      "ZIP entry filenames must be unique."
    );

    const nestedRequest: ZipPackageRequest = {
      format: "zip",
      entries: [artifact("nested.zip", "zip" as GeneratedArtifact["format"])],
    };
    expect(validateZipPackage(nestedRequest)).toContain("Nested ZIP entries are not supported.");

    const oversizedRequest: ZipPackageRequest = {
      format: "zip",
      entries: Array.from({ length: 6 }, (_, index) =>
        artifact("entry-" + index + ".txt", "txt", MAX_ARTIFACT_BYTES)
      ),
    };
    expect(oversizedRequest.entries).toHaveLength(6);
    expect(MAX_ZIP_ENTRIES).toBe(20);
    expect(MAX_ZIP_TOTAL_UNCOMPRESSED_BYTES).toBe(50 * 1024 * 1024);
    expect(validateZipPackage(oversizedRequest)).toContain(
      "ZIP package exceeds the total uncompressed size limit."
    );
  });
});
