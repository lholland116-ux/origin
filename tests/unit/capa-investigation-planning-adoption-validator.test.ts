import { describe, expect, it } from "vitest";

import {
  constructCapaInvestigationPlanningAdoption,
  CapaInvestigationPlanningAdoptionValidationError,
  validateCapaInvestigationPlanningAdoptionIntent,
} from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";
import {
  CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION,
} from "../../lib/capa/ai/capa-investigation-planning-adoption-contract";

const VERSION = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const USER = "50000000-0000-4000-8000-000000000001";

function item(overrides: Record<string, unknown> = {}) {
  return {
    proposal_key: "P1",
    investigation_question: "Question",
    evidence_target: "Evidence",
    investigation_method: "Method",
    scope_relationship: "Scope",
    owner_user_id: null,
    due_date: null,
    dependency_proposal_keys: [],
    ...overrides,
  };
}

function intent(overrides: Record<string, unknown> = {}) {
  return {
    expected_case_version_id: VERSION,
    expected_record_version: 2,
    output_id: OUTPUT,
    selected_items: [item()],
    ...overrides,
  };
}

function expectReason(value: unknown, reasonCode: string): void {
  expect(() => validateCapaInvestigationPlanningAdoptionIntent(value))
    .toThrowError(expect.objectContaining({
      name: "CapaInvestigationPlanningAdoptionValidationError",
      reason_code: reasonCode,
    }));
}

describe("S30 investigation-planning adoption intent validation", () => {
  it("accepts selective human intent and freezes a normalized copy", () => {
    const source = intent({
      selected_items: [item({
        investigation_question: "  Ｗｈｙ did it happen?  ",
        owner_user_id: USER,
        due_date: "2026-09-30",
      })],
    });
    const before = JSON.stringify(source);
    const result = validateCapaInvestigationPlanningAdoptionIntent(source);

    expect(result.selected_items[0]).toMatchObject({
      proposal_key: "P1",
      investigation_question: "Why did it happen?",
      owner_user_id: USER,
      due_date: "2026-09-30",
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selected_items)).toBe(true);
    expect(Object.isFrozen(result.selected_items[0])).toBe(true);
    expect(JSON.stringify(source)).toBe(before);
  });

  it("requires the exact browser-owned shape", () => {
    expectReason({ ...intent(), adopted_by_user_id: USER }, "UNSUPPORTED_ADOPTION_INPUT_FIELD");
    expectReason({ ...intent(), adopted_at: "2026-09-03T00:00:00.000Z" }, "UNSUPPORTED_ADOPTION_INPUT_FIELD");
    expectReason({ ...intent(), source_type: "ai_proposal" }, "UNSUPPORTED_ADOPTION_INPUT_FIELD");
    expectReason({ ...intent(), source_reference: "browser" }, "UNSUPPORTED_ADOPTION_INPUT_FIELD");
    expectReason({ ...intent(), workflow_state: "S40" }, "UNSUPPORTED_ADOPTION_INPUT_FIELD");
    expectReason({ ...intent(), request_id: "browser" }, "UNSUPPORTED_ADOPTION_INPUT_FIELD");
    expectReason({ ...intent(), selected_items: [] }, "INVALID_SELECTED_ITEMS");
  });

  it("validates proposal keys, duplicates, dependencies, owner and due date", () => {
    expectReason(intent({ selected_items: [item({ proposal_key: "X1" })] }), "INVALID_PROPOSAL_KEY");
    expectReason(intent({ selected_items: [item(), item({ proposal_key: "P1" })] }), "DUPLICATE_PROPOSAL_KEY");
    expectReason(intent({ selected_items: [item({ dependency_proposal_keys: ["X1"] })] }), "INVALID_DEPENDENCY_PROPOSAL_KEY");
    expectReason(intent({ selected_items: [item({ dependency_proposal_keys: ["P1"] })] }), "SELF_DEPENDENCY");
    expectReason(intent({ selected_items: [
      item({ dependency_proposal_keys: ["P2"] }),
      item({ proposal_key: "P2", dependency_proposal_keys: ["P1"] }),
    ] }), "DEPENDENCY_CYCLE");
    expectReason(intent({ selected_items: [item({ owner_user_id: "not-a-uuid" })] }), "INVALID_OWNER_USER_ID");
    expectReason(intent({ selected_items: [item({ due_date: "2026-02-30" })] }), "INVALID_DUE_DATE");
  });

  it("rejects malformed identifiers, versions and oversized text", () => {
    expectReason(intent({ expected_case_version_id: "not-a-uuid" }), "INVALID_EXPECTED_CASE_VERSION_ID");
    expectReason(intent({ expected_record_version: 0 }), "INVALID_EXPECTED_RECORD_VERSION");
    expectReason(intent({ output_id: "not-a-uuid" }), "INVALID_OUTPUT_ID");
    expectReason(intent({ selected_items: [item({ investigation_method: "x".repeat(4_001) })] }), "ADOPTION_TEXT_TOO_LONG");
  });

  it("constructs only a server-owned canonical human adoption record", () => {
    const validated = validateCapaInvestigationPlanningAdoptionIntent(intent());
    const record = constructCapaInvestigationPlanningAdoption({
      adoption_id: "60000000-0000-4000-8000-000000000001" as never,
      organization_id: "10000000-0000-4000-8000-000000000001" as never,
      capa_case_id: "20000000-0000-4000-8000-000000000001" as never,
      case_version_id: validated.expected_case_version_id,
      record_version: validated.expected_record_version,
      output_id: validated.output_id as never,
      adopted_item: validated.selected_items[0]!,
      adopted_at: "2026-09-03T12:00:00.000Z" as never,
      adopted_by: { actor_type: "human", actor_id: USER } as const,
      request_id: "70000000-0000-4000-8000-000000000001" as never,
      correlation_id: "80000000-0000-4000-8000-000000000001" as never,
      idempotency_key: "adoption-1" as never,
    });

    expect(record.adoption_policy_version).toBe(CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION);
    expect(record.adopted_by).toEqual({ actor_type: "human", actor_id: USER });
    expect(record.workflow_mutated).toBe(false);
    expect(record.controlled_record_mutated).toBe(false);
    expect(record.gate_approved).toBe(false);
    expect(Object.isFrozen(record)).toBe(true);
    expect(Object.isFrozen(record.adopted_item)).toBe(true);
  });

  it("requires a human actor and trusted valid timestamp for canonical records", () => {
    const base = {
      adoption_id: "60000000-0000-4000-8000-000000000001" as never,
      organization_id: "10000000-0000-4000-8000-000000000001" as never,
      capa_case_id: "20000000-0000-4000-8000-000000000001" as never,
      case_version_id: VERSION as never,
      record_version: 2,
      output_id: OUTPUT as never,
      adopted_item: item() as never,
      adopted_at: "2026-09-03T12:00:00.000Z" as never,
      adopted_by: { actor_type: "human", actor_id: USER } as const,
      request_id: "70000000-0000-4000-8000-000000000001" as never,
      correlation_id: "80000000-0000-4000-8000-000000000001" as never,
      idempotency_key: "adoption-1" as never,
    };
    expect(() => constructCapaInvestigationPlanningAdoption({
      ...base,
      adopted_by: { actor_type: "agent", actor_id: "AG-PLAN" },
    })).toThrow(CapaInvestigationPlanningAdoptionValidationError);
    expect(() => constructCapaInvestigationPlanningAdoption({
      ...base,
      adopted_at: "browser-time" as never,
    })).toThrow(CapaInvestigationPlanningAdoptionValidationError);
  });
});
