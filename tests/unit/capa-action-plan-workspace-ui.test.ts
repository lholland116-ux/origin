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
    expect(advisory).toContain("Adopt into Action Plan");
    expect(advisory).toContain("Nothing was saved automatically");
    expect(advisory).toContain("onAdoptCandidate");
    expect(advisory).toContain("Adopt effectiveness planning");
    expect(advisory).not.toContain("Approve action plan");
    expect(advisory).not.toContain("Submit to S70");
  });

  it("covers durable editing, controlled targets, dependencies, effectiveness planning, and readiness", () => {
    for (const text of ["loadActionPlanWorkspace", "saveActionPlanWorkspace", "expected_draft_revision", "Add action", "Remove action", "Corrective", "Preventive", "Correction", "Containment", "Assign to me", "Due date", "Linked authoritative targets", "Dependencies", "Effectiveness check required", "Effectiveness planning", "Ready for Action Plan Review", "Not ready for Action Plan Review", "Submit action plan for review", "createActionPlanSubmissionAttempt", "submitActionPlanSubmissionAttempt", "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", "createActionPlanItemFromAdvisoryCandidate", "UNSAVED local changes", "durable draft revision"]) expect(workspace).toContain(text);
    expect(workspace).not.toContain("Submit to S70");
    expect(workspace).not.toContain("Approve action plan");
    expect(workspace).not.toContain("deleteActionPlanWorkspace");
    expect(workspace).toContain("items: [...plan.items, createActionPlanItemFromAdvisoryCandidate");
    expect(workspace).toContain("source_reference === candidate.suggestion_key");
    expect(workspace).toContain("effectiveness_check_required: false");
  });

  it("presents returned-workspace rationale and a human-owned response without client cycle authority", () => {
    expect(workspace).toContain("S70 · Return / Rework");
    expect(workspace).toContain("Action Plan returned for rework");
    expect(workspace).toContain("Reviewer Return rationale");
    expect(workspace).toContain("Owner response");
    expect(workspace).toContain("An owner response is required before resubmission.");
    expect(workspace).toContain("action_plan_return_response: { response_narrative: responseNarrative }");
    expect(workspace).toContain("returnContext !== undefined");
    expect(workspace).not.toContain("return_transition_audit_event_id:");
    expect(workspace).not.toContain("resubmitted_case_version_id:");
  });
});
