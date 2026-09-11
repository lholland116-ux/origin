import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("CAPA existing-case workspace navigation", () => {
  const intake = readFileSync(
    resolve("app/capa/CapaIntakeClient.tsx"),
    "utf8",
  );

  it("requests one-shot positioning only from the previous-case selection", () => {
    expect(intake).toContain('id="active-capa-workspace"');
    expect(intake).toContain("ref={activeCapaWorkspaceRef}");
    expect(intake).toContain("scrollIntoView({");
    expect(intake).toContain('behavior: "smooth"');
    expect(intake).toContain('block: "start"');
    expect(intake).toMatch(
      /void openExistingCase\(\s*capaCase,\s*\{\s*scrollToWorkspace:\s*true,/,
    );
    expect(
      intake.match(/scrollToWorkspace:\s*true/g),
    ).toHaveLength(1);
  });

  it("keeps authoritative refreshes free of navigation requests", () => {
    const refreshBlocks =
      intake.match(
        /onAuthoritativeRefresh=\{async \(\) => \{[\s\S]*?await loadCases\("replace"\);[\s\S]*?\}\s*\}\s*\/>/g,
      ) ?? [];

    expect(refreshBlocks).toHaveLength(5);
    for (const block of refreshBlocks) {
      expect(block).toContain("await openExistingCase({");
      expect(block).not.toContain("scrollToWorkspace");
    }
  });

  it("does not position the page until the authoritative response parses", () => {
    const openExistingCaseStart =
      intake.indexOf("async function openExistingCase");
    const openExistingCaseEnd =
      intake.indexOf("function beginScopeApproval", openExistingCaseStart);
    const openExistingCase = intake.slice(
      openExistingCaseStart,
      openExistingCaseEnd,
    );

    expect(openExistingCase).not.toContain("window.scrollTo");
    expect(openExistingCase).not.toContain("scrollIntoView");
    expect(openExistingCase.indexOf("if (parsedCase === null)")).toBeGreaterThan(-1);
    expect(openExistingCase.indexOf("if (options.scrollToWorkspace)")).toBeGreaterThan(
      openExistingCase.indexOf("if (parsedCase === null)"),
    );
  });

  it("recognizes an authoritative S60 case as Action Planning", () => {
    expect(intake).toMatch(
      /if \(status === "S60"\)\s*\{\s*return CAPA_STATE_DEFINITIONS\.S60\.name;\s*\}/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S60"\s*\? CAPA_STATE_DEFINITIONS\.S60\.name/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S60"\s*\? "The approved root-cause conclusion is now in action planning\."/,
    );

    const s60Header = intake.indexOf(
      'createdCapa.status === "S60"',
    );
    const draftFallback = intake.indexOf(
      '"CAPA draft created"',
      s60Header,
    );
    expect(s60Header).toBeGreaterThan(-1);
    expect(draftFallback).toBeGreaterThan(s60Header);
    expect(intake).not.toContain(
      'createdCapa.status === "S60"\n                      ? "CAPA draft created"',
    );
  });

  it("preserves existing S40 and S50 presentation branches", () => {
    expect(intake).toMatch(
      /createdCapa\.status === "S40"\s*\? CAPA_STATE_DEFINITIONS\.S40\.name/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S50"\s*\? "The authoritative investigation and root-cause package are submitted for review\."/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S40"\s*\? "The authoritative CAPA is in active investigation execution\."/,
    );
  });

  it("recognizes S70 as pending Action Plan Review without exposing draft-created messaging", () => {
    expect(intake).toMatch(
      /if \(status === "S70"\)\s*\{\s*return CAPA_STATE_DEFINITIONS\.S70\.name;\s*\}/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S70"\s*\? CAPA_STATE_DEFINITIONS\.S70\.name/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S70"\s*\? "The action plan has been submitted for human review\. Approval has not yet occurred\."/,
    );
    const s70Label = intake.indexOf(': createdCapa.status === "S70"');
    const draftFallback = intake.indexOf(': "CAPA draft created"', s70Label);
    expect(s70Label).toBeGreaterThan(-1);
    expect(draftFallback).toBeGreaterThan(s70Label);
    expect(intake).not.toMatch(/createdCapa\.status === "S70"\s*\? \(\s*<CapaActionPlanWorkspace/);
    expect(intake).toContain("Approval has not yet occurred.");
    expect(intake).not.toContain('createdCapa.status === "S70"\n            ? "The draft record and its audit event were committed atomically."');
  });

  it("mounts the human Implementation Active workspace for S80", () => {
    expect(intake).toMatch(
      /if \(status === "S80"\)\s*\{\s*return CAPA_STATE_DEFINITIONS\.S80\.name;\s*\}/,
    );
    expect(intake).toMatch(
      /createdCapa\.status === "S80"\s*\? CAPA_STATE_DEFINITIONS\.S80\.name/,
    );
    expect(intake).toContain(
      "The action plan has been approved for implementation. Implementation evidence has not yet been submitted.",
    );
    expect(intake).toContain("CapaImplementationWorkspace");
    expect(intake).toContain('createdCapa.status === "S80" ? (');
  });
});
