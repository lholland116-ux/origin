import { loadImage } from "@napi-rs/canvas";
import {
  RUNWARE_IMAGE_EDIT_DIMENSION_STEP,
  RUNWARE_IMAGE_EDIT_MAX_DIMENSION,
  RUNWARE_IMAGE_EDIT_MIN_DIMENSION,
} from "./config";
import type { ImageEditSourceReference } from "./lineage";

if (typeof window !== "undefined") {
  throw new Error("Image edit source inspection is server-only");
}

export const MAX_IMAGE_EDIT_SOURCE_BYTES = 8 * 1024 * 1024;
export const MAX_IMAGE_EDIT_SOURCE_AXIS = 8192;
export const MAX_IMAGE_EDIT_SOURCE_PIXELS = 16_777_216;

export const MIN_RUNWARE_EDIT_DIMENSION = RUNWARE_IMAGE_EDIT_MIN_DIMENSION;
export const MAX_RUNWARE_EDIT_DIMENSION = RUNWARE_IMAGE_EDIT_MAX_DIMENSION;
export const RUNWARE_EDIT_DIMENSION_STEP = RUNWARE_IMAGE_EDIT_DIMENSION_STEP;

export type ImageEditSourceMimeType =
  | "image/png"
  | "image/jpeg"
  | "image/webp";

export type ResolvedImageEditSource = Readonly<{
  sourceReference: ImageEditSourceReference;
  conversationId: string;
  bytes: Uint8Array;
  mimeType: ImageEditSourceMimeType;
  width: number;
  height: number;
  byteLength: number;
}>;

export type ImageEditSourceInspection = Readonly<{
  bytes: Uint8Array;
  mimeType: ImageEditSourceMimeType;
  width: number;
  height: number;
  byteLength: number;
}>;

export type ImageEditSourceValidationCode =
  | "unsupported_format"
  | "mime_mismatch"
  | "invalid_image"
  | "source_too_large"
  | "unsafe_dimensions"
  | "unsupported_dimensions";

export class ImageEditSourceValidationError extends Error {
  readonly code: ImageEditSourceValidationCode;

  constructor(code: ImageEditSourceValidationCode, message: string) {
    super(message);
    this.name = "ImageEditSourceValidationError";
    this.code = code;
  }
}

type ParsedImage = Readonly<{
  mimeType: ImageEditSourceMimeType;
  width: number;
  height: number;
}>;

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

const CRC32_TABLE = Array.from({ length: 256 }, (_, tableIndex) => {
  let value = tableIndex;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
  }
  return value >>> 0;
});

function fail(code: ImageEditSourceValidationCode, message: string): never {
  throw new ImageEditSourceValidationError(code, message);
}

function hasBytes(bytes: Uint8Array, offset: number, length: number): boolean {
  return (
    Number.isSafeInteger(offset) &&
    Number.isSafeInteger(length) &&
    offset >= 0 &&
    length >= 0 &&
    offset <= bytes.byteLength &&
    length <= bytes.byteLength - offset
  );
}

function readUint16Be(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 2)) {
    fail("invalid_image", "Image data is truncated.");
  }

  return bytes[offset] * 0x100 + bytes[offset + 1];
}

function readUint16Le(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 2)) {
    fail("invalid_image", "Image data is truncated.");
  }

  return bytes[offset] + bytes[offset + 1] * 0x100;
}

function readUint24Le(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 3)) {
    fail("invalid_image", "Image data is truncated.");
  }

  return bytes[offset] + bytes[offset + 1] * 0x100 + bytes[offset + 2] * 0x10000;
}

function readUint32Be(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 4)) {
    fail("invalid_image", "Image data is truncated.");
  }

  return (
    bytes[offset] * 0x1000000 +
    bytes[offset + 1] * 0x10000 +
    bytes[offset + 2] * 0x100 +
    bytes[offset + 3]
  );
}

function readUint32Le(bytes: Uint8Array, offset: number): number {
  if (!hasBytes(bytes, offset, 4)) {
    fail("invalid_image", "Image data is truncated.");
  }

  return (
    bytes[offset] +
    bytes[offset + 1] * 0x100 +
    bytes[offset + 2] * 0x10000 +
    bytes[offset + 3] * 0x1000000
  );
}

