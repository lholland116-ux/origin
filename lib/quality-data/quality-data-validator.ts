import { createHash } from "node:crypto";

import {
  qualityDataIngestionCommandSchema,
  type QualityDataIngestionCommand,
  type QualityDataValidationOutcome,
} from "./quality-data-contract";

export type QualityDataValidationFailure =
  | "INVALID_QUALITY_DATA_CONTRACT"
  | "SOURCE_FINGERPRINT_MISMATCH"
  | "STORAGE_REFERENCE_SCOPE_INVALID";

export class QualityDataContractError extends Error {
  constructor(readonly reason_code: QualityDataValidationFailure) {
    super("The quality-data request is invalid.");
    this.name = "QualityDataContractError";
  }
}

export function validateQualityDataIngestionCommand(
  input: unknown,
  organizationId: string,
): QualityDataIngestionCommand {
  const parsed = qualityDataIngestionCommandSchema.safeParse(input);
  if (!parsed.success) {
    throw new QualityDataContractError("INVALID_QUALITY_DATA_CONTRACT");
  }

  const command = parsed.data;
  const actualDigest = createHash("sha256")
    .update(command.source.source_bytes)
    .digest("hex");
  if (actualDigest !== command.source.source_sha256) {
    throw new QualityDataContractError("SOURCE_FINGERPRINT_MISMATCH");
  }

  const storageScope = /^quality-data\/([0-9a-f-]{36})\/[A-Za-z0-9._-]{1,128}\/[A-Za-z0-9._-]{1,128}\/original$/i
    .exec(command.source.storage_reference);
  if (storageScope?.[1]?.toLowerCase() !== organizationId.toLowerCase()) {
    throw new QualityDataContractError("STORAGE_REFERENCE_SCOPE_INVALID");
  }

  return command;
}

/**
 * These outcomes describe technical integrity checks only. They do not
 * assert that source facts are accurate or constitute human-verified evidence.
 */
export function deriveQualityDataIntegrityOutcomes(
  command: QualityDataIngestionCommand,
): readonly QualityDataValidationOutcome[] {
  const fieldCount = command.records.reduce((count, record) => count + record.fields.length, 0);
  return [
    {
      target: { scope: "dataset" },
      rule_code: "SOURCE_SHA256_MATCH",
      rule_version: "1.0.0",
      outcome: "pass",
      details: { algorithm: "sha256" },
    },
    {
      target: { scope: "dataset" },
      rule_code: "CONTRACT_SCHEMA_VALID",
      rule_version: "1.0.0",
      outcome: "pass",
      details: { contract_version: "quality-data-foundation-1.0.0" },
    },
    {
      target: { scope: "dataset" },
      rule_code: "CELL_PROVENANCE_COMPLETE",
      rule_version: "1.0.0",
      outcome: "pass",
      details: { record_count: String(command.records.length), field_count: String(fieldCount) },
    },
  ];
}
