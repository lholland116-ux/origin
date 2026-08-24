import { createHash } from "node:crypto";

/**
 * Controlled, provider-neutral preprocessing for governed CAPA knowledge.
 *
 * Original artifact bytes and normalized text are fingerprinted separately.
 * Normalization is deliberately conservative: it standardizes transport-level
 * text representation without rewriting controlled meaning.
 *
 * Traceability: ING-001, ING-002, ING-004; Document #10.
 */

export const CAPA_KNOWLEDGE_PROCESSING_VERSION =
  "capa-knowledge-processing-1.0.0";

export const CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHM =
  "sha256" as const;

export const DEFAULT_MAXIMUM_ORIGINAL_BYTES =
  25 * 1024 * 1024;

export const DEFAULT_MAXIMUM_NORMALIZED_CHARACTERS =
  2_000_000;

export type CapaKnowledgeProcessingReasonCode =
  | "INVALID_ORIGINAL_ARTIFACT"
  | "ORIGINAL_ARTIFACT_EMPTY"
  | "ORIGINAL_ARTIFACT_TOO_LARGE"
  | "INVALID_EXTRACTED_TEXT"
  | "EXTRACTED_TEXT_EMPTY"
  | "EXTRACTED_TEXT_TOO_LARGE"
  | "INVALID_PROCESSING_LIMIT";

export class CapaKnowledgeProcessingError extends Error {
  readonly reason_code:
    CapaKnowledgeProcessingReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeProcessingReasonCode,
  ) {
    super(reasonCode);
    this.name = "CapaKnowledgeProcessingError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeFingerprint {
  readonly algorithm:
    typeof CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHM;
  readonly digest_hex: string;
}

export interface CapaKnowledgeOriginalFingerprint
  extends CapaKnowledgeFingerprint {
  readonly subject: "original_artifact";
  readonly byte_length: number;
}

export interface CapaKnowledgeNormalizedText {
  readonly processing_version:
    typeof CAPA_KNOWLEDGE_PROCESSING_VERSION;
  readonly text: string;
  readonly character_length: number;
  readonly utf8_byte_length: number;
  readonly fingerprint:
    CapaKnowledgeFingerprint & {
      readonly subject: "normalized_text";
    };
}

export interface CapaKnowledgeProcessingLimits {
  readonly maximum_original_bytes?: number;
  readonly maximum_normalized_characters?: number;
}

function controlledLimit(
  supplied: number | undefined,
  fallback: number,
): number {
  const value = supplied ?? fallback;

  if (
    !Number.isSafeInteger(value) ||
    value <= 0
  ) {
    throw new CapaKnowledgeProcessingError(
      "INVALID_PROCESSING_LIMIT",
    );
  }

  return value;
}

function sha256(
  value: Uint8Array | string,
): CapaKnowledgeFingerprint {
  return Object.freeze({
    algorithm:
      CAPA_KNOWLEDGE_FINGERPRINT_ALGORITHM,
    digest_hex:
      createHash("sha256")
        .update(value)
        .digest("hex"),
  });
}

/**
 * Fingerprints the exact artifact bytes before extraction or normalization.
 * Callers must not substitute decoded text for the original byte sequence.
 */
export function fingerprintCapaKnowledgeArtifact(
  artifact: unknown,
  limits: CapaKnowledgeProcessingLimits = {},
): CapaKnowledgeOriginalFingerprint {
  if (!(artifact instanceof Uint8Array)) {
    throw new CapaKnowledgeProcessingError(
      "INVALID_ORIGINAL_ARTIFACT",
    );
  }

  if (artifact.byteLength === 0) {
    throw new CapaKnowledgeProcessingError(
      "ORIGINAL_ARTIFACT_EMPTY",
    );
  }

  const maximumBytes = controlledLimit(
    limits.maximum_original_bytes,
    DEFAULT_MAXIMUM_ORIGINAL_BYTES,
  );

  if (artifact.byteLength > maximumBytes) {
    throw new CapaKnowledgeProcessingError(
      "ORIGINAL_ARTIFACT_TOO_LARGE",
    );
  }

  return Object.freeze({
    ...sha256(artifact),
    subject: "original_artifact" as const,
    byte_length: artifact.byteLength,
  });
}

/**
 * Applies only representation-safe normalization:
 * - removes one leading Unicode BOM;
 * - converts CRLF and CR line endings to LF;
 * - normalizes Unicode to NFC;
 * - removes trailing spaces and tabs from each line;
 * - removes leading/trailing blank lines.
 *
 * It intentionally does not alter wording, case, internal spacing, units,
 * numbering, punctuation, negation, or nonblank line order.
 */
export function normalizeCapaKnowledgeText(
  extractedText: unknown,
  limits: CapaKnowledgeProcessingLimits = {},
): CapaKnowledgeNormalizedText {
  if (typeof extractedText !== "string") {
    throw new CapaKnowledgeProcessingError(
      "INVALID_EXTRACTED_TEXT",
    );
  }

  const maximumCharacters = controlledLimit(
    limits.maximum_normalized_characters,
    DEFAULT_MAXIMUM_NORMALIZED_CHARACTERS,
  );

  const normalized = extractedText
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .normalize("NFC")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .replace(/^(?:[\t ]*\n)+/, "")
    .replace(/(?:\n[\t ]*)+$/, "");

  if (normalized.trim().length === 0) {
    throw new CapaKnowledgeProcessingError(
      "EXTRACTED_TEXT_EMPTY",
    );
  }

  if (normalized.length > maximumCharacters) {
    throw new CapaKnowledgeProcessingError(
      "EXTRACTED_TEXT_TOO_LARGE",
    );
  }

  const textFingerprint = sha256(normalized);

  return Object.freeze({
    processing_version:
      CAPA_KNOWLEDGE_PROCESSING_VERSION,
    text: normalized,
    character_length: normalized.length,
    utf8_byte_length:
      Buffer.byteLength(normalized, "utf8"),
    fingerprint: Object.freeze({
      ...textFingerprint,
      subject: "normalized_text" as const,
    }),
  });
}
