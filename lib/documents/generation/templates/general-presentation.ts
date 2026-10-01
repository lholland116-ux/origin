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

type ReportPresentationVariables = {
  readonly mode?: "report";
  readonly title: string;
  readonly summary: string;
  readonly sections: readonly PresentationSection[];
  readonly recommendations?: readonly string[];
  readonly comparison?: PresentationComparison;
  readonly subtitle?: string;
  readonly notes?: string;
  readonly filename?: string;
};

type ExplicitPresentationVariables = {
  readonly mode: "explicit_slides";
  readonly title: string;
  readonly exactSlideCount: number;
  readonly slides: readonly PresentationSlide[];
  readonly filename?: string;
};

export type GeneralPresentationVariables =
  | ReportPresentationVariables
  | ExplicitPresentationVariables;

const SUPPORTED_FORMATS = ["pptx"] as const;

function preservedRequiredString(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    issues.push(key + " is required and must be a non-empty string.");
    return "";
  }
  return value;
}

function preservedOptionalString(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !value.trim()) {
    issues.push(key + " must be a non-empty string when provided.");
    return undefined;
  }
  return value;
}

function preservedOptionalStringArray(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    issues.push(key + " must be a non-empty string array when provided.");
    return undefined;
  }
  return value as readonly string[];
}

function parseExplicitVariables(
  record: TemplateVariablesRecord,
): ExplicitPresentationVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(
    record,
    ["mode", "title", "exactSlideCount", "slides", "filename"],
    issues,
  );
  const title = preservedRequiredString(record, "title", issues);
  const countValue = record.exactSlideCount;
  const exactSlideCount =
    typeof countValue === "number" && Number.isInteger(countValue) && countValue > 0
      ? countValue
      : 0;
  if (exactSlideCount === 0) {
    issues.push("exactSlideCount is required and must be a positive integer.");
  }
  const slideRecords = requiredRecordArray(record, "slides", issues);
  const explicitSlides = slideRecords.map((slideRecord, index): PresentationSlide => {
    rejectUnexpectedKeys(
      slideRecord,
      ["type", "title", "body", "bullets", "subtitle", "notes"],
      issues,
    );
    const type = preservedRequiredString(slideRecord, "type", issues);
    const slideTitle = preservedRequiredString(slideRecord, "title", issues);
    const body = preservedOptionalString(slideRecord, "body", issues);
    const bullets = preservedOptionalStringArray(slideRecord, "bullets", issues);
    const subtitle = preservedOptionalString(slideRecord, "subtitle", issues);
    const notes = preservedOptionalString(slideRecord, "notes", issues);

    if (type === "title") {
      if (body || bullets) issues.push("Slide " + (index + 1) + " title slides cannot include body or bullets.");
      return { type: "title", title: slideTitle, ...(subtitle ? { subtitle } : {}), ...(notes ? { notes } : {}) };
    }
    if (type === "bullets") {
      if (!bullets) issues.push("Slide " + (index + 1) + " bullets are required.");
      if (body || subtitle) issues.push("Slide " + (index + 1) + " bullet slides cannot include body or subtitle.");
      return { type: "bullets", title: slideTitle, items: bullets ?? [], ...(notes ? { notes } : {}) };
    }
    if (type !== "body") {
      issues.push("Slide " + (index + 1) + " has an unsupported explicit slide type.");
    }
    if (!body) issues.push("Slide " + (index + 1) + " body is required.");
    if (bullets || subtitle) issues.push("Slide " + (index + 1) + " body slides cannot include bullets or subtitle.");
    return { type: "body", title: slideTitle, paragraphs: body ? [body] : [], ...(notes ? { notes } : {}) };
  });
  if (exactSlideCount !== 0 && exactSlideCount !== explicitSlides.length) {
    issues.push("exactSlideCount must match slides.length.");
  }
  const filename = optionalString(record, "filename", issues);
  assertTemplateIssues(issues);
  return {
    mode: "explicit_slides",
    title,
    exactSlideCount,
    slides: explicitSlides,
    ...(filename ? { filename } : {}),
  };
}

function parseReportVariables(
  record: TemplateVariablesRecord,
): ReportPresentationVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(
    record,
    ["mode", "title", "summary", "sections", "recommendations", "comparison", "subtitle", "notes", "filename"],
    issues,
  );
  if (record.mode !== undefined && record.mode !== "report") {
    issues.push("mode must be report for report-style presentations.");
  }
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
    mode: "report",
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

function parseVariables(record: TemplateVariablesRecord): GeneralPresentationVariables {
  return record.mode === "explicit_slides"
    ? parseExplicitVariables(record)
    : parseReportVariables(record);
}

function reportSlides(variables: ReportPresentationVariables): readonly PresentationSlide[] {
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
      slides: variables.mode === "explicit_slides" ? variables.slides : reportSlides(variables),
      ...(variables.mode === "explicit_slides"
        ? { exactSlideCount: variables.exactSlideCount }
        : {}),
      title: variables.title,
    };
  },
};