function hasAscii(bytes: Uint8Array, offset: number, value: string): boolean {
  if (!hasBytes(bytes, offset, value.length)) return false;

  return [...value].every((character, index) => bytes[offset + index] === character.charCodeAt(0));
}

function crc32(bytes: Uint8Array, offset: number, length: number): number {
  let crc = 0xffffffff;

  for (let index = 0; index < length; index += 1) {
    crc = (crc >>> 8) ^ CRC32_TABLE[(crc ^ bytes[offset + index]) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function enforceSourceDimensions(width: number, height: number): void {
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    fail("unsafe_dimensions", "Image dimensions are invalid.");
  }

  if (width > MAX_IMAGE_EDIT_SOURCE_AXIS || height > MAX_IMAGE_EDIT_SOURCE_AXIS) {
    fail("unsafe_dimensions", "Image dimensions are too large.");
  }

  if (width > Math.floor(MAX_IMAGE_EDIT_SOURCE_PIXELS / height)) {
    fail("unsafe_dimensions", "Image pixel dimensions are too large.");
  }
}

function parsePng(bytes: Uint8Array): ParsedImage {
  if (
    bytes.byteLength < PNG_SIGNATURE.length ||
    !PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    fail("invalid_image", "Image data is not a valid PNG.");
  }

  let offset = PNG_SIGNATURE.length;
  let sawIhdr = false;
  let sawIdat = false;
  let sawIend = false;
  let width = 0;
  let height = 0;

  while (offset < bytes.byteLength) {
    if (!hasBytes(bytes, offset, 12)) {
      fail("invalid_image", "PNG data is truncated.");
    }

    const chunkLength = readUint32Be(bytes, offset);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;

    if (!hasBytes(bytes, dataOffset, chunkLength + 4)) {
      fail("invalid_image", "PNG chunk data is truncated.");
    }

    const chunkEnd = dataOffset + chunkLength + 4;
    const chunkType = String.fromCharCode(
      bytes[typeOffset],
      bytes[typeOffset + 1],
      bytes[typeOffset + 2],
      bytes[typeOffset + 3],
    );
    if (!/^[A-Za-z]{4}$/.test(chunkType)) {
      fail("invalid_image", "PNG chunk type is invalid.");
    }

    const expectedCrc = readUint32Be(bytes, chunkEnd - 4);
    const actualCrc = crc32(bytes, typeOffset, chunkLength + 4);

    if (actualCrc !== expectedCrc) {
      fail("invalid_image", "PNG data is invalid.");
    }

    if (!sawIhdr && chunkType !== "IHDR") {
      fail("invalid_image", "PNG data has no valid header.");
    }

    if (chunkType === "IHDR") {
      if (sawIhdr || chunkLength !== 13) {
        fail("invalid_image", "PNG header is invalid.");
      }

      width = readUint32Be(bytes, dataOffset);
      height = readUint32Be(bytes, dataOffset + 4);
      const bitDepth = bytes[dataOffset + 8];
      const colorType = bytes[dataOffset + 9];
      const compressionMethod = bytes[dataOffset + 10];
      const filterMethod = bytes[dataOffset + 11];
      const interlaceMethod = bytes[dataOffset + 12];
      const validBitDepth =
        (colorType === 0 && [1, 2, 4, 8, 16].includes(bitDepth)) ||
        (colorType === 2 && [8, 16].includes(bitDepth)) ||
        (colorType === 3 && [1, 2, 4, 8].includes(bitDepth)) ||
        (colorType === 4 && [8, 16].includes(bitDepth)) ||
        (colorType === 6 && [8, 16].includes(bitDepth));

      if (
        !validBitDepth ||
        ![0, 2, 3, 4, 6].includes(colorType) ||
        compressionMethod !== 0 ||
        filterMethod !== 0 ||
        ![0, 1].includes(interlaceMethod)
      ) {
        fail("invalid_image", "PNG header is invalid.");
      }

      enforceSourceDimensions(width, height);
      sawIhdr = true;
    } else if (chunkType === "IDAT") {
      if (!sawIhdr || chunkLength === 0) {
        fail("invalid_image", "PNG image data is invalid.");
      }
      sawIdat = true;
    } else if (chunkType === "IEND") {
      if (chunkLength !== 0 || !sawIdat) {
        fail("invalid_image", "PNG end marker is invalid.");
      }

      sawIend = true;
      offset = chunkEnd;
      break;
    }

    offset = chunkEnd;
  }

  if (!sawIhdr || !sawIdat || !sawIend || offset !== bytes.byteLength) {
    fail("invalid_image", "PNG data is incomplete.");
  }

  return { mimeType: "image/png", width, height };
}

function isJpegSofMarker(marker: number): boolean {
  return (
    [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(
      marker,
    )
  );
}

function isJpegStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd9);
}

function parseJpeg(bytes: Uint8Array): ParsedImage {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    fail("invalid_image", "Image data is not a valid JPEG.");
  }

  let offset = 2;
  let width = 0;
  let height = 0;
  let sawSof = false;

  while (offset < bytes.byteLength) {
    if (bytes[offset] !== 0xff) {
      fail("invalid_image", "JPEG marker data is invalid.");
    }

    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset += 1;
    if (offset >= bytes.byteLength) {
      fail("invalid_image", "JPEG marker data is truncated.");
    }

    const marker = bytes[offset];
    offset += 1;

    if (marker === 0xd9 || marker === 0xda) {
      if (marker === 0xda && sawSof) {
        if (!hasBytes(bytes, offset, 2)) {
          fail("invalid_image", "JPEG scan marker is truncated.");
        }

        const scanLength = readUint16Be(bytes, offset);
        if (scanLength < 2 || !hasBytes(bytes, offset, scanLength)) {
          fail("invalid_image", "JPEG scan marker is invalid.");
        }

        const terminalEoi = bytes.byteLength - 2;
        if (terminalEoi <= offset + scanLength || bytes[terminalEoi] !== 0xff || bytes[terminalEoi + 1] !== 0xd9) {
          fail("invalid_image", "JPEG image data is incomplete.");
        }

        return { mimeType: "image/jpeg", width, height };
      }

      fail("invalid_image", "JPEG image data is incomplete.");
    }

    if (isJpegStandaloneMarker(marker)) {
      continue;
    }

    if (!hasBytes(bytes, offset, 2)) {
      fail("invalid_image", "JPEG segment is truncated.");
    }

    const segmentLength = readUint16Be(bytes, offset);
    if (segmentLength < 2 || !hasBytes(bytes, offset, segmentLength)) {
      fail("invalid_image", "JPEG segment is invalid.");
    }

    if (isJpegSofMarker(marker)) {
      if (sawSof || segmentLength < 8) {
        fail("invalid_image", "JPEG frame header is invalid.");
      }

      height = readUint16Be(bytes, offset + 3);
      width = readUint16Be(bytes, offset + 5);
      enforceSourceDimensions(width, height);
      sawSof = true;
    }

    offset += segmentLength;
  }

  fail("invalid_image", sawSof ? "JPEG image data is incomplete." : "JPEG has no usable frame header.");
}

