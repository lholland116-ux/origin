import { createHash } from "node:crypto";

import type {
  CapaKnowledgeNormalizedText,
} from "./capa-knowledge-processing";

/**
 * Deterministic segmentation of normalized governed CAPA knowledge.
 *
 * Passages are exact, contiguous slices of the normalized source. The
 * segmenter never summarizes, rewrites, removes or overlaps source content.
 * Stable character offsets make every passage independently locatable and
 * allow exact reconstruction of the normalized derivative.
 *
 * Traceability: ING-002, ING-004, KB-RET-001; Document #10.
 */

export const CAPA_KNOWLEDGE_SEGMENTATION_VERSION =
  "capa-knowledge-segmentation-1.0.0";

export const DEFAULT_CAPA_PASSAGE_MAXIMUM_CHARACTERS =
  1_200;

export const DEFAULT_CAPA_PASSAGE_MINIMUM_CHARACTERS =
  600;

export type CapaKnowledgeSegmentationReasonCode =
  | "INVALID_NORMALIZED_TEXT"
  | "INVALID_SOURCE_VERSION_ID"
  | "INVALID_SEGMENTATION_CONFIGURATION"
  | "SEGMENTATION_INTEGRITY_FAILURE";

export class CapaKnowledgeSegmentationError
  extends Error {
  readonly reason_code:
    CapaKnowledgeSegmentationReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeSegmentationReasonCode,
  ) {
    super(reasonCode);
    this.name = "CapaKnowledgeSegmentationError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeSegmentationConfiguration {
  readonly segmentation_version?: string;
  readonly maximum_characters?: number;
  readonly minimum_characters?: number;
}

export interface CapaKnowledgePassage {
  readonly source_version_id: string;
  readonly segmentation_version: string;
  readonly sequence_number: number;
  readonly locator: string;
  readonly start_character_offset: number;
  readonly end_character_offset: number;
  readonly character_length: number;
  readonly text: string;
  readonly fingerprint: {
    readonly algorithm: "sha256";
    readonly digest_hex: string;
  };
}

export interface CapaKnowledgeSegmentationResult {
  readonly source_version_id: string;
  readonly segmentation_version: string;
  readonly normalized_text_fingerprint: string;
  readonly passages:
    readonly CapaKnowledgePassage[];
  readonly passage_count: number;
  readonly character_count: number;
}

const VERSION_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

const SOURCE_VERSION_ID_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;

function controlledInteger(
  value: number,
): boolean {
  return Number.isSafeInteger(value) &&
    value > 0;
}

function validateConfiguration(
  input:
    CapaKnowledgeSegmentationConfiguration,
): {
  readonly segmentation_version: string;
  readonly maximum_characters: number;
  readonly minimum_characters: number;
} {
  const segmentationVersion =
    input.segmentation_version ??
    CAPA_KNOWLEDGE_SEGMENTATION_VERSION;
  const maximumCharacters =
    input.maximum_characters ??
    DEFAULT_CAPA_PASSAGE_MAXIMUM_CHARACTERS;
  const minimumCharacters =
    input.minimum_characters ??
    DEFAULT_CAPA_PASSAGE_MINIMUM_CHARACTERS;

  if (
    !VERSION_PATTERN.test(segmentationVersion) ||
    !controlledInteger(maximumCharacters) ||
    !controlledInteger(minimumCharacters) ||
    minimumCharacters > maximumCharacters
  ) {
    throw new CapaKnowledgeSegmentationError(
      "INVALID_SEGMENTATION_CONFIGURATION",
    );
  }

  return {
    segmentation_version: segmentationVersion,
    maximum_characters: maximumCharacters,
    minimum_characters: minimumCharacters,
  };
}

