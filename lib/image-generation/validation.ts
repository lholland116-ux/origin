import { IMAGE_GENERATION_PROMPT_MAX_LENGTH } from "./config";
import { normalizeGeneratedImageMimeType } from "../chat/generated-image-history";
import type { ImageEditRequest, ImageGenerationRequest } from "./provider";

export type ImageGenerationValidationField =
  | keyof ImageGenerationRequest
  | "request";

export type ImageGenerationValidationIssue = {
  field: ImageGenerationValidationField;
  message: string;
};

export type ImageGenerationValidationResult =
  | { success: true; request: ImageGenerationRequest }
  | { success: false; issues: ImageGenerationValidationIssue[] };

export type ImageEditValidationField =
  | "request"
  | "sourceImage"
  | "instruction"
  | "width"
  | "height"
  | "model"
  | "aspectRatio"
  | "seed";

export type ImageEditValidationIssue = {
  field: ImageEditValidationField;
  message: string;
};

export type ImageEditValidationResult =
  | { success: true; request: ImageEditRequest }
  | { success: false; issues: ImageEditValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidOptionalString(
  input: Record<string, unknown>,
  field: "model" | "aspectRatio" | "quality",
  issues: ImageGenerationValidationIssue[],
): input is Record<string, unknown> & Record<typeof field, string | undefined> {
  const value = input[field];

  if (value === undefined) {
    return true;
  }

  if (typeof value !== "string" || value.trim().length === 0) {
    issues.push({
      field,
      message: `${field} must be a non-empty string when provided`,
    });
    return false;
  }

  return true;
}

function hasValidPositiveInteger(
  input: Record<string, unknown>,
  field: "width" | "height",
  issues: ImageGenerationValidationIssue[],
): input is Record<string, unknown> & Record<typeof field, number | undefined> {
  const value = input[field];

  if (value === undefined) {
    return true;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    issues.push({
      field,
      message: `${field} must be a positive integer when provided`,
    });
    return false;
  }

  return true;
}

function hasValidEditOptionalString(
  input: Record<string, unknown>,
  field: "model" | "aspectRatio",
  issues: ImageEditValidationIssue[],
): void {
  const value = input[field];

  if (value !== undefined && (typeof value !== "string" || value.trim().length === 0)) {
    issues.push({
      field,
      message: `${field} must be a non-empty string when provided`,
    });
  }
}

function validateEditDimensions(
  input: Record<string, unknown>,
  issues: ImageEditValidationIssue[],
): void {
  const width = input.width;
  const height = input.height;
  const hasWidth = width !== undefined;
  const hasHeight = height !== undefined;

  if (hasWidth !== hasHeight) {
    issues.push({
      field: hasWidth ? "height" : "width",
      message: "width and height must be provided together",
    });
    return;
  }

  if (!hasWidth) {
    return;
  }

  if (typeof width !== "number" || !Number.isSafeInteger(width) || width <= 0) {
    issues.push({
      field: "width",
      message: "width must be a positive finite integer when provided",
    });
  }

  if (typeof height !== "number" || !Number.isSafeInteger(height) || height <= 0) {
    issues.push({
      field: "height",
      message: "height must be a positive finite integer when provided",
    });
  }
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowedKeys.includes(key));
}

/**
 * Validates stable request fields without imposing provider-specific limits.
 */
