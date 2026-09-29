import ExcelJS from "exceljs";
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

describe("document generation templates", () => {
  it("lists the versioned templates and rejects duplicate registry IDs", () => {
    const templates = listTemplates();
    expect(templates.map((template) => template.id)).toEqual([
      "general-report",
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
});
