/**
 * Provider-neutral input for a future image-generation request.
 *
 * Provider adapters are responsible for translating these stable fields into
 * vendor-specific request formats.
 */
export type ImageGenerationRequest = {
  prompt: string;
  model?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  quality?: string;
  seed?: number;
};

export type ImageGenerationCost = {
  currency: string;
  amount: number;
};

/**
 * Provider output before persistence, storage, or message materialization.
 */
export type ImageGenerationResult = {
  provider: string;
  model: string;
  mimeType: string;
  bytes: Uint8Array;
  generationId?: string;
  width?: number;
  height?: number;
  cost?: ImageGenerationCost;
};

export interface ImageGenerationProvider {
  generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult>;
}
