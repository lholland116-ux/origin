import { IMAGE_GENERATION_PROMPT_MAX_LENGTH } from "./config";
import type { ImageGenerationRequest } from "./provider";

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
