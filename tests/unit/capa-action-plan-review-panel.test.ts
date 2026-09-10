import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("S70 action-plan review panel", () => {
  const panel = readFileSync("app/capa/CapaActionPlanReviewPanel.tsx", "utf8");
  const intake = readFileSync("app/capa/CapaIntakeClient.tsx", "utf8");

  it("renders the controlled submitted baseline read-only", () => {
    expect(panel).toContain("Submitted controlled baseline");
    expect(panel).toContain("Implementation evidence plan");
    expect(panel).toContain("Unintended consequence assessment");
    expect(panel).toContain("Linked authoritative targets");
    expect(panel).toContain("Dependencies");
    expect(panel).toContain("Effectiveness planning");
    expect(panel).not.toContain("CapaActionPlanWorkspace");
    expect(panel).not.toContain("saveDraft");
  });

  it("requires rationale and uses explicit approve confirmation plus step-up", () => {
    expect(panel).toContain("Review rationale");
    expect(panel).toContain('rationale.trim().length === 0');
    expect(panel).toContain("I confirm this approval decision and rationale.");
    expect(panel).toContain("FreshTotpStepUp");
    expect(panel).toContain('begin("approve")');
    expect(panel).toContain('begin("return")');
    expect(panel).toContain("Approve action plan");
    expect(panel).toContain("Return for action planning");
    expect(panel).toContain("setAttempt(next)");
    expect(panel).toContain("if (attempt) void submit(attempt)");
  });

  it("routes both pending decisions through the same step-up flow", () => {
    const begin = panel.slice(
      panel.indexOf("function begin"),
      panel.indexOf("async function submit"),
    );

    expect(begin).toContain("if (attempt !== null || submitting) return;");
    expect(panel).toContain('begin("approve")');
    expect(panel).toContain('begin("return")');
    expect(begin).toContain("setStepUpOpen(true)");
    expect(begin).not.toContain("void submit(next)");
    expect(panel).toContain('attempt?.decision === "return"');
    expect(panel).toContain("Confirm return for action planning");
    expect(panel).toContain("setStepUpOpen(false); setAttempt(null);");
  });

  it("refreshes authoritative state after success and does not render S60 editing in S70", () => {
    expect(panel).toContain("onAuthoritativeRefresh");
    expect(panel).toContain("Implementation evidence has not yet been submitted.");
    expect(intake).toContain('createdCapa.status === "S60" ? (');
    expect(intake).toContain('createdCapa.status === "S70" &&');
    expect(intake).toContain("<CapaActionPlanReviewPanel");
    expect(intake).not.toMatch(/createdCapa\.status === "S70"\s*\?\s*\(\s*<CapaActionPlanWorkspace/);
  });

  it("keeps the AI review advisory separate from human decisions", () => {
    expect(panel).toContain("AI Review Advisory");
    expect(panel).toContain("Generate AI review");
    expect(panel).toContain("Generating AI review…");
    expect(panel).toContain("Overall assessment");
    expect(panel).toContain("AI recommended disposition");
    expect(panel).toContain("Reviewer attention:");
    expect(panel).toContain("Supporting references:");
    expect(panel).toContain("Approve and Return remain independent human-controlled actions.");
    expect(panel).toContain('onClick={() => void generateAdvisory()}');
    expect(panel).toContain('onClick={() => begin("approve")}');
    expect(panel).toContain('onClick={() => begin("return")}');
    expect(panel).not.toContain("recommended_disposition === \"approve\" &&");
    expect(panel).not.toContain("recommended_disposition === \"return\" &&");
  });

  it("presents completed Return/Response cycles as immutable, separate history", () => {
    expect(panel).toContain("Previous Return / Response cycles");
    expect(panel).toContain("Reviewer Return rationale");
    expect(panel).toContain("Owner response · immutable controlled history");
    expect(panel).toContain("Return / Response cycle {index + 1}");
    expect(panel).toContain("reviewHistory.map");
    expect(panel).not.toContain("setReviewHistory");
  });
});
