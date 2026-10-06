import { describe, expect, it, vi } from "vitest";
import {
  createIntelligenceDecisionCoordinator,
  mapPlanningFailureToUserSafeFailure,
  type IntelligenceDecisionInput,
} from "@/lib/ai/intelligence-decision-coordinator";
import { CAPABILITY_REGISTRY } from "@/lib/ai/capability-registry";
import { createMultiStepPlanner, type PlanningResult } from "@/lib/ai/multi-step-planner";
import type { MultiStepPlannerModelClient } from "@/lib/ai/multi-step-planner-model-client";
import { PLANNED_EXECUTION_HANDOFF_VERSION } from "@/lib/ai/planner-governance";
import { MAX_INTELLIGENCE_PLAN_STEPS, validateIntelligencePlan } from "@/lib/ai/plan-validator";

function decisionInput(
  prompt: string,
  router: Partial<IntelligenceDecisionInput["router"]> = {},
  extras: Partial<IntelligenceDecisionInput> = {},
): IntelligenceDecisionInput {
  return {
    prompt,
    router: { mode: "auto", hasImageContext: false, ...router },
    ...extras,
  };
}

const modelPlan = {
  kind: "planned",
  failureCode: null,
  steps: [
    { id: "answer", capability: "standard", dependsOn: [], inputs: [{ source: "user", stepId: null, output: null }], expectedOutput: "text" },
    { id: "document", capability: "document_generation", dependsOn: ["answer"], inputs: [{ source: "step", stepId: "answer", output: "text" }], expectedOutput: "document" },
  ],
};

function modelClient(...responses: unknown[]): MultiStepPlannerModelClient {
  return { generateStructuredPlan: vi.fn(async () => responses.shift()) };
}

describe("Intelligence Decision Coordinator single-step V1 fast path", () => {
  it.each([
    ["Explain ISO 14971.", {}, "standard"],
    ["What is the latest FDA guidance?", { deferAutoWebSearch: true }, "web_search"],
    ["Create an image of a cleanroom.", {}, "image_generation"],
    ["A quiet lake at sunrise", { mode: "create_image" }, "image_generation"],
    ["Make the walls blue.", { hasImageContext: true }, "image_editing"],
    ["Make the walls blue.", { hasImageAttachment: true }, "image_editing"],
    ["What are the benefits of ISO 14971?", { hasImageContext: true }, "standard"],
    ["Summarize this image.", { hasImageAttachment: true }, "file_analysis"],
    ["Create a PDF report.", {}, "document_generation"],
  ] as const)("keeps the existing V1 route for %s", async (prompt, router, route) => {
    const plan = vi.fn(async (): Promise<PlanningResult> => {
      throw new Error("single-step requests must not reach the planner");
    });
    const coordinator = createIntelligenceDecisionCoordinator({ plan });
    const decision = await coordinator.decideIntelligenceAction(decisionInput(prompt, router));

    expect(decision).toMatchObject({ kind: "single_step", route: { route } });
    expect(decision.telemetry).toMatchObject({
      task_complexity: "single_step",
      planning_outcome: "single_step",
      planner_model_calls: 0,
      repair_attempted: false,
    });
    expect(plan).not.toHaveBeenCalled();
  });

  it("preserves explicit Search routing for single-step requests", async () => {
    const decision = await createIntelligenceDecisionCoordinator().decideIntelligenceAction(
      decisionInput("What is the latest FDA guidance?", { mode: "web_search" }),
    );
    expect(decision).toMatchObject({ kind: "single_step", route: { route: "web_search", reason: "explicit_web_search" } });
  });
});