function parseWebp(bytes: Uint8Array): ParsedImage {
  if (bytes.byteLength < 20 || !hasAscii(bytes, 0, "RIFF") || !hasAscii(bytes, 8, "WEBP")) {
    fail("invalid_image", "Image data is not a valid WebP.");
  }

  const riffSize = readUint32Le(bytes, 4);
  if (riffSize < 4 || riffSize + 8 !== bytes.byteLength) {
    fail("invalid_image", "WebP RIFF framing is invalid.");
  }

  let offset = 12;
  let width = 0;
  let height = 0;
  let sawImageChunk = false;
  let sawExtendedHeader = false;
  let extendedWidth = 0;
  let extendedHeight = 0;

  while (offset < bytes.byteLength) {
    if (!hasBytes(bytes, offset, 8)) {
      fail("invalid_image", "WebP chunk header is truncated.");
    }

    const chunkType = String.fromCharCode(
      bytes[offset],
      bytes[offset + 1],
      bytes[offset + 2],
      bytes[offset + 3],
    );
    const chunkLength = readUint32Le(bytes, offset + 4);
    const dataOffset = offset + 8;
    const paddedLength = chunkLength + (chunkLength % 2);

    if (!hasBytes(bytes, dataOffset, paddedLength)) {
      fail("invalid_image", "WebP chunk data is truncated.");
    }

    if (chunkLength % 2 === 1 && bytes[dataOffset + chunkLength] !== 0) {
      fail("invalid_image", "WebP chunk padding is invalid.");
    }

    if (chunkType === "VP8 ") {
      if (chunkLength < 10 || !hasBytes(bytes, dataOffset, 10)) {
        fail("invalid_image", "WebP VP8 data is invalid.");
      }

      if (
        bytes[dataOffset + 3] !== 0x9d ||
        bytes[dataOffset + 4] !== 0x01 ||
        bytes[dataOffset + 5] !== 0x2a
      ) {
        fail("invalid_image", "WebP VP8 frame data is invalid.");
      }

      const frameWidth = readUint16Le(bytes, dataOffset + 6) & 0x3fff;
      const frameHeight = readUint16Le(bytes, dataOffset + 8) & 0x3fff;
      if (sawExtendedHeader && (frameWidth !== extendedWidth || frameHeight !== extendedHeight)) {
        fail("invalid_image", "WebP frame dimensions do not match the extended header.");
      }
      width = frameWidth;
      height = frameHeight;
      sawImageChunk = true;
    } else if (chunkType === "VP8L") {
      if (chunkLength < 5 || bytes[dataOffset] !== 0x2f) {
        fail("invalid_image", "WebP VP8L data is invalid.");
      }

      const widthMinusOne =
        bytes[dataOffset + 1] | ((bytes[dataOffset + 2] & 0x3f) << 8);
      const heightMinusOne =
        ((bytes[dataOffset + 2] >> 6) |
          (bytes[dataOffset + 3] << 2) |
          ((bytes[dataOffset + 4] & 0x3f) << 10));
      const frameWidth = widthMinusOne + 1;
      const frameHeight = heightMinusOne + 1;
      if (sawExtendedHeader && (frameWidth !== extendedWidth || frameHeight !== extendedHeight)) {
        fail("invalid_image", "WebP frame dimensions do not match the extended header.");
      }
      width = frameWidth;
      height = frameHeight;
      sawImageChunk = true;
    } else if (chunkType === "VP8X") {
      if (chunkLength < 10) {
        fail("invalid_image", "WebP VP8X data is invalid.");
      }

      if (bytes[dataOffset + 1] !== 0 || bytes[dataOffset + 2] !== 0 || bytes[dataOffset + 3] !== 0) {
        fail("invalid_image", "WebP VP8X reserved fields are invalid.");
      }

      extendedWidth = readUint24Le(bytes, dataOffset + 4) + 1;
      extendedHeight = readUint24Le(bytes, dataOffset + 7) + 1;
      if (sawImageChunk && (width !== extendedWidth || height !== extendedHeight)) {
        fail("invalid_image", "WebP frame dimensions do not match the extended header.");
      }
      width = extendedWidth;
      height = extendedHeight;
      sawExtendedHeader = true;
    }

    offset += 8 + paddedLength;
  }

  if (!sawImageChunk || !width || !height) {
    fail("invalid_image", "WebP has no usable image frame.");
  }

  enforceSourceDimensions(width, height);
  return { mimeType: "image/webp", width, height };
}

