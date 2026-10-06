import { describe, expect, it, vi } from "vitest";
import { createMultiStepPlanner, planMultiStepObjective } from "@/lib/ai/multi-step-planner";
import { validateIntelligencePlan } from "@/lib/ai/plan-validator";
import type { MultiStepPlannerModelClient } from "@/lib/ai/multi-step-planner-model-client";

const userInput = { source: "user", stepId: null, output: null };
const attachmentInput = (output: "file" | "image") => ({ source: "attachment", output });
const stepInput = (stepId: string, output: string | null = null) => ({
  source: "step",
  stepId,
  ...(output ? { output } : {}),
});

function modelPlan(steps: readonly Record<string, unknown>[]) {
  return { kind: "planned", failureCode: null, steps };
}

function modelStep(
  id: string,
  capability: string,
  dependsOn: string[] = [],
  inputs: Array<Record<string, unknown>> = [userInput],
  expectedOutput: string | null = null,
) {
  return { id, capability, dependsOn, inputs, expectedOutput };
}

const validModelPlan = modelPlan([
  modelStep("answer", "standard", [], [userInput], "text"),
  modelStep("document", "document_generation", ["answer"], [stepInput("answer", "text")], "document"),
]);

function mockModelClient(...responses: unknown[]): MultiStepPlannerModelClient {
  const generateStructuredPlan = vi.fn(async () => responses.shift());
  return { generateStructuredPlan };
}