describe("Intelligence Decision Coordinator multi-step handoffs", () => {
  it.each([
    ["Search the latest FDA QMSR changes and create a PDF briefing.", [], ["web_search", "standard", "document_generation"]],
    ["Analyze these complaints and create a PowerPoint.", ["file"], ["file_analysis", "standard", "document_generation"]],
    ["Research EU MDR deadlines, summarize them, and create a Word report.", [], ["web_search", "standard", "document_generation"]],
    ["Identify the defect and create a PDF report.", ["image"], ["file_analysis", "standard", "document_generation"]],
  ] as const)("returns an unexecuted governed plan for %s", async (prompt, attachments, capabilities) => {
    const coordinator = createIntelligenceDecisionCoordinator();
    const decision = await coordinator.decideIntelligenceAction(decisionInput(
      prompt,
      { hasImageAttachment: attachments[0] === "image", hasDocumentAttachment: attachments[0] === "file" },
      { attachments },
    ));

    expect(decision.kind).toBe("multi_step");
    if (decision.kind !== "multi_step") return;
    expect(decision.handoff.version).toBe(PLANNED_EXECUTION_HANDOFF_VERSION);
    expect(decision.handoff.plannerSource).toBe("deterministic");
    expect(decision.handoff.plan.status).toBe("validated");
    expect(validateIntelligencePlan(decision.handoff.plan).valid).toBe(true);
    expect([...new Set(decision.handoff.plan.steps.map(({ capability }) => capability))].sort()).toEqual([...capabilities].sort());
    expect(decision.handoff.governance.maxSteps).toBe(MAX_INTELLIGENCE_PLAN_STEPS);
    expect(decision.handoff.governance.capabilityIds).toEqual([...capabilities].sort());
    expect(decision.telemetry).toMatchObject({
      task_complexity: "multi_step",
      planning_outcome: "planned",
      planner_source: "deterministic",
      planner_model_calls: 0,
      repair_attempted: false,
      failure_code: null,
    });
  });

  it("produces a dependency-respecting DAG order for web plus attached-report comparison", async () => {
    const decision = await createIntelligenceDecisionCoordinator().decideIntelligenceAction(decisionInput(
      "Compare this report with current FDA guidance and create a briefing.",
      { hasDocumentAttachment: true },
      { attachments: ["file"] },
    ));
    expect(decision.kind).toBe("multi_step");
    if (decision.kind !== "multi_step") return;

    const { plan, orderedStepIds } = decision.handoff;
    expect(plan.steps.map(({ capability }) => capability)).toEqual([
      "web_search", "file_analysis", "standard", "document_generation",
    ]);
    expect(orderedStepIds).toEqual(["step-1", "step-2", "step-3", "step-4"]);
    expect(orderedStepIds).toHaveLength(plan.steps.length);
    expect(new Set(orderedStepIds).size).toBe(plan.steps.length);
    const orderIndex = new Map(orderedStepIds.map((id, index) => [id, index]));
    for (const step of plan.steps) {
      for (const dependency of step.dependsOn) {
        expect(orderIndex.get(dependency)).toBeLessThan(orderIndex.get(step.id)!);
      }
    }
  });

  it("emits metadata-only attachment context and a JSON-safe operational contract", async () => {
    const decision = await createIntelligenceDecisionCoordinator().decideIntelligenceAction(decisionInput(
      "Analyze this image and create a PDF defect report.",
      { hasImageAttachment: true },
      { attachments: ["image", "image"] },
    ));
    expect(decision.kind).toBe("multi_step");
    if (decision.kind !== "multi_step") return;
    expect(decision.handoff.attachmentContext).toEqual({ imageCount: 2, fileCount: 0 });
    expect(JSON.stringify(decision.handoff)).not.toContain("raw upload");
    expect(JSON.stringify(decision.handoff)).not.toContain("api_key");
    expect(JSON.stringify(decision.handoff)).not.toContain("generateStructuredPlan");
    expect(JSON.parse(JSON.stringify(decision.handoff))).toEqual(decision.handoff);
    expect(Object.keys(decision.handoff)).toEqual([
      "version", "objective", "plan", "orderedStepIds", "plannerSource", "attachmentContext", "governance",
    ]);
  });

  it("retains model source and records bounded model/repair usage", async () => {
    const client = modelClient(modelPlan);
    const planner = createMultiStepPlanner(client);
    const decision = await createIntelligenceDecisionCoordinator({ plan: planner.plan }).decideIntelligenceAction(
      decisionInput("Compare these two proposals and create a document."),
    );
    expect(decision.kind).toBe("multi_step");
    if (decision.kind !== "multi_step") return;
    expect(decision.handoff.plannerSource).toBe("model");
    expect(decision.telemetry).toMatchObject({ planner_model_calls: 1, repair_attempted: false });
    expect(client.generateStructuredPlan).toHaveBeenCalledTimes(1);
    expect(decision.handoff.governance.maxModelCalls).toBe(2);
    expect(decision.handoff.governance.maxRepairAttempts).toBe(1);
  });
});

