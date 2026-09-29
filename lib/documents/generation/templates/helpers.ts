import { sanitizeFilename } from "../filenames";
import type {
  TemplateInputValue,
  TemplateOutputFormat,
  TemplateVariablesRecord,
} from "./types";
import { TemplateValidationError } from "./types";

export function isTemplateRecord(
  value: TemplateInputValue | undefined,
): value is TemplateVariablesRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function requiredString(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    issues.push(`${key} is required and must be a non-empty string.`);
    return "";
  }
  return value.trim();
}

export function optionalString(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): string | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    issues.push(`${key} must be a string when provided.`);
    return undefined;
  }
  return value.trim() || undefined;
}

export function requiredStringArray(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): readonly string[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    issues.push(`${key} is required and must be a non-empty string array.`);
    return [];
  }
  return value.map((item) => item.trim());
}

export function optionalStringArray(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): readonly string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (
    !Array.isArray(value) ||
    value.some((item) => typeof item !== "string" || !item.trim())
  ) {
    issues.push(`${key} must be a string array when provided.`);
    return undefined;
  }
  return value.map((item) => item.trim());
}

export function requiredRecordArray(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): readonly TemplateVariablesRecord[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => !isTemplateRecord(item))) {
    issues.push(`${key} is required and must be a non-empty object array.`);
    return [];
  }
  return value;
}

export function optionalRecord(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): TemplateVariablesRecord | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!isTemplateRecord(value)) {
    issues.push(`${key} must be an object when provided.`);
    return undefined;
  }
  return value;
}

export function stringMatrix(
  record: TemplateVariablesRecord,
  key: string,
  issues: string[],
): readonly (readonly string[])[] {
  const value = record[key];
  if (
    !Array.isArray(value) ||
    value.some(
      (row) =>
        !Array.isArray(row) ||
        row.some((cell) => typeof cell !== "string"),
    )
  ) {
    issues.push(`${key} must be a string matrix.`);
    return [];
  }
  return (value as readonly (readonly string[])[]).map((row) => row.map((cell) => cell.trim()));
}

export function rejectUnexpectedKeys(
  record: TemplateVariablesRecord,
  allowedKeys: readonly string[],
  issues: string[],
): void {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) issues.push(`Unexpected template variable: ${key}.`);
  }
}

export function assertTemplateIssues(issues: readonly string[]): void {
  if (issues.length > 0) throw new TemplateValidationError(issues);
}

export function supportedFormat(
  format: string,
  supportedFormats: readonly TemplateOutputFormat[],
  issues: string[],
): TemplateOutputFormat {
  if (!supportedFormats.includes(format as TemplateOutputFormat)) {
    issues.push(`Format ${format} is not supported by this template.`);
  }
  return format as TemplateOutputFormat;
}

export function templateFilename(
  record: TemplateVariablesRecord,
  title: string,
  format: TemplateOutputFormat,
  issues: string[],
): string {
  const requested = optionalString(record, "filename", issues);
  return sanitizeFilename(requested ?? title, format);
}

export function textTable(
  columns: readonly string[],
  rows: readonly (readonly string[])[],
): string[] {
  return [
    "| " + columns.join(" | ") + " |",
    "| " + columns.map(() => "---").join(" | ") + " |",
    ...rows.map((row) => "| " + row.join(" | ") + " |"),
  ];
}
