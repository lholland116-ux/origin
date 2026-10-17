import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { QUALITY_DATA_MAX_SOURCE_BYTES } from "../../lib/quality-data/quality-data-contract";
import { deriveQualityDataIntegrityOutcomes, QualityDataContractError, validateQualityDataIngestionCommand } from "../../lib/quality-data/quality-data-validator";

const ORG = "5f7f0a11-4a38-4bc0-91a4-cd54e8a11001";
const BYTES = new TextEncoder().encode("synthetic inspection source");
const SHA256 = createHash("sha256").update(BYTES).digest("hex");

function command(overrides: Record<string, unknown> = {}) {
  return {
    idempotency_key: "quality-ingestion-1",
    source: {
      source_key: "supplier-a-inspections",
      source_name: "Supplier A inspection data",
      source_type: "csv",
      original_source_version: "revision-1",
      source_sha256: SHA256,
      source_bytes: BYTES,
      media_type: "text/csv",
      storage_reference: `quality-data/${ORG}/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb/original`,
      parser_version: "csv-parser-1.0.0",
      schema_version: "inspection-schema-1.0.0",
    },
    dataset: {
      dataset_key: "supplier-a-quarterly",
      dataset_name: "Supplier A quarterly inspections",
      schema_version: "inspection-schema-1.0.0",
    },
    records: [{
      source_worksheet: "Inspections",
      source_row_number: 2,
      fields: [
        { field_key: "inspection_id", value_type: "text", original_value: "I-001", normalized_value: "I-001", source_cell_reference: "A2" },
        { field_key: "defect_count", value_type: "number", original_value: 2, normalized_value: 2, source_cell_reference: "B2" },
        { field_key: "inspection_date", value_type: "date", original_value: "10/01/2026", normalized_value: "2026-10-01", source_cell_reference: "C2" },
        { field_key: "comment", value_type: "blank", original_value: null, source_cell_reference: "D2" },
      ],
    }],
    ...overrides,
  };
}

describe("quality-data contract validation", () => {
  it("accepts bounded typed values, exact provenance and deterministic outcomes", () => {
    const valid = validateQualityDataIngestionCommand(command(), ORG);
    expect(valid.records[0]?.fields.map((field) => field.value_type)).toEqual([
      "text", "number", "date", "blank",
    ]);
    expect(deriveQualityDataIntegrityOutcomes(valid).map((outcome) => outcome.rule_code)).toEqual([
      "SOURCE_SHA256_MATCH", "CONTRACT_SCHEMA_VALID", "CELL_PROVENANCE_COMPLETE",
    ]);
    expect(valid.source.source_sha256).toBe(SHA256);
  });

  it("rejects a source fingerprint that does not match original bytes", () => {
    expect(() => validateQualityDataIngestionCommand(command({
      source: { ...command().source, source_sha256: "a".repeat(64) },
    }), ORG)).toThrowError(QualityDataContractError);
  });

  it("rejects storage references outside the server-resolved organization", () => {
    const otherOrg = "6a7f0a11-4a38-4bc0-91a4-cd54e8a11002";
    expect(() => validateQualityDataIngestionCommand(command({
      source: { ...command().source, storage_reference: command().source.storage_reference.replace(ORG, otherOrg) },
    }), ORG)).toThrowError(QualityDataContractError);
  });

  it("rejects personal-document adoption and client ownership claims as unknown fields", () => {
    expect(() => validateQualityDataIngestionCommand(command({
      source: { ...command().source, personal_document_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      organization_id: ORG,
      uploader_user_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }), ORG)).toThrowError(QualityDataContractError);
  });

  it("rejects unsupported or mismatched typed values and duplicate provenance", () => {
    const invalid = command({
      records: [{
        source_worksheet: "Inspections",
        source_row_number: 2,
        fields: [
          { field_key: "defect_count", value_type: "number", original_value: "two", normalized_value: 2, source_cell_reference: "B2" },
          { field_key: "defect_count", value_type: "number", original_value: 2, normalized_value: 2, source_cell_reference: "C2" },
        ],
      }],
    });
    expect(() => validateQualityDataIngestionCommand(invalid, ORG)).toThrowError(QualityDataContractError);
  });

  it("rejects oversized original source bytes", () => {
    const tooLarge = new Uint8Array(QUALITY_DATA_MAX_SOURCE_BYTES + 1);
    expect(() => validateQualityDataIngestionCommand(command({
      source: { ...command().source, source_bytes: tooLarge },
    }), ORG)).toThrowError(QualityDataContractError);
  });

  it("rejects caller-supplied validation outcomes so only deterministic server checks are recorded", () => {
    expect(() => validateQualityDataIngestionCommand(command({
      validation_outcomes: [{ target: { scope: "dataset" }, rule_code: "FAKE", rule_version: "1.0.0", outcome: "pass" }],
    }), ORG)).toThrowError(QualityDataContractError);
  });
});
