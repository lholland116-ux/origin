import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("S60 action-planning workspace UI", () => {
  const workspace = readFileSync(resolve("app/capa/CapaActionPlanWorkspace.tsx"), "utf8");
  const advisory = readFileSync(resolve("app/capa/CapaActionPlanAdvisoryPanel.tsx"), "utf8");
  const intake = readFileSync(resolve("app/capa/CapaIntakeClient.tsx"), "utf8");

  it("renders only from the authoritative S60 branch and preserves existing S40/S50 branches", () => {
    expect(intake).toContain("createdCapa.status === \"S60\"");
    expect(intake).toContain("<CapaActionPlanWorkspace");
    expect(intake).toContain("createdCapa.status === \"S40\" || createdCapa.status === \"S50\"");
    expect(workspace).toContain("Action Planning");
    expect(workspace).toContain("Human-controlled draft workspace");
    expect(workspace).toContain("CapaActionPlanAdvisoryPanel");
    expect(advisory).toContain("AG-ACTION");
    expect(advisory).toContain("GOVERNED AI ADVISORY");
    expect(advisory).toContain("No workspace adoption was performed");
    expect(advisory).not.toContain("Approve action plan");
    expect(advisory).not.toContain("Submit to S70");
  });

  it("covers durable editing, controlled targets, dependencies, effectiveness planning, and readiness", () => {
    for (const text of ["loadActionPlanWorkspace", "saveActionPlanWorkspace", "expected_draft_revision", "Add action", "Remove action", "Corrective", "Preventive", "Correction", "Containment", "Assign to me", "Due date", "Linked authoritative targets", "Dependencies", "Effectiveness check required", "Effectiveness planning", "Ready for Action Plan Review", "Not ready for Action Plan Review", "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT"]) expect(workspace).toContain(text);
    expect(workspace).not.toContain("Submit to S70");
    expect(workspace).not.toContain("Approve action plan");
  });
});
