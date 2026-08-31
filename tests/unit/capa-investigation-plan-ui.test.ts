import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("S30 investigation planning UI boundary", () => {
  const intake = readFileSync(resolve("app/capa/CapaIntakeClient.tsx"), "utf8");
  const panel = readFileSync(resolve("app/capa/CapaInvestigationPlanPanel.tsx"), "utf8");
  const selector = readFileSync(resolve("app/capa/CapaParticipantSelector.tsx"), "utf8");
  it("renders the panel only from authoritative S30 state", () => {
    expect(intake).toContain('createdCapa.status === "S30"');
    expect(intake).toContain("<CapaInvestigationPlanPanel");
  });
  it("uses deliberate release wording and explains S30 to S40", () => {
    expect(panel).toContain("Release this investigation plan for execution?");
    expect(panel).toContain("S30 Investigation Planning to S40 Investigation Active");
    expect(panel).not.toMatch(/Quality Approval|Approve Investigation/);
  });
  it("has no editable UUID, status, SME, MFA, or override control", () => {
    expect(selector).toContain("<select"); expect(selector).not.toContain('type="text"');
    expect(panel).not.toContain("FreshTotpStepUp"); expect(panel).not.toContain("sme_user_ids");
    expect(panel).not.toContain("in_progress"); expect(panel).not.toContain("completed");
    expect(panel).not.toMatch(/Force release|Override blocker/);
  });
  it("refreshes authoritative state after release rather than setting S40", () => {
    expect(panel).toContain("await onAuthoritativeRefresh()");
    expect(panel).not.toContain('setStatus("S40")');
    expect(intake).toMatch(/onAuthoritativeRefresh=\{async \(\) => \{[\s\S]*await openExistingCase\([\s\S]*await loadCases\("replace"\)/);
  });
  it("renders semantic S40 presentation without draft-state fallbacks", () => {
    expect(intake).toContain("CAPA_STATE_DEFINITIONS.S40.name");
    expect(intake).toContain("The authoritative CAPA is in active investigation execution.");
    expect(intake).toContain('createdCapa.status === "S40"');
    expect(intake).toMatch(/createdCapa\.status === "S40"[\s\S]*CAPA_STATE_DEFINITIONS\.S40\.name[\s\S]*: "CAPA draft created"/);
  });
  it("renders safe participant labels", () => {
    expect(selector).toContain('"You"'); expect(selector).toContain('"Eligible participant"');
  });
});