describe("Intelligence Decision Coordinator failures and governance", () => {
  it("returns a typed missing-attachment failure instead of pretending Standard completed the request", async () => {
    const decision = await createIntelligenceDecisionCoordinator().decideIntelligenceAction(decisionInput(
      "Analyze this spreadsheet and create a PDF report.",
    ));
    expect(decision).toMatchObject({
      kind: "unable_to_plan",
      failure: { code: "missing_required_attachment" },
      telemetry: { planning_outcome: "unable_to_plan", failure_code: "missing_required_attachment" },
    });
    expect(decision.kind).not.toBe("single_step");
    if (decision.kind === "unable_to_plan") {
      expect(decision.failure.message).toMatch(/attach the file or image/i);
      expect(decision.failure.message).not.toContain("validation");
    }
  });

  it.each([
    ["plan_too_complex", "This request has too many dependent steps. Try simplifying it.", 1, false],
    ["planner_unavailable", "Multi-step planning is temporarily unavailable. Please try again later.", 1, false],
    ["invalid_model_plan", "I couldn't safely prepare a plan for that request. Try rephrasing it.", 1, false],
  ] as const)("maps %s to a user-safe non-execution result", async (code, message, modelCalls, repairAttempted) => {
    const plan = vi.fn(async (): Promise<PlanningResult> => ({
      kind: "unable_to_plan",
      code,
      plannerModelCalls: modelCalls,
      repairAttempted,
    }));
    const decision = await createIntelligenceDecisionCoordinator({ plan }).decideIntelligenceAction(
      decisionInput("Search current guidance and create a report."),
    );
    expect(decision).toMatchObject({ kind: "unable_to_plan", failure: { code, message } });
    expect(plan).toHaveBeenCalledOnce();
    expect(decision.telemetry.planning_outcome).toBe("unable_to_plan");
  });

  it("maps final invalid output after the bounded repair to a generic safe failure", async () => {
    const invalid = { kind: "planned", failureCode: null, steps: [{ id: "a", capability: "standard", dependsOn: [], inputs: [], expectedOutput: "text" }] };
    const client = modelClient(invalid, invalid);
    const coordinator = createIntelligenceDecisionCoordinator({ plan: createMultiStepPlanner(client).plan });
    const decision = await coordinator.decideIntelligenceAction(decisionInput("Compare these proposals and create a document."));
    expect(decision).toMatchObject({
      kind: "unable_to_plan",
      failure: { code: "invalid_model_plan", message: "I couldn't safely prepare a plan for that request. Try rephrasing it." },
      telemetry: { planner_model_calls: 2, repair_attempted: true },
    });
    expect(client.generateStructuredPlan).toHaveBeenCalledTimes(2);
  });

  it("narrows capabilities to registered available IDs and rejects a plan that elevates availability", async () => {
    const received: string[][] = [];
    const unavailablePlan: PlanningResult = {
      kind: "planned",
      source: "model",
      plannerModelCalls: 1,
      repairAttempted: false,
      plan: {
        objective: "Search current guidance and create a report.",
        status: "validated",
        steps: [
          { id: "analysis", capability: "file_analysis", dependsOn: [], inputs: [{ source: "attachment", output: "file" }], expectedOutput: "text" },
          { id: "document", capability: "document_generation", dependsOn: ["analysis"], inputs: [{ source: "step", stepId: "analysis", output: "text" }], expectedOutput: "document" },
        ],
      },
    };
    const plan = vi.fn(async (input): Promise<PlanningResult> => {
      received.push([...(input.availableCapabilities ?? [])]);
      return unavailablePlan;
    });
    const decision = await createIntelligenceDecisionCoordinator({ plan }).decideIntelligenceAction(decisionInput(
      "Search current guidance and create a report.",
      {},
      { availableCapabilities: ["standard", "not_registered"] },
    ));
    expect(received).toEqual([["standard"]]);
    expect(decision).toMatchObject({ kind: "unable_to_plan", failure: { code: "invalid_model_plan" } });
  });

  it("rejects an unregistered capability even if an injected planner returns it", async () => {
    const invalidPlan = {
      kind: "planned",
      source: "model",
      plannerModelCalls: 1,
      repairAttempted: false,
      plan: {
        objective: "Search current guidance and create a report.",
        status: "validated",
        steps: [
          { id: "research", capability: "arbitrary_url_tool", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
          { id: "document", capability: "document_generation", dependsOn: ["research"], inputs: [{ source: "step", stepId: "research" }], expectedOutput: "document" },
        ],
      },
    } as unknown as PlanningResult;
    const decision = await createIntelligenceDecisionCoordinator({
      plan: async () => invalidPlan,
    }).decideIntelligenceAction(decisionInput("Search current guidance and create a report."));
    expect(decision).toMatchObject({ kind: "unable_to_plan", failure: { code: "invalid_model_plan" } });
  });

  it("does not invoke the model when model planning is disabled, while allowing deterministic plans", async () => {
    const client = modelClient(modelPlan);
    const coordinator = createIntelligenceDecisionCoordinator({
      plan: createMultiStepPlanner(client).plan,
      modelPlanningAllowed: false,
    });
    const modelOnly = await coordinator.decideIntelligenceAction(decisionInput("Compare these proposals and create a document."));
    expect(modelOnly).toMatchObject({ kind: "unable_to_plan", failure: { code: "model_planning_disabled" } });
    const deterministic = await coordinator.decideIntelligenceAction(decisionInput("Search the latest FDA QMSR changes and create a PDF briefing."));
    expect(deterministic.kind).toBe("multi_step");
    expect(client.generateStructuredPlan).not.toHaveBeenCalled();

    const forbiddenModelPlan = await createIntelligenceDecisionCoordinator({
      plan: async (): Promise<PlanningResult> => ({
        kind: "planned",
        source: "model",
        plannerModelCalls: 1,
        repairAttempted: false,
        plan: {
          objective: "Search the latest FDA QMSR changes and create a PDF briefing.",
          status: "validated",
          steps: [
            { id: "research", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
            { id: "document", capability: "document_generation", dependsOn: ["research"], inputs: [{ source: "step", stepId: "research" }], expectedOutput: "document" },
          ],
        },
      }),
      modelPlanningAllowed: false,
    }).decideIntelligenceAction(decisionInput("Search the latest FDA QMSR changes and create a PDF briefing."));
    expect(forbiddenModelPlan).toMatchObject({ kind: "unable_to_plan", failure: { code: "invalid_model_plan" } });
  });

  it("does not forward attachment metadata when governance disables attachment context", async () => {
    const client = modelClient();
    const planner = createMultiStepPlanner(client);
    const plan = vi.fn(planner.plan);
    const coordinator = createIntelligenceDecisionCoordinator({ plan, attachmentContextAllowed: false });
    const decision = await coordinator.decideIntelligenceAction(decisionInput(
      "Analyze this spreadsheet and create a PDF report.",
      { hasDocumentAttachment: true },
      { attachments: ["file"] },
    ));
    expect(plan).toHaveBeenCalledWith(expect.objectContaining({ attachments: [], modelPlanningAllowed: true }));
    expect(decision).toMatchObject({ kind: "unable_to_plan", failure: { code: "missing_required_attachment" } });
    expect(client.generateStructuredPlan).not.toHaveBeenCalled();
  });

  it("rejects a coordinator dependency that violates model-call or repair governance", async () => {
    const plan = vi.fn(async (): Promise<PlanningResult> => ({
      kind: "planned",
      source: "model",
      plannerModelCalls: 3,
      repairAttempted: true,
      plan: {
        objective: "Search current guidance and create a report.",
        status: "validated",
        steps: [
          { id: "research", capability: "web_search", dependsOn: [], inputs: [{ source: "user" }], expectedOutput: "search_results" },
          { id: "document", capability: "document_generation", dependsOn: ["research"], inputs: [{ source: "step", stepId: "research" }], expectedOutput: "document" },
        ],
      },
    }));
    const decision = await createIntelligenceDecisionCoordinator({ plan }).decideIntelligenceAction(
      decisionInput("Search current guidance and create a report."),
    );
    expect(decision).toMatchObject({ kind: "unable_to_plan", failure: { code: "invalid_model_plan" } });
  });

  it("reports bounded metadata and maps every typed failure to safe copy", () => {
    expect(mapPlanningFailureToUserSafeFailure("missing_required_attachment").message).toMatch(/attach/i);
    expect(mapPlanningFailureToUserSafeFailure("plan_too_complex").message).toMatch(/simplifying/i);
    expect(mapPlanningFailureToUserSafeFailure("planner_unavailable").message).toMatch(/temporarily unavailable/i);
    expect(mapPlanningFailureToUserSafeFailure("invalid_model_plan").message).not.toMatch(/provider|stack|chain.of.thought/i);
    expect(CAPABILITY_REGISTRY.has("standard")).toBe(true);
  });
});
