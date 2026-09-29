import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
}));

vi.mock("@/lib/openai", () => ({
  openai: { responses: { create: mocks.create } },
}));

import {
  isDocumentGenerationCandidate,
  resolveDocumentGenerationIntent,
} from "@/lib/documents/generation/intent";

describe("document generation intent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
