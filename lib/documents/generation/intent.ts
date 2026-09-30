import { openai } from "@/lib/openai";
import { getTemplate, listTemplates } from "./templates/registry";
import { renderTemplate } from "./templates/render";
import { TemplateValidationError } from "./templates/types";
import type {
  TemplateInputValue,
  TemplateOutputFormat,
  TemplateVariablesRecord,
} from "./templates/types";
import { isTemplateOutputFormat } from "./generate";

const MODEL = "gpt-5.6-luna";

const DOCUMENT_REQUEST_CANDIDATE =
  /\b(document|file|export|download|report|summary|presentation|powerpoint|pptx|word|docx|pdf|spreadsheet|excel|xlsx|markdown|zip|text file)\b/i;

const EXPLICIT_DOCUMENT_GENERATION_VERB =
  /\b(?:create|generate|make|produce|build|export|prepare|save\s+as)\b/i;

const SUPPORTED_DOCUMENT_OUTPUT_REFERENCE =
  /\b(?:txt|text\s+file|markdown|md|docx|word\s+document|pdf|xlsx|excel\s+(?:spreadsheet|workbook)|pptx|powerpoint|presentation|zip)\b/i;

const INFORMATIONAL_DOCUMENT_QUESTION =
  /\b(?:what\s+is|what\s+does|explain|how\s+(?:do|can)\s+i|can\s+.+\s+open)\b/i;

const REQUIRED_STRING_SCHEMA = { type: "string", minLength: 1 } as const;
const OPTIONAL_STRING_SCHEMA = { type: ["string", "null"] } as const;
const REQUIRED_STRING_ARRAY_SCHEMA = {
  type: "array",
  minItems: 1,
  items: REQUIRED_STRING_SCHEMA,
} as const;
const OPTIONAL_STRING_ARRAY_SCHEMA = {
  type: ["array", "null"],
  items: REQUIRED_STRING_SCHEMA,
} as const;

const TABLE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    columns: REQUIRED_STRING_ARRAY_SCHEMA,
    rows: {
      type: "array",
      items: {
        type: "array",
        items: { type: "string" },
      },
    },
  },
  required: ["columns", "rows"],
} as const;

const NULLABLE_TABLE_SCHEMA = {
  anyOf: [TABLE_SCHEMA, { type: "null" }],
} as const;

const GENERAL_REPORT_VARIABLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: REQUIRED_STRING_SCHEMA,
    summary: REQUIRED_STRING_SCHEMA,
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: REQUIRED_STRING_SCHEMA,
          body: REQUIRED_STRING_SCHEMA,
          bullets: OPTIONAL_STRING_ARRAY_SCHEMA,
          table: NULLABLE_TABLE_SCHEMA,
        },
        required: ["heading", "body", "bullets", "table"],
      },
    },
    subtitle: OPTIONAL_STRING_SCHEMA,
    author: OPTIONAL_STRING_SCHEMA,
    date: OPTIONAL_STRING_SCHEMA,
    recommendations: OPTIONAL_STRING_ARRAY_SCHEMA,
    conclusion: OPTIONAL_STRING_SCHEMA,
    filename: OPTIONAL_STRING_SCHEMA,
  },
  required: [
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
} as const;

const EXECUTIVE_SUMMARY_VARIABLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: REQUIRED_STRING_SCHEMA,
    context: REQUIRED_STRING_SCHEMA,
    keyFindings: REQUIRED_STRING_ARRAY_SCHEMA,
    implications: REQUIRED_STRING_ARRAY_SCHEMA,
    recommendedActions: REQUIRED_STRING_ARRAY_SCHEMA,
    conclusion: OPTIONAL_STRING_SCHEMA,
    filename: OPTIONAL_STRING_SCHEMA,
  },
  required: [
    "title",
    "context",
    "keyFindings",
    "implications",
    "recommendedActions",
    "conclusion",
    "filename",
  ],
} as const;