describe("multi-step planner deterministic path", () => {
  it.each([
    ["Search the latest FDA QMSR changes and create a PDF briefing.", []],
    ["Search the latest FDA QMSR changes and create a PPTX briefing.", []],
    ["Research current EU MDR deadlines, summarize the findings, and create a Word report.", []],
  ])("plans web research and an artifact without calling a model: %s", async (objective, attachments) => {
    const modelClient = mockModelClient();
    const result = await createMultiStepPlanner(modelClient).plan({ objective, attachments });

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(result.source).toBe("deterministic");
    expect(result.plan.steps.map(({ capability }) => capability)).toEqual([
      "web_search",
      "standard",
      "document_generation",
    ]);
    expect(result.plan.steps[0]).toMatchObject({
      dependsOn: [],
      inputs: [{ source: "user" }],
      expectedOutput: "search_results",
    });
    expect(result.plan.steps[1]).toMatchObject({
      dependsOn: ["step-1"],
      inputs: [{ source: "step", stepId: "step-1" }],
      expectedOutput: "text",
    });
    expect(result.plan.steps[2]).toMatchObject({
      dependsOn: ["step-2"],
      inputs: [{ source: "step", stepId: "step-2", output: "text" }],
      expectedOutput: "document",
    });
    expect(validateIntelligencePlan(result.plan).valid).toBe(true);
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();
  });

  it.each([
    ["Analyze this complaint spreadsheet and create a PDF report.", ["file"]],
    ["Analyze this spreadsheet and create a PowerPoint summarizing major failure trends.", ["file"]],
    ["Analyze this image, identify the defect, and create a PDF report.", ["image"]],
  ] as const)("plans attachment analysis followed by synthesis and artifact generation", async (objective, attachments) => {
    const modelClient = mockModelClient();
    const result = await createMultiStepPlanner(modelClient).plan({ objective, attachments });

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(result.source).toBe("deterministic");
    expect(result.plan.steps.map(({ capability }) => capability)).toEqual([
      "file_analysis",
      "standard",
      "document_generation",
    ]);
    expect(result.plan.steps[0]).toMatchObject({
      inputs: [attachmentInput(attachments[0])],
      expectedOutput: "text",
    });
    expect(result.plan.steps[1]).toMatchObject({
      dependsOn: ["step-1"],
      inputs: [{ source: "step", stepId: "step-1" }],
      expectedOutput: "text",
    });
    expect(result.plan.steps[2].dependsOn).toEqual(["step-2"]);
    expect(validateIntelligencePlan(result.plan).valid).toBe(true);
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();
  });

  it("represents combined web research and file analysis as a merge DAG", async () => {
    const result = await createMultiStepPlanner(mockModelClient()).plan({
      objective: "Search current information and compare it with this uploaded report, then create a briefing.",
      attachments: ["file"],
    });

    expect(result.kind).toBe("planned");
    if (result.kind !== "planned") return;
    expect(result.plan.steps.map(({ capability }) => capability)).toEqual([
      "web_search",
      "file_analysis",
      "standard",
      "document_generation",
    ]);
    expect(result.plan.steps[2]).toMatchObject({
      dependsOn: ["step-1", "step-2"],
      inputs: [stepInput("step-1"), stepInput("step-2")],
    });
    expect(validateIntelligencePlan(result.plan).valid).toBe(true);
  });

  it("does not invent a missing attachment or plan without required capabilities", async () => {
    const modelClient = mockModelClient(validModelPlan);
    await expect(createMultiStepPlanner(modelClient).plan({
      objective: "Analyze this complaint spreadsheet and create a PDF report.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "missing_required_attachment", plannerModelCalls: 0, repairAttempted: false });
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();

    await expect(createMultiStepPlanner(modelClient).plan({
      objective: "Search current information and compare it with this uploaded report, then create a briefing.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "missing_required_attachment", plannerModelCalls: 0, repairAttempted: false });
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();

    await expect(createMultiStepPlanner(mockModelClient()).plan({
      objective: "Search the latest FDA changes and create a PDF report.",
      availableCapabilities: ["standard", "not_registered"],
    })).resolves.toEqual({ kind: "unable_to_plan", code: "unsupported_objective", plannerModelCalls: 0, repairAttempted: false });
  });

  it("keeps V1 single-step cases on the zero-model-call fast path", async () => {
    const modelClient = mockModelClient(validModelPlan);
    const planner = createMultiStepPlanner(modelClient);
    for (const objective of [
      "Explain ISO 14971.",
      "Explain CAPA and why it matters.",
      "Compare ISO 13485 and FDA QMSR.",
      "Create an image of a cleanroom.",
      "Summarize this PDF.",
      "Create a PDF report.",
      "What's the latest FDA QMSR news?",
    ]) {
      await expect(planner.plan({ objective })).resolves.toEqual({ kind: "single_step", plannerModelCalls: 0, repairAttempted: false });
    }
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();
  });
});

describe("multi-step planner model path", () => {
  it("accepts a valid structured plan only after the shared validator approves it", async () => {
    const modelClient = mockModelClient(validModelPlan);
    const result = await createMultiStepPlanner(modelClient).plan({
      objective: "Compare these two proposals and create a document.",
    });
    expect(result).toMatchObject({ kind: "planned", source: "model", plan: { status: "validated" } });
    expect(modelClient.generateStructuredPlan).toHaveBeenCalledTimes(1);
    if (result.kind === "planned") expect(validateIntelligencePlan(result.plan).valid).toBe(true);
  });

  it("rejects unknown model capabilities and permits only one bounded repair", async () => {
    const bad = modelPlan([
      modelStep("answer", "browser", [], [userInput], "text"),
      modelStep("document", "document_generation", ["answer"], [stepInput("answer", "text")], "document"),
    ]);
    const modelClient = mockModelClient(bad, validModelPlan);
    const result = await createMultiStepPlanner(modelClient).plan({
      objective: "Compare these two proposals and create a document.",
    });
    expect(result.kind).toBe("planned");
    expect(modelClient.generateStructuredPlan).toHaveBeenCalledTimes(2);
    expect(modelClient.generateStructuredPlan).toHaveBeenLastCalledWith(expect.objectContaining({
      repair: expect.objectContaining({ validationErrors: expect.arrayContaining([expect.stringContaining("Unknown capability")]) }),
    }));
  });

  it.each([
    modelPlan([
      modelStep("first", "standard", ["second"], [stepInput("second", "text")], "text"),
      modelStep("second", "standard", ["first"], [stepInput("first", "text")], "text"),
    ]),
    modelPlan([
      modelStep("answer", "standard", ["missing"], [stepInput("missing", "text")], "text"),
      modelStep("document", "document_generation", ["answer"], [stepInput("answer", "text")], "document"),
    ]),
  ])("attempts one repair for graph-invalid structured plans", async (invalidPlan) => {
    const modelClient = mockModelClient(invalidPlan, validModelPlan);
    const result = await createMultiStepPlanner(modelClient).plan({
      objective: "Compare these two proposals and create a document.",
    });
    expect(result.kind).toBe("planned");
    expect(modelClient.generateStructuredPlan).toHaveBeenCalledTimes(2);
  });

  it("does not truncate plans over six steps", async () => {
    const oversized = modelPlan(Array.from({ length: 7 }, (_, index) =>
      modelStep(`step-${index + 1}`, "standard", [], [userInput], "text"),
    ));
    const modelClient = mockModelClient(oversized, validModelPlan);
    await expect(createMultiStepPlanner(modelClient).plan({
      objective: "Compare these two proposals and create a document.",
      taskComplexity: "multi_step",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "plan_too_complex", plannerModelCalls: 1, repairAttempted: false });
    expect(modelClient.generateStructuredPlan).toHaveBeenCalledTimes(1);
  });

  it("returns safe codes for invalid output, unsuccessful repair, and provider failure", async () => {
    await expect(createMultiStepPlanner(mockModelClient({ malformed: true })).plan({
      objective: "Compare these two proposals and create a document.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "invalid_model_plan", plannerModelCalls: 1, repairAttempted: false });

    const stillInvalid = modelPlan([
      modelStep("a", "standard", ["b"], [stepInput("b", "text")], "text"),
      modelStep("b", "standard", ["a"], [stepInput("a", "text")], "text"),
    ]);
    const repairClient = mockModelClient(stillInvalid, stillInvalid);
    await expect(createMultiStepPlanner(repairClient).plan({
      objective: "Compare these two proposals and create a document.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "invalid_model_plan", plannerModelCalls: 2, repairAttempted: true });
    expect(repairClient.generateStructuredPlan).toHaveBeenCalledTimes(2);

    const providerFailure: MultiStepPlannerModelClient = {
      generateStructuredPlan: vi.fn().mockRejectedValue(new Error("provider details stay private")),
    };
    await expect(createMultiStepPlanner(providerFailure).plan({
      objective: "Compare these two proposals and create a document.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "planner_unavailable", plannerModelCalls: 1, repairAttempted: false });
  });

  it("does not accept chain-of-thought fields and never exceeds two model calls", async () => {
    const withRationale = { ...validModelPlan, rationale: "private chain" };
    const modelClient = mockModelClient(withRationale);
    await expect(createMultiStepPlanner(modelClient).plan({
      objective: "Compare these two proposals and create a document.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "invalid_model_plan", plannerModelCalls: 1, repairAttempted: false });
    expect(modelClient.generateStructuredPlan).toHaveBeenCalledTimes(1);
  });

  it("maps model-declared failures into the typed failure result", async () => {
    const modelClient = mockModelClient({
      kind: "unable_to_plan",
      failureCode: "plan_too_complex",
      steps: [],
    });
    await expect(createMultiStepPlanner(modelClient).plan({
      objective: "Compare these two proposals and create a document.",
    })).resolves.toEqual({ kind: "unable_to_plan", code: "plan_too_complex", plannerModelCalls: 1, repairAttempted: false });
    expect(modelClient.generateStructuredPlan).toHaveBeenCalledTimes(1);
  });

  it("keeps the default planner usable for a single-step request without loading a model", async () => {
    await expect(planMultiStepObjective({ objective: "Explain ISO 14971." })).resolves.toEqual({ kind: "single_step", plannerModelCalls: 0, repairAttempted: false });
  });

  it("disables only model-assisted planning when governance turns model planning off", async () => {
    const modelClient = mockModelClient(validModelPlan);
    const planner = createMultiStepPlanner(modelClient);
    await expect(planner.plan({
      objective: "Compare these two proposals and create a document.",
      modelPlanningAllowed: false,
    })).resolves.toMatchObject({
      kind: "unable_to_plan",
      code: "model_planning_disabled",
      plannerModelCalls: 0,
    });
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();

    await expect(planner.plan({
      objective: "Search the latest FDA QMSR changes and create a PDF briefing.",
      modelPlanningAllowed: false,
    })).resolves.toMatchObject({
      kind: "planned",
      source: "deterministic",
      plannerModelCalls: 0,
    });
    expect(modelClient.generateStructuredPlan).not.toHaveBeenCalled();
  });
});
