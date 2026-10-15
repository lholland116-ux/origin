import { describe, expect, it } from "vitest";
import { selectDocumentOutputFormat } from "@/lib/agent-runtime/document-output-format";

describe("document output format selection", () => {
  it.each([
    ["Analyze the attached DOCX and create an Excel workbook.", "xlsx"],
    ["Analyze the attached PDF and create an XLSX spreadsheet.", "xlsx"],
    ["Convert the attached Word document to XLSX.", "xlsx"],
    ["Analyze the attached XLSX workbook and create a DOCX report.", "docx"],
    ["Analyze this text file and create a PDF report.", "pdf"],
    ["Analyze this spreadsheet and create a TXT file.", "txt"],
  ] as const)("selects the requested output for %s", (objective, format) => {
    expect(selectDocumentOutputFormat(objective)).toEqual({ kind: "selected", format });
  });

  it.each([
    "Create a DOCX and PDF report from the source file.",
    "Analyze the attached Word document and create a PowerPoint presentation.",
  ])("rejects missing, conflicting, or unsupported output formats: %s", (objective) => {
    const selection = selectDocumentOutputFormat(objective);
    expect(selection.kind).not.toBe("selected");
  });

  it("defaults to PDF when no output format is requested", () => {
    expect(selectDocumentOutputFormat("Analyze the attached DOCX and create a report.")).toEqual({
      kind: "selected",
      format: "pdf",
    });
  });
});
