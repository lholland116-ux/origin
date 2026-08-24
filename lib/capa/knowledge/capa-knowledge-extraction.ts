/**
 * Controlled extraction boundary for governed CAPA knowledge artifacts.
 *
 * Third-party parsers remain behind this provider-neutral interface. The
 * boundary requires an independently detected media type, exact extractor
 * identity/version and structured extraction units with stable locators.
 *
 * Traceability: ING-003, ING-004, ING-005; Document #10.
 */

export const CAPA_KNOWLEDGE_EXTRACTION_VERSION =
  "capa-knowledge-extraction-1.0.0";

export const CAPA_KNOWLEDGE_MEDIA_TYPES = [
  "text/plain",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
] as const;

export type CapaKnowledgeMediaType =
  typeof CAPA_KNOWLEDGE_MEDIA_TYPES[number];

export type CapaKnowledgeExtractionReasonCode =
  | "INVALID_EXTRACTION_REQUEST"
  | "UNSUPPORTED_MEDIA_TYPE"
  | "DECLARED_MEDIA_TYPE_MISMATCH"
  | "EXTRACTOR_NOT_APPROVED"
  | "EXTRACTOR_IDENTITY_MISMATCH"
  | "EXTRACTION_FAILED"
  | "EXTRACTED_CONTENT_EMPTY"
  | "INVALID_EXTRACTION_RESULT";

export class CapaKnowledgeExtractionError
  extends Error {
  readonly reason_code:
    CapaKnowledgeExtractionReasonCode;

  constructor(
    reasonCode:
      CapaKnowledgeExtractionReasonCode,
  ) {
    super(reasonCode);
    this.name = "CapaKnowledgeExtractionError";
    this.reason_code = reasonCode;
  }
}

export interface CapaKnowledgeExtractionRequest {
  readonly artifact_bytes: Uint8Array;
  readonly declared_media_type: string;
  readonly detected_media_type: string;
  readonly extractor_id: string;
  readonly extractor_version: string;
}

export interface CapaKnowledgeExtractionUnit {
  readonly sequence_number: number;
  readonly locator: string;
  readonly text: string;
}

export interface CapaKnowledgeAdapterResult {
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly units:
    readonly CapaKnowledgeExtractionUnit[];
  readonly warnings?: readonly string[];
}

export interface CapaKnowledgeExtractor {
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly media_type:
    CapaKnowledgeMediaType;

  extract(
    artifactBytes: Uint8Array,
  ): Promise<CapaKnowledgeAdapterResult>;
}

export interface CapaKnowledgeExtractionResult {
  readonly extraction_version:
    typeof CAPA_KNOWLEDGE_EXTRACTION_VERSION;
  readonly media_type:
    CapaKnowledgeMediaType;
  readonly extractor_id: string;
  readonly extractor_version: string;
  readonly units:
    readonly CapaKnowledgeExtractionUnit[];
  readonly combined_text: string;
  readonly warnings: readonly string[];
}

const IDENTIFIER_PATTERN =
  /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function supportedMediaType(
  value: string,
): value is CapaKnowledgeMediaType {
  return CAPA_KNOWLEDGE_MEDIA_TYPES
    .includes(value as CapaKnowledgeMediaType);
}

function validateRequest(
  request: unknown,
): asserts request is CapaKnowledgeExtractionRequest {
  if (
    typeof request !== "object" ||
    request === null
  ) {
    throw new CapaKnowledgeExtractionError(
      "INVALID_EXTRACTION_REQUEST",
    );
  }

  const candidate = request as Partial<
    CapaKnowledgeExtractionRequest
  >;

  if (
    !(candidate.artifact_bytes instanceof
      Uint8Array) ||
    candidate.artifact_bytes.byteLength === 0 ||
    typeof candidate.declared_media_type !==
      "string" ||
    typeof candidate.detected_media_type !==
      "string" ||
    typeof candidate.extractor_id !== "string" ||
    !IDENTIFIER_PATTERN.test(
      candidate.extractor_id,
    ) ||
    typeof candidate.extractor_version !==
      "string" ||
    !IDENTIFIER_PATTERN.test(
      candidate.extractor_version,
    )
  ) {
    throw new CapaKnowledgeExtractionError(
      "INVALID_EXTRACTION_REQUEST",
    );
  }
}

function validateAdapterResult(
  result: unknown,
): asserts result is CapaKnowledgeAdapterResult {
  if (
    typeof result !== "object" ||
    result === null
  ) {
    throw new CapaKnowledgeExtractionError(
      "INVALID_EXTRACTION_RESULT",
    );
  }

  const candidate = result as Partial<
    CapaKnowledgeAdapterResult
  >;

  if (
    typeof candidate.extractor_id !== "string" ||
    !IDENTIFIER_PATTERN.test(
      candidate.extractor_id,
    ) ||
    typeof candidate.extractor_version !==
      "string" ||
    !IDENTIFIER_PATTERN.test(
      candidate.extractor_version,
    ) ||
    !Array.isArray(candidate.units) ||
    candidate.units.length === 0 ||
    (
      candidate.warnings !== undefined &&
      (
        !Array.isArray(candidate.warnings) ||
        candidate.warnings.some(
          (warning) =>
            typeof warning !== "string" ||
            warning.trim().length === 0,
        )
      )
    )
  ) {
    throw new CapaKnowledgeExtractionError(
      "INVALID_EXTRACTION_RESULT",
    );
  }

  for (
    let index = 0;
    index < candidate.units.length;
    index += 1
  ) {
    const unit = candidate.units[index];

    if (
      typeof unit !== "object" ||
      unit === null ||
      unit.sequence_number !== index + 1 ||
      typeof unit.locator !== "string" ||
      unit.locator.trim().length === 0 ||
      typeof unit.text !== "string"
    ) {
      throw new CapaKnowledgeExtractionError(
        "INVALID_EXTRACTION_RESULT",
      );
    }
  }
}