export function validateImageGenerationRequest(
  input: unknown,
): ImageGenerationValidationResult {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [
        {
          field: "request",
          message: "request must be an object",
        },
      ],
    };
  }

  const issues: ImageGenerationValidationIssue[] = [];
  const prompt = input.prompt;

  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    issues.push({
      field: "prompt",
      message: "prompt must be a non-empty string",
    });
  } else if (prompt.length > IMAGE_GENERATION_PROMPT_MAX_LENGTH) {
    issues.push({
      field: "prompt",
      message: `prompt must be ${IMAGE_GENERATION_PROMPT_MAX_LENGTH} characters or fewer`,
    });
  }

  hasValidOptionalString(input, "model", issues);
  hasValidOptionalString(input, "aspectRatio", issues);
  hasValidOptionalString(input, "quality", issues);
  hasValidPositiveInteger(input, "width", issues);
  hasValidPositiveInteger(input, "height", issues);

  const seed = input.seed;
  if (
    seed !== undefined &&
    (typeof seed !== "number" || !Number.isSafeInteger(seed))
  ) {
    issues.push({
      field: "seed",
      message: "seed must be an integer when provided",
    });
  }

  if (issues.length > 0 || typeof prompt !== "string") {
    return { success: false, issues };
  }

  const request: ImageGenerationRequest = { prompt };

  if (typeof input.model === "string") {
    request.model = input.model;
  }
  if (typeof input.width === "number") {
    request.width = input.width;
  }
  if (typeof input.height === "number") {
    request.height = input.height;
  }
  if (typeof input.aspectRatio === "string") {
    request.aspectRatio = input.aspectRatio;
  }
  if (typeof input.quality === "string") {
    request.quality = input.quality;
  }
  if (typeof input.seed === "number") {
    request.seed = input.seed;
  }

  return { success: true, request };
}

/**
 * Validates provider-neutral natural-language edit input. Authorization and
 * source retrieval intentionally remain outside this validation boundary.
 */
export function validateImageEditRequest(
  input: unknown,
): ImageEditValidationResult {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "request", message: "request must be an object" }],
    };
  }

  const issues: ImageEditValidationIssue[] = [];

  if (
    !hasOnlyKeys(input, [
      "sourceImage",
      "instruction",
      "width",
      "height",
      "model",
      "aspectRatio",
      "seed",
    ])
  ) {
    issues.push({
      field: "request",
      message: "request contains an unsupported field",
    });
  }

  const sourceImage = input.sourceImage;
  let normalizedMimeType: string | null = null;

  if (!isRecord(sourceImage) || !hasOnlyKeys(sourceImage, ["bytes", "mimeType"])) {
    issues.push({
      field: "sourceImage",
      message: "sourceImage must contain only bytes and mimeType",
    });
  } else {
    if (!(sourceImage.bytes instanceof Uint8Array) || sourceImage.bytes.byteLength === 0) {
      issues.push({
        field: "sourceImage",
        message: "sourceImage.bytes must be a non-empty Uint8Array",
      });
    }

    normalizedMimeType = normalizeGeneratedImageMimeType(sourceImage.mimeType);
    if (!normalizedMimeType) {
      issues.push({
        field: "sourceImage",
        message: "sourceImage.mimeType must be a supported image MIME type",
      });
    }
  }

  const instruction = input.instruction;
  if (typeof instruction !== "string" || instruction.trim().length === 0) {
    issues.push({
      field: "instruction",
      message: "instruction must be a non-empty string",
    });
  } else if (instruction.length > IMAGE_GENERATION_PROMPT_MAX_LENGTH) {
    issues.push({
      field: "instruction",
      message: `instruction must be ${IMAGE_GENERATION_PROMPT_MAX_LENGTH} characters or fewer`,
    });
  }

  hasValidEditOptionalString(input, "model", issues);
  hasValidEditOptionalString(input, "aspectRatio", issues);
  validateEditDimensions(input, issues);

  const seed = input.seed;
  if (seed !== undefined && (typeof seed !== "number" || !Number.isSafeInteger(seed))) {
    issues.push({
      field: "seed",
      message: "seed must be an integer when provided",
    });
  }

  if (
    issues.length > 0 ||
    !isRecord(sourceImage) ||
    !(sourceImage.bytes instanceof Uint8Array) ||
    sourceImage.bytes.byteLength === 0 ||
    !normalizedMimeType ||
    typeof instruction !== "string"
  ) {
    return { success: false, issues };
  }

  const request: ImageEditRequest = {
    sourceImage: {
      bytes: sourceImage.bytes,
      mimeType: normalizedMimeType,
    },
    instruction,
  };

  if (typeof input.model === "string") {
    request.model = input.model;
  }
  if (typeof input.aspectRatio === "string") {
    request.aspectRatio = input.aspectRatio;
  }
  if (typeof input.width === "number") {
    request.width = input.width;
  }
  if (typeof input.height === "number") {
    request.height = input.height;
  }
  if (typeof input.seed === "number") {
    request.seed = input.seed;
  }

  return { success: true, request };
}
