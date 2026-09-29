import type {
  DocumentGenerationRequest,
  PresentationSlide,
} from "../contracts";
import {
  assertTemplateIssues,
  optionalString,
  optionalStringArray,
  optionalRecord,
  rejectUnexpectedKeys,
  requiredRecordArray,
  requiredString,
  requiredStringArray,
  stringMatrix,
  supportedFormat,
  templateFilename,
} from "./helpers";
import type {
  DocumentTemplate,
  TemplateRenderInput,
  TemplateVariablesRecord,
} from "./types";

type PresentationSection = {
  readonly heading: string;
  readonly body: string;
  readonly findings?: readonly string[];
};

type PresentationComparison = {
  readonly columns: readonly string[];
  readonly rows: readonly (readonly string[])[];
};

export type GeneralPresentationVariables = {
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly PresentationSection[];
  readonly recommendations?: readonly string[];
  readonly comparison?: PresentationComparison;
  readonly subtitle?: string;
  readonly notes?: string;
  readonly filename?: string;
};

const SUPPORTED_FORMATS = ["pptx"] as const;

function parseVariables(record: TemplateVariablesRecord): GeneralPresentationVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(
    record,
    ["title", "summary", "sections", "recommendations", "comparison", "subtitle", "notes", "filename"],
    issues,
  );
  const title = requiredString(record, "title", issues);
  const summary = requiredString(record, "summary", issues);
  const sectionRecords = requiredRecordArray(record, "sections", issues);
  const sections = sectionRecords.map((sectionRecord) => {
    rejectUnexpectedKeys(sectionRecord, ["heading", "body", "findings"], issues);
    const heading = requiredString(sectionRecord, "heading", issues);
    const body = requiredString(sectionRecord, "body", issues);
    const findings = optionalStringArray(sectionRecord, "findings", issues);
    return { heading, body, ...(findings ? { findings } : {}) };
  });
  const recommendations = optionalStringArray(record, "recommendations", issues);
  const comparisonRecord = optionalRecord(record, "comparison", issues);
  let comparison: PresentationComparison | undefined;
  if (comparisonRecord) {
    rejectUnexpectedKeys(comparisonRecord, ["columns", "rows"], issues);
    const columns = requiredStringArray(comparisonRecord, "columns", issues);
    const rows = stringMatrix(comparisonRecord, "rows", issues);
    if (rows.some((row) => row.length !== columns.length)) {
      issues.push("comparison rows must match columns.");
    }
    comparison = { columns, rows };
  }
  const subtitle = optionalString(record, "subtitle", issues);
  const notes = optionalString(record, "notes", issues);
  const filename = optionalString(record, "filename", issues);
  assertTemplateIssues(issues);
  return {
    title,
    summary,
    sections,
    ...(recommendations ? { recommendations } : {}),
    ...(comparison ? { comparison } : {}),
    ...(subtitle ? { subtitle } : {}),
    ...(notes ? { notes } : {}),
    ...(filename ? { filename } : {}),
  };
}

function slides(variables: GeneralPresentationVariables): readonly PresentationSlide[] {
  const result: PresentationSlide[] = [
    { type: "title", title: variables.title, subtitle: variables.subtitle, notes: variables.notes },
    { type: "section", title: "Executive Summary", supportingText: variables.summary },
  ];
  for (const section of variables.sections) {
    result.push({ type: "body", title: section.heading, paragraphs: [section.body] });
    if (section.findings) {
      result.push({ type: "bullets", title: `${section.heading} — Findings`, items: section.findings });
    }
  }
  if (variables.comparison) {
    result.push({
      type: "table",
      title: "Comparison",
      columns: variables.comparison.columns,
      rows: variables.comparison.rows,
    });
  }
  if (variables.recommendations) {
    result.push({ type: "numbered", title: "Recommendations", items: variables.recommendations });
  }
  return result;
}

export const generalPresentationTemplate: DocumentTemplate = {
  id: "general-presentation",
  version: 1,
  name: "General Presentation",
  description: "A professional presentation structure for summaries, findings, and recommendations.",
  contentFamily: "presentation",
  supportedFormats: SUPPORTED_FORMATS,
  requiredVariables: [
    { name: "title", kind: "string", description: "Presentation title." },
    { name: "summary", kind: "string", description: "Executive summary." },
    { name: "sections", kind: "object[]", description: "Presentation body sections." },
  ],
  optionalVariables: [
    { name: "subtitle", kind: "string", description: "Optional title-slide subtitle." },
    { name: "recommendations", kind: "string[]", description: "Optional recommendations." },
    { name: "comparison", kind: "table", description: "Optional comparison table." },
    { name: "notes", kind: "string", description: "Optional title-slide speaker notes." },
    { name: "filename", kind: "string", description: "Optional output filename." },
  ],
  render(input: TemplateRenderInput): DocumentGenerationRequest {
    const issues: string[] = [];
    supportedFormat(input.format, SUPPORTED_FORMATS, issues);
    assertTemplateIssues(issues);
    const variables = parseVariables(input.variables);
    return {
      format: "pptx",
      filename: templateFilename(input.variables, variables.title, "pptx", []),
      slides: slides(variables),
      title: variables.title,
    };
  },
};
