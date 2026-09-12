import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("S80 human implementation workspace UI", () => {
  const workspace = readFileSync(resolve("app/capa/CapaImplementationWorkspace.tsx"), "utf8");
  const client = readFileSync(resolve("app/capa/capa-implementation-workspace-client.ts"), "utf8");
  const intake = readFileSync(resolve("app/capa/CapaIntakeClient.tsx"), "utf8");

  it("protects first-entry S80 from showing a return/rework section or requiring an owner response", () => {
    expect(intake).toContain('createdCapa.status === "S80"');
    expect(intake).toContain("<CapaImplementationWorkspace");
    expect(workspace).toContain("Read-only approved S70 authority");
    expect(workspace).toContain("Approved action");
    expect(workspace).toContain("projection.implementation_review_return_cycle !== null ? <section");
    expect(workspace).toContain("projection.implementation_review_return_cycle === null ? {} :");
    expect(workspace).toContain("if (projection.implementation_review_return_cycle !== null &&");
    expect(workspace).toContain("implementation_review_return_response");
  });

  it("shows returned-S80 reviewer rationale read-only and separates the editable owner response", () => {
    expect(workspace).toContain("S90 · Returned for owner rework");
    expect(workspace).toContain("Immutable reviewer rationale");
    expect(workspace).toContain("projection.implementation_review_return_cycle.rationale");
    expect(workspace).toContain("Owner response to reviewer return");
    expect(workspace).toContain("Required before resubmission");
    expect(workspace).toContain("This response is stored separately from the reviewer rationale.");
    expect(workspace).toContain("<textarea aria-required=\"true\"");
  });

  it("covers human status, narrative, multiple evidence, provenance, save and conflict UX", () => {
    for (const text of ["Owner-reported execution status", "reported_complete", "Blocked reason", "Implementation narrative", "Add evidence", "Remove draft evidence", "Evidence kind", "Evidence date", "Evidence provenance", "Origin kind", "Source system kind", "Save implementation workspace", "Submit for implementation review", "submit-implementation", "Reload authoritative workspace", "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT", "UNSAVED local changes", "local changes were not saved"]) expect(workspace + client).toContain(text);
    expect(workspace).toContain("draft_revision: projection.draft_revision");
    expect(workspace).toContain("Nothing is saved automatically");
    expect(client).toContain("approved_s70_baseline");
    expect(client).toContain("action_progress");
  });

  it("renders governed advisory findings and limits adoption to local narrative patches", () => {
    for (const text of ["GOVERNED AI ADVISORY", "Generate advisory", "Suggested human action", "Governed references", "Adopt into local narrative draft", "Eligible narrative suggestion", "Generate a new advisory", "adoption.eligible", "implementation_narrative"]) expect(workspace).toContain(text);
    expect(workspace).toContain("AI cannot create evidence");
    expect(workspace).toContain("does not create evidence");
    expect(workspace).toContain("does not submit automatically");
    expect(workspace).not.toContain("Adopt into evidence");
    expect(workspace).not.toContain("Set reported complete");
  });
});
