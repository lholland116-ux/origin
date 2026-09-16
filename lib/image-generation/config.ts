/**
 * Stable application-level identifiers. A future provider adapter can map the
 * model identifier to its vendor-specific model/version identifier.
 */
export const IMAGE_GENERATION_DEFAULT_PROVIDER = "replicate";
export const IMAGE_GENERATION_DEFAULT_MODEL = "flux-schnell";

/** Fixed production image-editing configuration for the Runware adapter. */
export const RUNWARE_IMAGE_EDIT_API_KEY_ENV = "RUNWARE_IMAGE_EDIT_API_KEY" as const;
export const RUNWARE_IMAGE_EDIT_ENDPOINT = "https://api.runware.ai/v1" as const;
export const RUNWARE_IMAGE_EDIT_PROVIDER = "runware" as const;
export const RUNWARE_IMAGE_EDIT_MODEL = "runware:400@4" as const;

// Synchronous image edits need room for provider execution while remaining
// bounded; this is deliberately fixed and cannot be supplied by a client.
export const RUNWARE_IMAGE_EDIT_TIMEOUT_MS = 120_000;
export const RUNWARE_IMAGE_EDIT_MIN_DIMENSION = 128;
export const RUNWARE_IMAGE_EDIT_MAX_DIMENSION = 2048;
export const RUNWARE_IMAGE_EDIT_DIMENSION_STEP = 16;

/**
 * Deliberate application-level prompt limit, independent of provider limits.
 */
export const IMAGE_GENERATION_PROMPT_MAX_LENGTH = 4000;
