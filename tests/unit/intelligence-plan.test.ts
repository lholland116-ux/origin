import { describe, expect, it } from "vitest";
import type { IntelligencePlan, PlanStep } from "@/lib/ai/intelligence-plan";
import { orderPlanSteps } from "@/lib/ai/plan-graph";
import { MAX_INTELLIGENCE_PLAN_STEPS, validateIntelligencePlan } from "@/lib/ai/plan-validator";

function plan(steps: PlanStep[], objective = "Complete a useful task."): IntelligencePlan {
  return { objective, steps, status: "draft" };
}

describe("intelligence plan validation", () => {
  it("accepts a valid one-step plan", () => {
    expect(validateIntelligencePlan(plan([
      { id: "answer", capability: "standard", dependsOn: [], inputs: [{ source: "user" }] },
    ]))).toMatchObject({ valid: true, orderedStepIds: ["answer"] });
  });

  it("accepts a sequential web-search, answer, document DAG", () => {
    const result = validateIntelligencePlan(plan([
      { id: "research", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }] },
      { id: "synthesize", capability: "standard", dependsOn: ["research"], inputs: [{ source: "step", stepId: "research", output: "search_results" }] },
      { id: "document", capability: "document_generation", dependsOn: ["synthesize"], inputs: [{ source: "step", stepId: "synthesize", output: "text" }] },
    ], "Research and prepare a report."));

    expect(result.valid).toBe(true);
    expect(result.orderedStepIds).toEqual(["research", "synthesize", "document"]);
  });

  it("accepts a DAG with independent branches and a join", () => {
    const result = validateIntelligencePlan(plan([
      { id: "search", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }] },
      { id: "analyze", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }] },
      { id: "combine", capability: "standard", dependsOn: ["analyze", "search"], inputs: [
        { source: "step", stepId: "analyze", output: "structured_data" },
        { source: "step", stepId: "search", output: "search_results" },
      ] },
    ]));
    expect(result.valid).toBe(true);
    expect(result.orderedStepIds.indexOf("analyze")).toBeLessThan(result.orderedStepIds.indexOf("combine"));
    expect(result.orderedStepIds.indexOf("search")).toBeLessThan(result.orderedStepIds.indexOf("combine"));
  });

  it("rejects unknown capabilities and duplicate step IDs", () => {
    expect(validateIntelligencePlan(plan([
      { id: "bad", capability: "unknown", dependsOn: [] } as unknown as PlanStep,
    ])).errors.join(" ")).toMatch(/Unknown capability/);

    const duplicate = plan([
      { id: "same", capability: "standard", dependsOn: [] },
      { id: "same", capability: "web_search", dependsOn: [] },
    ]);
    expect(validateIntelligencePlan(duplicate).errors.join(" ")).toMatch(/Duplicate step id/);
  });

  it("rejects missing dependencies, self-dependencies, and cycles", () => {
    expect(validateIntelligencePlan(plan([
      { id: "a", capability: "standard", dependsOn: ["missing"] },
    ])).errors.join(" ")).toMatch(/missing dependency/i);

    expect(validateIntelligencePlan(plan([
      { id: "a", capability: "standard", dependsOn: ["a"] },
    ])).errors.join(" ")).toMatch(/cannot depend on itself/i);

    expect(validateIntelligencePlan(plan([
      { id: "a", capability: "standard", dependsOn: ["b"] },
      { id: "b", capability: "standard", dependsOn: ["a"] },
    ])).errors.join(" ")).toMatch(/cycle/i);

    expect(orderPlanSteps([
      { id: "a", capability: "standard", dependsOn: ["c"] },
      { id: "b", capability: "standard", dependsOn: ["a"] },
      { id: "c", capability: "standard", dependsOn: ["b"] },
    ])).toEqual({ ok: false, reason: "cycle" });
  });

  it("rejects empty objectives and empty plans", () => {
    expect(validateIntelligencePlan(plan([
      { id: "a", capability: "standard", dependsOn: [] },
    ], "  ")).valid).toBe(false);
    expect(validateIntelligencePlan(plan([])).valid).toBe(false);
  });

  it("allows six steps and rejects seven", () => {
    expect(MAX_INTELLIGENCE_PLAN_STEPS).toBe(6);
    const steps = (count: number) => Array.from({ length: count }, (_, index) => ({
      id: `step-${index + 1}`,
      capability: "standard" as const,
      dependsOn: [],
    }));
    expect(validateIntelligencePlan(plan(steps(6))).valid).toBe(true);
    expect(validateIntelligencePlan(plan(steps(7))).errors.join(" ")).toMatch(/at most 6 steps/);
  });

  it("returns a deterministic topological order for independent nodes", () => {
    const steps = [
      { id: "c", capability: "standard" as const, dependsOn: [] },
      { id: "a", capability: "standard" as const, dependsOn: [] },
      { id: "b", capability: "standard" as const, dependsOn: [] },
    ];
    const first = orderPlanSteps(steps);
    expect(first).toEqual(orderPlanSteps([...steps].reverse()));
  });

  it("accepts compatible references and rejects incompatible chains", () => {
    const compatible = plan([
      { id: "search", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }] },
      { id: "answer", capability: "standard", dependsOn: ["search"], inputs: [{ source: "step", stepId: "search", output: "search_results" }] },
    ]);
    expect(validateIntelligencePlan(compatible).valid).toBe(true);

    const incompatible = plan([
      { id: "search", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }] },
      { id: "edit", capability: "image_editing", dependsOn: ["search"], inputs: [
        { source: "step", stepId: "search", output: "search_results" },
      ] },
    ]);
    expect(validateIntelligencePlan(incompatible).errors.join(" ")).toMatch(/cannot produce|cannot accept/i);

    const inconsistentOutput = plan([
      { id: "analyze", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }], expectedOutput: "text" },
      { id: "document", capability: "document_generation", dependsOn: ["analyze"], inputs: [{ source: "step", stepId: "analyze", output: "structured_data" }] },
    ]);
    expect(validateIntelligencePlan(inconsistentOutput).errors.join(" ")).toMatch(/does not match the expected output/i);
  });

  it("requires attachment inputs for attachment-backed capabilities", () => {
    const missing = plan([{ id: "analyze", capability: "file_analysis", dependsOn: [] }]);
    expect(validateIntelligencePlan(missing).errors.join(" ")).toMatch(/requires an attachment/i);

    const present = plan([{
      id: "analyze",
      capability: "file_analysis",
      dependsOn: [],
      inputs: [{ source: "attachment", output: "file" }],
    }]);
    expect(validateIntelligencePlan(present).valid).toBe(true);
  });

  it("accepts JSON-safe operational contracts without embedding rationale or executable values", () => {
    const value = plan([{
      id: "answer",
      capability: "standard",
      dependsOn: [],
      inputs: [{ source: "user" }],
      expectedOutput: "text",
    }]);
    expect(JSON.parse(JSON.stringify(value))).toEqual(value);
    expect(Object.values(value.steps[0])).not.toContain(expect.any(Function));
  });
});
