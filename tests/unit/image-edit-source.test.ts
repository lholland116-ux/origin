import { beforeEach, describe, expect, it, vi } from "vitest";

const { actualLoadImageRef, loadImageMock } = vi.hoisted(() => ({
  loadImageMock: vi.fn(),
  actualLoadImageRef: {
    current: null as typeof import("@napi-rs/canvas").loadImage | null,
  },
}));

vi.mock("@napi-rs/canvas", async () => {
  const actual = await vi.importActual<typeof import("@napi-rs/canvas")>("@napi-rs/canvas");
  actualLoadImageRef.current = actual.loadImage;
  return { ...actual, loadImage: loadImageMock };
});

beforeEach(() => {
  loadImageMock.mockImplementation((source, options) => actualLoadImageRef.current?.(source, options));
});

import {
  ImageEditSourceValidationError,
  MAX_IMAGE_EDIT_SOURCE_AXIS,
  MAX_IMAGE_EDIT_SOURCE_BYTES,
  MAX_IMAGE_EDIT_SOURCE_PIXELS,
  inspectImageEditSource,
  normalizeImageEditDimensions,
} from "@/lib/image-generation/image-edit-source";

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAABHNCSVQICAgIfAhkiAAAAAFzUkdCAK7OHOkAAAARSURBVAiZYzROm/mfgYGBAQANBQIz+/EjQQAAAABJRU5ErkJggg==";
const JPEG_BASE64 =
  "/9j/4AAQSkZJRgABAQAAAQABAAD/4gHYSUNDX1BST0ZJTEUAAQEAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiWFlaAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADb/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAIDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAB//EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AJEAWxe//9k=";
const WEBP_BASE64 =
  "UklGRh4CAABXRUJQVlA4WAoAAAAgAAAAAQAAAAAASUNDUMgBAAAAAAHIAAAAAAQwAABtbnRyUkdCIFhZWiAH4AABAAEAAAAAAABhY3NwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAA9tYAAQAAAADTLQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAlkZXNjAAAA8AAAACRyWFlaAAABFAAAABRnWFlaAAABKAAAABRiV2FZAAABPAAAABR3dHB0AAABUAAAABRyVFJDAAABZAAAAChnVFJDAAABZAAAAChiVFJDAAABZAAAAChjcHJ0AAABjAAAADxtbHVjAAAAAAAAAAEAAAAMZW5VUwAAAAgAAAAcAHMAUgBHAEJYWVogAAAAAAAAb6IAADj1AAADkFhZWiAAAAAAAABimQAAt4UAABjaWFlaIAAAAAAAACSgAAAPhAAAts9YWVogAAAAAAAA9tYAAQAAAADTLXBhcmEAAAAAAAQAAAACZmYAAPKnAAANWQAAE9AAAApbAAAAAAAAAABtbHVjAAAAAAAAAAEAAAAMZW5VUwAAACAAAAAcAEcAbwBvAGcAbABlACAASQBuAGMALgAgADIAMAAxADZWUDggMAAAABACAJ0BKgIAAQAAgA4loAJ0ugH4AfgAA8gA/vgjb/9tDFPiD9k3/69EHiDfqaAAAA==";
const VP8L_BASE64 = "UklGRhwAAABXRUJQVlA4TA8AAAAvAQAAAAcQ/Y/+ByKi/wEA";

function bytes(base64: string): Uint8Array {
  return new Uint8Array(Buffer.from(base64, "base64"));
}

function pngWithDimensions(width: number, height: number): Uint8Array {
  const result = bytes(PNG_BASE64);
  const view = new DataView(result.buffer);
  view.setUint32(16, width, false);
  view.setUint32(20, height, false);
  view.setUint32(29, crc32(result.slice(12, 29)), false);
  return result;
}

