/**
 * Stable application-level identifiers. A future provider adapter can map the
 * model identifier to its vendor-specific model/version identifier.
 */
export const IMAGE_GENERATION_DEFAULT_PROVIDER = "replicate";
export const IMAGE_GENERATION_DEFAULT_MODEL = "flux-schnell";

/**
 * Deliberate application-level prompt limit, independent of provider limits.
 */
export const IMAGE_GENERATION_PROMPT_MAX_LENGTH = 4000;
