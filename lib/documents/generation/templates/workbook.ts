import type { DocumentGenerationRequest, WorkbookCell } from "../contracts";
import { workbookExtractionToSheet, validateWorkbookExtraction } from "../workbook-extraction-contract";
import {
  assertTemplateIssues,
  rejectUnexpectedKeys,
  requiredString,
  supportedFormat,
  templateFilename,
} from "./helpers";
import type { DocumentTemplate, TemplateRenderInput, TemplateVariablesRecord } from "./types";

function parseVariables(record: TemplateVariablesRecord) {
  const issues: string[] = [];
  rejectUnexpectedKeys(record, ["title", "sheetName", "columns", "rows", "filename"], issues);
  const title = requiredString(record, "title", issues);
  const filename = record.filename;
  if (filename !== undefined && filename !== null && typeof filename !== "string") {
    issues.push("filename must be a string when provided.");
  }
  const sheetName = record.sheetName;
  if (typeof sheetName !== "string") issues.push("sheetName is required and must be a string.");
  const columns = record.columns;
  if (!Array.isArray(columns) || columns.some((column) => typeof column !== "string")) {
    issues.push("columns must be an array of strings.");
  }
  const rows = record.rows;
  if (!Array.isArray(rows) || rows.some((row) => !Array.isArray(row))) {
    issues.push("rows must be a matrix.");
  }
  assertTemplateIssues(issues);

  const extraction = validateWorkbookExtraction({
    sheetName,
    columns,
    rows: (rows as unknown[][]).map((row) => row.map((cell) => cell as WorkbookCell)),
  });
  return {
    title,
    filename: typeof filename === "string" ? filename : undefined,
    extraction,
  };
}

export const workbookTemplate: DocumentTemplate = {
  id: "tabular-workbook",
  version: 1,
  name: "Tabular Workbook",
  description: "A single structured worksheet generated from validated columns and rows.",
  contentFamily: "report",
  supportedFormats: ["xlsx"],
  requiredVariables: [
    { name: "title", kind: "string", description: "Workbook title." },
    { name: "sheetName", kind: "string", description: "Worksheet name." },
    { name: "columns", kind: "string[]", description: "Nonempty worksheet headers." },
    { name: "rows", kind: "table", description: "Rectangular rows of validated typed cell values." },
  ],
  optionalVariables: [
    { name: "filename", kind: "string", description: "Optional output filename." },
  ],
  render(input: TemplateRenderInput): DocumentGenerationRequest {
    const format = supportedFormat(input.format, ["xlsx"], []);
    const variables = parseVariables(input.variables);
    return {
      format: "xlsx",
      title: variables.title,
      filename: templateFilename(input.variables, variables.title, format, []),
      sheets: [workbookExtractionToSheet(variables.extraction)],
    };
  },
};
