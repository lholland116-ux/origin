import ExcelJS from "exceljs";
import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import {
  createTemplateRegistry,
  generateDocxArtifact,
  generateMarkdownArtifact,
  generatePdfArtifact,
  generatePptxArtifact,
  generateTextArtifact,
  generateXlsxArtifact,
  getTemplate,
  listTemplates,
  renderTemplate,
  TemplateValidationError,
  type DocumentGenerationRequest,
  type GeneratedArtifact,
  type StructuredDocumentRequest,
  type TemplateVariablesRecord,
} from "@/lib/documents/generation";
import { extractPptxPresentation } from "@/lib/documents/extract-pptx";

const generalVariables: TemplateVariablesRecord = {
  title: "Quarterly Review",
  summary: "A concise review of the quarter.",
  sections: [
    {
      heading: "Findings",
      body: "The operating model improved.",
      bullets: ["Delivery improved", "Risk remained controlled"],
      table: {
        columns: ["Metric", "Result"],
        rows: [["Quality", "Strong"]],
      },
    },
    {
      heading: "Next Steps",
      body: "The review cadence will continue.",
    },
  ],
  recommendations: ["Maintain the review cadence"],
  conclusion: "Continue the current approach.",
};

const comparisonVariables = {
  title: "Option Comparison",
  items: [
    { name: "Alpha", description: "Established option" },
    { name: "Beta", description: "Emerging option" },
  ],
  criteria: ["Cost", "Risk"],
  summary: "Alpha is more established while Beta is more flexible.",
  comparisons: [
    { item: "Alpha", values: ["Medium", "Low"] },
    { item: "Beta", values: ["Low", "Medium"] },
  ],
  observations: ["Alpha reduces transition risk.", "Beta may reduce cost."],
};

async function generateArtifact(
  request: DocumentGenerationRequest,
): Promise<GeneratedArtifact> {
  if (request.format === "txt") return generateTextArtifact(request);
  if (request.format === "md") return generateMarkdownArtifact(request);
  if (request.format === "docx") return generateDocxArtifact(request as Parameters<typeof generateDocxArtifact>[0]);
  if (request.format === "pdf") return generatePdfArtifact(request as Parameters<typeof generatePdfArtifact>[0]);
  if (request.format === "xlsx") return generateXlsxArtifact(request as Parameters<typeof generateXlsxArtifact>[0]);
  return generatePptxArtifact(request as Parameters<typeof generatePptxArtifact>[0]);
}

function assertStructuredRequest(
  request: DocumentGenerationRequest,
): asserts request is StructuredDocumentRequest {
  if (request.format !== "docx" && request.format !== "pdf") {
    throw new Error("Expected structured document request.");
  }
}