const COMPARISON_REPORT_VARIABLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: REQUIRED_STRING_SCHEMA,
    items: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          name: REQUIRED_STRING_SCHEMA,
          description: OPTIONAL_STRING_SCHEMA,
        },
        required: ["name", "description"],
      },
    },
    criteria: REQUIRED_STRING_ARRAY_SCHEMA,
    summary: REQUIRED_STRING_SCHEMA,
    comparisons: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          item: REQUIRED_STRING_SCHEMA,
          values: REQUIRED_STRING_ARRAY_SCHEMA,
        },
        required: ["item", "values"],
      },
    },
    observations: REQUIRED_STRING_ARRAY_SCHEMA,
    conclusion: OPTIONAL_STRING_SCHEMA,
    filename: OPTIONAL_STRING_SCHEMA,
  },
  required: [
    "title",
    "items",
    "criteria",
    "summary",
    "comparisons",
    "observations",
    "conclusion",
    "filename",
  ],
} as const;

const GENERAL_PRESENTATION_VARIABLES_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    title: REQUIRED_STRING_SCHEMA,
    summary: REQUIRED_STRING_SCHEMA,
    sections: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          heading: REQUIRED_STRING_SCHEMA,
          body: REQUIRED_STRING_SCHEMA,
          findings: OPTIONAL_STRING_ARRAY_SCHEMA,
        },
        required: ["heading", "body", "findings"],
      },
    },
    recommendations: OPTIONAL_STRING_ARRAY_SCHEMA,
    comparison: NULLABLE_TABLE_SCHEMA,
    subtitle: OPTIONAL_STRING_SCHEMA,
    notes: OPTIONAL_STRING_SCHEMA,
    filename: OPTIONAL_STRING_SCHEMA,
  },
  required: [
    "title",
    "summary",
    "sections",
    "recommendations",
    "comparison",
    "subtitle",
    "notes",
    "filename",
  ],
} as const;

function templateDocumentSchema(
  templateId: string,
  formats: readonly string[],
  variables: unknown,
) {
  return {
    type: "object" as const,
    additionalProperties: false as const,
    properties: {
      templateId: { type: "string" as const, enum: [templateId] },
      formats: {
        type: "array" as const,
        minItems: 1,
        items: { type: "string" as const, enum: formats },
      },
      packageAsZip: { type: "boolean" as const },
      title: REQUIRED_STRING_SCHEMA,
      variables,
    },
    required: ["templateId", "formats", "packageAsZip", "title", "variables"],
  };
}

const DOCUMENT_INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    action: { type: "string", enum: ["none", "generate_document"] },
    document: {
      anyOf: [
        { type: "null" },
        templateDocumentSchema("general-report", ["docx", "pdf", "md", "txt"], GENERAL_REPORT_VARIABLES_SCHEMA),
        templateDocumentSchema("executive-summary", ["docx", "pdf", "md", "txt"], EXECUTIVE_SUMMARY_VARIABLES_SCHEMA),
        templateDocumentSchema("comparison-report", ["docx", "pdf", "md", "txt", "xlsx"], COMPARISON_REPORT_VARIABLES_SCHEMA),
        templateDocumentSchema("general-presentation", ["pptx"], GENERAL_PRESENTATION_VARIABLES_SCHEMA),
      ],
    },
  },
  required: ["action", "document"],
} as const;

type IntentModelRecord = {
  readonly action?: unknown;
  readonly document?: unknown;
  readonly templateId?: unknown;
  readonly formats?: unknown;
  readonly packageAsZip?: unknown;
  readonly title?: unknown;
  readonly variables?: unknown;
};

type IntentDocumentRecord = {
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

export class DocumentGenerationIntentValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super("Invalid document generation intent.");
    this.name = "DocumentGenerationIntentValidationError";
    this.issues = issues;
  }
}

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

function omitNullTemplateProperties(value: TemplateInputValue): TemplateInputValue {
  if (Array.isArray(value)) {
    return value.map(omitNullTemplateProperties);
  }
  if (!isRecord(value)) return value;

  const normalized: Record<string, TemplateInputValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (item !== null) normalized[key] = omitNullTemplateProperties(item);
  }
  return normalized;
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

function validateTemplateContracts(
  templateId: string,
  formats: readonly TemplateOutputFormat[],
  variables: TemplateVariablesRecord,
): readonly string[] {
  try {
    for (const format of formats) {
      renderTemplate({ templateId, format, variables });
    }
    return [];
  } catch (error) {
    return error instanceof TemplateValidationError
      ? error.issues
      : ["The selected document template could not be rendered."];
  }
}

