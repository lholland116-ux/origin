import { describe, expect, it } from "vitest";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import {
  validateCapaInvestigationPlanningAdvisoryBrowserRequest,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-validator";
import type {
  CapaInvestigationPlanningAdvisoryHumanDraft,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-context";

function validDraft(): Record<string, unknown> {
  return {
    trust: "untrusted_human_draft",
    content: {
      items: [{
        local_key: "D1",
        investigation_question: "  Ｗｈｙ did the event occur?  ",
        evidence_target: "Batch records",
        investigation_method: "Document review",
        scope_relationship: "Potentially related to the initiating event",
        due_date_consideration: "Review before release",
        dependency_local_keys: [],
        owner_selected: false,
      }],
    },
  };
}

function expectReason(value: unknown, reasonCode: string): void {
  expect(() =>
    validateCapaInvestigationPlanningAdvisoryBrowserRequest(value),
  ).toThrowError(expect.objectContaining({
    name: "CapaInvestigationPlanningAdvisoryValidationError",
    reason_code: reasonCode,
  }));
}

describe("CAPA investigation-planning advisory browser validation", () => {
  it("creates the controlled default request", () => {
    const result = validateCapaInvestigationPlanningAdvisoryBrowserRequest({});

    expect(result).toEqual({
      requested_output: CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
      focus: null,
      untrusted_human_draft: null,
    });
    expect(Object.isFrozen(result)).toBe(true);
  });

  it("normalizes focus with NFKC and trimming", () => {
    expect(validateCapaInvestigationPlanningAdvisoryBrowserRequest({
      focus: "  Ｆｏｃｕｓ  ",
    }).focus).toBe("Focus");
    expect(validateCapaInvestigationPlanningAdvisoryBrowserRequest({
      focus: " \t ",
    }).focus).toBeNull();
  });

  it("rejects invalid focus values and oversized focus", () => {
    expectReason({ focus: 42 }, "INVALID_ADVISORY_INPUT");
    expectReason({ focus: "x".repeat(1_001) }, "ADVISORY_FOCUS_TOO_LONG");
  });

  it.each([
    "requested_output",
    "organization_id",
    "user_id",
    "workflow_state",
    "adopted_by_user_id",
    "unknown",
  ])("rejects unsupported top-level field %s", (field) => {
    expectReason({ [field]: "browser supplied" }, "UNSUPPORTED_ADVISORY_INPUT_FIELD");
  });

  it("accepts and normalizes the exact S30 untrusted draft shape", () => {
    const source = validDraft();
    const result = validateCapaInvestigationPlanningAdvisoryBrowserRequest({
      untrusted_human_draft: source,
    });
    const draft = result.untrusted_human_draft as CapaInvestigationPlanningAdvisoryHumanDraft;

    expect(result.untrusted_human_draft).toEqual({
      trust: "untrusted_human_draft",
      content: {
        items: [{
          local_key: "D1",
          investigation_question: "Why did the event occur?",
          evidence_target: "Batch records",
          investigation_method: "Document review",
          scope_relationship: "Potentially related to the initiating event",
          due_date_consideration: "Review before release",
          dependency_local_keys: [],
          owner_selected: false,
        }],
      },
    });
    expect(Object.isFrozen(draft)).toBe(true);
    expect(Object.isFrozen(draft.content)).toBe(true);
    expect(Object.isFrozen(draft.content.items)).toBe(true);
  });

  it("maps missing and null drafts to null", () => {
    expect(validateCapaInvestigationPlanningAdvisoryBrowserRequest({})
      .untrusted_human_draft).toBeNull();
    expect(validateCapaInvestigationPlanningAdvisoryBrowserRequest({
      untrusted_human_draft: null,
    }).untrusted_human_draft).toBeNull();
  });

  it("rejects malformed, authority-bearing, and malformed-content drafts", () => {
    expectReason({ untrusted_human_draft: { trust: "authoritative_server_context" } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    expectReason({ untrusted_human_draft: { trust: "untrusted_human_draft", content: { items: "nope" } } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    expectReason({ untrusted_human_draft: { ...validDraft(), adopted_at: "2026-09-03T00:00:00.000Z" } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
    expectReason({ untrusted_human_draft: { trust: "untrusted_human_draft", content: { items: [{ ...validDraftContentItem(), owner_user_id: "30000000-0000-4000-8000-000000000001" }] } } }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
  });

  it("rejects oversized serialized drafts and cycles", () => {
    const oversized = validDraft();
    const item = (oversized.content as { items: Record<string, unknown>[] }).items[0]!;
    item.investigation_question = "x".repeat(4_000);
    item.evidence_target = "x".repeat(4_000);
    item.investigation_method = "x".repeat(4_000);
    item.scope_relationship = "x".repeat(4_000);
    item.due_date_consideration = "x".repeat(4_000);
    const second = { ...item, local_key: "D2" };
    (oversized.content as { items: Record<string, unknown>[] }).items.push(second, { ...item, local_key: "D3" }, { ...item, local_key: "D4" });
    expectReason({ untrusted_human_draft: oversized }, "UNTRUSTED_HUMAN_DRAFT_TOO_LARGE");

    const first = validDraftContentItem();
    const cycleDraft = {
      trust: "untrusted_human_draft",
      content: {
        items: [
          { ...first, dependency_local_keys: ["D2"] },
          { ...first, local_key: "D2", dependency_local_keys: ["D1"] },
        ],
      },
    };
    expectReason({ untrusted_human_draft: cycleDraft }, "INVALID_UNTRUSTED_HUMAN_DRAFT");
  });

  it("does not mutate caller input", () => {
    const source = validDraft();
    const before = JSON.stringify(source);
    validateCapaInvestigationPlanningAdvisoryBrowserRequest({
      untrusted_human_draft: source,
    });
    expect(JSON.stringify(source)).toBe(before);
  });
});

function validDraftContentItem(): Record<string, unknown> {
  return {
    local_key: "D1",
    investigation_question: "Question",
    evidence_target: "Evidence",
    investigation_method: "Method",
    scope_relationship: "Scope",
    due_date_consideration: "Due date",
    dependency_local_keys: [],
    owner_selected: false,
  };
}