function detectMimeType(bytes: Uint8Array): ImageEditSourceMimeType | null {
  if (
    bytes.byteLength >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((value, index) => bytes[index] === value)
  ) {
    return "image/png";
  }

  if (bytes.byteLength >= 2 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    return "image/jpeg";
  }

  if (bytes.byteLength >= 12 && hasAscii(bytes, 0, "RIFF") && hasAscii(bytes, 8, "WEBP")) {
    return "image/webp";
  }

  return null;
}

function normalizeDeclaredMimeType(value: unknown): ImageEditSourceMimeType | null {
  if (typeof value !== "string") return null;

  const normalized = value.split(";", 1)[0]?.trim().toLowerCase();
  return normalized === "image/png" || normalized === "image/jpeg" || normalized === "image/webp"
    ? normalized
    : null;
}

function parseImage(bytes: Uint8Array, mimeType: ImageEditSourceMimeType): ParsedImage {
  switch (mimeType) {
    case "image/png":
      return parsePng(bytes);
    case "image/jpeg":
      return parseJpeg(bytes);
    case "image/webp":
      return parseWebp(bytes);
  }
}

export async function inspectImageEditSource(input: {
  bytes: Uint8Array;
  declaredMimeType?: string | null;
}): Promise<ImageEditSourceInspection> {
  if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0) {
    fail("invalid_image", "Image source is empty.");
  }

  if (input.bytes.byteLength > MAX_IMAGE_EDIT_SOURCE_BYTES) {
    fail("source_too_large", "Image source is too large.");
  }

  const bytes = new Uint8Array(input.bytes);
  const detectedMimeType = detectMimeType(bytes);
  if (!detectedMimeType) {
    fail("unsupported_format", "Image source format is not supported.");
  }

  const hasDeclaredMimeType =
    input.declaredMimeType !== undefined && input.declaredMimeType !== null;
  const declaredMimeType = hasDeclaredMimeType
    ? normalizeDeclaredMimeType(input.declaredMimeType)
    : null;

  if (hasDeclaredMimeType && !declaredMimeType) {
    fail("unsupported_format", "Image source format is not supported.");
  }

  if (declaredMimeType && declaredMimeType !== detectedMimeType) {
    fail("mime_mismatch", "Declared image MIME type does not match the image bytes.");
  }

  const parsed = parseImage(bytes, detectedMimeType);

  let decoded: { width: number; height: number };
  try {
    const image = await loadImage(Buffer.from(bytes));
    decoded = { width: image.width, height: image.height };
  } catch {
    fail("invalid_image", "Image source could not be decoded.");
  }

  if (
    !Number.isFinite(decoded.width) ||
    !Number.isFinite(decoded.height) ||
    decoded.width !== parsed.width ||
    decoded.height !== parsed.height
  ) {
    fail("invalid_image", "Image dimensions could not be verified.");
  }

  enforceSourceDimensions(decoded.width, decoded.height);

  return {
    bytes,
    mimeType: parsed.mimeType,
    width: parsed.width,
    height: parsed.height,
    byteLength: bytes.byteLength,
  };
}

