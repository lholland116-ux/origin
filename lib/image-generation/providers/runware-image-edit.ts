import {
  RUNWARE_IMAGE_EDIT_API_KEY_ENV,
  RUNWARE_IMAGE_EDIT_DIMENSION_STEP,
  RUNWARE_IMAGE_EDIT_ENDPOINT,
  RUNWARE_IMAGE_EDIT_MAX_DIMENSION,
  RUNWARE_IMAGE_EDIT_MIN_DIMENSION,
  RUNWARE_IMAGE_EDIT_MODEL,
  RUNWARE_IMAGE_EDIT_PROVIDER,
  RUNWARE_IMAGE_EDIT_TIMEOUT_MS,
} from "../config";
import type {
  ImageEditingProvider,
  ImageGenerationCost,
  ImageGenerationResult,
  ImageEditRequest,
} from "../provider";
import { validateImageEditRequest } from "../validation";

if (typeof window !== "undefined") {
  throw new Error("Runware image editing is server-only");
}

export type RunwareImageEditProviderErrorCode =
  | "invalid_request"
  | "configuration"
  | "provider_failure"
  | "invalid_output"
  | "timeout";

export type RunwareImageEditFailureStage =
  | "network"
  | "upstream_http"
  | "response_parse"
  | "response_processing";

type RunwareImageEditProviderErrorDetails = Readonly<{
  failureStage?: RunwareImageEditFailureStage;
  upstreamStatus?: number | null;
  upstreamCode?: string | null;
  upstreamParameter?: string | null;
  upstreamTaskType?: string | null;
  upstreamType?: string | null;
  upstreamMessage?: string | null;
  taskUUID?: string;
}>;

export class RunwareImageEditProviderError extends Error {
  readonly code: RunwareImageEditProviderErrorCode;
  readonly status?: number;
  readonly failureStage: RunwareImageEditFailureStage | null;
  readonly upstreamStatus: number | null;
  readonly upstreamCode: string | null;
  readonly upstreamParameter: string | null;
  readonly upstreamTaskType: string | null;
  readonly upstreamType: string | null;
  readonly upstreamMessage: string | null;
  readonly taskUUID: string | null;

  constructor(
    code: RunwareImageEditProviderErrorCode,
    message: string,
    status?: number,
    details: RunwareImageEditProviderErrorDetails = {},
  ) {
    super(message);
    this.name = "RunwareImageEditProviderError";
    this.code = code;
    this.status = status;
    this.failureStage = details.failureStage ?? null;
    this.upstreamStatus = details.upstreamStatus ?? status ?? null;
    this.upstreamCode = details.upstreamCode ?? null;
    this.upstreamParameter = details.upstreamParameter ?? null;
    this.upstreamTaskType = details.upstreamTaskType ?? null;
    this.upstreamType = details.upstreamType ?? null;
    this.upstreamMessage = details.upstreamMessage ?? null;
    this.taskUUID = details.taskUUID ?? null;
  }
}

type RunwareFetcher = typeof fetch;

type JsonRecord = Record<string, unknown>;

const RUNWARE_PROVIDER_FAILURE_EVENT = "image-edit:runware_provider_failure" as const;
const MAX_UPSTREAM_DIAGNOSTIC_BYTES = 4096;
const MAX_UPSTREAM_DIAGNOSTIC_VALUE_LENGTH = 128;
const MAX_UPSTREAM_DIAGNOSTIC_MESSAGE_LENGTH = 256;
const SENSITIVE_DIAGNOSTIC_CONTENT_PATTERN =
  /(?:https?:\/\/|s3:\/\/|gs:\/\/|data:[^,\s]*,|authorization|bearer\s|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|secret|cookie|signed[_ -]?url|[A-Za-z0-9+/]{80,}={0,2})/i;

const PNG_SIGNATURE = new Uint8Array([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
]);

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeDiagnosticScalar(
  value: unknown,
  maxLength = MAX_UPSTREAM_DIAGNOSTIC_VALUE_LENGTH,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const sanitized = value.replace(/[\u0000-\u001f\u007f]+/g, " ").trim();
  if (
    sanitized.length === 0 ||
    SENSITIVE_DIAGNOSTIC_CONTENT_PATTERN.test(sanitized)
  ) {
    return null;
  }

  return sanitized.slice(0, maxLength);
}

