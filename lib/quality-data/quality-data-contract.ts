import { z } from "zod";

export const QUALITY_DATA_CONTRACT_VERSION = "quality-data-foundation-1.0.0";
export const QUALITY_DATA_MAX_SOURCE_BYTES = 10 * 1024 * 1024;
export const QUALITY_DATA_MAX_RECORDS = 10_000;
export const QUALITY_DATA_MAX_FIELDS = 50_000;
export const QUALITY_DATA_MAX_FIELD_BYTES = 16_384;
export const QUALITY_DATA_MAX_BUNDLE_BYTES = 5 * 1024 * 1024;

const boundedCode = z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const boundedVersion = z.string().trim().min(1).max(100);
const boundedName = z.string().trim().min(1).max(200);

export const QUALITY_DATA_SOURCE_TYPES = [
  "xlsx", "csv", "docx", "pdf", "txt", "other",
] as const;
export type QualityDataSourceType = (typeof QUALITY_DATA_SOURCE_TYPES)[number];

const baseField = z.object({
  field_key: boundedCode,
  normalized_unit: z.string().trim().max(32).optional(),
  source_cell_reference: z.string().trim().min(1).max(32)
    .regex(/^[A-Z]{1,3}[1-9][0-9]{0,6}$/),
}).strict();

export const qualityDataFieldSchema = z.discriminatedUnion("value_type", [
  baseField.extend({
    value_type: z.literal("text"),
    original_value: z.string().max(QUALITY_DATA_MAX_FIELD_BYTES),
    normalized_value: z.string().max(QUALITY_DATA_MAX_FIELD_BYTES).nullable(),
  }),
  baseField.extend({
    value_type: z.literal("number"),
    original_value: z.number().finite(),
    normalized_value: z.number().finite().nullable(),
  }),
  baseField.extend({
    value_type: z.literal("date"),
    original_value: z.string().min(1).max(128),
    normalized_value: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  }),
  baseField.extend({
    value_type: z.literal("boolean"),
    original_value: z.boolean(),
    normalized_value: z.boolean().nullable(),
  }),
  baseField.extend({
    value_type: z.literal("blank"),
    original_value: z.null(),
    normalized_value: z.null().optional(),
  }),
]);

export type QualityDataField = z.infer<typeof qualityDataFieldSchema>;

export const qualityDataRecordSchema = z.object({
  source_worksheet: z.string().trim().min(1).max(128),
  source_row_number: z.number().int().positive().max(1_048_576),
  fields: z.array(qualityDataFieldSchema).min(1).max(100),
}).strict();

export const qualityDataValidationOutcomeSchema = z.object({
  target:
    z.discriminatedUnion("scope", [
      z.object({ scope: z.literal("dataset") }).strict(),
      z.object({ scope: z.literal("record"), record_ordinal: z.number().int().positive() }).strict(),
      z.object({ scope: z.literal("field"), record_ordinal: z.number().int().positive(), field_key: boundedCode }).strict(),
    ]),
  rule_code: boundedCode,
  rule_version: boundedVersion,
  outcome: z.enum(["pass", "fail", "review_required"]),
  details: z.record(z.string(), z.string().max(256)).default({}),
}).strict();

