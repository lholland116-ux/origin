import { z } from "zod";
import {
  isValidWorkbookIsoDate,
  MAX_TABLE_COLUMNS,
  MAX_TABLE_ROWS,
  MAX_WORKBOOK_CELL_TEXT_LENGTH,
  validateWorksheetName,
} from "@/lib/documents/generation/validation";
import type { WorkbookCell, WorkbookSheet } from "@/lib/documents/generation/contracts";

export const MAX_WORKBOOK_EXTRACTION_REPLY_CHARS = 200_000;

const invalidCellControls = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;
const dateCellSchema = z.object({
  type: z.literal("date"),
  value: z.string().refine(isValidWorkbookIsoDate, "Date cells must use a valid YYYY-MM-DD date."),
}).strict();

const workbookCellSchema = z.union([
  z.string().max(MAX_WORKBOOK_CELL_TEXT_LENGTH).refine((value) => !invalidCellControls.test(value), "Cell contains unsupported control characters."),
  z.number().finite(),
  z.null(),
  dateCellSchema,
]);

const workbookExtractionSchema = z.object({
  sheetName: z.string().min(1).max(31),
  columns: z.array(z.string().min(1).max(MAX_WORKBOOK_CELL_TEXT_LENGTH))
    .min(1).max(MAX_TABLE_COLUMNS),
  rows: z.array(z.array(workbookCellSchema).min(1).max(MAX_TABLE_COLUMNS))
    .min(1).max(MAX_TABLE_ROWS),
}).strict().superRefine((value, context) => {
  const nameError = validateWorksheetName(value.sheetName);
  if (nameError) context.addIssue({ code: "custom", message: nameError, path: ["sheetName"] });
  if (value.columns.some((column) => !column.trim() || invalidCellControls.test(column))) {
    context.addIssue({ code: "custom", message: "Column headers must be nonempty text.", path: ["columns"] });
  }
  value.rows.forEach((row, index) => {
    if (row.length !== value.columns.length) {
      context.addIssue({ code: "custom", message: "Workbook rows must match the column count.", path: ["rows", index] });
    }
  });
});

export type WorkbookExtraction = z.infer<typeof workbookExtractionSchema>;

export class WorkbookExtractionValidationError extends Error {
  constructor() {
    super("Structured workbook data is invalid.");
    this.name = "WorkbookExtractionValidationError";
  }
}

export function validateWorkbookExtraction(value: unknown): WorkbookExtraction {
  const parsed = workbookExtractionSchema.safeParse(value);
  if (!parsed.success) throw new WorkbookExtractionValidationError();
  return parsed.data;
}

export function parseWorkbookExtractionReply(reply: string): WorkbookExtraction {
  if (reply.length > MAX_WORKBOOK_EXTRACTION_REPLY_CHARS) throw new WorkbookExtractionValidationError();
  let value: unknown;
  try {
    value = JSON.parse(reply);
  } catch {
    throw new WorkbookExtractionValidationError();
  }
  return validateWorkbookExtraction(value);
}

export function workbookExtractionToSheet(value: WorkbookExtraction): WorkbookSheet {
  return { name: value.sheetName, columns: value.columns, rows: value.rows as readonly (readonly WorkbookCell[])[] };
}

export const WORKBOOK_EXTRACTION_RESPONSE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    sheetName: { type: "string", minLength: 1, maxLength: 31 },
    columns: {
      type: "array",
      minItems: 1,
      maxItems: MAX_TABLE_COLUMNS,
      items: { type: "string", minLength: 1, maxLength: MAX_WORKBOOK_CELL_TEXT_LENGTH },
    },
    rows: {
      type: "array",
      minItems: 1,
      maxItems: MAX_TABLE_ROWS,
      items: {
        type: "array",
        minItems: 1,
        maxItems: MAX_TABLE_COLUMNS,
        items: {
          anyOf: [
            { type: ["string", "null"], maxLength: MAX_WORKBOOK_CELL_TEXT_LENGTH },
            { type: "number" },
            {
              type: "object",
              additionalProperties: false,
              properties: {
                type: { type: "string", enum: ["date"] },
                value: { type: "string", pattern: "^[0-9]{4}-[0-9]{2}-[0-9]{2}$" },
              },
              required: ["type", "value"],
            },
          ],
        },
      },
    },
  },
  required: ["sheetName", "columns", "rows"],
} as const;
