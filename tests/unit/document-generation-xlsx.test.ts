import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  generateXlsxArtifact,
  MAX_ARTIFACT_BYTES,
  validateGeneratedArtifact,
} from "@/lib/documents/generation";
import type { WorkbookDocumentRequest } from "@/lib/documents/generation";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const unicodeText = "Résumé — naïve façade — 日本語";
const typographicText = "“quoted text” — typographic punctuation";

function completeRequest(
  overrides: Partial<WorkbookDocumentRequest & { format: "xlsx" }> = {},
): WorkbookDocumentRequest & { format: "xlsx" } {
  return {
    format: "xlsx",
    title: "Qualification Workbook",
    sheets: [
      {
        name: "Summary",
        columns: ["Status", "Score", "Negative", "Enabled", "Blank", "Notes"],
        rows: [["Complete", 123.45, -10, true, null, unicodeText + " — " + typographicText]],
      },
      {
        name: "Action Items",
        columns: ["Action", "Owner"],
        rows: [["Review workbook", "LVTChat"]],
      },
    ],
    ...overrides,
  };
}

async function readWorkbook(bytes: Uint8Array): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const excelBuffer = Buffer.from(bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0];
  await workbook.xlsx.load(excelBuffer);
  return workbook;
}

describe("XLSX generator", () => {
  it("generates a readable multi-sheet workbook with formatting and Unicode", async () => {
    const artifact = await generateXlsxArtifact(completeRequest());
    const workbook = await readWorkbook(artifact.bytes);
    const summary = workbook.getWorksheet("Summary");
    const actions = workbook.getWorksheet("Action Items");

    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(artifact.bytes).subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(artifact.filename).toBe("lvtchat-document.xlsx");
    expect(artifact.mimeType).toBe(XLSX_MIME);
    expect(artifact.format).toBe("xlsx");
    expect(artifact.sizeBytes).toBe(artifact.bytes.byteLength);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Summary",
      "Action Items",
    ]);
    expect(summary).toBeDefined();
    expect(actions).toBeDefined();
    expect(summary?.getCell(1, 1).value).toBe("Status");
    expect(summary?.getCell(2, 1).value).toBe("Complete");
    expect(summary?.getCell(2, 2).value).toBe(123.45);
    expect(summary?.getCell(2, 3).value).toBe(-10);
    expect(summary?.getCell(2, 4).value).toBe(true);
    expect(summary?.getCell(2, 5).value).toBeNull();
    expect(summary?.getCell(2, 6).value).toBe(unicodeText + " — " + typographicText);
    expect(actions?.getCell(2, 1).value).toBe("Review workbook");
    expect(summary?.getRow(1).font?.bold).toBe(true);
    expect(summary?.getRow(1).fill).toMatchObject({ type: "pattern", fgColor: { argb: "1F4E78" } });
    expect(summary?.views[0]).toMatchObject({ state: "frozen", ySplit: 1 });
  });

  it("keeps formula-looking strings as text while preserving numeric negatives", async () => {
    const artifact = await generateXlsxArtifact(
      completeRequest({
        sheets: [
          {
            name: "Formula Safety",
            columns: ["Equals", "Plus", "Minus", "At", "Number"],
            rows: [["=SUM(A1:A2)", "+cmd", "-unsafe-string", "@reference", -10]],
          },
        ],
      }),
    );
    const workbook = await readWorkbook(artifact.bytes);
    const sheet = workbook.getWorksheet("Formula Safety");
    const values = ["'=SUM(A1:A2)", "'+cmd", "'-unsafe-string", "'@reference"];

    values.forEach((value, index) => {
      const cell = sheet?.getCell(2, index + 1);
      expect(cell?.type).toBe(ExcelJS.ValueType.String);
      expect(cell?.value).toBe(value);
    });
    expect(sheet?.getCell(2, 5).type).toBe(ExcelJS.ValueType.Number);
    expect(sheet?.getCell(2, 5).value).toBe(-10);
  });

  it("reuses shared filename behavior and enforces the artifact boundary", async () => {
    const cases = [
      [undefined, "lvtchat-document.xlsx"],
      ["report", "report.xlsx"],
      ["report.pdf", "report.xlsx"],
      ["../../private/report.xlsx", "_._private_report.xlsx"],
      ["report.xlsx.xlsx", "report.xlsx"],
    ] as const;

    for (const [filename, expected] of cases) {
      const artifact = await generateXlsxArtifact(completeRequest({ filename }));
      expect(artifact.filename).toBe(expected);
      expect(artifact.filename).toMatch(/\.xlsx$/);
      expect(artifact.filename).not.toContain("..");
    }

    const issues = validateGeneratedArtifact({
      filename: "large.xlsx",
      mimeType: XLSX_MIME,
      bytes: new Uint8Array(MAX_ARTIFACT_BYTES + 1),
      sizeBytes: MAX_ARTIFACT_BYTES + 1,
      format: "xlsx",
    });
    expect(issues).toContain("Artifact exceeds the maximum size.");
  });

  it("rejects unsafe, duplicate, overlong, empty, and empty-workbook requests", async () => {
    const headerOnly = await generateXlsxArtifact(completeRequest({ sheets: [{ name: "Headers Only", columns: ["Value"], rows: [] }] }));
    const headerWorkbook = await readWorkbook(headerOnly.bytes);
    expect(headerWorkbook.getWorksheet("Headers Only")?.getRow(1).values).toEqual([, "Value"]);

    const invalidNames = [
      "A".repeat(32),
      "Bad/Name",
      "Bad?Name",
      "'Bad",
      "",
    ];

    for (const name of invalidNames) {
      await expect(
        generateXlsxArtifact(
          completeRequest({
            sheets: [
              {
                name,
                columns: ["Value"],
                rows: [],
              },
            ],
          }),
        ),
      ).rejects.toThrow();
    }

    await expect(
      generateXlsxArtifact(
        completeRequest({
          sheets: [
            { name: "Duplicate", columns: ["A"], rows: [] },
            { name: "Duplicate", columns: ["B"], rows: [] },
          ],
        }),
      ),
    ).rejects.toThrow("Worksheet names must be unique");

    await expect(
      generateXlsxArtifact(completeRequest({ sheets: [] })),
    ).rejects.toThrow("Workbook must contain a sheet");
  });

  it("rejects malformed sheet data through shared validation", async () => {
    await expect(
      generateXlsxArtifact(
        completeRequest({
          sheets: [
            {
              name: "Invalid",
              columns: ["A", "B"],
              rows: [["only one"]],
            },
          ],
        }),
      ),
    ).rejects.toThrow("rows do not match");
  });
});
