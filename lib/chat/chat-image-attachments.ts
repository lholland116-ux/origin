export const MAX_STORED_IMAGES = 3;
export const MAX_STORED_IMAGE_PATH_LENGTH = 500;
export const MAX_STORED_IMAGE_NAME_LENGTH = 255;
export const MAX_STORED_IMAGE_METADATA_BYTES = 8_192;

export type ChatImagePlan = "free" | "pro";

export type StoredImageReference = {
  imagePath: string;
  imageName: string;
};

export type NormalizedChatImageInput =
  | {
      source: "none";
      images: [];
    }
  | {
      source: "legacy";
      imageBase64: string;
      imagePath: string;
      imageName: string;
    }
  | {
      source: "stored";
      images: StoredImageReference[];
    };

export type ChatImageValidationCode =
  | "INVALID_IMAGES"
  | "MIXED_IMAGE_INPUT"
  | "DUPLICATE_IMAGE"
  | "INVALID_IMAGE"
  | "IMAGE_LIMIT_EXCEEDED";

export class ChatImageValidationError extends Error {
  readonly code: ChatImageValidationCode;

  constructor(code: ChatImageValidationCode, message: string) {
    super(message);
    this.name = "ChatImageValidationError";
    this.code = code;
  }
}

function normalizedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f-\u009f]/u.test(value);
}

function invalidImages(message: string): ChatImageValidationError {
  return new ChatImageValidationError("INVALID_IMAGES", message);
}

export function validateStoredImagePath(
  imagePath: string,
  userId: string
): void {
  const expectedNamespace = `${userId}/`;
  const pathSegments = imagePath.split("/");

  if (
    !imagePath ||
    imagePath.length > MAX_STORED_IMAGE_PATH_LENGTH ||
    imagePath.startsWith("/") ||
    imagePath.includes("..") ||
    imagePath.includes("\\") ||
    imagePath.startsWith(expectedNamespace) === false ||
    pathSegments.some((segment) => segment.length === 0) ||
    hasControlCharacter(imagePath)
  ) {
    throw new ChatImageValidationError("INVALID_IMAGE", "Invalid image attachment.");
  }
}

function validateStoredImageName(imageName: string): void {
  if (
    !imageName ||
    imageName.length > MAX_STORED_IMAGE_NAME_LENGTH ||
    hasControlCharacter(imageName)
  ) {
    throw invalidImages("Invalid image metadata.");
  }
}

function validateMetadataSize(images: unknown[]): void {
  const metadataBytes = new TextEncoder().encode(JSON.stringify(images)).length;

  if (metadataBytes > MAX_STORED_IMAGE_METADATA_BYTES) {
    throw invalidImages("Image metadata is too large.");
  }
}

export function normalizeChatImageInput(params: {
  images?: unknown;
  imageBase64?: unknown;
  imagePath?: unknown;
  imageName?: unknown;
  userId: string;
}): NormalizedChatImageInput {
  const imageBase64 = normalizedString(params.imageBase64);
  const imagePath = normalizedString(params.imagePath);
  const imageName = normalizedString(params.imageName);
  const hasLegacyImage = Boolean(imageBase64 || imagePath || imageName);

  if (params.images !== undefined && !Array.isArray(params.images)) {
    throw invalidImages("images must be an array.");
  }

  const rawImages = Array.isArray(params.images) ? params.images : [];

  if (hasLegacyImage && rawImages.length > 0) {
    throw new ChatImageValidationError(
      "MIXED_IMAGE_INPUT",
      "Legacy and stored image inputs cannot be used together."
    );
  }

  if (rawImages.length === 0) {
    if (!hasLegacyImage) {
      return { source: "none", images: [] };
    }

    return {
      source: "legacy",
      imageBase64,
      imagePath,
      imageName,
    };
  }

  validateMetadataSize(rawImages);

  const seenPaths = new Set<string>();
  const images = rawImages.map((rawImage): StoredImageReference => {
    if (!rawImage || typeof rawImage !== "object" || Array.isArray(rawImage)) {
      throw invalidImages("Each image must be an object.");
    }

    const imageRecord = rawImage as Record<string, unknown>;
    const keys = Object.keys(imageRecord);

    if (
      keys.some((key) => key !== "imagePath" && key !== "imageName")
    ) {
      throw invalidImages("Stored images accept only imagePath and imageName.");
    }

    const normalizedImagePath = normalizedString(imageRecord.imagePath);
    const normalizedImageName = normalizedString(imageRecord.imageName);

    if (!normalizedImagePath || !normalizedImageName) {
      throw invalidImages("Each image requires imagePath and imageName.");
    }

    validateStoredImagePath(normalizedImagePath, params.userId);
    validateStoredImageName(normalizedImageName);

    if (seenPaths.has(normalizedImagePath)) {
      throw new ChatImageValidationError(
        "DUPLICATE_IMAGE",
        "Duplicate image attachments are not allowed."
      );
    }

    seenPaths.add(normalizedImagePath);

    return {
      imagePath: normalizedImagePath,
      imageName: normalizedImageName,
    };
  });

  return { source: "stored", images };
}

export function getStoredImageLimit(plan: ChatImagePlan): number {
  return plan === "pro" ? MAX_STORED_IMAGES : 1;
}

export function assertStoredImageCount(
  images: StoredImageReference[],
  plan: ChatImagePlan
): void {
  if (images.length > getStoredImageLimit(plan)) {
    throw new ChatImageValidationError(
      "IMAGE_LIMIT_EXCEEDED",
      "The image attachment count exceeds the plan limit."
    );
  }
}

export function buildImageInputContent(
  userText: string,
  imageUrls: string[]
) {
  return [
    {
      type: "input_text" as const,
      text: userText,
    },
    ...imageUrls.map((imageUrl) => ({
      type: "input_image" as const,
      image_url: imageUrl,
      detail: "auto" as const,
    })),
  ];
}
