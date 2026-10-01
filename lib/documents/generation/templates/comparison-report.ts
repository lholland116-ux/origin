import type {
  DocumentGenerationRequest,
  DocumentSection,
  WorkbookCell,
} from "../contracts";
import {
  assertTemplateIssues,
  optionalString,
  rejectUnexpectedKeys,
  requiredRecordArray,
  requiredString,
  requiredStringArray,
  supportedFormat,
  templateFilename,
  textTable,
} from "./helpers";
import type {
  DocumentTemplate,
  TemplateOutputFormat,
  TemplateRenderInput,
  TemplateVariablesRecord,
} from "./types";

type ComparedItem = {
  readonly name: string;
  readonly description?: string;
};

type ComparisonRow = {
  readonly item: string;
  readonly values: readonly WorkbookCell[];
};

export type ComparisonReportVariables = {
  readonly title: string;
  readonly firstColumnHeader?: string;
  readonly items: readonly ComparedItem[];
  readonly criteria: readonly string[];
  readonly summary: string;
  readonly comparisons: readonly ComparisonRow[];
  readonly observations: readonly string[];
  readonly conclusion?: string;
  readonly filename?: string;
};

const SUPPORTED_FORMATS = ["docx", "pdf", "md", "txt", "xlsx"] as const;

function isComparisonCell(value: unknown): value is WorkbookCell {
  return (
    (typeof value === "string" && /\S/.test(value)) ||
    (typeof value === "number" && Number.isFinite(value)) ||
    typeof value === "boolean" ||
    value === null
  );
}

function requiredComparisonCellArray(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): readonly WorkbookCell[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    issues.push(key + " is required and must be a non-empty array of strings, numbers, booleans, or null.");
    return [];
  }

  const cells: WorkbookCell[] = [];
  for (const cell of value) {
    if (!isComparisonCell(cell)) {
      issues.push(key + " is required and must be a non-empty array of strings, numbers, booleans, or null.");
      return [];
    }
    cells.push(cell);
  }
  return cells;
}

function displayComparisonCell(value: WorkbookCell): string {
  return value === null ? "" : String(value);
}

function optionalFirstColumnHeader(
  record: TemplateVariablesRecord,
  issues: string[],
): string | undefined {
  const value = record.firstColumnHeader;
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || !/\S/.test(value)) {
    issues.push("firstColumnHeader must be null or a non-empty string.");
    return undefined;
  }
  return value;
}

function parseVariables(record: TemplateVariablesRecord): ComparisonReportVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(
    record,
    ["title", "firstColumnHeader", "items", "criteria", "summary", "comparisons", "observations", "conclusion", "filename"],
    issues,
  );
  const title = requiredString(record, "title", issues);
  const firstColumnHeader = optionalFirstColumnHeader(record, issues);
  const itemRecords = requiredRecordArray(record, "items", issues);
  const items = itemRecords.map((itemRecord) => {
    rejectUnexpectedKeys(itemRecord, ["name", "description"], issues);
    const name = requiredString(itemRecord, "name", issues);
    const description = optionalString(itemRecord, "description", issues);
    return { name, ...(description ? { description } : {}) };
  });
  const criteria = requiredStringArray(record, "criteria", issues);
  const summary = requiredString(record, "summary", issues);
  const comparisonRecords = requiredRecordArray(record, "comparisons", issues);
  const comparisons = comparisonRecords.map((comparisonRecord, index) => {
    rejectUnexpectedKeys(comparisonRecord, ["item", "values"], issues);
    const item = requiredString(comparisonRecord, "item", issues);
    const values = requiredComparisonCellArray(comparisonRecord, "values", issues);
    if (values.length !== criteria.length) {
      issues.push(`comparisons[${index}].values must match criteria.`);
    }
    if (items.length > 0 && !items.some((candidate) => candidate.name === item)) {
      issues.push(`comparisons[${index}].item must match an item.`);
    }
    return { item, values };
  });
  const observations = requiredStringArray(record, "observations", issues);
  const conclusion = optionalString(record, "conclusion", issues);
  const filename = optionalString(record, "filename", issues);
  assertTemplateIssues(issues);
  return {
    title,
    ...(firstColumnHeader !== undefined ? { firstColumnHeader } : {}),
    items,
    criteria,
    summary,
    comparisons,
    observations,
    ...(conclusion ? { conclusion } : {}),
    ...(filename ? { filename } : {}),
  };
}

function comparisonTable(variables: ComparisonReportVariables): {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly WorkbookCell[])[];
} {
  return {
    columns: [variables.firstColumnHeader ?? "Item", ...variables.criteria],
    rows: variables.comparisons.map((row) => [row.item, ...row.values]),
  };
}

