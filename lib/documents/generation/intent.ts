import { openai } from "@/lib/openai";
import { getTemplate, listTemplates } from "./templates/registry";
import type {
  TemplateInputValue,
  TemplateOutputFormat,
  TemplateVariablesRecord,
} from "./templates/types";
import { isTemplateOutputFormat } from "./generate";

const MODEL = "gpt-5.6-luna";

const DOCUMENT_REQUEST_CANDIDATE =
  /\b(document|file|export|download|report|summary|presentation|powerpoint|pptx|word|docx|pdf|spreadsheet|excel|xlsx|markdown|zip|text file)\b/i;

const DOCUMENT_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["none", "generate_document"] },
    templateId: { type: "string" },
    formats: {
      type: "array",
      items: { type: "string", enum: ["txt", "md", "docx", "pdf", "xlsx", "pptx"] },
      maxItems: 7,
    },
    packageAsZip: { type: "boolean" },
    title: { type: "string" },
    variables: { type: "object", additionalProperties: true },
  },
  required: ["action", "templateId", "formats", "packageAsZip", "title", "variables"],
} as const;

type IntentModelRecord = {
  readonly action?: unknown;
  readonly templateId?: unknown;
  readonly formats?: unknown;
  readonly packageAsZip?: unknown;
  readonly title?: unknown;
  readonly variables?: unknown;
};

export type DocumentGenerationIntent = {
  readonly templateId: string;
  readonly formats: readonly TemplateOutputFormat[];
  readonly variables: TemplateVariablesRecord;
  readonly packageAsZip: boolean;
};

export function getRuntimeCurrentDate(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTemplateInputValue(value: unknown, depth = 0): value is TemplateInputValue {
  if (depth > 12) return false;
  if (value === null) return true;
  if (typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => isTemplateInputValue(item, depth + 1));
  if (!isRecord(value)) return false;
  return Object.values(value).every((item) => isTemplateInputValue(item, depth + 1));
}

function parseModelIntent(value: unknown): DocumentGenerationIntent | null {
  if (!isRecord(value)) return null;
  const row = value as IntentModelRecord;

  if (row.action !== "generate_document" || typeof row.templateId !== "string") {
    return null;
  }

  const templateId = row.templateId.trim();
  if (!templateId || !getTemplate(templateId)) return null;

  const rawFormats = Array.isArray(row.formats) ? row.formats : [];
  const formats = rawFormats.filter(isTemplateOutputFormat);
  const uniqueFormats = Array.from(new Set(formats));
  if (uniqueFormats.length === 0 || uniqueFormats.length !== rawFormats.length || uniqueFormats.length !== formats.length) return null;

  if (!isRecord(row.variables) || !isTemplateInputValue(row.variables)) return null;

  const variables = {
    ...(row.variables as TemplateVariablesRecord),
    ...(typeof row.title === "string" && row.title.trim() && row.variables.title === undefined
      ? { title: row.title.trim() }
      : {}),
  };

  return {
    templateId,
    formats: uniqueFormats,
    variables,
    packageAsZip: row.packageAsZip === true || uniqueFormats.length > 1,
  };
}

export function isDocumentGenerationCandidate(message: string): boolean {
  return DOCUMENT_REQUEST_CANDIDATE.test(message);
}

export async function resolveDocumentGenerationIntent(params: {
  readonly latestMessage: string;
  readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly documentContext?: string;
}): Promise<DocumentGenerationIntent | null> {
  if (!isDocumentGenerationCandidate(params.latestMessage)) return null;

  const history = params.history
    .slice(-12)
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");
  const context = params.documentContext
    ? `\n\nDOCUMENT CONTEXT:\n${params.documentContext.slice(0, 40_000)}`
    : "";

  const templateSchemas = listTemplates().map((template) => ({
    id: template.id,
    supportedFormats: template.supportedFormats,
    requiredVariables: template.requiredVariables,
    optionalVariables: template.optionalVariables,
  }));
  const currentDate = getRuntimeCurrentDate();

  const instructions = [
    "You are LVTChat's document-intent planner.",
    "Return action=none unless the latest user message explicitly requests creating, exporting, downloading, or packaging a document.",
    "Do not treat a question about a file format as a generation request.",
    "For generate_document, choose exactly one registered template: general-report, executive-summary, comparison-report, or general-presentation.",
    "Choose only supported formats. If more than one format is requested, set packageAsZip=true.",
    "For general-report sections, keep body as paragraph text only. Put unordered list items in bullets and tables in table with columns and rows. Never encode tables or lists as Markdown inside body.",
    `Use this exact template schema when building variables: ${JSON.stringify(templateSchemas)}. Include every required variable with the correct shape, including at least one section/item where required. Use only the selected template's documented variable names.`,
    "Preserve supplied content and do not invent factual findings.",
    "CURRENT RUNTIME DATE (UTC): " + currentDate + ". When the user requests today or the current date, use this exact date. Do not infer a different date from model knowledge or conversation content.",
    "Use the current conversation and document context only as source content. Never return paths, code, MIME overrides, or library options.",
    `Return only JSON matching ${JSON.stringify(DOCUMENT_INTENT_SCHEMA)}.`,
    `CONVERSATION:\n${history}${context}`,
  ].join("\n\n");

  try {
    const response = await openai.responses.create({
      model: MODEL,
      input: instructions,
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "lvtchat_document_intent",
          schema: DOCUMENT_INTENT_SCHEMA,
          strict: false,
        },
      },
    } as never);

    const output = response.output_text?.trim();
    if (!output) return null;
    return parseModelIntent(JSON.parse(output));
  } catch (error) {
    console.error("Document intent resolution failed:", error);
    return null;
  }
}
