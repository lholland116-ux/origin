import { OfficeParser, type OfficeContentNode } from "officeparser";
import { MAX_EXTRACTED_TEXT_LENGTH } from "@/lib/documents/extract-limits";

export const PPTX_MAX_UNCOMPRESSED_BYTES = 50 * 1024 * 1024;
export const PPTX_MAX_ZIP_ENTRIES = 1_000;
export const PPTX_PARSE_TIMEOUT_MS = 10_000;

export type ExtractedPresentationTable = {
  rows: string[][];
};

export type ExtractedPresentationSlide = {
  slideNumber: number;
  title?: string;
  text: string[];
  tables?: ExtractedPresentationTable[];
  notes?: string[];
};

export type ExtractedPresentation = {
  slides: ExtractedPresentationSlide[];
};

type PptxExtractionOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

function nodeText(node: OfficeContentNode): string {
  if (typeof node.text === "string" && node.text.trim()) {
    return node.text;
  }

  return (node.children ?? [])
    .map((child) => nodeText(child))
    .filter(Boolean)
    .join(" ");
}

function tableFromNode(node: OfficeContentNode): ExtractedPresentationTable {
  return {
    rows: (node.children ?? []).map((row) =>
      (row.children ?? []).map((cell) => nodeText(cell)),
    ),
  };
}

function normalizeText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function truncateText(input: string): string {
  const marker = "[Truncated due to size limit]";
  if (input.length <= MAX_EXTRACTED_TEXT_LENGTH) {
    return input;
  }

  return (
    input.slice(0, MAX_EXTRACTED_TEXT_LENGTH - marker.length - 2) +
    "\n\n" +
    marker
  );
}

function buildParseSignal(options: PptxExtractionOptions): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? PPTX_PARSE_TIMEOUT_MS;
  const timeoutId = setTimeout(
    () => controller.abort(),
    Math.max(0, timeoutMs),
  );
  const onAbort = () => controller.abort();

  if (options.signal?.aborted) {
    controller.abort();
  }

  options.signal?.addEventListener("abort", onAbort, { once: true });

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timeoutId);
      options.signal?.removeEventListener("abort", onAbort);
    },
  };
}

function readArchiveEntryNames(buffer: Buffer): string[] {
  const eocdSignature = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocdOffset = buffer.lastIndexOf(eocdSignature);

  if (eocdOffset < 0 || eocdOffset + 22 > buffer.length) {
    return [];
  }

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectorySize = buffer.readUInt32LE(eocdOffset + 12);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const centralDirectoryEnd = centralDirectoryOffset + centralDirectorySize;

  if (centralDirectoryEnd > buffer.length) {
    throw new Error("Invalid PPTX central directory.");
  }

  const names: string[] = [];
  const seen = new Set<string>();
  let cursor = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (
      cursor + 46 > centralDirectoryEnd ||
      buffer.readUInt32LE(cursor) !== 0x02014b50
    ) {
      throw new Error("Invalid PPTX central directory entry.");
    }

    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const nameStart = cursor + 46;
    const nameEnd = nameStart + nameLength;
    const name = buffer.subarray(nameStart, nameEnd).toString("utf8");

    if (
      name.startsWith("/") ||
      name.includes("\\") ||
      name.split("/").includes("..")
    ) {
      throw new Error("Unsafe PPTX archive path.");
    }

    if (
      /^ppt\/(?:embeddings|activeX)\/.+/i.test(name) ||
      name.toLowerCase().endsWith("vbaproject.bin")    ) {
      throw new Error("Unsupported embedded PPTX content.");
    }

    if (seen.has(name)) {
      throw new Error("Duplicate PPTX archive path.");
    }

    seen.add(name);
    names.push(name);
    cursor = nameEnd + extraLength + commentLength;
  }

  return names;
}

function slideNumbersFromArchive(buffer: Buffer): number[] {
  return readArchiveEntryNames(buffer)
    .map((name) => name.match(/^ppt\/slides\/slide(\d+)\.xml$/))
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => Number(match[1]))
    .sort((left, right) => left - right);
}


export async function parsePptx(
  buffer: Buffer,
  options: PptxExtractionOptions = {},
) {
  const parseSignal = buildParseSignal(options);

  try {
    readArchiveEntryNames(buffer);
    const ast = await OfficeParser.parseOffice(buffer, {
      extractAttachments: false,
      ocr: false,
      ignoreComments: true,
      ignoreSlideMasters: true,
      ignoreNotes: false,
      includeRawContent: false,
      decompressionLimits: {
        maxUncompressedBytes: PPTX_MAX_UNCOMPRESSED_BYTES,
        maxZipEntries: PPTX_MAX_ZIP_ENTRIES,
      },
      abortSignal: parseSignal.signal,
    });

    if (ast.type !== "pptx") {
      throw new Error("Unsupported or invalid PowerPoint presentation.");
    }

    return ast;
  } finally {
    parseSignal.dispose();
  }
}

export async function extractPptxPresentation(
  buffer: Buffer,
  options: PptxExtractionOptions = {},
): Promise<ExtractedPresentation> {
  const ast = await parsePptx(buffer, options);
  const parsedSlides = ast.content
    .filter((node) => node.type === "slide")
    .sort(
      (left, right) =>
        (left.metadata?.slideNumber ?? 0) -
        (right.metadata?.slideNumber ?? 0),
    );
  const slidesByNumber = new Map(
    parsedSlides.map((slide) => [slide.metadata?.slideNumber ?? 0, slide]),
  );
  const slides = slideNumbersFromArchive(buffer).map(
    (slideNumber) =>
      slidesByNumber.get(slideNumber) ?? {
        type: "slide" as const,
        metadata: { slideNumber },
        children: [],
      },
  );

  return {
    slides: slides.map((slide) => {
      const children = slide.children ?? [];
      const heading = children.find(
        (node) => node.type === "heading" && nodeText(node),
      );
      const tables = children
        .filter((node) => node.type === "table")
        .map(tableFromNode);
      const text = children
        .filter((node) => node !== heading && node.type !== "table")
        .map(nodeText)
        .map(normalizeText)
        .filter(Boolean);
      const notes = (slide.notes ?? [])
        .map(nodeText)
        .map(normalizeText)
        .filter(Boolean);

      return {
        slideNumber: slide.metadata?.slideNumber ?? 0,
        ...(heading ? { title: normalizeText(nodeText(heading)) } : {}),
        ...(tables.length ? { tables } : {}),
        ...(text.length ? { text } : { text: [] }),
        ...(notes.length ? { notes } : {}),
      };
    }),
  };
}

export function normalizeExtractedPresentation(
  presentation: ExtractedPresentation,
): string {
  const sections = presentation.slides.map((slide) => {
    const lines = ["[Slide " + slide.slideNumber + "]"];

    if (slide.title) {
      lines.push("Title: " + slide.title);
    }

    lines.push(...slide.text);

    for (const table of slide.tables ?? []) {
      lines.push("Table:");
      lines.push(...table.rows.map((row) => row.join(" | ")));
    }

    if (slide.notes?.length) {
      lines.push("Notes:");
      lines.push(...slide.notes);
    }

    return lines.join("\n");
  });

  return truncateText(normalizeText(sections.join("\n\n")));
}

export async function extractPptxText(
  buffer: Buffer,
  options: PptxExtractionOptions = {},
): Promise<string> {
  return normalizeExtractedPresentation(
    await extractPptxPresentation(buffer, options),
  );
}
