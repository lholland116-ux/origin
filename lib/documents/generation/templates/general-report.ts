import type {
  DocumentSection,
  DocumentGenerationRequest,
} from "../contracts";
import {
  assertTemplateIssues,
  optionalString,
  optionalStringArray,
  optionalRecord,
  rejectUnexpectedKeys,
  requiredRecordArray,
  requiredStringArray,
  requiredString,
  stringMatrix,
  supportedFormat,
  templateFilename,
  textTable,
} from "./helpers";
import type {
  DocumentTemplate,
  TemplateRenderInput,
  TemplateVariablesRecord,
} from "./types";

type GeneralReportSection = {
  readonly heading: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly table?: {
    readonly columns: readonly string[];
    readonly rows: readonly (readonly string[])[];
  };
};

export type GeneralReportVariables = {
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly GeneralReportSection[];
  readonly subtitle?: string;
  readonly author?: string;
  readonly date?: string;
  readonly recommendations?: readonly string[];
  readonly conclusion?: string;
  readonly filename?: string;
};

const SUPPORTED_FORMATS = ["docx", "pdf", "md", "txt"] as const;

function parseVariables(record: TemplateVariablesRecord): GeneralReportVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(
    record,
    [
      "title",
      "summary",
      "sections",
      "subtitle",
      "author",
      "date",
      "recommendations",
      "conclusion",
      "filename",
    ],
    issues,
  );
  const title = requiredString(record, "title", issues);
  const summary = requiredString(record, "summary", issues);
  const sectionRecords = requiredRecordArray(record, "sections", issues);
  const sections = sectionRecords.map((sectionRecord, index) => {
    rejectUnexpectedKeys(sectionRecord, ["heading", "body", "bullets", "table"], issues);
    const heading = requiredString(sectionRecord, "heading", issues);
    const body = requiredString(sectionRecord, "body", issues);
    const bullets = optionalStringArray(sectionRecord, "bullets", issues);
    const tableRecord = optionalRecord(sectionRecord, "table", issues);
    let table: GeneralReportSection["table"];
    if (tableRecord) {
      const columns = requiredStringArray(tableRecord, "columns", issues);
      const rows = stringMatrix(tableRecord, "rows", issues);
      if (rows.some((row) => row.length !== columns.length)) {
        issues.push(`sections[${index}].table rows must match columns.`);
      }
      table = { columns, rows };
    }
    return { heading, body, ...(bullets ? { bullets } : {}), ...(table ? { table } : {}) };
  });
  const subtitle = optionalString(record, "subtitle", issues);
  const author = optionalString(record, "author", issues);
  const date = optionalString(record, "date", issues);
  const recommendations = optionalStringArray(record, "recommendations", issues);
  const conclusion = optionalString(record, "conclusion", issues);
  const filename = optionalString(record, "filename", issues);
  assertTemplateIssues(issues);
  return {
    title,
    summary,
    sections,
    ...(subtitle ? { subtitle } : {}),
    ...(author ? { author } : {}),
    ...(date ? { date } : {}),
    ...(recommendations ? { recommendations } : {}),
    ...(conclusion ? { conclusion } : {}),
    ...(filename ? { filename } : {}),
  };
}

function structuredSections(variables: GeneralReportVariables): readonly DocumentSection[] {
  const sections: DocumentSection[] = [];
  if (variables.subtitle) sections.push({ type: "paragraph", text: variables.subtitle });
  if (variables.author || variables.date) {
    sections.push({
      type: "paragraph",
      text: [variables.author, variables.date].filter(Boolean).join(" · "),
    });
  }
  sections.push({ type: "heading", level: 1, text: "Summary" });
  sections.push({ type: "paragraph", text: variables.summary });
  for (const section of variables.sections) {
    sections.push({ type: "heading", level: 2, text: section.heading });
    sections.push({ type: "paragraph", text: section.body });
    if (section.bullets) sections.push({ type: "list", ordered: false, items: section.bullets });
    if (section.table) sections.push({ type: "table", ...section.table });
  }
  if (variables.recommendations) {
    sections.push({ type: "heading", level: 1, text: "Recommendations" });
    sections.push({ type: "list", ordered: false, items: variables.recommendations });
  }
  if (variables.conclusion) {
    sections.push({ type: "heading", level: 1, text: "Conclusion" });
    sections.push({ type: "paragraph", text: variables.conclusion });
  }
  return sections;
}

