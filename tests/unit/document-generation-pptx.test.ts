import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  generatePptxArtifact,
  MAX_ARTIFACT_BYTES,
  validateGeneratedArtifact,
} from "@/lib/documents/generation";
import { extractPptxPresentation } from "@/lib/documents/extract-pptx";
import type { PresentationDocumentRequest } from "@/lib/documents/generation";

const PPTX_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const unicodeText = "Résumé — naïve façade — 日本語";
const typographicText = "“quoted text” — typographic punctuation";

function representativeRequest(
  overrides: Partial<PresentationDocumentRequest & { format: "pptx" }> = {},
): PresentationDocumentRequest & { format: "pptx" } {
  return {
    format: "pptx",
    filename: "qualification.pptx",
    title: "Qualification Presentation",
    slides: [
      {
        type: "title",
        title: "Qualification Presentation",
        subtitle: unicodeText,
        notes: "Speaker notes survive the presentation round trip.",
      },
      {
        type: "body",
        title: "Executive Summary",
        paragraphs: ["The foundation is ready.", typographicText],
      },
      {
        type: "bullets",
        title: "Key Findings",
        items: ["First finding", unicodeText, "Third finding"],
      },
      {
        type: "table",
        title: "Comparison",
        columns: ["Option", "Status"],
        rows: [
          ["Upstream", "Selected"],
          ["Alternative", "Deferred"],
        ],
      },
      {
        type: "numbered",
        title: "Recommendations",
        items: ["Review the output", "Approve the controlled release"],
      },
    ],
    ...overrides,
  };
}

async function readBack(
  bytes: Uint8Array,
): Promise<Awaited<ReturnType<typeof extractPptxPresentation>>> {
  return extractPptxPresentation(Buffer.from(bytes));
}

describe("PPTX generator", () => {
  it("generates a valid 16:9 five-slide presentation with CS4B round-trip content", async () => {
    const artifact = await generatePptxArtifact(representativeRequest());
    const presentation = await readBack(artifact.bytes);
    const allText = JSON.stringify(presentation);
    const zip = await JSZip.loadAsync(Buffer.from(artifact.bytes));
    const presentationXml = await zip.file("ppt/presentation.xml")?.async("string");

    expect(artifact.bytes).toBeInstanceOf(Uint8Array);
    expect(artifact.bytes.byteLength).toBeGreaterThan(0);
    expect(Buffer.from(artifact.bytes).subarray(0, 4)).toEqual(
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
    );
    expect(artifact.filename).toBe("qualification.pptx");
    expect(artifact.mimeType).toBe(PPTX_MIME);
    expect(artifact.format).toBe("pptx");
    expect(artifact.sizeBytes).toBe(artifact.bytes.byteLength);
    expect(presentation.slides).toHaveLength(5);
    expect(presentation.slides.map((slide) => slide.slideNumber)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(allText).toContain("Qualification Presentation");
    expect(allText).toContain("Executive Summary");
    expect(allText).toContain("First finding");
    expect(allText).toContain("Selected");
    expect(allText).toContain("Approve the controlled release");
    expect(allText).toContain(unicodeText);
    expect(allText).toContain(typographicText);
    expect(allText).toContain("Speaker notes survive the presentation round trip.");
    expect(presentationXml).toContain('cx="12192000" cy="6858000"');
  });

  it("creates continuation slides for long body, bullet, and table content", async () => {
    const body = {
      type: "body" as const,
      title: "Long body",
      paragraphs: Array.from(
        { length: 25 },
        (_, index) =>
          "Paragraph " +
          (index + 1) +
          " contains enough text to require deterministic wrapping and continuation.",
      ),
    };
    const bullets = {
      type: "bullets" as const,
      title: "Long bullets",
      items: Array.from({ length: 30 }, (_, index) => "Finding " + (index + 1)),
    };
    const table = {
      type: "table" as const,
      title: "Long table",
      columns: ["Item", "Status"],
      rows: Array.from({ length: 30 }, (_, index) => [
        "Row " + (index + 1),
        "Ready",
      ]),
    };

    const artifact = await generatePptxArtifact(
      representativeRequest({ slides: [body, bullets, table] }),
    );
    const presentation = await readBack(artifact.bytes);
    const allText = JSON.stringify(presentation);

    expect(presentation.slides.length).toBeGreaterThan(3);
    expect(allText).toContain("Paragraph 25");
    expect(allText).toContain("Finding 30");
    expect(allText).toContain("Row 30");
    expect(allText).toContain("continued");
  });

  it("rejects continuation splitting for exact-count presentations", async () => {
    const longBody = {
      type: "body" as const,
      title: "Long exact slide",
      paragraphs: Array.from(
        { length: 25 },
        (_, index) =>
          "Paragraph " +
          (index + 1) +
          " contains enough text to require deterministic wrapping and continuation.",
      ),
    };

    await expect(generatePptxArtifact(
      representativeRequest({
        exactSlideCount: 1,
        slides: [longBody],
      }),
    )).rejects.toThrow(
      "Explicit slide content is too large to fit without changing the requested slide count.",
    );
  });

  it("uses shared filename and artifact validation behavior", async () => {
    const cases = [
      [undefined, "lvtchat-document.pptx"],
      ["report", "report.pptx"],
      ["report.pdf", "report.pptx"],
      ["../../private/report.pptx", "_._private_report.pptx"],
      ["report.pptx.pptx", "report.pptx"],
    ] as const;

    for (const [filename, expected] of cases) {
      const artifact = await generatePptxArtifact(
        representativeRequest({ filename }),
      );
      expect(artifact.filename).toBe(expected);
      expect(artifact.filename).toMatch(/\.pptx$/);
      expect(artifact.filename).not.toContain("..");
    }

    const issues = validateGeneratedArtifact({
      filename: "large.pptx",
      mimeType: PPTX_MIME,
      bytes: new Uint8Array(MAX_ARTIFACT_BYTES + 1),
      sizeBytes: MAX_ARTIFACT_BYTES + 1,
      format: "pptx",
    });
    expect(issues).toContain("Artifact exceeds the maximum size.");
  });

  it("rejects malformed presentation requests through shared validation", async () => {
    await expect(
      generatePptxArtifact(
        representativeRequest({
          slides: [],
        }),
      ),
    ).rejects.toThrow("Presentation must contain a slide");

    await expect(
      generatePptxArtifact(
        representativeRequest({
          slides: [
            {
              type: "unknown",
              title: "Invalid",
            } as never,
          ],
        }),
      ),
    ).rejects.toThrow("unsupported type");

    await expect(
      generatePptxArtifact(
        representativeRequest({
          slides: [
            {
              type: "table",
              title: "Invalid table",
              columns: ["A", "B"],
              rows: [["only one"]],
            },
          ],
        }),
      ),
    ).rejects.toThrow("does not match the columns");
  });
});
