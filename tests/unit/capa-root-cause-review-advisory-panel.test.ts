import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import CapaRootCauseReviewAdvisoryPanel, { isCurrentCapaRootCauseReviewAdvisoryRequest } from "../../app/capa/CapaRootCauseReviewAdvisoryPanel";

describe("S50 root-cause review advisory panel", () => {
  const source = readFileSync(resolve("app/capa/CapaRootCauseReviewAdvisoryPanel.tsx"), "utf8");

  it("renders an initial read-only request surface", () => {
    const markup = renderToStaticMarkup(createElement(CapaRootCauseReviewAdvisoryPanel, {
      caseId: "10000000-0000-4000-8000-000000000001",
      expectedCaseVersionId: "20000000-0000-4000-8000-000000000001",
      expectedRecordVersion: 5,
    }));
    expect(markup).toContain("Root Cause Review Advisory");
    expect(markup).toContain("Generate advisory");
    expect(markup).toContain("does not change the submitted controlled record");
    expect(markup).not.toMatch(/<input|<select|<textarea/);
  });

  it("renders only safe advisory sections and retry behavior", () => {
    for (const text of ["Neutral review summary", "Advisory warnings", "Version comparison", "Blockers and warnings", "Evidence map", "Uncertainty and limitations", "Human review question", "Output ID", "Retry request", "Regenerate advisory"]) expect(source).toContain(text);
    expect(source).toContain("fetchCapaRootCauseReviewAdvisory");
    expect(source).toContain("buildCapaRootCauseReviewAdvisoryRequest");
    for (const behavior of ["setRequesting(true)", "setResult(response)", "setFailure(response)", "proposal.blockers_warnings", "proposal.evidence_map", "advisory.warnings", "advisory.uncertainty_and_limitations", "advisory.status"]) expect(source).toContain(behavior);
    expect(source).not.toMatch(/\b(?:Adopt|Accept|Reject|Approve|Submit|Release|Transition|Sign)\b/);
  });

  it("discards an old snapshot completion and an older concurrent completion", () => {
    const requestA = { token: 1, caseId: "case-a", expectedCaseVersionId: "version-a", expectedRecordVersion: 5 } as const;
    const snapshotB = { token: 1, caseId: "case-b", expectedCaseVersionId: "version-b", expectedRecordVersion: 6 } as const;
    const requestB = { ...snapshotB, token: 2 } as const;
    expect(isCurrentCapaRootCauseReviewAdvisoryRequest(requestA, snapshotB)).toBe(false);
    expect(isCurrentCapaRootCauseReviewAdvisoryRequest(requestA, requestB)).toBe(false);
    expect(isCurrentCapaRootCauseReviewAdvisoryRequest(requestB, requestB)).toBe(true);
    expect(source).toContain("requestTokenRef");
    expect(source).toContain("snapshotRef");
    expect(source).toContain("if (!isCurrentCapaRootCauseReviewAdvisoryRequest(identity, currentIdentity)) return;");
  });
});