function markdownContent(variables: GeneralReportVariables): string {
  const lines = [`# ${variables.title}`];
  if (variables.subtitle) lines.push("", variables.subtitle);
  if (variables.author || variables.date) lines.push("", [variables.author, variables.date].filter(Boolean).join(" · "));
  lines.push("", "## Summary", "", variables.summary);
  for (const section of variables.sections) {
    lines.push("", `## ${section.heading}`, "", section.body);
    if (section.bullets) lines.push("", ...section.bullets.map((item) => `- ${item}`));
    if (section.table) lines.push("", ...textTable(section.table.columns, section.table.rows));
  }
  if (variables.recommendations) lines.push("", "## Recommendations", "", ...variables.recommendations.map((item) => `- ${item}`));
  if (variables.conclusion) lines.push("", "## Conclusion", "", variables.conclusion);
  return lines.join("\n");
}

function textContent(variables: GeneralReportVariables): string {
  const lines = [variables.title];
  if (variables.subtitle) lines.push("", variables.subtitle);
  if (variables.author || variables.date) lines.push("", [variables.author, variables.date].filter(Boolean).join(" · "));
  lines.push("", "SUMMARY", variables.summary);
  for (const section of variables.sections) {
    lines.push("", section.heading.toUpperCase(), section.body);
    if (section.bullets) lines.push(...section.bullets.map((item) => `- ${item}`));
    if (section.table) lines.push(...section.table.rows.map((row) => row.join(" | ")));
  }
  if (variables.recommendations) lines.push("", "RECOMMENDATIONS", ...variables.recommendations.map((item) => `- ${item}`));
  if (variables.conclusion) lines.push("", "CONCLUSION", variables.conclusion);
  return lines.join("\n");
}

export const generalReportTemplate: DocumentTemplate = {
  id: "general-report",
  version: 1,
  name: "General Report",
  description: "A reusable report structure for findings, analysis, and recommendations.",
  contentFamily: "report",
  supportedFormats: SUPPORTED_FORMATS,
  requiredVariables: [
    { name: "title", kind: "string", description: "Report title." },
    { name: "summary", kind: "string", description: "Report summary or introduction." },
    { name: "sections", kind: "object[]", description: "Report sections shaped as { heading, body, optional bullets: string[], optional table: { columns: string[], rows: string[][] } }. Keep lists and tables structured, not embedded in body text." },
  ],
  optionalVariables: [
    { name: "subtitle", kind: "string", description: "Optional subtitle." },
    { name: "author", kind: "string", description: "Optional author or source label." },
    { name: "date", kind: "string", description: "Optional date label." },
    { name: "recommendations", kind: "string[]", description: "Optional recommendations." },
    { name: "conclusion", kind: "string", description: "Optional conclusion." },
    { name: "filename", kind: "string", description: "Optional output filename." },
  ],
  render(input: TemplateRenderInput): DocumentGenerationRequest {
    const issues: string[] = [];
    const format = supportedFormat(input.format, SUPPORTED_FORMATS, issues);
    assertTemplateIssues(issues);
    const variables = parseVariables(input.variables);
    const filename = templateFilename(input.variables, variables.title, format, []);
    if (format === "docx" || format === "pdf") {
      return { format, filename, title: variables.title, sections: structuredSections(variables) };
    }
    if (format === "md") {
      return { format, filename, title: variables.title, content: markdownContent(variables) };
    }
    return { format: "txt", filename, title: variables.title, content: textContent(variables) };
  },
};