export const qualityDataIngestionCommandSchema = z.object({
  idempotency_key: z.string().trim().min(1).max(200),
  source: z.object({
    source_key: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    source_name: boundedName,
    source_type: z.enum(QUALITY_DATA_SOURCE_TYPES),
    original_source_version: z.string().trim().min(1).max(128),
    source_sha256: z.string().regex(/^[0-9a-f]{64}$/),
    source_bytes: z.instanceof(Uint8Array).refine(
      (value) => value.byteLength > 0 && value.byteLength <= QUALITY_DATA_MAX_SOURCE_BYTES,
      "QUALITY_DATA_SOURCE_SIZE_INVALID",
    ),
    media_type: z.string().trim().min(1).max(256),
    storage_reference: z.string().trim().min(1).max(1024),
    parser_version: boundedVersion,
    schema_version: boundedVersion,
  }).strict(),
  dataset: z.object({
    dataset_key: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    dataset_name: boundedName,
    schema_version: boundedVersion,
  }).strict(),
  records: z.array(qualityDataRecordSchema).min(1).max(QUALITY_DATA_MAX_RECORDS),
}).strict().superRefine((command, context) => {
  const totalFields = command.records.reduce((count, record) => count + record.fields.length, 0);
  if (totalFields > QUALITY_DATA_MAX_FIELDS) {
    context.addIssue({ code: "custom", path: ["records"], message: "QUALITY_DATA_FIELD_LIMIT_EXCEEDED" });
  }

  command.records.forEach((record, recordIndex) => {
    const keys = new Set<string>();
    record.fields.forEach((field, fieldIndex) => {
      if (keys.has(field.field_key)) {
        context.addIssue({ code: "custom", path: ["records", recordIndex, "fields", fieldIndex, "field_key"], message: "QUALITY_DATA_DUPLICATE_FIELD_KEY" });
      }
      keys.add(field.field_key);
    });
  });

  const recordPositions = new Set<string>();
  command.records.forEach((record, index) => {
    const key = `${record.source_worksheet}\u0000${record.source_row_number}`;
    if (recordPositions.has(key)) {
      context.addIssue({ code: "custom", path: ["records", index], message: "QUALITY_DATA_DUPLICATE_SOURCE_ROW" });
    }
    recordPositions.add(key);
  });

  const serializedBytes = new TextEncoder().encode(JSON.stringify({
    ...command,
    source: { ...command.source, source_bytes: undefined },
  })).byteLength;
  if (serializedBytes > QUALITY_DATA_MAX_BUNDLE_BYTES) {
    context.addIssue({ code: "custom", path: [], message: "QUALITY_DATA_BUNDLE_LIMIT_EXCEEDED" });
  }
});

export type QualityDataIngestionCommand = z.infer<typeof qualityDataIngestionCommandSchema>;
export type QualityDataValidationOutcome = z.infer<typeof qualityDataValidationOutcomeSchema>;

export interface QualityDataScope {
  readonly organization_id: string;
}

export interface QualityDataSourceIdentity extends QualityDataScope {
  readonly source_id: string;
  readonly source_key: string;
  readonly source_name: string;
  readonly source_type: QualityDataSourceType;
  readonly uploaded_by_user_id: string;
  readonly created_at: string;
}

export interface QualityDataSourceVersion extends QualityDataScope {
  readonly source_version_id: string;
  readonly source_id: string;
  readonly version_number: number;
  readonly original_source_version: string;
  readonly fingerprint_algorithm: "sha256";
  readonly source_sha256: string;
  readonly byte_length: number;
  readonly media_type: string;
  readonly storage_reference: string;
  readonly parser_version: string;
  readonly schema_version: string;
  readonly uploaded_by_user_id: string;
  readonly created_at: string;
}

export interface QualityDataDatasetIdentity extends QualityDataScope {
  readonly dataset_id: string;
  readonly dataset_key: string;
  readonly dataset_name: string;
  readonly created_by_user_id: string;
  readonly created_at: string;
}

export interface QualityDataDatasetVersion extends QualityDataScope {
  readonly dataset_version_id: string;
  readonly dataset_id: string;
  readonly version_number: number;
  readonly schema_version: string;
  readonly review_state: "review_required";
  readonly created_by_user_id: string;
  readonly created_at: string;
}

export interface QualityDataIngestionReceipt {
  readonly status: "accepted" | "already_registered";
  readonly ingestion_job_id: string;
  readonly source_id: string;
  readonly source_version_id: string;
  readonly dataset_id: string;
  readonly dataset_version_id: string;
  readonly record_count: number;
  readonly field_count: number;
  readonly review_state: "review_required";
}
