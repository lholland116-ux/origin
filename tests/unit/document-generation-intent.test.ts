import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  openai: { responses: { create: mocks.create } },
}));

import {
  getRuntimeCurrentDate,
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

  it("publishes template-aware schema branches for every registered template", async () => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({ action: "none", templateId: "", formats: [], packageAsZip: false, title: "", variables: {} }),
    });

    await resolveDocumentGenerationIntent({
      latestMessage: "What is a PDF file?",
      history: [{ role: "user", content: "What is a PDF file?" }],
    });

    const request = mocks.create.mock.calls[0]?.[0] as {
      text?: { format?: { schema?: { allOf?: readonly { anyOf?: readonly Record<string, unknown>[] }[] } } };
    };
    const branches = request.text?.format?.schema?.allOf?.[0]?.anyOf ?? [];
    expect(branches).toHaveLength(5);
    const templateBranches = branches.filter((branch) => {
      const properties = branch.properties as Record<string, { enum?: readonly string[] }> | undefined;
      return properties?.templateId?.enum?.[0] !== undefined;
    });
    expect(templateBranches.map((branch) => (branch.properties as Record<string, { enum?: readonly string[] }>).templateId?.enum?.[0])).toEqual([
      "general-report",
      "executive-summary",
      "comparison-report",
      "general-presentation",
    ]);
    const generalReport = templateBranches[0] as { properties: { variables: { required: readonly string[]; properties: { sections: { items: { required: readonly string[] } } } } } };
    expect(generalReport.properties.variables.required).toEqual(["title", "summary", "sections"]);
    expect(generalReport.properties.variables.properties.sections.items.required).toEqual(["heading", "body"]);
    const executive = templateBranches[1] as { properties: { variables: { required: readonly string[] } } };
    expect(executive.properties.variables.required).toEqual(["title", "context", "keyFindings", "implications", "recommendedActions"]);
    const comparison = templateBranches[2] as { properties: { variables: { required: readonly string[] } } };
    expect(comparison.properties.variables.required).toEqual(["title", "items", "criteria", "summary", "comparisons", "observations"]);
    const presentation = templateBranches[3] as { properties: { variables: { required: readonly string[]; properties: { sections: { items: { required: readonly string[] } } } } } };
    expect(presentation.properties.variables.required).toEqual(["title", "summary", "sections"]);
    expect(presentation.properties.variables.properties.sections.items.required).toEqual(["heading", "body"]);
  });

  it.each([
    ["summary", { title: "Sparse", sections: [{ heading: "Section", body: "Body" }] }],
    ["section heading", { title: "Sparse", summary: "Summary", sections: [{ body: "Body" }] }],
    ["section body", { title: "Sparse", summary: "Summary", sections: [{ heading: "Section" }] }],
  ])("rejects general-report output missing required %s at the planner boundary", async (_missing, variables) => {
    mocks.create.mockResolvedValue({
      output_text: JSON.stringify({
        action: "generate_document", templateId: "general-report", formats: ["pdf"], packageAsZip: false, title: "Sparse", variables,
      }),
    });

    await expect(resolveDocumentGenerationIntent({
      latestMessage: "Create a PDF report.",
      history: [{ role: "user", content: "Create a PDF report." }],
    })).resolves.toBeNull();
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
    })).resolves.toBeNull();
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
    ).resolves.toBeNull();
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

    await resolveDocumentGenerationIntent({
      latestMessage: "Create a TXT summary of the key points from this conversation.",
      history: [
        { role: "user", content: "We reviewed the release evidence." },
        { role: "assistant", content: "Two follow-up actions remain." },
      ],
    });

    const plannerInput = mocks.create.mock.calls[0]?.[0]?.input as string;
    expect(plannerInput).toContain('"id":"general-report"');
    expect(plannerInput).toContain('"name":"sections"');
    expect(plannerInput).toContain('"kind":"object[]"');
    expect(plannerInput).toContain("We reviewed the release evidence.");
  });
});
