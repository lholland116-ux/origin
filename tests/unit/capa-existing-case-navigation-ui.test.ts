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

    expect(refreshBlocks).toHaveLength(2);
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
});