describe("document generation templates", () => {
  it("lists the versioned templates and rejects duplicate registry IDs", () => {
    const templates = listTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "general-report",
      "simple-document",
      "executive-summary",
      "comparison-report",
      "general-presentation",
    ]);
    expect(templates.every((template) => template.version === 1)).toBe(true);
    expect(templates.every((template) => !("render" in template))).toBe(true);
    expect(() => {
      const template = getTemplate("general-report");
      if (!template) throw new Error("Expected general-report template");
      return createTemplateRegistry([template, template]);
    }).toThrow(/Duplicate template ID/);
  });

  it("validates template IDs, formats, required variables, and malformed shapes", () => {
    expect(() =>
      renderTemplate({
        templateId: "missing-template",
        format: "md",
        variables: {},
      }),
    ).toThrow(TemplateValidationError);
    expect(() =>
      renderTemplate({
        templateId: "general-presentation",
        format: "pdf",
        variables: generalVariables,
      }),
    ).toThrow(/not supported/);
    expect(() =>
      renderTemplate({
        templateId: "general-report",
        format: "md",
        variables: { title: "Missing sections", summary: "Incomplete" },
      }),
    ).toThrow(/sections is required/);
    expect(() =>
      renderTemplate({
        templateId: "general-report",
        format: "md",
        variables: { ...generalVariables, unexpected: "not allowed" },
      }),
    ).toThrow(/Unexpected template variable/);
    expect(() =>
      renderTemplate({
        templateId: "comparison-report",
        format: "xlsx",
        variables: {
          ...comparisonVariables,
          comparisons: [{ item: "Alpha", values: ["Only one value"] }],
        },
      }),
    ).toThrow(/must match criteria/);
  });

  it("renders a general report into Markdown, TXT, DOCX, and PDF requests and artifacts", async () => {
    const markdown = renderTemplate({
      templateId: "general-report",
      format: "md",
      variables: generalVariables,
    });
    expect(markdown).toMatchObject({ format: "md", filename: "Quarterly-Review.md" });
    expect(markdown.format === "md" ? markdown.content : "").toContain("Findings");
    expect(markdown.format === "md" ? markdown.content : "").toContain("Maintain the review cadence");

    const text = await generateArtifact(
      renderTemplate({
        templateId: "general-report",
        format: "txt",
        variables: { ...generalVariables, filename: "Quarterly Review?.txt" },
      }),
    );
    expect(text).toMatchObject({ format: "txt", filename: "Quarterly-Review.txt" });

    const docx = await generateArtifact(
      renderTemplate({ templateId: "general-report", format: "docx", variables: generalVariables }),
    );
    const pdf = await generateArtifact(
      renderTemplate({ templateId: "general-report", format: "pdf", variables: generalVariables }),
    );
    expect(docx.format).toBe("docx");
    expect(pdf.format).toBe("pdf");
    expect(docx.sizeBytes).toBe(docx.bytes.length);
    expect(pdf.sizeBytes).toBe(pdf.bytes.length);
  });

  it.each(["txt", "md", "docx", "pdf"] as const)("renders minimal exact content as %s", async (format) => {
    const title = "LVTChat PDF Exact Content Test";
    const date = "2026-09-30";
    const body = "This document verifies LVTChat PDF generation in production.";
    const bullets = [
      "PDF generation works correctly.",
      "Document persistence works correctly.",
      "Historical downloads work correctly.",
    ];
    const request = renderTemplate({
      templateId: "simple-document",
      format,
      variables: { title, date, body, bullets },
    });
    expect(request.title).toBe(title);
    const artifact = await generateArtifact(request);
    expect(artifact.format).toBe(format);

    if (request.format === "txt" || request.format === "md") {
      const expected = (request.format === "md" ? "# " : "") + title + "\n\n" + date + "\n\n" + body + "\n\n" + bullets.map((bullet) => "- " + bullet).join("\n");
      expect(request.content).toBe(expected);
      expect(new TextDecoder().decode(artifact.bytes)).toBe(expected);
      expect(request.content.split(body)).toHaveLength(2);
      expect(request.content).not.toMatch(/Summary|Verification|Conclusion|filler/i);
      return;
    }

    assertStructuredRequest(request);
    expect(request.sections).toEqual([
      { type: "paragraph", text: date },
      { type: "paragraph", text: body },
      { type: "list", ordered: false, items: bullets },
    ]);
    if (request.format === "docx") {
      const archive = await JSZip.loadAsync(Buffer.from(artifact.bytes));
      const xml = await archive.file("word/document.xml")?.async("text");
      expect(xml).toContain(title);
      expect(xml?.split(body)).toHaveLength(2);
      for (const bullet of bullets) expect(xml).toContain(bullet);
      expect(xml).not.toMatch(/Summary|Verification|Conclusion|filler/i);
      return;
    }
    expect(new TextDecoder().decode(artifact.bytes, { stream: false })).toContain("%PDF-");
    expect(JSON.stringify(request.sections)).not.toMatch(/Summary|Verification|Conclusion|filler/i);
  });

  it("omits bullets when simple-document bullets are omitted or null", () => {
    const formats = ["txt", "md", "docx", "pdf"] as const;
    const template = getTemplate("simple-document");
    expect(template?.supportedFormats).toEqual(formats);
    for (const format of formats) {
      for (const bullets of [undefined, null]) {
        const variables: TemplateVariablesRecord = {
          title: "Minimal title",
          body: "Exact body content.",
          ...(bullets !== undefined ? { bullets } : {}),
        };
        const request = renderTemplate({ templateId: "simple-document", format, variables });
        expect(request.title).toBe("Minimal title");
        if (request.format === "txt" || request.format === "md") {
          expect(request.content).toBe((format === "md" ? "# " : "") + "Minimal title\n\nExact body content.");
          expect(request.content).not.toContain("- ");
        } else {
          assertStructuredRequest(request);
          expect(request.sections).toEqual([{ type: "paragraph", text: "Exact body content." }]);
        }
      }
    }
  });
  it("renders an executive summary with deterministic decision-oriented sections", () => {
    const request = renderTemplate({
      templateId: "executive-summary",
      format: "txt",
      variables: {
        title: "Decision Brief",
        context: "The team must choose a delivery path.",
        keyFindings: ["Path A is faster"],
        implications: ["The decision affects launch timing"],
        recommendedActions: ["Approve Path A"],
        conclusion: "Proceed with review.",
      },
    });
    expect(request).toMatchObject({ format: "txt", filename: "Decision-Brief.txt" });
    expect(request.format === "txt" ? request.content : "").toContain("KEY FINDINGS");
    expect(request.format === "txt" ? request.content : "").toContain("1. Approve Path A");
    expect(() =>
      renderTemplate({
        templateId: "executive-summary",
        format: "xlsx",
        variables: {
          title: "Decision Brief",
          context: "Context",
          keyFindings: ["Finding"],
          implications: ["Implication"],
          recommendedActions: ["Action"],
        },
      }),
    ).toThrow(/not supported/);
  });

  it("renders comparison reports to documents and reads the XLSX output back", async () => {
    const documentRequest = renderTemplate({
      templateId: "comparison-report",
      format: "md",
      variables: comparisonVariables,
    });
    expect(documentRequest.format === "md" ? documentRequest.content : "").toContain("| Item | Cost | Risk |");
    expect(documentRequest.format === "md" ? documentRequest.content : "").toContain("| Beta | Low | Medium |");

    const workbookRequest = renderTemplate({
      templateId: "comparison-report",
      format: "xlsx",
      variables: comparisonVariables,
    });
    const workbookArtifact = await generateArtifact(workbookRequest);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(workbookArtifact.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual(["Comparison"]);
    expect(workbook.worksheets[0]?.getRow(1).values).toEqual([
      undefined,
      "Item",
      "Cost",
      "Risk",
    ]);
    expect(workbook.worksheets[0]?.getRow(3).values).toEqual([
      undefined,
      "Beta",
      "Low",
      "Medium",
    ]);
  });

  it("preserves comparison scalar types in XLSX and renders them as text elsewhere", async () => {
    const variables = {
      ...comparisonVariables,
      criteria: ["Quantity", "Unit Price", "Enabled", "Blank", "Reference", "Postal", "Formula"],
      comparisons: [{
        item: "Alpha",
        values: [2, 899.99, true, null, "00123", "31005", "=SUM(A1:A2)"],
      }],
    };
    const workbookRequest = renderTemplate({
      templateId: "comparison-report",
      format: "xlsx",
      variables,
    });
    expect(workbookRequest.format).toBe("xlsx");
    if (workbookRequest.format !== "xlsx") throw new Error("Expected XLSX request.");

    const workbookArtifact = await generateArtifact(workbookRequest);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(workbookArtifact.bytes) as unknown as Parameters<typeof workbook.xlsx.load>[0]);
    const sheet = workbook.worksheets[0];
    expect(sheet?.getCell(2, 2).type).toBe(ExcelJS.ValueType.Number);
    expect(sheet?.getCell(2, 2).value).toBe(2);
    expect(sheet?.getCell(2, 3).type).toBe(ExcelJS.ValueType.Number);
    expect(sheet?.getCell(2, 3).value).toBe(899.99);
    expect(sheet?.getCell(2, 4).type).toBe(ExcelJS.ValueType.Boolean);
    expect(sheet?.getCell(2, 4).value).toBe(true);
    expect(sheet?.getCell(2, 5).value).toBeNull();
    expect(sheet?.getCell(2, 6).type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell(2, 6).value).toBe("00123");
    expect(sheet?.getCell(2, 7).type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell(2, 7).value).toBe("31005");
    expect(sheet?.getCell(2, 8).type).toBe(ExcelJS.ValueType.String);
    expect(sheet?.getCell(2, 8).value).toBe("'=SUM(A1:A2)");

    const expectedTextRow = ["Alpha", "2", "899.99", "true", "", "00123", "31005", "=SUM(A1:A2)"];
    for (const format of ["txt", "md", "docx", "pdf"] as const) {
      const request = renderTemplate({ templateId: "comparison-report", format, variables });
      if (request.format === "txt" || request.format === "md") {
        expect(request.content).not.toContain("[object Object]");
        expect(request.content).toContain(expectedTextRow.join(" | "));
      } else if (request.format === "docx" || request.format === "pdf") {
        const tableSection = request.sections.find((section) => section.type === "table");
        expect(tableSection?.type === "table" ? tableSection.rows[0] : undefined).toEqual(expectedTextRow);
      } else {
        throw new Error("Expected a text-oriented comparison format.");
      }
      const artifact = await generateArtifact(request);
      expect(artifact.bytes.byteLength).toBeGreaterThan(0);
    }
  });

  it("renders and reads a general presentation through the existing PPTX extractor", async () => {
    const request = renderTemplate({
      templateId: "general-presentation",
      format: "pptx",
      variables: {
        title: "Release Review — 日本語",
        subtitle: "Decision package",
        summary: "The release is ready for controlled review.",
        sections: [
          {
            heading: "Findings",
            body: "The qualification suite is green.",
            findings: ["All focused tests passed"],
          },
        ],
        comparison: {
          columns: ["Option", "Status"],
          rows: [["Current", "Ready"]],
        },
        recommendations: ["Complete human review"],
        notes: "Review the release package.",
      },
    });
    const artifact = await generateArtifact(request);
    const presentation = await extractPptxPresentation(Buffer.from(artifact.bytes) as unknown as Parameters<typeof extractPptxPresentation>[0]);
    const content = JSON.stringify(presentation);
    expect(presentation.slides.map((slide) => slide.slideNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(content).toContain("Release Review — 日本語");
    expect(content).toContain("The release is ready for controlled review.");
    expect(content).toContain("All focused tests passed");
    expect(content).toContain("Complete human review");
    expect(content).toContain("Review the release package.");
  });

  it("keeps general-report tables and lists structured through DOCX", async () => {
    const request = renderTemplate({
      templateId: "general-report",
      format: "docx",
      variables: generalVariables,
    });

    expect(request.format).toBe("docx");
    if (request.format !== "docx") return;
    expect(request.sections).toEqual(expect.arrayContaining([
      { type: "list", ordered: false, items: ["Delivery improved", "Risk remained controlled"] },
      { type: "table", columns: ["Metric", "Result"], rows: [["Quality", "Strong"]] },
    ]));

    const artifact = await generateDocxArtifact(request as Parameters<typeof generateDocxArtifact>[0]);
    const archive = await JSZip.loadAsync(Buffer.from(artifact.bytes));
    const documentXml = await archive.file("word/document.xml")?.async("text");

    expect(documentXml).toContain("<w:tbl");
    expect(documentXml).toContain("Delivery improved");
    expect(documentXml).toContain("w:numPr");
    expect(documentXml).not.toContain("| Metric | Result |");
  });
});