function roundRunwareDimension(value: number): number {
  const rounded = Math.round(value / RUNWARE_EDIT_DIMENSION_STEP) * RUNWARE_EDIT_DIMENSION_STEP;
  return Math.min(
    MAX_RUNWARE_EDIT_DIMENSION,
    Math.max(MIN_RUNWARE_EDIT_DIMENSION, rounded),
  );
}

export function normalizeImageEditDimensions(input: {
  width: number;
  height: number;
}): { width: number; height: number } {
  const { width, height } = input;

  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0
  ) {
    fail("unsafe_dimensions", "Image dimensions are invalid.");
  }

  const minimumScale = Math.max(
    MIN_RUNWARE_EDIT_DIMENSION / width,
    MIN_RUNWARE_EDIT_DIMENSION / height,
  );
  const maximumScale = Math.min(
    MAX_RUNWARE_EDIT_DIMENSION / width,
    MAX_RUNWARE_EDIT_DIMENSION / height,
  );

  if (!Number.isFinite(minimumScale) || !Number.isFinite(maximumScale) || minimumScale > maximumScale) {
    fail("unsupported_dimensions", "Image dimensions cannot be normalized safely.");
  }

  const scale = Math.max(minimumScale, Math.min(1, maximumScale));
  const normalizedWidth = roundRunwareDimension(width * scale);
  const normalizedHeight = roundRunwareDimension(height * scale);

  if (
    normalizedWidth < MIN_RUNWARE_EDIT_DIMENSION ||
    normalizedHeight < MIN_RUNWARE_EDIT_DIMENSION ||
    normalizedWidth > MAX_RUNWARE_EDIT_DIMENSION ||
    normalizedHeight > MAX_RUNWARE_EDIT_DIMENSION ||
    normalizedWidth % RUNWARE_EDIT_DIMENSION_STEP !== 0 ||
    normalizedHeight % RUNWARE_EDIT_DIMENSION_STEP !== 0
  ) {
    fail("unsupported_dimensions", "Image dimensions cannot be normalized safely.");
  }

  return { width: normalizedWidth, height: normalizedHeight };
}
