import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  openai: { responses: { create: mocks.create } },
}));

import {
  DocumentGenerationIntentValidationError,
  getRuntimeCurrentDate,
  isExplicitDocumentGenerationRequest,
  isDocumentGenerationCandidate,
  resolveDocumentGenerationIntent,
} from "@/lib/documents/generation/intent";
import { renderTemplate } from "@/lib/documents/generation";

describe("document generation intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["2026-09-30T12:00:00.000Z", "2026-09-30"],
    ["2031-01-02T00:15:00.000Z", "2031-01-02"],
  ])("derives the runtime current date without a hard-coded calendar date", (timestamp, expected) => {
    expect(getRuntimeCurrentDate(new Date(timestamp))).toBe(expected);
  });

  it("supplies the runtime current date as authoritative planner context for relative date requests", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["txt"],
        packageAsZip: false,
        title: "Current date",
        variables: {
          summary: "Today is 2026-09-30.",
          sections: [{ heading: "Date", body: "2026-09-30" }],
        },
      }),
    });

    await expect(
      resolveDocumentGenerationIntent({
        latestMessage: "Create a TXT document containing the current date.",
        history: [{ role: "user", content: "Create a TXT document containing the current date." }],
      }),
    ).resolves.toMatchObject({
      variables: { summary: "Today is 2026-09-30." },
    });

    const plannerInput = mocks.create.mock.calls[0]?.[0]?.input as string;
    expect(plannerInput).toContain("CURRENT RUNTIME DATE (UTC): 2026-09-30");
    expect(plannerInput).toContain("use this exact date");
    expect(plannerInput).not.toContain("June 16, 2025");
  });

  it("normalizes nullable optional planner fields before template validation", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["pdf"],
        packageAsZip: false,
        title: "Nullable fields",
        variables: {
          title: "Nullable fields",
          summary: "A summary.",
          sections: [{ heading: "Section", body: "Body", bullets: null, table: null }],
          subtitle: null,
          author: null,
          date: null,
          recommendations: null,
          conclusion: null,
          filename: null,
        },
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF report.",
      history: [{ role: "user", content: "Create a PDF report." }],
    })).resolves.toMatchObject({
      variables: {
        title: "Nullable fields",
        summary: "A summary.",
        sections: [{ heading: "Section", body: "Body" }],
      },
    });
  });

  it("keeps an automatic current date in the dedicated field across shared output formats", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["txt", "pdf"],
        packageAsZip: false,
        title: "Qualification Report",
        variables: {
          title: "Qualification Report",
          date: "2026-09-30",
          summary: "A concise qualification summary.",
          sections: [{
            heading: "Key Points",
            body: "Today's date: 2026-09-30",
            bullets: ["Today's date: 2026-09-30", "First point", "Second point"],
          }],
        },
      }),
    });

    const result = await resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF containing today's date and three bullet points.",
      history: [{ role: "user", content: "Create a PDF containing today's date and three bullet points." }],
    });

    expect(result?.formats).toEqual(["txt", "pdf"]);
    expect(result?.variables.date).toBe("2026-09-30");
    expect(result?.variables.sections).toEqual([{
      heading: "Key Points",
      body: "See the document date above.",
      bullets: ["First point", "Second point"],
    }]);
    const plannerInput = mocks.create.mock.calls[0]?.[0]?.input as string;
    expect(plannerInput).toContain("dedicated date position");
  });

  it("preserves explicitly requested repeated date placement", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-02T12:00:00.000Z"));
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["pdf"],
        packageAsZip: false,
        title: "Qualification Report",
        variables: {
          title: "Qualification Report",
          date: "2031-01-02",
          summary: "A concise qualification summary.",
          sections: [{ heading: "Findings", body: "The result is ready." }],
          conclusion: "Today's date: 2031-01-02",
        },
      }),
    });

    const result = await resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF. Put today's date under the title and also repeat it in the conclusion.",
      history: [{ role: "user", content: "Create a PDF. Put today's date under the title and also repeat it in the conclusion." }],
    });

    expect(result?.variables.date).toBe("2031-01-02");
    expect(result?.variables.conclusion).toBe("Today's date: 2031-01-02");
  });

  it("publishes an OpenAI-compatible schema for every registered template", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "none", document: null,
      }),
    });

    await resolveDocumentGenerationIntent({
      latestMessage: "What is a PDF file?",
      history: [{ role: "user", content: "What is a PDF file?" }],
    });

    type SchemaNode = {
      type?: string | readonly string[];
      properties?: Record<string, SchemaNode>;
      required?: readonly string[];
      additionalProperties?: boolean;
      items?: SchemaNode;
      anyOf?: readonly SchemaNode[];
      enum?: readonly string[];
      minItems?: number;
      pattern?: string;
    };
    const request = mocks.create.mock.calls[0]?.[0] as {
      text?: { format?: { schema?: SchemaNode; strict?: boolean } };
    };
    expect(request.text?.format?.strict).toBe(true);
    const schema = request.text?.format?.schema;
    expect(schema?.type).toBe("object");
    expect(JSON.stringify(schema)).not.toContain("minLength");
    expect(schema?.anyOf).toBeUndefined();
    expect((schema as SchemaNode & { allOf?: unknown }).allOf).toBeUndefined();
    expect((schema as SchemaNode & { oneOf?: unknown }).oneOf).toBeUndefined();

    const visit = (node: SchemaNode | undefined) => {
      if (!node) return;
      if (node.type === "object") {
        const properties = node.properties ?? {};
        const required = node.required ?? [];
        expect(node.additionalProperties).toBe(false);
        expect(new Set(required)).toEqual(new Set(Object.keys(properties)));
      }
      Object.values(node.properties ?? {}).forEach(visit);
      visit(node.items);
      node.anyOf?.forEach(visit);
    };
    visit(schema);

    const document = schema?.properties?.document;
    const branches = document?.anyOf ?? [];
    expect(branches).toHaveLength(6);
    expect(branches[0]?.type).toBe("null");
    const templateBranches = branches.filter((branch) => branch.type === "object");
    expect(templateBranches).toHaveLength(5);

    const generalReport = templateBranches[0];
    expect(generalReport.properties?.templateId?.enum).toEqual(["general-report"]);
    expect(generalReport.properties?.formats?.minItems).toBe(1);
    expect(generalReport.properties?.formats?.items?.enum).toEqual(["docx", "pdf", "md", "txt"]);
    expect(generalReport.properties?.variables?.properties?.title?.pattern).toBe("\\S");
    expect(generalReport.properties?.variables?.properties?.summary?.pattern).toBe("\\S");
    expect(generalReport.properties?.variables?.properties?.sections?.minItems).toBe(1);
    expect(generalReport.properties?.variables?.properties?.sections?.items?.required).toEqual(["heading", "body", "bullets", "table"]);
    expect(generalReport.properties?.variables?.properties?.sections?.items?.properties?.heading?.pattern).toBe("\\S");
    expect(generalReport.properties?.variables?.properties?.sections?.items?.properties?.body?.pattern).toBe("\\S");
    expect(generalReport.properties?.variables?.properties?.sections?.items?.properties?.bullets?.type).toEqual(["array", "null"]);
    expect(generalReport.properties?.variables?.properties?.sections?.items?.properties?.bullets?.minItems).toBeUndefined();
    expect(generalReport.properties?.variables?.properties?.sections?.items?.properties?.table?.anyOf).toHaveLength(2);
    expect(generalReport.properties?.variables?.properties?.date?.pattern).toBeUndefined();

    const executiveSummary = templateBranches[1];
    expect(executiveSummary.properties?.templateId?.enum).toEqual(["executive-summary"]);
    expect(executiveSummary.properties?.variables?.properties?.title?.pattern).toBe("\\S");
    expect(executiveSummary.properties?.variables?.properties?.context?.pattern).toBe("\\S");
    expect(executiveSummary.properties?.variables?.properties?.keyFindings?.minItems).toBe(1);
    expect(executiveSummary.properties?.variables?.properties?.implications?.minItems).toBe(1);
    expect(executiveSummary.properties?.variables?.properties?.recommendedActions?.minItems).toBe(1);
    expect(executiveSummary.properties?.variables?.required).toContain("recommendedActions");

    const comparisonReport = templateBranches[2];
    expect(comparisonReport.properties?.templateId?.enum).toEqual(["comparison-report"]);
    expect(comparisonReport.properties?.variables?.properties?.title?.pattern).toBe("\\S");
    expect(comparisonReport.properties?.variables?.properties?.firstColumnHeader?.type).toEqual(["string", "null"]);
    expect(comparisonReport.properties?.variables?.properties?.firstColumnHeader?.pattern).toBe("\\S");
    expect(comparisonReport.properties?.variables?.required).toContain("firstColumnHeader");
    expect(comparisonReport.properties?.variables?.properties?.items?.minItems).toBe(1);
    expect(comparisonReport.properties?.variables?.properties?.items?.items?.properties?.name?.pattern).toBe("\\S");
    expect(comparisonReport.properties?.variables?.properties?.criteria?.minItems).toBe(1);
    expect(comparisonReport.properties?.variables?.properties?.summary?.pattern).toBe("\\S");
    expect(comparisonReport.properties?.variables?.properties?.comparisons?.minItems).toBe(1);
    expect(comparisonReport.properties?.variables?.properties?.comparisons?.items?.properties?.item?.pattern).toBe("\\S");
    expect(comparisonReport.properties?.variables?.properties?.comparisons?.items?.properties?.values?.minItems).toBe(1);
    expect(
      comparisonReport.properties?.variables?.properties?.comparisons?.items?.properties?.values?.items?.anyOf?.map(
        (branch) => branch.type,
      ),
    ).toEqual(["string", "number", "boolean", "null"]);
    expect(
      comparisonReport.properties?.variables?.properties?.comparisons?.items?.properties?.values?.items?.anyOf?.[0]?.pattern,
    ).toBe("\\S");
    expect(comparisonReport.properties?.variables?.properties?.observations?.minItems).toBe(1);
    expect(comparisonReport.properties?.variables?.required).toContain("comparisons");

    const generalPresentation = templateBranches[3];
    expect(generalPresentation.properties?.templateId?.enum).toEqual(["general-presentation"]);
    expect(generalPresentation.properties?.variables?.properties?.title?.pattern).toBe("\\S");
    expect(generalPresentation.properties?.variables?.properties?.summary?.pattern).toBe("\\S");
    expect(generalPresentation.properties?.variables?.properties?.sections?.minItems).toBe(1);
    expect(generalPresentation.properties?.variables?.properties?.sections?.items?.properties?.heading?.pattern).toBe("\\S");
    expect(generalPresentation.properties?.variables?.properties?.sections?.items?.properties?.body?.pattern).toBe("\\S");
    expect(generalPresentation.properties?.variables?.required).toContain("sections");
  });

  it("accepts a coupled nested template branch and normalizes it to the internal intent", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        document: {
          templateId: "general-report",
          formats: ["pdf"],
          packageAsZip: false,
          title: "Coupled report",
          variables: {
            title: "Coupled report",
            summary: "A summary.",
            sections: [{ heading: "Findings", body: "The result is ready." }],
            subtitle: null,
            author: null,
            date: null,
            recommendations: null,
            conclusion: null,
            filename: null,
          },
        },
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF report.",
      history: [{ role: "user", content: "Create a PDF report." }],
    })).resolves.toMatchObject({
      templateId: "general-report",
      formats: ["pdf"],
      variables: { title: "Coupled report", summary: "A summary." },
    });
  });

  it.each([
    ["summary", { title: "Sparse", sections: [{ heading: "Section", body: "Body" }] }],
    ["empty summary", { title: "Sparse", summary: "", sections: [{ heading: "Section", body: "Body" }] }],
    ["section heading", { title: "Sparse", summary: "Summary", sections: [{ body: "Body" }] }],
    ["empty section heading", { title: "Sparse", summary: "Summary", sections: [{ heading: "", body: "Body" }] }],
    ["section body", { title: "Sparse", summary: "Summary", sections: [{ heading: "Section" }] }],
    ["empty section body", { title: "Sparse", summary: "Summary", sections: [{ heading: "Section", body: "" }] }],
    ["whitespace-only section heading", { title: "Sparse", summary: "Summary", sections: [{ heading: " \t ", body: "Body" }] }],
    ["whitespace-only section body", { title: "Sparse", summary: "Summary", sections: [{ heading: "Section", body: " \n " }] }],
  ])("rejects general-report output missing required %s at the planner boundary", async (_missing, variables) => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document", templateId: "general-report", formats: ["pdf"], packageAsZip: false, title: "Sparse", variables,
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF report.",
      history: [{ role: "user", content: "Create a PDF report." }],
    })).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);
  });

  it("rejects a selected-template and format mismatch before rendering", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document", templateId: "general-presentation", formats: ["pdf"], packageAsZip: false, title: "Mismatch",
        variables: { title: "Mismatch", summary: "Summary", sections: [{ heading: "Section", body: "Body" }] },
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF presentation.",
      history: [{ role: "user", content: "Create a PDF presentation." }],
    })).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);
  });

  it("preserves the exact requested bullets while retaining report structure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T12:00:00.000Z"));
    const bullets = [
      "PDF generation works correctly.",
      "Document persistence works correctly.",
      "Historical downloads work correctly.",
    ];
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document", templateId: "general-report", formats: ["pdf"], packageAsZip: false, title: "LVTChat PDF Exact Content Test.",
        variables: {
          title: "LVTChat PDF Exact Content Test.", date: "2026-09-30",
          summary: "This document verifies LVTChat PDF generation in production.",
          sections: [{ heading: "Key Points", body: "This document verifies LVTChat PDF generation in production.", bullets }],
        },
      }),
    });

    const result = await resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF titled LVTChat PDF Exact Content Test. Include today's date once beneath the title, include this introductory sentence exactly, include these three bullet points exactly, and do not add anything else.",
      history: [{ role: "user", content: "Create the exact PDF." }],
    });

    expect(result?.templateId).toBe("general-report");
    expect(result?.variables.date).toBe("2026-09-30");
    expect(result?.variables.summary).toBe("This document verifies LVTChat PDF generation in production.");
    expect(result?.variables.sections).toEqual([{ heading: "Key Points", body: "This document verifies LVTChat PDF generation in production.", bullets }]);
    expect(() => renderTemplate({ templateId: "general-report", format: "pdf", variables: result?.variables ?? {} })).not.toThrow();
  });

  it("allows a no-bullet report while retaining required structure", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2031-01-02T12:00:00.000Z"));
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document", templateId: "general-report", formats: ["pdf"], packageAsZip: false, title: "LVTChat PDF No Bullet Test.",
        variables: {
          title: "LVTChat PDF No Bullet Test.", date: "2031-01-02",
          summary: "This document verifies LVTChat PDF generation in production.",
          sections: [{ heading: "Introduction", body: "This document verifies LVTChat PDF generation in production." }],
        },
      }),
    });

    const result = await resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF titled LVTChat PDF No Bullet Test. Include today's date once beneath the title and this sentence exactly. Do not include any bullet points.",
      history: [{ role: "user", content: "Create the no-bullet PDF." }],
    });

    expect(result?.templateId).toBe("general-report");
    expect(result?.variables.date).toBe("2031-01-02");
    expect(result?.variables.sections).toEqual([{ heading: "Introduction", body: "This document verifies LVTChat PDF generation in production." }]);
    expect(() => renderTemplate({ templateId: "general-report", format: "pdf", variables: result?.variables ?? {} })).not.toThrow();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses a semantic candidate gate without treating ordinary format questions as actions", async () => {
    expect(isDocumentGenerationCandidate("What is a PDF file?")).toBe(true);
    expect(isDocumentGenerationCandidate("Explain photosynthesis.")).toBe(false);

    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "none",
        templateId: "",
        formats: [],
        packageAsZip: false,
        title: "",
        variables: {},
      }),
    });

    await expect(
      resolveDocumentGenerationIntent({
        latestMessage: "What is a PDF file?",
        history: [{ role: "user", content: "What is a PDF file?" }],
      }),
    ).resolves.toBeNull();
  });

  it.each([
    "Create a TXT file from this conversation.",
    "Create a Markdown document from this.",
    "Generate a DOCX report.",
    "Create a PDF summary.",
    "Make an XLSX workbook.",
    "Create a PPTX presentation.",
    "Create a ZIP package.",
  ])("recognizes explicit supported-format generation: %s", (message) => {
    expect(isExplicitDocumentGenerationRequest(message)).toBe(true);
  });

  it.each([
    "What is a PDF?",
    "Explain DOCX files.",
    "Can Excel open XLSX files?",
    "What is Markdown?",
    "What does ZIP compression do?",
  ])("does not classify informational format questions as explicit generation: %s", (message) => {
    expect(isExplicitDocumentGenerationRequest(message)).toBe(false);
  });

  it("fails explicitly when the planner returns action:none for a generation request", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "none", templateId: "", formats: [], packageAsZip: false, title: "", variables: {},
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF summary.",
      history: [{ role: "user", content: "Create a PDF summary." }],
    })).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);
  });

  it.each([
    ["empty planner output", { output_text: "" }],
    ["malformed planner JSON", { output_text: "not-json" }],
  ])("fails explicitly for %s", async (_label, response) => {
    mocks.create.mockResolvedValue(response);

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF summary.",
      history: [{ role: "user", content: "Create a PDF summary." }],
    })).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);
  });

  it("fails explicitly when the planner throws for a generation request", async () => {
    mocks.create.mockRejectedValue(new Error("planner unavailable"));

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF summary.",
      history: [{ role: "user", content: "Create a PDF summary." }],
    })).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);
  });

  it("accepts only a validated structured generation action", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "general-report",
        formats: ["docx", "pdf"],
        packageAsZip: true,
        title: "Quarterly Review",
        variables: {
          summary: "A concise review.",
          sections: [{ heading: "Findings", body: "The result is ready." }],
        },
      }),
    });

    await expect(
      resolveDocumentGenerationIntent({
        latestMessage: "Create a DOCX and PDF report from this.",
        history: [{ role: "user", content: "Create a DOCX and PDF report from this." }],
      }),
    ).resolves.toMatchObject({
      templateId: "general-report",
      formats: ["docx", "pdf"],
      packageAsZip: true,
      variables: { title: "Quarterly Review" },
    });
  });

  it("fails closed for malformed or unknown model actions", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        templateId: "unknown-template",
        formats: ["pdf"],
        packageAsZip: false,
        title: "Unknown",
        variables: {},
      }),
    });

    await expect(
      resolveDocumentGenerationIntent({
        latestMessage: "Export this as a PDF.",
        history: [{ role: "user", content: "Export this as a PDF." }],
      }),
    ).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);
  });
  it("preserves typed scalar values returned for comparison-report XLSX planning", async () => {
    const values = [2, 899.99, true, null, "00123", "=SUM(A1:A2)"];
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document",
        document: {
          templateId: "comparison-report",
          formats: ["xlsx"],
          packageAsZip: false,
          title: "Typed comparison",
          variables: {
            title: "Typed comparison",
            firstColumnHeader: "Name",
            items: [{ name: "Alpha", description: null }],
            criteria: ["Quantity", "Unit Price", "Enabled", "Blank", "Reference", "Formula"],
            summary: "A typed comparison.",
            comparisons: [{ item: "Alpha", values }],
            observations: ["Values retain their intended types."],
            conclusion: null,
            filename: null,
          },
        },
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create an XLSX comparison workbook.",
      history: [{ role: "user", content: "Create an XLSX comparison workbook." }],
    })).resolves.toMatchObject({
      templateId: "comparison-report",
      formats: ["xlsx"],
      variables: { firstColumnHeader: "Name", comparisons: [{ item: "Alpha", values }] },
    });
  });

  it("provides exact template schemas to the planner for conversation summaries", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "none",
        templateId: "",
        formats: [],
        packageAsZip: false,
        title: "",
        variables: {},
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a TXT summary of the key points from this conversation.",
      history: [
        { role: "user", content: "We reviewed the release evidence." },
        { role: "assistant", content: "Two follow-up actions remain." },
      ],
    })).rejects.toBeInstanceOf(DocumentGenerationIntentValidationError);

    const plannerInput = mocks.create.mock.calls[0]?.[0]?.input as string;
    expect(plannerInput).toContain('"id":"general-report"');
    expect(plannerInput).toContain('"name":"sections"');
    expect(plannerInput).toContain('"kind":"object[]"');
    expect(plannerInput).toContain("We reviewed the release evidence.");
  });
});