async function readBoundedResponseBody(response: Response): Promise<string | null> {
  if (!response.body) {
    return null;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch {
    return null;
  }
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > MAX_UPSTREAM_DIAGNOSTIC_BYTES) {
        await reader.cancel().catch(() => undefined);
        return null;
      }

      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(bytes);
}

async function readUpstreamErrorMetadata(response: Response): Promise<{
  upstreamCode: string | null;
  upstreamParameter: string | null;
  upstreamTaskType: string | null;
  upstreamType: string | null;
  upstreamMessage: string | null;
}> {
  const body = await readBoundedResponseBody(response);
  if (!body) {
    return {
      upstreamCode: null,
      upstreamParameter: null,
      upstreamTaskType: null,
      upstreamType: null,
      upstreamMessage: null,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return {
      upstreamCode: null,
      upstreamParameter: null,
      upstreamTaskType: null,
      upstreamType: null,
      upstreamMessage: null,
    };
  }

  if (!isRecord(parsed)) {
    return {
      upstreamCode: null,
      upstreamParameter: null,
      upstreamTaskType: null,
      upstreamType: null,
      upstreamMessage: null,
    };
  }

  const firstError = Array.isArray(parsed.errors)
    ? parsed.errors[0]
    : parsed.error;
  if (!isRecord(firstError)) {
    return {
      upstreamCode: null,
      upstreamParameter: null,
      upstreamTaskType: null,
      upstreamType: null,
      upstreamMessage: null,
    };
  }

  return {
    upstreamCode: sanitizeDiagnosticScalar(firstError.code),
    upstreamParameter: sanitizeDiagnosticScalar(firstError.parameter),
    upstreamTaskType: sanitizeDiagnosticScalar(firstError.taskType),
    upstreamType: sanitizeDiagnosticScalar(firstError.type),
    upstreamMessage: sanitizeDiagnosticScalar(
      firstError.message,
      MAX_UPSTREAM_DIAGNOSTIC_MESSAGE_LENGTH,
    ),
  };
}

function createProviderFailureError(details: {
  failureStage: RunwareImageEditFailureStage;
  taskUUID: string;
  upstreamStatus?: number;
  upstreamCode?: string | null;
  upstreamParameter?: string | null;
  upstreamTaskType?: string | null;
  upstreamType?: string | null;
  upstreamMessage?: string | null;
}): RunwareImageEditProviderError {
  const diagnostic = {
    code: "provider_failure" as const,
    failureStage: details.failureStage,
    upstreamStatus: details.upstreamStatus ?? null,
    upstreamCode: details.upstreamCode ?? null,
    upstreamParameter: details.upstreamParameter ?? null,
    upstreamTaskType: details.upstreamTaskType ?? null,
    upstreamType: details.upstreamType ?? null,
    upstreamMessage: details.upstreamMessage ?? null,
    taskUUID: details.taskUUID,
    provider: RUNWARE_IMAGE_EDIT_PROVIDER,
    model: RUNWARE_IMAGE_EDIT_MODEL,
  } as const;

  console.error(RUNWARE_PROVIDER_FAILURE_EVENT, diagnostic);

  return new RunwareImageEditProviderError(
    "provider_failure",
    "Runware image editing failed",
    details.upstreamStatus,
    diagnostic,
  );
}

function getApiKey(): string {
  const value = process.env[RUNWARE_IMAGE_EDIT_API_KEY_ENV];

  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RunwareImageEditProviderError(
      "configuration",
      `${RUNWARE_IMAGE_EDIT_API_KEY_ENV} is required for image editing`,
    );
  }

  return value.trim();
}

function validateRunwareDimension(value: number, field: "width" | "height"): void {
  if (
    !Number.isSafeInteger(value) ||
    value < RUNWARE_IMAGE_EDIT_MIN_DIMENSION ||
    value > RUNWARE_IMAGE_EDIT_MAX_DIMENSION ||
    value % RUNWARE_IMAGE_EDIT_DIMENSION_STEP !== 0
  ) {
    throw new RunwareImageEditProviderError(
      "invalid_request",
      `${field} must be an integer from ${RUNWARE_IMAGE_EDIT_MIN_DIMENSION} to ${RUNWARE_IMAGE_EDIT_MAX_DIMENSION} divisible by ${RUNWARE_IMAGE_EDIT_DIMENSION_STEP}`,
    );
  }
}

