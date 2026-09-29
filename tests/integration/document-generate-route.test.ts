import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "10000000-0000-4000-8000-000000000001";

const mocks = vi.hoisted(() => ({
  supabase: {
    auth: { getUser: vi.fn() },
  },
}));

vi.mock("../../lib/supabase/server", () => ({
  createServerSupabaseClient: vi.fn(async () => mocks.supabase),
}));

import { POST } from "../../app/api/documents/generate/route";

const generalVariables = {
  title: "Quarterly Review",
  summary: "A concise review of the quarter.",
  sections: [
    { heading: "Findings", body: "The operating model improved." },
  ],
  recommendations: ["Maintain the review cadence"],
  conclusion: "Continue the current approach.",
};

const comparisonVariables = {
  title: "Option Comparison",
  items: [{ name: "Alpha" }, { name: "Beta" }],
  criteria: ["Cost", "Risk"],
  summary: "Alpha is safer while Beta costs less.",
  comparisons: [
    { item: "Alpha", values: ["Medium", "Low"] },
    { item: "Beta", values: ["Low", "Medium"] },
  ],
  observations: ["Both options remain viable."],
};

const presentationVariables = {
  title: "Release Review",
  summary: "The release is ready.",
  sections: [{ heading: "Findings", body: "Qualification passed." }],
  recommendations: ["Complete review"],
};

function request(body: unknown): Request {
  return new Request("http://localhost/api/documents/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/documents/generate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: { id: USER_ID } },
      error: null,
    });
  });

  it("requires authentication", async () => {
    mocks.supabase.auth.getUser.mockResolvedValue({
      data: { user: null },
      error: null,
    });

    const response = await POST(request({
      templateId: "general-report",
      format: "txt",
      variables: generalVariables,
    }));

    expect(response.status).toBe(401);
  });

  it.each([
    ["unsupported format", { format: "html" }],
    ["unknown template", { templateId: "missing-template", format: "txt" }],
    ["malformed variables", { format: "txt", variables: { title: "Missing sections" } }],
  ])("rejects %s", async (_label, overrides) => {
    const response = await POST(
      request({
        templateId: "general-report",
        variables: generalVariables,
        ...overrides,
      }),
    );

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBeTruthy();
  });

  it.each([
    ["txt", "text/plain", "Quarterly-Review.txt", generalVariables],
    ["md", "text/markdown", "Quarterly-Review.md", generalVariables],
    [
      "docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "Quarterly-Review.docx",
      generalVariables,
    ],
    ["pdf", "application/pdf", "Quarterly-Review.pdf", generalVariables],
    [
      "xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Option-Comparison.xlsx",
      comparisonVariables,
    ],
    [
      "pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Release-Review.pptx",
      presentationVariables,
    ],
  ])("returns a validated %s artifact", async (format, mimeType, filename, variables) => {
    const response = await POST(
      request({ templateId: format === "xlsx" ? "comparison-report" : format === "pptx" ? "general-presentation" : "general-report", format, variables }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain(mimeType);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${filename}"`);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect((await response.arrayBuffer()).byteLength).toBeGreaterThan(0);
  });

  it("rejects an oversized JSON request before generation", async () => {
    const response = await POST(
      request({
        templateId: "general-report",
        format: "txt",
        variables: { ...generalVariables, summary: "x".repeat(300_000) },
      }),
    );

    expect(response.status).toBe(413);
  });

  it("packages multiple formats into a ZIP artifact", async () => {
    const response = await POST(
      request({
        templateId: "general-report",
        format: "zip",
        formats: ["docx", "pdf"],
        variables: generalVariables,
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toBe(
      'attachment; filename="Quarterly-Review.zip"',
    );
    expect(Array.from(new Uint8Array(await response.arrayBuffer())).slice(0, 4)).toEqual([
      0x50,
      0x4b,
      0x03,
      0x04,
    ]);
  });
});
