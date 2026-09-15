import { IMAGE_GENERATION_PROMPT_MAX_LENGTH } from "./config";

export const IMAGE_EDIT_OPERATION = "edit" as const;

export type ImageEditSourceReference =
  | {
      kind: "generated_image";
      generatedImageId: string;
    }
  | {
      kind: "uploaded_image";
      messageId: string;
      ordinal: number;
    };

export type ImageEditLineage = {
  operation: typeof IMAGE_EDIT_OPERATION;
  source: ImageEditSourceReference;
  derivativeGeneratedImageId: string;
  instruction: string;
};

export type ImageEditSourceValidationIssue = {
  field: "source";
  message: string;
};

export type ImageEditSourceValidationResult =
  | { success: true; source: ImageEditSourceReference }
  | { success: false; issues: ImageEditSourceValidationIssue[] };

export type ImageEditLineageValidationIssue = {
  field: "operation" | "source" | "derivativeGeneratedImageId" | "instruction";
  message: string;
};

export type ImageEditLineageValidationResult =
  | { success: true; lineage: ImageEditLineage }
  | { success: false; issues: ImageEditLineageValidationIssue[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isLogicalIdentity(value: unknown): value is string {
  if (typeof value !== "string") return false;

  const normalized = value.trim();
  return (
    normalized.length > 0 &&
    !normalized.includes("/") &&
    !normalized.includes("\\") &&
    !/^[a-z][a-z\d+.-]*:\/\//i.test(normalized) &&
    !/[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  );
}

function hasOnlyKeys(input: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  return Object.keys(input).every((key) => allowedKeys.includes(key));
}

function invalidSource(message: string): ImageEditSourceValidationResult {
  return { success: false, issues: [{ field: "source", message }] };
}

function normalizeLogicalIdentity(value: unknown): string | null {
  return isLogicalIdentity(value) ? value.trim() : null;
}

export function validateImageEditSourceReference(
  input: unknown,
): ImageEditSourceValidationResult {
  if (!isRecord(input) || typeof input.kind !== "string") {
    return invalidSource("source must identify a supported source kind");
  }

  if (input.kind === "generated_image") {
    if (!hasOnlyKeys(input, ["kind", "generatedImageId"])) {
      return invalidSource("generated sources accept only generatedImageId");
    }

    const generatedImageId = normalizeLogicalIdentity(input.generatedImageId);
    return generatedImageId
      ? { success: true, source: { kind: "generated_image", generatedImageId } }
      : invalidSource("generatedImageId must be a non-empty logical identity");
  }

  if (input.kind === "uploaded_image") {
    if (!hasOnlyKeys(input, ["kind", "messageId", "ordinal"])) {
      return invalidSource("uploaded sources accept only messageId and ordinal");
    }

    const messageId = normalizeLogicalIdentity(input.messageId);
    if (!messageId) {
      return invalidSource("messageId must be a non-empty logical identity");
    }

    if (
      typeof input.ordinal !== "number" ||
      !Number.isSafeInteger(input.ordinal) ||
      input.ordinal < 1
    ) {
      return invalidSource("ordinal must be a one-based safe integer");
    }

    return {
      success: true,
      source: { kind: "uploaded_image", messageId, ordinal: input.ordinal },
    };
  }

  return invalidSource("source kind must be generated_image or uploaded_image");
}

export function validateImageEditLineage(
  input: unknown,
): ImageEditLineageValidationResult {
  if (!isRecord(input)) {
    return {
      success: false,
      issues: [{ field: "source", message: "lineage must be an object" }],
    };
  }

  const issues: ImageEditLineageValidationIssue[] = [];

  if (input.operation !== IMAGE_EDIT_OPERATION) {
    issues.push({
      field: "operation",
      message: "operation must be edit",
    });
  }

  const sourceResult = validateImageEditSourceReference(input.source);
  if (!sourceResult.success) {
    issues.push({ field: "source", message: sourceResult.issues[0]?.message ?? "source is invalid" });
  }

  const derivativeGeneratedImageId = normalizeLogicalIdentity(
    input.derivativeGeneratedImageId,
  );
  if (!derivativeGeneratedImageId) {
    issues.push({
      field: "derivativeGeneratedImageId",
      message: "derivativeGeneratedImageId must be a non-empty logical identity",
    });
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

  if (
    issues.length > 0 ||
    !sourceResult.success ||
    !derivativeGeneratedImageId ||
    typeof instruction !== "string"
  ) {
    return { success: false, issues };
  }

  return {
    success: true,
    lineage: {
      operation: IMAGE_EDIT_OPERATION,
      source: sourceResult.source,
      derivativeGeneratedImageId,
      instruction,
    },
  };
}
