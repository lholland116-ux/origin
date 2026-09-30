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

function isRelativeDateRequest(message: string): boolean {
  return /\b(?:today(?:['’]s)?|current date)\b/i.test(message);
}

function requestsExplicitDateRepetition(message: string): boolean {
  return /\b(?:repeat|again|twice|more than once|both)\b/i.test(message);
}

function requestsExplicitDatePlacement(message: string): boolean {
  return /\b(?:under|in|inside|within)\b[\s\S]{0,48}\b(?:title|heading|body|summary|paragraph|conclusion|section|bullet|table)\b/i.test(message);
}

function isAutomaticDateOnlyText(value: string, currentDate: string): boolean {
  const normalized = value
    .trim()
    .replace(/^[>*\-•\s]+/, "")
    .replace(/[.!?]+$/, "")
    .trim();
  const date = currentDate.replace(/-/g, "\\-");
  return new RegExp("^(?:(?:today(?:['’]s)?|current)\\s+date|date)?\\s*[:\\-–—]?\\s*" + date + "$", "i").test(normalized);
}

function removeAutomaticDateOnlyText(value: string, currentDate: string, fallback: string): string {
  const cleaned = value
    .split(/\r?\n/)
    .filter((line) => !isAutomaticDateOnlyText(line, currentDate))
    .join("\n")
    .trim();
  return cleaned || fallback;
}

function normalizeAutomaticDatePlacement(
  variables: TemplateVariablesRecord,
  latestMessage: string,
  currentDate: string,
): TemplateVariablesRecord {
  if (
    !isRelativeDateRequest(latestMessage) ||
    requestsExplicitDateRepetition(latestMessage) ||
    requestsExplicitDatePlacement(latestMessage) ||
    variables.date !== currentDate
  ) {
    return variables;
  }

  const sections = Array.isArray(variables.sections)
    ? variables.sections.map((section) => {
        if (!isRecord(section)) return section;
        const nextSection = { ...section };
        if (typeof nextSection.body === "string") {
          nextSection.body = removeAutomaticDateOnlyText(
            nextSection.body,
            currentDate,
            "See the document date above.",
          );
        }
        if (Array.isArray(nextSection.bullets)) {
          const bullets = nextSection.bullets.filter(
            (bullet): bullet is string =>
              typeof bullet === "string" && !isAutomaticDateOnlyText(bullet, currentDate),
          );
          if (bullets.length > 0) nextSection.bullets = bullets;
          else delete nextSection.bullets;
        }
        if (isRecord(nextSection.table) && Array.isArray(nextSection.table.rows)) {
          nextSection.table = {
            ...nextSection.table,
            rows: nextSection.table.rows.map((row) =>
              Array.isArray(row)
                ? row.map((cell) =>
                    typeof cell === "string" && isAutomaticDateOnlyText(cell, currentDate)
                      ? ""
                      : cell,
                  )
                : row,
            ),
          };
        }
        return nextSection;
      })
    : variables.sections;

  const normalized: Record<string, TemplateInputValue> = { ...variables, sections };
  for (const key of ["summary", "conclusion"] as const) {
    const value = normalized[key];
    if (typeof value === "string") {
      normalized[key] = removeAutomaticDateOnlyText(
        value,
        currentDate,
        "See the document date above.",
      );
    }
  }
  if (Array.isArray(normalized.recommendations)) {
    const recommendations = normalized.recommendations.filter(
      (item): item is string =>
        typeof item === "string" && !isAutomaticDateOnlyText(item, currentDate),
    );
    if (recommendations.length > 0) normalized.recommendations = recommendations;
    else delete normalized.recommendations;
  }
  return normalized;
}

function parseModelIntent(
  value: unknown,
  context: { readonly latestMessage: string; readonly currentDate: string },
): DocumentGenerationIntent | null {
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
  const normalizedVariables =
    templateId === "general-report"
      ? normalizeAutomaticDatePlacement(variables, context.latestMessage, context.currentDate)
      : variables;

  return {
    templateId,
    formats: uniqueFormats,
    variables: normalizedVariables,
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
    "For a relative current-date request, put the grounded date in general-report's optional date variable so it appears in the template's dedicated date position. Do not repeat that same automatic date in summary, section body, bullets, tables, recommendations, or conclusion. Preserve repeated placement only when the user explicitly asks for it or names a body location.",
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
    return parseModelIntent(JSON.parse(output), {
      latestMessage: params.latestMessage,
      currentDate,
    });
  } catch (error) {
    console.error("Document intent resolution failed:", error);
    return null;
  }
}