function firstJpegMarker(bytesValue: Uint8Array, marker: number): number {
  for (let index = 2; index < bytesValue.length; index += 1) {
    if (bytesValue[index - 1] === 0xff && bytesValue[index] === marker) {
      return index;
    }
  }

  return -1;
}

function firstWebpChunk(bytesValue: Uint8Array, wantedType: string): Uint8Array {
  const view = new DataView(bytesValue.buffer);
  let offset = 12;

  while (offset < bytesValue.length) {
    const chunkLength = view.getUint32(offset + 4, true);
    const chunkSize = 8 + chunkLength + (chunkLength % 2);
    const chunkType = String.fromCharCode(
      bytesValue[offset],
      bytesValue[offset + 1],
      bytesValue[offset + 2],
      bytesValue[offset + 3],
    );

    if (chunkType === wantedType) {
      return bytesValue.slice(offset, offset + chunkSize);
    }

    offset += chunkSize;
  }

  throw new Error(`Missing WebP chunk: ${wantedType}`);
}

function webpVp8WithDimensions(width: number, height: number): Uint8Array {
  const vp8Chunk = firstWebpChunk(bytes(WEBP_BASE64), "VP8 ");
  const result = new Uint8Array(12 + vp8Chunk.length);
  result.set(new TextEncoder().encode("RIFF"), 0);
  result.set(new TextEncoder().encode("WEBP"), 8);
  result.set(vp8Chunk, 12);

  const view = new DataView(result.buffer);
  view.setUint32(4, result.byteLength - 8, true);
  view.setUint16(12 + 8 + 6, width & 0x3fff, true);
  view.setUint16(12 + 8 + 8, height & 0x3fff, true);
  return result;
}

function pngWithCorruptedIdat(): Uint8Array {
  const result = bytes(PNG_BASE64);
  const view = new DataView(result.buffer);
  let offset = 8;

  while (offset < result.byteLength) {
    const chunkLength = view.getUint32(offset, false);
    const typeOffset = offset + 4;
    const dataOffset = offset + 8;
    const chunkEnd = dataOffset + chunkLength + 4;
    const chunkType = String.fromCharCode(
      result[typeOffset],
      result[typeOffset + 1],
      result[typeOffset + 2],
      result[typeOffset + 3],
    );

    if (chunkType === "IDAT") {
      result[dataOffset] ^= 0xff;
      view.setUint32(
        chunkEnd - 4,
        crc32(result.slice(typeOffset, dataOffset + chunkLength)),
        false,
      );
      return result;
    }

    offset = chunkEnd;
  }

  throw new Error("Missing PNG IDAT chunk");
}