function validateNormalizedText(
  value: unknown,
): asserts value is CapaKnowledgeNormalizedText {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    throw new CapaKnowledgeSegmentationError(
      "INVALID_NORMALIZED_TEXT",
    );
  }

  const candidate = value as Partial<
    CapaKnowledgeNormalizedText
  >;

  if (
    typeof candidate.text !== "string" ||
    candidate.text.length === 0 ||
    candidate.character_length !==
      candidate.text.length ||
    typeof candidate.fingerprint !==
      "object" ||
    candidate.fingerprint === null ||
    candidate.fingerprint.algorithm !==
      "sha256" ||
    !/^[a-f0-9]{64}$/.test(
      candidate.fingerprint.digest_hex ?? "",
    )
  ) {
    throw new CapaKnowledgeSegmentationError(
      "INVALID_NORMALIZED_TEXT",
    );
  }
}

function preferredEnd(
  text: string,
  start: number,
  maximumEnd: number,
  minimumCharacters: number,
): number {
  if (maximumEnd === text.length) {
    return maximumEnd;
  }

  const minimumEnd = Math.min(
    start + minimumCharacters,
    maximumEnd,
  );

  for (
    let index = maximumEnd;
    index > minimumEnd;
    index -= 1
  ) {
    const previous = text[index - 1];

    if (previous === "\n") {
      return index;
    }
  }

  for (
    let index = maximumEnd;
    index > minimumEnd;
    index -= 1
  ) {
    const previous = text[index - 1];

    if (
      previous === " " ||
      previous === "\t"
    ) {
      return index;
    }
  }

  return maximumEnd;
}

function locator(
  start: number,
  end: number,
): string {
  return `char:${String(start).padStart(10, "0")}-${String(end).padStart(10, "0")}`;
}

function passageFingerprint(
  sourceVersionId: string,
  segmentationVersion: string,
  start: number,
  end: number,
  text: string,
): string {
  return createHash("sha256")
    .update(sourceVersionId)
    .update("\u0000")
    .update(segmentationVersion)
    .update("\u0000")
    .update(String(start))
    .update(":")
    .update(String(end))
    .update("\u0000")
    .update(text)
    .digest("hex");
}

export function segmentCapaKnowledgeText(
  sourceVersionId: unknown,
  normalizedText: unknown,
  configuration:
    CapaKnowledgeSegmentationConfiguration = {},
): CapaKnowledgeSegmentationResult {
  if (
    typeof sourceVersionId !== "string" ||
    !SOURCE_VERSION_ID_PATTERN.test(
      sourceVersionId,
    )
  ) {
    throw new CapaKnowledgeSegmentationError(
      "INVALID_SOURCE_VERSION_ID",
    );
  }

  validateNormalizedText(normalizedText);
  const controlled =
    validateConfiguration(configuration);
  const passages: CapaKnowledgePassage[] = [];

  let start = 0;

  while (start < normalizedText.text.length) {
    const maximumEnd = Math.min(
      start + controlled.maximum_characters,
      normalizedText.text.length,
    );
    const end = preferredEnd(
      normalizedText.text,
      start,
      maximumEnd,
      controlled.minimum_characters,
    );
    const text = normalizedText.text.slice(
      start,
      end,
    );

    passages.push(Object.freeze({
      source_version_id: sourceVersionId,
      segmentation_version:
        controlled.segmentation_version,
      sequence_number: passages.length + 1,
      locator: locator(start, end),
      start_character_offset: start,
      end_character_offset: end,
      character_length: text.length,
      text,
      fingerprint: Object.freeze({
        algorithm: "sha256" as const,
        digest_hex: passageFingerprint(
          sourceVersionId,
          controlled.segmentation_version,
          start,
          end,
          text,
        ),
      }),
    }));

    start = end;
  }

  if (
    passages.map((passage) => passage.text)
      .join("") !== normalizedText.text ||
    passages.at(-1)
      ?.end_character_offset !==
      normalizedText.text.length
  ) {
    throw new CapaKnowledgeSegmentationError(
      "SEGMENTATION_INTEGRITY_FAILURE",
    );
  }

  return Object.freeze({
    source_version_id: sourceVersionId,
    segmentation_version:
      controlled.segmentation_version,
    normalized_text_fingerprint:
      normalizedText.fingerprint.digest_hex,
    passages: Object.freeze(passages),
    passage_count: passages.length,
    character_count:
      normalizedText.text.length,
  });
}
