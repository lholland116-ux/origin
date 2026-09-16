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

/**
 * Provider-neutral input for a natural-language image edit.
 *
 * Source authorization and storage resolution happen outside the provider.
 * Adapters receive image data only and translate these stable fields into
 * vendor-specific input.
 */
export type ImageEditRequest = {
  sourceImage: {
    bytes: Uint8Array;
    mimeType: string;
  };
  instruction: string;
  /** Server-resolved output dimensions; never trust these from a client. */
  width?: number;
  height?: number;
  model?: string;
  aspectRatio?: string;
  seed?: number;
};

export interface ImageGenerationProvider {
  generateImage(
    request: ImageGenerationRequest,
  ): Promise<ImageGenerationResult>;
}

/**
 * Image editing is intentionally separate from generation because a future
 * editing provider may differ from the generation provider.
 */
export interface ImageEditingProvider {
  editImage(
    request: ImageEditRequest,
  ): Promise<ImageGenerationResult>;
}
