import { describe, expect, it } from "vitest";

import {
  buildCapaContainmentRiskAdvisoryPrompt,
} from "../../lib/capa/ai/capa-containment-risk-advisory-prompt";
import type {
  CapaContainmentRiskAdvisoryContextAssembly,
} from "../../lib/capa/ai/capa-containment-risk-advisory-context";

const authoritative = {
  trust: "authoritative_server_context",
  organization_id: "organization-1",
  capa_case_id: "case-1",
  case_version_id: "version-1",
  record_version: 3,
  workflow_state: "S20",
  actor: "user-1",
  active_roles: [],
  intake_scope: { initiating_event: "event-1" },
  persisted_containment_risk: null,
};

const untrustedHumanDraft = {
  trust: "untrusted_human_draft",
  content: {
    actions: [],
    impact_scope: { products: [], processes: [], data: [], customers: [], patients: [] },
    risk_evaluation: null,
    missing_risk_information: [],
    escalations: [],
  },
};

function renderPrompt(): string {
  return buildCapaContainmentRiskAdvisoryPrompt({
    context: {
      authoritative,
      untrusted_human_draft: untrustedHumanDraft,
    } as unknown as CapaContainmentRiskAdvisoryContextAssembly,
    focus: "Review containment evidence",
  });
}

describe("S20 containment/risk advisory prompt", () => {
  it("states the validator-controlled atomic question grammar", () => {
    const prompt = renderPrompt();
    expect(prompt).toContain("Does, Do, Is, Are, May, Can, Could, Should, Must, What, Which, Who, How, When, Where, Whether");
    expect(prompt).toContain("one atomic single-clause question");
    expect(prompt).toContain("ends with exactly one question mark");
    expect(prompt).toContain("the question mark appears only at the end");
    expect(prompt).toContain("Commas and semicolons are prohibited");
    expect(prompt).toContain("colons are prohibited");
    expect(prompt).toContain("period, exclamation mark, another question mark, newline, paragraph break, spaced hyphen, spaced em dash, or spaced en dash");
    expect(prompt).toContain("standalone connector words: and, but, however, although, though, yet, while, because, since, therefore, thus");
    expect(prompt).toContain("Do not combine two questions or two requested facts");
    expect(prompt).toContain('"What evidence supports containment?"');
    expect(prompt).toContain('"Which risk method applies?"');
    expect(prompt).toContain('"Is containment verified?"');
    expect(prompt).toContain('"Who owns the assessment?"');
  });

  it("preserves governance prohibitions and fixed output flags", () => {
    const prompt = renderPrompt();
    for (const phrase of [
      "risk acceptability",
      "containment approval",
      "G-02",
      "workflow advancement",
      "controlled-record mutation",
      "assignment",
      "evidence verification",
      "review disposition",
      "citations must be []",
      "advisory_only=true",
      "workflow_mutated=false",
      "human_acceptance_required=true",
    ]) {
      expect(prompt).toContain(phrase);
    }
  });

  it("serializes authoritative context, untrusted draft, and focus in controlled blocks", () => {
    const prompt = renderPrompt();
    expect(prompt).toContain("BEGIN AUTHORITATIVE_SERVER_CONTEXT_DATA");
    expect(prompt).toContain(JSON.stringify(authoritative));
    expect(prompt).toContain("BEGIN UNTRUSTED_HUMAN_DRAFT_DATA");
    expect(prompt).toContain(JSON.stringify(untrustedHumanDraft));
    expect(prompt).toContain("BEGIN HUMAN_FOCUS_DATA");
    expect(prompt).toContain(JSON.stringify("Review containment evidence"));
  });
});
