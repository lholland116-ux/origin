import { deflateRawSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  extractPptxPresentation,
  extractPptxText,
  parsePptx,
  PPTX_MAX_UNCOMPRESSED_BYTES,
  PPTX_MAX_ZIP_ENTRIES,
  PPTX_PARSE_TIMEOUT_MS,
} from "@/lib/documents/extract-pptx";
import { validateFiles } from "@/lib/documents/validate-upload";
import { DOCUMENT_LIMITS } from "@/lib/documents/config";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

type ZipEntry = {
  name: string;
  content: string | Buffer;
};

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;

  for (const byte of buffer) {
    crc ^= byte;

    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }

  return (crc ^ 0xffffffff) >>> 0;
}

function makeZip(entries: ZipEntry[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const content = Buffer.isBuffer(entry.content)
      ? entry.content
      : Buffer.from(entry.content, "utf8");
    const compressed = deflateRawSync(content);
    const checksum = crc32(content);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(compressed.length, 18);
    local.writeUInt32LE(content.length, 22);
    local.writeUInt16LE(name.length, 26);
    localParts.push(Buffer.concat([local, name, compressed]));

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(8, 10);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(compressed.length, 20);
    central.writeUInt32LE(content.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([central, name]));

    offset += local.length + name.length + compressed.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...localParts, central, end]);
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}

function paragraph(text: string, bullet = false): string {
  return (
    "<a:p>" +
    (bullet ? '<a:pPr><a:buChar char=\""\"/></a:pPr>' : "") +
    "<a:r><a:rPr/><a:t>" +
    escapeXml(text) +
    "</a:t></a:r></a:p>"
  );
}

function shape(
  paragraphs: string[],
  placeholder?: "title",
): string {
  return (
    "<p:sp><p:nvSpPr><p:cNvPr id=\"1\" name=\"shape\"/><p:cNvSpPr/><p:nvPr>" +
    (placeholder ? '<p:ph type=\"title\"/>' : "") +
    "</p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>" +
    paragraphs.join("") +
    "</p:txBody></p:sp>"
  );
}

function table(rows: string[][]): string {
  return (
    "<p:graphicFrame><a:graphic><a:graphicData uri=\"http://schemas.openxmlformats.org/drawingml/2006/table\"><a:tbl>" +
    rows
      .map(
        (row) =>
          "<a:tr>" +
          row
            .map(
              (cell) =>
                "<a:tc><a:txBody><a:p><a:r><a:t>" +
                escapeXml(cell) +
                "</a:t></a:r></a:p></a:txBody></a:tc>",
            )
            .join("") +
          "</a:tr>",
      )
      .join("") +
    "</a:tbl></a:graphicData></a:graphic></p:graphicFrame>"
  );
}

function slideXml(options: {
  title?: string;
  body?: string[];
  bullets?: string[];
  tableRows?: string[][];
}): string {
  const shapes = [];

  if (options.title) {
    shapes.push(shape([paragraph(options.title)], "title"));
  }

  if (options.body?.length) {
    shapes.push(shape(options.body.map((text) => paragraph(text))));
  }

  if (options.bullets?.length) {
    shapes.push(shape(options.bullets.map((text) => paragraph(text, true))));
  }

  if (options.tableRows) {
    shapes.push(table(options.tableRows));
  }

  return (
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    "<p:cSld><p:spTree>" +
    shapes.join("") +
    "</p:spTree></p:cSld></p:sld>"
  );
}

function notesXml(text: string): string {
  return (
    '<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
    "<p:cSld><p:spTree>" +
    shape([paragraph(text)]) +
    "</p:spTree></p:cSld></p:sld>"
  );
}

function makePptx(options: {
  slides?: string[];
  notes?: string[];
  extraEntries?: number;
  macroEnabled?: boolean;
  externalRelationship?: boolean;
  unsafeEntry?: string;
  presentationXml?: string;
} = {}): Buffer {
  const slideXmls = options.slides ?? [];
  const contentType = options.macroEnabled
    ? "application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml"
    : "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
  const entries: ZipEntry[] = [
    {
      name: "[Content_Types].xml",
      content:
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="/ppt/presentation.xml" ContentType="' +
        contentType +
        '"/></Types>',
    },
    {
      name: "ppt/presentation.xml",
      content:
        options.presentationXml ??
        '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>',
    },
  ];

  slideXmls.forEach((content, index) => {
    entries.push({
      name: "ppt/slides/slide" + (index + 1) + ".xml",
      content,
    });

    if (options.externalRelationship && index === 0) {
      entries.push({
        name: "ppt/slides/_rels/slide" + (index + 1) + ".xml.rels",
        content:
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="https://example.com/remote" TargetMode="External"/></Relationships>',
      });
    }
  });

  (options.notes ?? []).forEach((content, index) => {
    entries.push({
      name: "ppt/notesSlides/notesSlide" + (index + 1) + ".xml",
      content,
    });
  });

  for (let index = 0; index < (options.extraEntries ?? 0); index += 1) {
    entries.push({
      name: "ppt/extra/entry-" + index + ".xml",
      content: "<extra/>",
    });
  }

  if (options.unsafeEntry) {
    entries.push({ name: options.unsafeEntry, content: "unsafe" });
  }

  return makeZip(entries);
}