function comparisonTextTable(variables: ComparisonReportVariables): {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
} {
  const table = comparisonTable(variables);
  return {
    columns: table.columns,
    rows: table.rows.map((row) => row.map(displayComparisonCell)),
  };
}

function sections(variables: ComparisonReportVariables): readonly DocumentSection[] {
  const table = comparisonTextTable(variables);
  const itemDescriptions = variables.items.map((item) =>
    item.description ? `${item.name}: ${item.description}` : item.name,
  );
  const result: DocumentSection[] = [
    { type: "heading", level: 1, text: "Summary" },
    { type: "paragraph", text: variables.summary },
    { type: "heading", level: 1, text: "Compared items" },
    { type: "list", ordered: false, items: itemDescriptions },
    { type: "heading", level: 1, text: "Comparison" },
    { type: "table", ...table },
    { type: "heading", level: 1, text: "Observations" },
    { type: "list", ordered: false, items: variables.observations },
  ];
  if (variables.conclusion) {
    result.push(
      { type: "heading", level: 1, text: "Conclusion" },
      { type: "paragraph", text: variables.conclusion },
    );
  }
  return result;
}

function markdownContent(variables: ComparisonReportVariables): string {
  const table = comparisonTextTable(variables);
  const lines = [
    `# ${variables.title}`,
    "",
    "## Summary",
    "",
    variables.summary,
    "",
    "## Compared items",
    "",
    ...variables.items.map((item) => `- ${item.description ? `${item.name}: ${item.description}` : item.name}`),
    "",
    "## Comparison",
    "",
    ...textTable(table.columns, table.rows),
    "",
    "## Observations",
    "",
    ...variables.observations.map((item) => `- ${item}`),
  ];
  if (variables.conclusion) lines.push("", "## Conclusion", "", variables.conclusion);
  return lines.join("\n");
}

function textContent(variables: ComparisonReportVariables): string {
  const table = comparisonTextTable(variables);
  const lines = [
    variables.title,
    "",
    "SUMMARY",
    variables.summary,
    "",
    "COMPARED ITEMS",
    ...variables.items.map((item) => `- ${item.description ? `${item.name}: ${item.description}` : item.name}`),
    "",
    "COMPARISON",
    table.columns.join(" | "),
    ...table.rows.map((row) => row.join(" | ")),
    "",
    "OBSERVATIONS",
    ...variables.observations.map((item) => `- ${item}`),
  ];
  if (variables.conclusion) lines.push("", "CONCLUSION", variables.conclusion);
  return lines.join("\n");
}

export const comparisonReportTemplate: DocumentTemplate = {
  id: "comparison-report",
  version: 1,
  name: "Comparison Report",
  description: "A narrative and tabular comparison of multiple options or items.",
  contentFamily: "report",
  supportedFormats: SUPPORTED_FORMATS,
  requiredVariables: [
    { name: "title", kind: "string", description: "Comparison title." },
    { name: "items", kind: "object[]", description: "Items or options being compared." },
    { name: "criteria", kind: "string[]", description: "Comparison criteria." },
    { name: "summary", kind: "string", description: "Comparison summary." },
    { name: "comparisons", kind: "object[]", description: "Rows of string, numeric, boolean, or blank comparison values." },
    { name: "observations", kind: "string[]", description: "Narrative observations." },
  ],
  optionalVariables: [
    { name: "firstColumnHeader", kind: "string", description: "Optional exact first-column heading; null uses Item." },
    { name: "conclusion", kind: "string", description: "Optional conclusion." },
    { name: "filename", kind: "string", description: "Optional output filename." },
  ],
  render(input: TemplateRenderInput): DocumentGenerationRequest {
    const issues: string[] = [];
    supportedFormat(input.format, SUPPORTED_FORMATS, issues);
    assertTemplateIssues(issues);
    const variables = parseVariables(input.variables);
    const format = input.format as TemplateOutputFormat;
    const filename = templateFilename(input.variables, variables.title, format, []);
    if (format === "xlsx") {
      const table = comparisonTable(variables);
      return {
        format,
        filename,
        title: variables.title,
        sheets: [{ name: "Comparison", columns: table.columns, rows: table.rows }],
      };
    }
    if (format === "docx" || format === "pdf") {
      return { format, filename, title: variables.title, sections: sections(variables) };
    }
    if (format === "md") {
      return { format, filename, title: variables.title, content: markdownContent(variables) };
    }
    return { format: "txt", filename, title: variables.title, content: textContent(variables) };
  },
};