function crc32(value: Uint8Array): number {
  const table = Array.from({ length: 256 }, (_, tableIndex) => {
    let tableValue = tableIndex;
    for (let bit = 0; bit < 8; bit += 1) {
      tableValue = (tableValue >>> 1) ^ (tableValue & 1 ? 0xedb88320 : 0);
    }
    return tableValue >>> 0;
  });
  let crc = 0xffffffff;

  for (const byte of value) {
    crc = (crc >>> 8) ^ table[(crc ^ byte) & 0xff];
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function expectSourceError(promise: Promise<unknown>, code: ImageEditSourceValidationError["code"]) {
  return expect(promise).rejects.toMatchObject({
    name: "ImageEditSourceValidationError",
    code,
  });
}

describe("image-edit source inspection", () => {
  it.each([
    ["image/png", PNG_BASE64, 2, 1],
    ["image/jpeg", JPEG_BASE64, 2, 1],
    ["image/webp", WEBP_BASE64, 2, 1],
  ])("accepts a genuinely decodable %s source", async (mimeType, base64, width, height) => {
    await expect(
      inspectImageEditSource({ bytes: bytes(base64), declaredMimeType: mimeType }),
    ).resolves.toMatchObject({ mimeType, width, height });
  });

  it("accepts MIME parameters while matching the actual format", async () => {
    await expect(
      inspectImageEditSource({
        bytes: bytes(PNG_BASE64),
        declaredMimeType: "image/png; charset=binary",
      }),
    ).resolves.toMatchObject({ mimeType: "image/png" });
  });

  it.each([
    ["image/png", PNG_BASE64],
    ["image/jpeg", JPEG_BASE64],
    ["image/webp", WEBP_BASE64],
  ])("detects a valid %s source without a declared MIME type", async (_mimeType, base64) => {
    await expect(
      inspectImageEditSource({ bytes: bytes(base64) }),
    ).resolves.toMatchObject({ mimeType: _mimeType });
  });

  it("rejects unsupported bytes without a declared MIME type", async () => {
    await expectSourceError(
      inspectImageEditSource({ bytes: new Uint8Array([1, 2, 3]) }),
      "unsupported_format",
    );
  });

  it("does not treat an empty declared MIME string as absent", async () => {
    await expectSourceError(
      inspectImageEditSource({ bytes: bytes(PNG_BASE64), declaredMimeType: "" }),
      "unsupported_format",
    );
  });

  it("accepts a genuine VP8L WebP fixture after independently verifying its image chunk", async () => {
    const vp8l = bytes(VP8L_BASE64);
    expect(firstWebpChunk(vp8l, "VP8L").slice(0, 4)).toEqual(
      new TextEncoder().encode("VP8L"),
    );

    await expect(
      inspectImageEditSource({ bytes: vp8l, declaredMimeType: "image/webp" }),
    ).resolves.toMatchObject({ mimeType: "image/webp", width: 2, height: 1 });
  });

  it("rejects empty, unsupported, and MIME-spoofed sources", async () => {
    await expectSourceError(
      inspectImageEditSource({ bytes: new Uint8Array(), declaredMimeType: "image/png" }),
      "invalid_image",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: new Uint8Array([1, 2, 3]), declaredMimeType: "image/gif" }),
      "unsupported_format",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: bytes(PNG_BASE64), declaredMimeType: "image/jpeg" }),
      "mime_mismatch",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: bytes(JPEG_BASE64), declaredMimeType: "image/webp" }),
      "mime_mismatch",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: bytes(WEBP_BASE64), declaredMimeType: "image/png" }),
      "mime_mismatch",
    );
  });

  it("rejects malformed, truncated, and structurally undecodable images", async () => {
    const png = bytes(PNG_BASE64);
    const truncatedPng = png.slice(0, -1);
    const badPng = new Uint8Array(png);
    badPng[0] = 0;
    const jpeg = bytes(JPEG_BASE64);
    const truncatedJpeg = jpeg.slice(0, -2);
    const badJpegSignature = jpeg.slice();
    badJpegSignature[1] = 0;
    const malformedJpegMarker = jpeg.slice();
    malformedJpegMarker[2] = 0;
    const malformedJpegSegment = jpeg.slice();
    malformedJpegSegment[4] = 0;
    malformedJpegSegment[5] = 1;

    await expectSourceError(
      inspectImageEditSource({ bytes: truncatedPng, declaredMimeType: "image/png" }),
      "invalid_image",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: badPng, declaredMimeType: "image/png" }),
      "unsupported_format",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: truncatedJpeg, declaredMimeType: "image/jpeg" }),
      "invalid_image",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: badJpegSignature, declaredMimeType: "image/jpeg" }),
      "unsupported_format",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: malformedJpegMarker, declaredMimeType: "image/jpeg" }),
      "invalid_image",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: malformedJpegSegment, declaredMimeType: "image/jpeg" }),
      "invalid_image",
    );
    const noSofJpeg = jpeg.slice();
    const sofMarker = firstJpegMarker(noSofJpeg, 0xc0);
    expect(sofMarker).toBeGreaterThan(0);
    noSofJpeg[sofMarker] = 0xe0;
    await expectSourceError(
      inspectImageEditSource({ bytes: noSofJpeg, declaredMimeType: "image/jpeg" }),
      "invalid_image",
    );
  });

  it("maps a structurally valid but decoder-rejected PNG to invalid_image", async () => {
    const undecodablePng = pngWithCorruptedIdat();
    expect(undecodablePng.slice(0, 8)).toEqual(bytes(PNG_BASE64).slice(0, 8));
    expect(undecodablePng.slice(-8, -4)).toEqual(new TextEncoder().encode("IEND"));

    loadImageMock.mockClear();
    loadImageMock.mockRejectedValueOnce(new Error("decoder internals are not exposed"));

    await expectSourceError(
      inspectImageEditSource({ bytes: undecodablePng, declaredMimeType: "image/png" }),
      "invalid_image",
    );
    expect(loadImageMock).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed WebP RIFF and chunk framing", async () => {
    const badRiff = bytes(WEBP_BASE64);
    badRiff[0] = 0;
    const badChunk = bytes(WEBP_BASE64);
    new DataView(badChunk.buffer).setUint32(16, 0xffffffff, true);

    await expectSourceError(
      inspectImageEditSource({ bytes: badRiff, declaredMimeType: "image/webp" }),
      "unsupported_format",
    );
    await expectSourceError(
      inspectImageEditSource({ bytes: badChunk, declaredMimeType: "image/webp" }),
      "invalid_image",
    );
  });

  const webpDimensionCases: ReadonlyArray<
    [number, number, ImageEditSourceValidationError["code"]]
  > = [
    [0, 1, "invalid_image"],
    [MAX_IMAGE_EDIT_SOURCE_AXIS + 1, 1, "unsafe_dimensions"],
    [4097, 4097, "unsafe_dimensions"],
  ];

  it.each(webpDimensionCases)("rejects WebP dimensions %s x %s with %s", async (width, height, code) => {
    await expectSourceError(
      inspectImageEditSource({
        bytes: webpVp8WithDimensions(width, height),
        declaredMimeType: "image/webp",
      }),
      code,
    );
  });

  it("accepts a source exactly at the byte limit and rejects one byte over", async () => {
    const source = bytes(PNG_BASE64);
    const paddingSize = MAX_IMAGE_EDIT_SOURCE_BYTES - source.byteLength - 12;
    const padded = new Uint8Array(MAX_IMAGE_EDIT_SOURCE_BYTES);
    padded.set(source.slice(0, -12));

    const iend = source.slice(-12);
    const dataOffset = source.length - 12;
    const paddingOffset = dataOffset;
    const paddingLength = paddingSize;
    const view = new DataView(padded.buffer);
    view.setUint32(paddingOffset, paddingLength, false);
    padded.set([0x74, 0x45, 0x58, 0x74], paddingOffset + 4);
    padded.fill(0x61, paddingOffset + 8, paddingOffset + 8 + paddingLength);
    const paddingChunkEnd = paddingOffset + 8 + paddingLength;
    padded.set(new TextEncoder().encode("padding\0"), paddingOffset + 8);
    padded.fill(0x61, paddingOffset + 16, paddingOffset + 8 + paddingLength);
    view.setUint32(
      paddingChunkEnd,
      crc32(padded.slice(paddingOffset + 4, paddingChunkEnd)),
      false,
    );
    padded.set(iend, paddingChunkEnd + 4);

    await expect(
      inspectImageEditSource({ bytes: padded, declaredMimeType: "image/png" }),
    ).resolves.toMatchObject({ byteLength: MAX_IMAGE_EDIT_SOURCE_BYTES });

    const oversized = new Uint8Array(MAX_IMAGE_EDIT_SOURCE_BYTES + 1);
    oversized.set(padded);
    await expectSourceError(
      inspectImageEditSource({ bytes: oversized, declaredMimeType: "image/png" }),
      "source_too_large",
    );
  });

  it("defensively copies source bytes in both directions", async () => {
    const original = bytes(PNG_BASE64);
    const inspected = await inspectImageEditSource({
      bytes: original,
      declaredMimeType: "image/png",
    });
    const inspectedSnapshot = inspected.bytes.slice();

    expect(inspected.bytes).not.toBe(original);
    original[0] ^= 0xff;
    expect(inspected.bytes).toEqual(inspectedSnapshot);

    const secondOriginal = bytes(PNG_BASE64);
    const secondOriginalSnapshot = secondOriginal.slice();
    const secondInspected = await inspectImageEditSource({
      bytes: secondOriginal,
      declaredMimeType: "image/png",
    });

    expect(secondInspected.bytes).not.toBe(secondOriginal);
    secondInspected.bytes[0] ^= 0xff;
    expect(secondOriginal).toEqual(secondOriginalSnapshot);
  });

  it.each([
    [MAX_IMAGE_EDIT_SOURCE_AXIS + 1, 1],
    [4097, 4097],
  ])("rejects unsafe parsed source dimensions %s x %s", async (width, height) => {
    await expectSourceError(
      inspectImageEditSource({
        bytes: pngWithDimensions(width, height),
        declaredMimeType: "image/png",
      }),
      "unsafe_dimensions",
    );
  });

  it("rejects a JPEG source with an unsafe parsed frame", async () => {
    const unsafe = bytes(JPEG_BASE64);
    const sofMarker = firstJpegMarker(unsafe, 0xc0);
    expect(sofMarker).toBeGreaterThan(0);
    const view = new DataView(unsafe.buffer);
    view.setUint16(sofMarker + 4, 5000, false);
    view.setUint16(sofMarker + 6, 5000, false);

    await expectSourceError(
      inspectImageEditSource({ bytes: unsafe, declaredMimeType: "image/jpeg" }),
      "unsafe_dimensions",
    );
  });
});

