import { describe, expect, it } from "vitest";
import { executionRunSchema, executionStepSchema, isJsonValue } from "@/lib/agent-runtime/runtime-contracts";

describe("LVTChat execution runtime contracts", () => {
  it("keeps run and step contracts JSON-safe with valid lifecycle statuses", () => {
    const run = {
      id: "execution-1",
      handoffVersion: 1,
      objective: "Research and make a report",
      status: "running",
      createdAt: "2026-10-06T12:00:00.000Z",
      startedAt: "2026-10-06T12:00:01.000Z",
      orderedStepIds: ["research"],
      steps: [{
        id: "research",
        capability: "web_search",
        status: "running",
        dependsOn: [],
        startedAt: "2026-10-06T12:00:01.000Z",
        attempt: 1,
      }],
    };

    expect(executionRunSchema.safeParse(run).success).toBe(true);
    expect(executionStepSchema.safeParse(run.steps[0]).success).toBe(true);
    expect(JSON.parse(JSON.stringify(run))).toEqual(run);
    expect(isJsonValue({ kind: "text", value: ["safe", 1, null] })).toBe(true);
    expect(isJsonValue({ client: () => undefined })).toBe(false);
  });

  it("rejects unknown lifecycle statuses and executable contract fields", () => {
    const invalidStep = {
      id: "step-1",
      capability: "standard",
      status: "executing",
      dependsOn: [],
      attempt: 1,
    };
    expect(executionStepSchema.safeParse(invalidStep).success).toBe(false);
    expect(executionStepSchema.safeParse({ ...invalidStep, status: "pending", execute: () => undefined }).success).toBe(false);
    expect(executionRunSchema.safeParse({
      id: "execution-1", handoffVersion: 1, objective: "safe", status: "pending", createdAt: "2026-10-06T12:00:00.000Z",
      orderedStepIds: [], steps: [], openAIClient: {},
    }).success).toBe(false);
  });
});
