import Replicate, { type FileOutput } from "replicate";

import {
  IMAGE_GENERATION_DEFAULT_MODEL,
} from "../config";
import type {
  ImageGenerationProvider,
  ImageGenerationRequest,
  ImageGenerationResult,
} from "../provider";
import { validateImageGenerationRequest } from "../validation";

if (typeof window !== "undefined") {
  throw new Error("Replicate image generation is server-only");
}

export const REPLICATE_FLUX_SCHNELL_MODEL =
  "black-forest-labs/flux-schnell" as const;

type ReplicateRunOptions = {
  input: Record<string, unknown>;
};

export type ReplicateRunner = (
  model: typeof REPLICATE_FLUX_SCHNELL_MODEL,
  options: ReplicateRunOptions,
) => Promise<unknown>;

export type ReplicateFluxSchnellProviderErrorCode =
  | "invalid_request"
  | "configuration"
  | "provider_failure"
  | "invalid_output";

export class ReplicateFluxSchnellProviderError extends Error {
  readonly code: ReplicateFluxSchnellProviderErrorCode;

  constructor(
    code: ReplicateFluxSchnellProviderErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ReplicateFluxSchnellProviderError";
    this.code = code;
  }
}

type BlobLike = {
  size: number;
  type?: unknown;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function isFileOutput(value: unknown): value is Pick<FileOutput, "blob"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { blob?: unknown }).blob === "function"
  );
}

function isBlobLike(value: unknown): value is BlobLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { size?: unknown }).size === "number" &&
    typeof (value as { arrayBuffer?: unknown }).arrayBuffer === "function"
  );
}

async function normalizeOutput(output: unknown): Promise<ImageGenerationResult> {
  if (!Array.isArray(output) || output.length !== 1) {
    throw new ReplicateFluxSchnellProviderError(
      "invalid_output",
      "Replicate returned an unexpected image output",
    );
  }

  const candidate = output[0];
  let blob: unknown;

  try {
    if (isFileOutput(candidate)) {
      blob = await candidate.blob();
    } else if (isBlobLike(candidate)) {
      blob = candidate;
    }
  } catch {
    throw new ReplicateFluxSchnellProviderError(
      "invalid_output",
      "Replicate image output could not be read",
    );
  }

  if (!isBlobLike(blob)) {
    throw new ReplicateFluxSchnellProviderError(
      "invalid_output",
      "Replicate returned an unreadable image output",
    );
  }

  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await blob.arrayBuffer());
  } catch {
    throw new ReplicateFluxSchnellProviderError(
      "invalid_output",
      "Replicate image output could not be read",
    );
  }

  if (blob.size <= 0 || bytes.byteLength === 0) {
    throw new ReplicateFluxSchnellProviderError(
      "invalid_output",
      "Replicate returned an empty image output",
    );
  }

  const reportedMimeType =
    typeof blob.type === "string" ? blob.type.trim().toLowerCase() : "";

  if (reportedMimeType && !reportedMimeType.startsWith("image/")) {
    throw new ReplicateFluxSchnellProviderError(
      "invalid_output",
      "Replicate returned a non-image output",
    );
  }

  return {
    provider: "replicate",
    model: IMAGE_GENERATION_DEFAULT_MODEL,
    mimeType: reportedMimeType || "image/webp",
    bytes,
  };
}

export class ReplicateFluxSchnellProvider
  implements ImageGenerationProvider
{
  private readonly runner: ReplicateRunner;

  constructor(options: { runner?: ReplicateRunner } = {}) {
    if (options.runner) {
      this.runner = options.runner;
      return;
    }

    const token = process.env.REPLICATE_API_TOKEN;
    if (typeof token !== "string" || token.trim().length === 0) {
      throw new ReplicateFluxSchnellProviderError(
        "configuration",
        "REPLICATE_API_TOKEN is required for image generation",
      );
    }

    const client = new Replicate({ auth: token });
    this.runner = (model, options) => client.run(model, options);
  }

  async generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult> {
    const validated = validateImageGenerationRequest(request);

    if (!validated.success) {
      throw new ReplicateFluxSchnellProviderError(
        "invalid_request",
        `Invalid image generation request: ${validated.issues[0]?.field ?? "request"}`,
      );
    }

    const normalizedRequest = validated.request;

    if (
      normalizedRequest.model !== undefined &&
      normalizedRequest.model !== IMAGE_GENERATION_DEFAULT_MODEL
    ) {
      throw new ReplicateFluxSchnellProviderError(
        "invalid_request",
        "The requested image generation model is not supported",
      );
    }

    if (
      normalizedRequest.width !== undefined ||
      normalizedRequest.height !== undefined
    ) {
      throw new ReplicateFluxSchnellProviderError(
        "invalid_request",
        "Explicit image dimensions are not supported yet",
      );
    }

    if (normalizedRequest.quality !== undefined) {
      throw new ReplicateFluxSchnellProviderError(
        "invalid_request",
        "Image quality selection is not supported yet",
      );
    }

    const input: Record<string, unknown> = {
      prompt: normalizedRequest.prompt,
      num_outputs: 1,
      go_fast: true,
      megapixels: "1",
      output_format: "webp",
      output_quality: 80,
      num_inference_steps: 4,
      aspect_ratio: normalizedRequest.aspectRatio ?? "1:1",
    };

    if (normalizedRequest.seed !== undefined) {
      input.seed = normalizedRequest.seed;
    }

    let output: unknown;
    try {
      output = await this.runner(REPLICATE_FLUX_SCHNELL_MODEL, { input });
    } catch {
      throw new ReplicateFluxSchnellProviderError(
        "provider_failure",
        "Replicate image generation failed",
      );
    }

    return normalizeOutput(output);
  }
}