function parseModelIntent(
  value: unknown,
  context: { readonly latestMessage: string; readonly currentDate: string },
): DocumentGenerationIntent | null {
  if (!isRecord(value)) return null;
  const row = value as IntentModelRecord;

  if (row.action !== "generate_document") {
    return null;
  }

  // The structured-output schema uses a coupled nested document branch. Keep
  // accepting the former flat shape while older test doubles are retired; all
  // values still pass the same template and format validation below.
  const document = (isRecord(row.document) ? row.document : row) as IntentDocumentRecord;

  if (typeof document.templateId !== "string") {
    throw new DocumentGenerationIntentValidationError(["The selected document template is invalid."]);
  }
  const templateId = document.templateId.trim();
  if (!templateId || !getTemplate(templateId)) {
    throw new DocumentGenerationIntentValidationError(["The selected document template is invalid."]);
  }

  const rawFormats = Array.isArray(document.formats) ? document.formats : [];
  const formats = rawFormats.filter(isTemplateOutputFormat);
  const uniqueFormats = Array.from(new Set(formats));
  if (uniqueFormats.length === 0 || uniqueFormats.length !== rawFormats.length || uniqueFormats.length !== formats.length) {
    throw new DocumentGenerationIntentValidationError(["The requested document formats are invalid."]);
  }

  const rawVariables = document.variables;
  if (!isRecord(rawVariables) || !isTemplateInputValue(rawVariables)) {
    throw new DocumentGenerationIntentValidationError(["The document template variables are invalid."]);
  }

  const variables = omitNullTemplateProperties({
    ...(rawVariables as TemplateVariablesRecord),
    ...(typeof document.title === "string" && document.title.trim() && rawVariables.title === undefined
      ? { title: document.title.trim() }
      : {}),
  }) as TemplateVariablesRecord;
  const normalizedVariables =
    templateId === "general-report"
      ? normalizeAutomaticDatePlacement(variables, context.latestMessage, context.currentDate)
      : variables;

  const contractIssues = validateTemplateContracts(templateId, uniqueFormats, normalizedVariables);
  if (contractIssues.length > 0) {
    throw new DocumentGenerationIntentValidationError(contractIssues);
  }
  return {
    templateId,
    formats: uniqueFormats,
    variables: normalizedVariables,
    packageAsZip: document.packageAsZip === true || uniqueFormats.length > 1,
  };
}

export function isDocumentGenerationCandidate(message: string): boolean {
  return DOCUMENT_REQUEST_CANDIDATE.test(message);
}

export function isExplicitDocumentGenerationRequest(message: string): boolean {
  return (
    EXPLICIT_DOCUMENT_GENERATION_VERB.test(message) &&
    SUPPORTED_DOCUMENT_OUTPUT_REFERENCE.test(message) &&
    !INFORMATIONAL_DOCUMENT_QUESTION.test(message)
  );
}

export async function resolveDocumentGenerationIntent(params: {
  readonly latestMessage: string;
  readonly history: readonly { readonly role: "user" | "assistant"; readonly content: string }[];
  readonly documentContext?: string;
}): Promise<DocumentGenerationIntent | null> {
  const explicitDocumentRequest = isExplicitDocumentGenerationRequest(params.latestMessage);
  if (!isDocumentGenerationCandidate(params.latestMessage) && !explicitDocumentRequest) return null;

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
    if (!output) {
      if (explicitDocumentRequest) {
        throw new DocumentGenerationIntentValidationError([
          "The document-generation planner returned no usable intent.",
        ]);
      }
      return null;
    }

    const parsed = parseModelIntent(JSON.parse(output), {
      latestMessage: params.latestMessage,
      currentDate,
    });
    if (!parsed && explicitDocumentRequest) {
      throw new DocumentGenerationIntentValidationError([
        "The document-generation planner did not produce a generation intent.",
      ]);
    }
    return parsed;
  } catch (error) {
    if (error instanceof DocumentGenerationIntentValidationError) throw error;
    console.error("Document intent resolution failed:", error);
    if (explicitDocumentRequest) {
      throw new DocumentGenerationIntentValidationError([
        "The document-generation planner failed to produce a usable intent.",
      ]);
    }
    return null;
  }
}