function makeFile(name: string, size: number, type: string): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("PPTX upload and analysis", () => {
  it("extracts slide titles, body, bullets, Unicode, tables, notes, and order", async () => {
    const presentation = await extractPptxPresentation(
      makePptx({
        slides: [
          slideXml({
            title: "Quarterly Review",
            body: ["Revenue increased", "R\u00e9sum\u00e9 \u2014 na\u00efve fa\u00e7ade \u2014 \u65e5\u672c\u8a9e"],
            bullets: ["First point", "Second point"],
            tableRows: [
              ["Region", "Revenue"],
              ["East", "100"],
            ],
          }),
          slideXml({ title: "Next Steps", body: ["Follow up"] }),
        ],
        notes: [notesXml("Discuss forecast assumptions.")],
      }),
    );

    expect(presentation.slides).toEqual([
      expect.objectContaining({
        slideNumber: 1,
        title: "Quarterly Review",
        text: ["Revenue increased", "R\u00e9sum\u00e9 \u2014 na\u00efve fa\u00e7ade \u2014 \u65e5\u672c\u8a9e", "First point", "Second point"],
        tables: [{ rows: [["Region", "Revenue"], ["East", "100"]] }],
        notes: ["Discuss forecast assumptions."],
      }),
      expect.objectContaining({
        slideNumber: 2,
        title: "Next Steps",
        text: ["Follow up"],
      }),
    ]);

    const normalized = await extractPptxText(
      makePptx({ slides: [slideXml({ title: "Title", body: ["Body"] })] }),
    );
    expect(normalized).toContain("[Slide 1]");
    expect(normalized).toContain("Title: Title");
    expect(normalized).toContain("Body");
  });

  it("handles an empty slide without producing arbitrary content", async () => {
    const presentation = await extractPptxPresentation(
      makePptx({ slides: [slideXml({})] }),
    );

    expect(presentation.slides).toEqual([{ slideNumber: 1, text: [] }]);
  });

  it("enforces the normalized extraction character limit", async () => {
    const presentation = await extractPptxText(
      makePptx({
        slides: [slideXml({ body: ["x".repeat(210_000)] })],
      }),
    );

    expect(presentation.length).toBeLessThanOrEqual(200_000);
    expect(presentation).toContain("[Truncated due to size limit]");
  });

  it("rejects malformed, fake, macro-enabled, and over-expanded presentations", async () => {
    await expect(parsePptx(Buffer.from("not a zip"))).rejects.toThrow();
    await expect(
      parsePptx(makePptx({ unsafeEntry: "../outside.xml" })),
    ).rejects.toThrow(/Unsafe PPTX archive path/);
    await expect(
      parsePptx(makeZip([{ name: "file.txt", content: "not pptx" }])),
    ).rejects.toThrow();
    await expect(
      parsePptx(makePptx({ macroEnabled: true })),
    ).rejects.toThrow();

    const expanded = Buffer.from(
      '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main">' +
        "<!--" +
        "x".repeat(PPTX_MAX_UNCOMPRESSED_BYTES + 1) +
        "--></p:presentation>",
    );
    await expect(
      parsePptx(
        makePptx({
          presentationXml: expanded.toString(),
        }),
      ),
    ).rejects.toThrow(/limit|size/i);
  });

  it("enforces archive-entry limits, timeout cancellation, external-resource safety, and file validation", async () => {
    await expect(
      parsePptx(makePptx({ extraEntries: PPTX_MAX_ZIP_ENTRIES + 1 })),
    ).rejects.toThrow(/entry|limit/i);

    const controller = new AbortController();
    controller.abort();
    await expect(
      parsePptx(makePptx({ slides: [slideXml({ body: ["text"] })] }), {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() => {
        throw new Error("external fetch must not occur");
      });
    await expect(
      parsePptx(
        makePptx({
          slides: [slideXml({ body: ["linked"] })],
          externalRelationship: true,
        }),
      ),
    ).resolves.toBeDefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();

    expect(PPTX_PARSE_TIMEOUT_MS).toBe(10_000);
    expect(DOCUMENT_LIMITS.allowedExtensions).toContain(".pptx");
    expect(validateFiles([makeFile("slides.pptx", 1, PPTX_MIME)], "pro")).toBeNull();
    expect(
      validateFiles([makeFile("slides.pptx", 1, "application/zip")], "pro"),
    ).toBe("Unsupported file type: slides.pptx");
    expect(
      validateFiles([makeFile("slides.pptm", 1, PPTX_MIME)], "pro"),
    ).toBe("Unsupported file type: slides.pptm");
    expect(
      validateFiles([makeFile("slides.ppt", 1, PPTX_MIME)], "pro"),
    ).toBe("Unsupported file type: slides.ppt");
    expect(
      validateFiles(
        [makeFile("large.pptx", 5 * 1024 * 1024 + 1, PPTX_MIME)],
        "free",
      ),
    ).toBe("File exceeds 5 MB: large.pptx");
  });

  it("keeps the client and server on the same PPTX contract", () => {
    const clientSource = readFileSync("app/chat/ChatClient.tsx", "utf8");
    const routeSource = readFileSync("app/api/documents/upload/route.ts", "utf8");

    expect(clientSource).toContain(".pptx");
    expect(clientSource).toContain(PPTX_MIME);
    expect(routeSource).toContain(".pptx");
    expect(routeSource).toContain(PPTX_MIME);
  });
});
