import { Document, Packer, Paragraph, Table, TableCell, TableRow } from "docx";
import { describe, expect, it } from "vitest";
import { extractTextFromFile } from "@/lib/documents/extract-text";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

async function makeDocx(children: (Paragraph | Table)[]): Promise<Buffer> {
  return Packer.toBuffer(new Document({ sections: [{ children }] }));
}

function tableFrom(text: string): { rows: { header: boolean; cells: string[] }[] } {
  const line = text.split("\n").find((candidate) => candidate.startsWith("DOCX_TABLE_JSON "));
  if (!line) throw new Error("Structured DOCX table was not found.");
  return JSON.parse(line.slice("DOCX_TABLE_JSON ".length)) as { rows: { header: boolean; cells: string[] }[] };
}

describe("DOCX table extraction", () => {
  it("preserves a simple four-column table, values, blanks, and surrounding paragraph order", async () => {
    const table = new Table({ rows: [
      new TableRow({ tableHeader: true, children: ["Quarter", "Revenue", "Region", "Note"].map((value) => new TableCell({ children: [new Paragraph(value)] })) }),
      new TableRow({ children: ["Q1", "200", "North", ""].map((value) => new TableCell({ children: [new Paragraph(value)] })) }),
      new TableRow({ children: ["Q2", "250", "South", "Reviewed"].map((value) => new TableCell({ children: [new Paragraph(value)] })) }),
    ] });
    const extracted = await extractTextFromFile(await makeDocx([
      new Paragraph("Context before table."),
      table,
      new Paragraph("Context after table."),
    ]), DOCX_MIME);

    expect(extracted.indexOf("Context before table.")).toBeLessThan(extracted.indexOf("DOCX_TABLE_JSON"));
    expect(extracted.indexOf("DOCX_TABLE_JSON")).toBeLessThan(extracted.indexOf("Context after table."));
    expect(tableFrom(extracted)).toEqual({ rows: [
      { header: true, cells: ["Quarter", "Revenue", "Region", "Note"] },
      { header: false, cells: ["Q1", "200", "North", ""] },
      { header: false, cells: ["Q2", "250", "South", "Reviewed"] },
    ] });
  });

  it("preserves existing Mammoth extraction behavior for DOCX without tables", async () => {
    const extracted = await extractTextFromFile(await makeDocx([
      new Paragraph("First paragraph."),
      new Paragraph("Second paragraph."),
    ]), DOCX_MIME);

    expect(extracted).toBe("First paragraph.\n\nSecond paragraph.");
  });

  it("rejects merged and nested table cells rather than flattening their meaning", async () => {
    const mergedTable = new Table({ rows: [
      new TableRow({ children: [
        new TableCell({ columnSpan: 2, children: [new Paragraph("Merged heading")] }),
        new TableCell({ children: [new Paragraph("Other")] }),
      ] }),
      new TableRow({ children: ["A", "B", "C"].map((value) => new TableCell({ children: [new Paragraph(value)] })) }),
    ] });
    await expect(extractTextFromFile(await makeDocx([mergedTable]), DOCX_MIME)).rejects.toThrow(/table structure/i);

    const nestedTable = new Table({ rows: [
      new TableRow({ children: [new TableCell({ children: [
        new Paragraph("Outer cell"),
        new Table({ rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph("Nested")] })] })] }),
      ] })] }),
    ] });
    await expect(extractTextFromFile(await makeDocx([nestedTable]), DOCX_MIME)).rejects.toThrow(/table structure/i);
  });
});
