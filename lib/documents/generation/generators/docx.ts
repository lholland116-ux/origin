import {
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
} from "docx";
import type {
  DocumentSection,
  GeneratedArtifact,
  StructuredDocumentRequest,
} from "../contracts";
import { sanitizeFilename } from "../filenames";
import { getDocumentMimeType } from "../mime";
import {
  assertValidGenerationRequest,
  DocumentGenerationValidationError,
  validateGeneratedArtifact,
} from "../validation";

const ORDERED_LIST_REFERENCE = "lvtchat-ordered-list";

function headingLevel(level: 1 | 2 | 3): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  if (level === 1) return HeadingLevel.HEADING_1;
  if (level === 2) return HeadingLevel.HEADING_2;
  return HeadingLevel.HEADING_3;
}

function listParagraphs(
  section: Extract<DocumentSection, { type: "list" }>,
): Paragraph[] {
  return section.items.map(
    (item) =>
      new Paragraph(
        section.ordered
          ? {
              text: item,
              numbering: {
                reference: ORDERED_LIST_REFERENCE,
                level: 0,
              },
            }
          : {
              text: item,
              bullet: { level: 0 },
            },
      ),
  );
}

function tableCell(text: string, bold = false): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: [new TextRun({ text, bold })],
      }),
    ],
  });
}

function tableFromSection(
  section: Extract<DocumentSection, { type: "table" }>,
): Table {
  const header = new TableRow({
    children: section.columns.map((column) => tableCell(column, true)),
  });
  const rows = section.rows.map(
    (row) =>
      new TableRow({
        children: row.map((cell) => tableCell(cell)),
      }),
  );

  return new Table({ rows: [header, ...rows] });
}

function sectionChildren(sections: readonly DocumentSection[]): Array<Paragraph | Table> {
  const children: Array<Paragraph | Table> = [];

  for (const section of sections) {
    if (section.type === "heading") {
      children.push(
        new Paragraph({
          text: section.text,
          heading: headingLevel(section.level),
        }),
      );
    } else if (section.type === "paragraph") {
      children.push(new Paragraph({ text: section.text }));
    } else if (section.type === "list") {
      children.push(...listParagraphs(section));
    } else {
      children.push(tableFromSection(section));
    }
  }

  return children;
}

export async function generateDocxArtifact(
  request: StructuredDocumentRequest & { readonly format: "docx" },
): Promise<GeneratedArtifact> {
  assertValidGenerationRequest(request);

  const children: Array<Paragraph | Table> = [];
  if (request.title !== undefined && request.title.length > 0) {
    children.push(
      new Paragraph({
        text: request.title,
        heading: HeadingLevel.TITLE,
      }),
    );
  }
  children.push(...sectionChildren(request.sections));

  const document = new Document({
    title: request.title,
    creator: "LVTChat",
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REFERENCE,
          levels: [
            {
              level: 0,
              format: "decimal",
              text: "%1.",
              alignment: "left",
            },
          ],
        },
      ],
    },
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(document);
  const artifact: GeneratedArtifact = {
    filename: sanitizeFilename(request.filename, "docx"),
    mimeType: getDocumentMimeType("docx"),
    bytes: new Uint8Array(buffer),
    sizeBytes: buffer.byteLength,
    format: "docx",
  };
  const issues = validateGeneratedArtifact(artifact);

  if (issues.length > 0) {
    throw new DocumentGenerationValidationError(issues);
  }

  return artifact;
}