function encodeDataUri(bytes: Uint8Array, mimeType: string): string {
  return `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}`;
}

function decodeBase64(value: string): Uint8Array {
  const normalized = value.trim();

  if (
    normalized.length === 0 ||
    normalized.length % 4 === 1 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)
  ) {
    throw new RunwareImageEditProviderError(
      "invalid_output",
      "Runware returned malformed image data",
    );
  }

  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bytes = new Uint8Array(Buffer.from(padded, "base64"));
  const canonical = Buffer.from(bytes).toString("base64").replace(/=+$/, "");

  if (bytes.byteLength === 0 || canonical !== normalized.replace(/=+$/, "")) {
    throw new RunwareImageEditProviderError(
      "invalid_output",
      "Runware returned malformed image data",
    );
  }

  return bytes;
}

function isPng(bytes: Uint8Array): boolean {
  if (bytes.byteLength < PNG_SIGNATURE.length) {
    return false;
  }

  if (!PNG_SIGNATURE.every((value, index) => bytes[index] === value)) {
    return false;
  }

  let offset = PNG_SIGNATURE.length;
  let sawIdat = false;
  let sawTerminalIend = false;

  while (offset < bytes.byteLength) {
    // A chunk always contains length, type, and CRC fields, even when its
    // data length is zero.
    if (bytes.byteLength - offset < 12) {
      return false;
    }

    const chunkLength =
      bytes[offset] * 0x1000000 +
      bytes[offset + 1] * 0x10000 +
      bytes[offset + 2] * 0x100 +
      bytes[offset + 3];
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength + 4;

    if (chunkEnd > bytes.byteLength) {
      return false;
    }

    const chunkType = String.fromCharCode(
      bytes[typeOffset],
      bytes[typeOffset + 1],
      bytes[typeOffset + 2],
      bytes[typeOffset + 3],
    );

    if (offset === PNG_SIGNATURE.length) {
      if (chunkType !== "IHDR" || chunkLength !== 13) {
        return false;
      }

      const width =
        bytes[dataOffset] * 0x1000000 +
        bytes[dataOffset + 1] * 0x10000 +
        bytes[dataOffset + 2] * 0x100 +
        bytes[dataOffset + 3];
      const height =
        bytes[dataOffset + 4] * 0x1000000 +
        bytes[dataOffset + 5] * 0x10000 +
        bytes[dataOffset + 6] * 0x100 +
        bytes[dataOffset + 7];

      if (width === 0 || height === 0) {
        return false;
      }
    }

    if (chunkType === "IDAT") {
      sawIdat = true;
    }

    if (chunkType === "IEND") {
      if (chunkLength !== 0) {
        return false;
      }

      sawTerminalIend = true;
      offset = chunkEnd;
      break;
    }

    offset = chunkEnd;
  }

  return sawIdat && sawTerminalIend && offset === bytes.byteLength;
}

function getProviderId(value: unknown, fallback: string): string {
  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim();
  return normalized.length > 0 && normalized.length <= 200 ? normalized : fallback;
}

function getCost(value: unknown): ImageGenerationCost | undefined {
  if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
    return { currency: "USD", amount: value };
  }

  if (!isRecord(value)) {
    return undefined;
  }

  const amount = value.amount;
  const currency = value.currency;

  if (
    typeof amount !== "number" ||
    !Number.isFinite(amount) ||
    amount < 0 ||
    typeof currency !== "string" ||
    currency.trim().length === 0
  ) {
    return undefined;
  }

  return { currency: currency.trim(), amount };
}

export class RunwareImageEditProvider implements ImageEditingProvider {
  private readonly fetcher: RunwareFetcher;

  constructor(options: { fetcher?: RunwareFetcher } = {}) {
    this.fetcher = options.fetcher ?? fetch;
  }