describe("image-edit source dimension safety", () => {
  it.each([
    [[1024, 1024], [1024, 1024]],
    [[1920, 1080], [1920, 1088]],
    [[1080, 1920], [1088, 1920]],
    [[4032, 3024], [2048, 1536]],
    [[640, 480], [640, 480]],
    [[320, 240], [320, 240]],
    [[100, 100], [128, 128]],
    [[5000, 500], [2048, 208]],
  ])("normalizes %sx%s deterministically", ([width, height], expected) => {
    const first = normalizeImageEditDimensions({ width, height });
    const second = normalizeImageEditDimensions({ width, height });

    expect(first).toEqual({ width: expected[0], height: expected[1] });
    expect(second).toEqual(first);
    expect(first.width % 16).toBe(0);
    expect(first.height % 16).toBe(0);
    expect(first.width).toBeGreaterThanOrEqual(128);
    expect(first.height).toBeGreaterThanOrEqual(128);
    expect(first.width).toBeLessThanOrEqual(2048);
    expect(first.height).toBeLessThanOrEqual(2048);
  });

  it.each([
    [0, 100],
    [-1, 100],
    [100, 0],
    [100, -1],
  ])("rejects invalid dimensions %s x %s", (width, height) => {
    expect(() => normalizeImageEditDimensions({ width, height })).toThrowError(
      ImageEditSourceValidationError,
    );
  });

  it("rejects an aspect ratio that cannot satisfy both provider bounds", () => {
    expect(() => normalizeImageEditDimensions({ width: 8192, height: 1 })).toThrowError(
      ImageEditSourceValidationError,
    );
  });

  it("documents the source safety boundaries", () => {
    expect(MAX_IMAGE_EDIT_SOURCE_BYTES).toBe(8 * 1024 * 1024);
    expect(MAX_IMAGE_EDIT_SOURCE_AXIS).toBe(8192);
    expect(MAX_IMAGE_EDIT_SOURCE_PIXELS).toBe(16_777_216);
  });
});
