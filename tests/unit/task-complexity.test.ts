import { describe, expect, it } from "vitest";
import { classifyTaskComplexity } from "@/lib/ai/task-complexity";

describe("task complexity foundation", () => {
  it.each([
    "Explain ISO 14971.",
    "Explain CAPA and why it matters.",
    "Create an image of a cleanroom.",
    "Summarize this PDF.",
    "Create a PDF report.",
    "What's the latest FDA QMSR news?",
    "Compare X and Y.",
    "Explain X and Y.",
  ])("keeps a single-capability request on the fast path: %s", (prompt) => {
    expect(classifyTaskComplexity(prompt)).toBe("single_step");
  });

  it.each([
    "Search the latest FDA QMSR changes and create a PDF briefing.",
    "Search the latest FDA QMSR changes and create a PPTX briefing.",
    "Analyze this spreadsheet and create a PowerPoint.",
    "Analyze this spreadsheet and create a PPTX.",
    "Research EU MDR deadlines and create a Word report.",
    "Analyze this image and create a PDF defect report.",
    "Search current information, summarize it, and create an artifact.",
  ])("detects an obvious multi-capability structure: %s", (prompt) => {
    expect(classifyTaskComplexity(prompt)).toBe("multi_step");
  });

  it("treats empty or ambiguous input conservatively", () => {
    expect(classifyTaskComplexity("  ")).toBe("single_step");
    expect(classifyTaskComplexity("Search for research about FDA QMSR.")).toBe("single_step");
  });
});