  async editImage(request: ImageEditRequest): Promise<ImageGenerationResult> {
    const validated = validateImageEditRequest(request);

    if (!validated.success) {
      throw new RunwareImageEditProviderError(
        "invalid_request",
        `Invalid image edit request: ${validated.issues[0]?.field ?? "request"}`,
      );
    }

    const normalizedRequest = validated.request;

    if (normalizedRequest.width === undefined || normalizedRequest.height === undefined) {
      throw new RunwareImageEditProviderError(
        "invalid_request",
        "Runware image editing requires output width and height",
      );
    }

    validateRunwareDimension(normalizedRequest.width, "width");
    validateRunwareDimension(normalizedRequest.height, "height");

    if (
      normalizedRequest.model !== undefined &&
      normalizedRequest.model !== RUNWARE_IMAGE_EDIT_MODEL
    ) {
      throw new RunwareImageEditProviderError(
        "invalid_request",
        "The requested Runware image editing model is not supported",
      );
    }

    const taskUUID = crypto.randomUUID();
    const task: JsonRecord = {
      taskType: "imageInference",
      taskUUID,
      model: RUNWARE_IMAGE_EDIT_MODEL,
      positivePrompt: normalizedRequest.instruction,
      width: normalizedRequest.width,
      height: normalizedRequest.height,
      inputs: {
        referenceImages: [
          encodeDataUri(normalizedRequest.sourceImage.bytes, normalizedRequest.sourceImage.mimeType),
        ],
      },
      outputType: "base64Data",
      outputFormat: "PNG",
      numberResults: 1,
      includeCost: true,
      deliveryMethod: "sync",
    };

    if (normalizedRequest.seed !== undefined) {
      task.seed = normalizedRequest.seed;
    }

    const apiKey = getApiKey();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), RUNWARE_IMAGE_EDIT_TIMEOUT_MS);

    try {
      let response: Response;
      try {
        response = await this.fetcher(RUNWARE_IMAGE_EDIT_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([task]),
          signal: controller.signal,
        });
      } catch (error) {
        if (error instanceof RunwareImageEditProviderError) {
          throw error;
        }

        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw new RunwareImageEditProviderError(
            "timeout",
            "Runware image editing timed out",
          );
        }

        throw createProviderFailureError({
          failureStage: "network",
          taskUUID,
        });
      }

      if (!response.ok) {
        const upstreamError = await readUpstreamErrorMetadata(response);
        throw createProviderFailureError({
          failureStage: "upstream_http",
          upstreamStatus: response.status,
          taskUUID,
          ...upstreamError,
        });
      }

      let body: unknown;
      try {
        body = await response.json();
      } catch (error) {
        if (error instanceof RunwareImageEditProviderError) {
          throw error;
        }

        if (
          controller.signal.aborted ||
          (error instanceof DOMException && error.name === "AbortError")
        ) {
          throw new RunwareImageEditProviderError(
            "timeout",
            "Runware image editing timed out",
          );
        }

        throw createProviderFailureError({
          failureStage: "response_parse",
          upstreamStatus: response.status,
          taskUUID,
        });
      }

      try {
        if (!isRecord(body) || !Array.isArray(body.data) || body.data.length !== 1) {
          throw new RunwareImageEditProviderError(
            "invalid_output",
            "Runware returned an unexpected image result",
          );
        }

        const result = body.data[0];
        if (!isRecord(result) || result.taskUUID !== taskUUID) {
          throw new RunwareImageEditProviderError(
            "invalid_output",
            "Runware returned an image for an unexpected task",
          );
        }

        if (typeof result.imageBase64Data !== "string" || result.imageBase64Data.trim().length === 0) {
          throw new RunwareImageEditProviderError(
            "invalid_output",
            "Runware returned no inline image data",
          );
        }

        const bytes = decodeBase64(result.imageBase64Data);
        if (!isPng(bytes)) {
          throw new RunwareImageEditProviderError(
            "invalid_output",
            "Runware returned an invalid PNG image",
          );
        }

        const cost = getCost(result.cost);

        return {
          provider: RUNWARE_IMAGE_EDIT_PROVIDER,
          model: RUNWARE_IMAGE_EDIT_MODEL,
          mimeType: "image/png",
          bytes,
          generationId: getProviderId(result.imageUUID, taskUUID),
          width: normalizedRequest.width,
          height: normalizedRequest.height,
          ...(cost ? { cost } : {}),
        };
      } catch (error) {
        if (error instanceof RunwareImageEditProviderError) {
          throw error;
        }

        throw createProviderFailureError({
          failureStage: "response_processing",
          upstreamStatus: response.status,
          taskUUID,
        });
      }
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
