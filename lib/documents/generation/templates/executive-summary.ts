import type { DocumentSection, DocumentGenerationRequest } from "../contracts";
import {
  assertTemplateIssues,
  optionalString,
  rejectUnexpectedKeys,
  requiredString,
  requiredStringArray,
  supportedFormat,
  templateFilename,
} from "./helpers";
import type {
  DocumentTemplate,
  TemplateRenderInput,
  TemplateVariablesRecord,
} from "./types";

export type ExecutiveSummaryVariables = {
  readonly title: string;
  readonly context: string;
  readonly keyFindings: readonly string[];
  readonly implications: readonly string[];
  readonly recommendedActions: readonly string[];
  readonly conclusion?: string;
  readonly filename?: string;
};

const SUPPORTED_FORMATS = ["docx", "pdf", "md", "txt"] as const;

function parseVariables(record: TemplateVariablesRecord): ExecutiveSummaryVariables {
  const issues: string[] = [];
  rejectUnexpectedKeys(
    record,
    ["title", "context", "keyFindings", "implications", "recommendedActions", "conclusion", "filename"],
    issues,
  );
  const title = requiredString(record, "title", issues);
  const context = requiredString(record, "context", issues);
  const keyFindings = requiredStringArray(record, "keyFindings", issues);
  const implications = requiredStringArray(record, "implications", issues);
  const recommendedActions = requiredStringArray(record, "recommendedActions", issues);
  const conclusion = optionalString(record, "conclusion", issues);
  const filename = optionalString(record, "filename", issues);
  assertTemplateIssues(issues);
  return {
    title,
    context,
    keyFindings,
    implications,
    recommendedActions,
    ...(conclusion ? { conclusion } : {}),
    ...(filename ? { filename } : {}),
  };
}

function sections(variables: ExecutiveSummaryVariables): readonly DocumentSection[] {
  const result: DocumentSection[] = [
    { type: "heading", level: 1, text: "Context" },
    { type: "paragraph", text: variables.context },
    { type: "heading", level: 1, text: "Key findings" },
    { type: "list", ordered: false, items: variables.keyFindings },
    { type: "heading", level: 1, text: "Implications" },
    { type: "list", ordered: false, items: variables.implications },
    { type: "heading", level: 1, text: "Recommended actions" },
    { type: "list", ordered: true, items: variables.recommendedActions },
  ];
  if (variables.conclusion) {
    result.push(
      { type: "heading", level: 1, text: "Conclusion" },
      { type: "paragraph", text: variables.conclusion },
    );
  }
  return result;
}

function markdownContent(variables: ExecutiveSummaryVariables): string {
  const lines = [
    `# ${variables.title}`,
    "",
    "## Context",
    "",
    variables.context,
    "",
    "## Key findings",
    "",
    ...variables.keyFindings.map((item) => `- ${item}`),
    "",
    "## Implications",
    "",
    ...variables.implications.map((item) => `- ${item}`),
    "",
    "## Recommended actions",
    "",
    ...variables.recommendedActions.map((item, index) => `${index + 1}. ${item}`),
  ];
  if (variables.conclusion) lines.push("", "## Conclusion", "", variables.conclusion);
  return lines.join("\n");
}

function textContent(variables: ExecutiveSummaryVariables): string {
  const lines = [
    variables.title,
    "",
    "CONTEXT",
    variables.context,
    "",
    "KEY FINDINGS",
    ...variables.keyFindings.map((item) => `- ${item}`),
    "",
    "IMPLICATIONS",
    ...variables.implications.map((item) => `- ${item}`),
    "",
    "RECOMMENDED ACTIONS",
    ...variables.recommendedActions.map((item, index) => `${index + 1}. ${item}`),
  ];
  if (variables.conclusion) lines.push("", "CONCLUSION", variables.conclusion);
  return lines.join("\n");
}

export const executiveSummaryTemplate: DocumentTemplate = {
  id: "executive-summary",
  version: 1,
  name: "Executive Summary",
  description: "A concise, decision-oriented summary of context, findings, and actions.",
  contentFamily: "report",
  supportedFormats: SUPPORTED_FORMATS,
  requiredVariables: [
    { name: "title", kind: "string", description: "Summary title." },
    { name: "context", kind: "string", description: "Context or purpose." },
    { name: "keyFindings", kind: "string[]", description: "Key findings." },
    { name: "implications", kind: "string[]", description: "Implications." },
    { name: "recommendedActions", kind: "string[]", description: "Recommended actions." },
  ],
  optionalVariables: [
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
      return { format, filename, title: variables.title, sections: sections(variables) };
    }
    if (format === "md") {
      return { format, filename, title: variables.title, content: markdownContent(variables) };
    }
    return { format: "txt", filename, title: variables.title, content: textContent(variables) };
  },
};