function freezeResult(
  mediaType: CapaKnowledgeMediaType,
  result: CapaKnowledgeAdapterResult,
): CapaKnowledgeExtractionResult {
  const units = result.units.map(
    (unit) => Object.freeze({ ...unit }),
  );
  const combinedText = units
    .map((unit) => unit.text)
    .join("\n");

  if (combinedText.trim().length === 0) {
    throw new CapaKnowledgeExtractionError(
      "EXTRACTED_CONTENT_EMPTY",
    );
  }

  return Object.freeze({
    extraction_version:
      CAPA_KNOWLEDGE_EXTRACTION_VERSION,
    media_type: mediaType,
    extractor_id: result.extractor_id,
    extractor_version:
      result.extractor_version,
    units: Object.freeze(units),
    combined_text: combinedText,
    warnings: Object.freeze([
      ...(result.warnings ?? []),
    ]),
  });
}

export class CapaKnowledgeExtractionService {
  private readonly extractors:
    ReadonlyMap<string, CapaKnowledgeExtractor>;

  constructor(
    extractors:
      readonly CapaKnowledgeExtractor[],
  ) {
    const registry =
      new Map<string, CapaKnowledgeExtractor>();

    for (const extractor of extractors) {
      const key = this.registryKey(
        extractor.media_type,
        extractor.extractor_id,
        extractor.extractor_version,
      );

      if (
        !supportedMediaType(extractor.media_type) ||
        !IDENTIFIER_PATTERN.test(
          extractor.extractor_id,
        ) ||
        !IDENTIFIER_PATTERN.test(
          extractor.extractor_version,
        ) ||
        registry.has(key)
      ) {
        throw new CapaKnowledgeExtractionError(
          "INVALID_EXTRACTION_REQUEST",
        );
      }

      registry.set(key, extractor);
    }

    this.extractors = registry;
  }

  async extract(
    request: unknown,
  ): Promise<CapaKnowledgeExtractionResult> {
    validateRequest(request);

    if (
      !supportedMediaType(
        request.detected_media_type,
      ) ||
      !supportedMediaType(
        request.declared_media_type,
      )
    ) {
      throw new CapaKnowledgeExtractionError(
        "UNSUPPORTED_MEDIA_TYPE",
      );
    }

    if (
      request.declared_media_type !==
      request.detected_media_type
    ) {
      throw new CapaKnowledgeExtractionError(
        "DECLARED_MEDIA_TYPE_MISMATCH",
      );
    }

    const extractor = this.extractors.get(
      this.registryKey(
        request.detected_media_type,
        request.extractor_id,
        request.extractor_version,
      ),
    );

    if (extractor === undefined) {
      throw new CapaKnowledgeExtractionError(
        "EXTRACTOR_NOT_APPROVED",
      );
    }

    let adapterResult: unknown;

    try {
      adapterResult = await extractor.extract(
        request.artifact_bytes,
      );
    } catch (error) {
      if (
        error instanceof
          CapaKnowledgeExtractionError
      ) {
        throw error;
      }

      throw new CapaKnowledgeExtractionError(
        "EXTRACTION_FAILED",
      );
    }

    validateAdapterResult(
      adapterResult,
    );

    if (
      adapterResult.extractor_id !==
        request.extractor_id ||
      adapterResult.extractor_version !==
        request.extractor_version
    ) {
      throw new CapaKnowledgeExtractionError(
        "EXTRACTOR_IDENTITY_MISMATCH",
      );
    }

    return freezeResult(
      request.detected_media_type,
      adapterResult,
    );
  }

  private registryKey(
    mediaType: string,
    extractorId: string,
    extractorVersion: string,
  ): string {
    return [
      mediaType,
      extractorId,
      extractorVersion,
    ].join("\u0000");
  }
}

/**
 * Approved strict UTF-8 text extractor. Invalid UTF-8 fails closed.
 */
export function createCapaPlainTextExtractor(
  extractorVersion = "plain-text-1.0.0",
): CapaKnowledgeExtractor {
  const extractorId = "CAPA-TXT";

  if (!IDENTIFIER_PATTERN.test(extractorVersion)) {
    throw new CapaKnowledgeExtractionError(
      "INVALID_EXTRACTION_REQUEST",
    );
  }

  return Object.freeze({
    extractor_id: extractorId,
    extractor_version: extractorVersion,
    media_type: "text/plain" as const,

    async extract(
      artifactBytes: Uint8Array,
    ): Promise<CapaKnowledgeAdapterResult> {
      let text: string;

      try {
        text = new TextDecoder(
          "utf-8",
          { fatal: true },
        ).decode(artifactBytes);
      } catch {
        throw new CapaKnowledgeExtractionError(
          "EXTRACTION_FAILED",
        );
      }

      return Object.freeze({
        extractor_id: extractorId,
        extractor_version: extractorVersion,
        units: Object.freeze([
          Object.freeze({
            sequence_number: 1,
            locator: "text:body",
            text,
          }),
        ]),
      });
    },
  });
}
