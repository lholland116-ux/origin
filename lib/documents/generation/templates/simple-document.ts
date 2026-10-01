import type { DocumentGenerationRequest, DocumentSection } from "../contracts";
import {
  assertTemplateIssues,
  optionalString,
  optionalStringArray,
  reconcileMarkdownTitleHeading,
  rejectUnexpectedKeys,
  requiredString,
  supportedFormat,
  templateFilename,
} from "./helpers";
import type {
  DocumentTemplate,
  TemplateRenderInput,
  TemplateVariablesRecord,
} from "./types";

type SimpleDocumentVariables = {
  readonly title: string;
  readonly date?: string;
  readonly body: string;
  readonly bullets?: readonly string[];
  readonly filename?: string;
};

const SUPPORTED_FORMATS = ["txt", "md", "docx", "pdf"] as const;

function parseVariables(record: TemplateVariablesRecord): SimpleDocumentVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(record, ["title", "date", "body", "bullets", "filename"], issues);
  const title = requiredString(record, "title", issues);
  const date = record.date === null ? undefined : optionalString(record, "date", issues);
  const body = requiredString(record, "body", issues);
  const bullets = record.bullets === null ? undefined : optionalStringArray(record, "bullets", issues);
  const filename = record.filename === null ? undefined : optionalString(record, "filename", issues);
  assertTemplateIssues(issues);
  return {
    title,
    body,
    ...(date ? { date } : {}),
    ...(bullets !== undefined ? { bullets } : {}),
    ...(filename ? { filename } : {}),
  };
}

function structuredSections(variables: SimpleDocumentVariables): readonly DocumentSection[] {
  const sections: DocumentSection[] = [];
  if (variables.date) sections.push({ type: "paragraph", text: variables.date });
  sections.push({ type: "paragraph", text: variables.body });
  if (variables.bullets?.length) {
    sections.push({ type: "list", ordered: false, items: variables.bullets });
  }
  return sections;
}

function textContent(variables: SimpleDocumentVariables, markdown: boolean): string {
  const lines = [markdown ? "# " + variables.title : variables.title];
  if (variables.date) lines.push("", variables.date);
  const body = markdown
    ? reconcileMarkdownTitleHeading(variables.title, variables.body).content
    : variables.body;
  lines.push("", body);
  if (variables.bullets?.length) {
    lines.push("", ...variables.bullets.map((bullet) => "- " + bullet));
  }
  return lines.join("\n");
}

export const simpleDocumentTemplate: DocumentTemplate = {
  id: "simple-document",
  version: 1,
  name: "Simple Document",
  description: "Minimal exact-content document with no required summary, headings, or filler prose.",
  contentFamily: "document",
  supportedFormats: SUPPORTED_FORMATS,
  requiredVariables: [
    { name: "title", kind: "string", description: "Document title." },
    { name: "body", kind: "string", description: "Required primary content; preserve the requested text and add no prose." },
  ],
  optionalVariables: [
    { name: "date", kind: "string", description: "Optional date displayed directly beneath the title." },
    { name: "bullets", kind: "string[]", description: "Optional bullet items. Include only when requested; omit or leave empty when none are requested." },
    { name: "filename", kind: "string", description: "Optional output filename." },
  ],
  render(input: TemplateRenderInput): DocumentGenerationRequest {
    const issues: string[] = [];
    const format = supportedFormat(input.format, SUPPORTED_FORMATS, issues);
    assertTemplateIssues(issues);
    const variables = parseVariables(input.variables);
    const filename = templateFilename(input.variables, variables.title, format, []);
    if (format === "docx" || format === "pdf") {
      return {
        format,
        filename,
        title: variables.title,
        sections: structuredSections(variables),
      };
    }
    if (format === "md") {
      return {
        format,
        filename,
        title: variables.title,
        content: textContent(variables, true),
      };
    }
    return {
      format: "txt",
      filename,
      title: variables.title,
      content: textContent(variables, false),
    };
  },
};
