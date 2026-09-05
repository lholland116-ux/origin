import { describe, expect, it } from "vitest";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
  type CapaInvestigationActiveAdoptionCategory,
} from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
import {
  constructCapaInvestigationActiveAdoption,
  validateCapaInvestigationActiveAdoptedContent,
  validateCapaInvestigationActiveAdoptionIntent,
} from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import {
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const USER = "50000000-0000-4000-8000-000000000001";
const REQUEST = "60000000-0000-4000-8000-000000000001";
const CORRELATION = "70000000-0000-4000-8000-000000000001";
const ADOPTION = "80000000-0000-4000-8000-000000000001";
const TIME = "2026-09-05T12:00:00.000Z";

function intent(items = [{ proposal_key: "P1", adopted_content: { gap: "gap" } }]) {
  return validateCapaInvestigationActiveAdoptionIntent({
    expected_case_version_id: VERSION,
    expected_record_version: 4,
    output_id: OUTPUT,
    selected_items: items,
  });
}

const content: Record<CapaInvestigationActiveAdoptionCategory, object> = {
  evidence_gap: { gap: "Gap", why_it_matters: "Why", recommended_next_step: "Next" },
  conflicting_information: { conflict: "Conflict", why_it_matters: "Why" },
  assumption: { assumption: "Assumption", verification_question: "Verify?" },
  causal_hypothesis: { hypothesis: "Hypothesis", rationale: "Rationale" },
  alternative_hypothesis: { hypothesis: "Alternative", rationale: "Rationale" },
  investigation_recommendation: { recommendation: "Recommendation", rationale: "Rationale" },
};

function canonical(overrides: Record<string, unknown> = {}) {
  return constructCapaInvestigationActiveAdoption({
    adoption_id: ADOPTION,
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_version_id: VERSION,
    record_version: 4,
    output_id: OUTPUT,
    proposal_key: "P1",
    proposal_category: "evidence_gap",
    adopted_item: { proposal_key: "P1", adopted_content: content.evidence_gap },
    resolved_reference_bindings: [{ reference_key: "R1", relationship: "related", trust: "untrusted_human_draft", source_kind: "ledger_item", source_id: "ledger-1" }],
    reference_manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
    reference_manifest_fingerprint_algorithm: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
    reference_manifest_sha256: "a".repeat(64),
    adopted_at: TIME,
    adopted_by: { actor_type: "human", actor_id: USER },
    adoption_policy_version: CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
    request_id: REQUEST,
    correlation_id: CORRELATION,
    idempotency_key: "batch-1" as never,
    workflow_mutated: false,
    controlled_record_mutated: false,
    gate_approved: false,
    ...overrides,
  } as never);
}

describe("S40 investigation-active adoption validator", () => {
  it("accepts the exact browser envelope and rejects caller-owned fields", () => {
    expect(intent().selected_items).toHaveLength(1);
    expect(() => intent([{ proposal_key: "P1", adopted_content: {}, proposal_category: "assumption" } as never])).toThrow();
    expect(() => intent([{ proposal_key: "P1", adopted_content: {}, reference_keys: ["R1"] } as never])).toThrow();
    expect(() => intent([{ proposal_key: "P1", adopted_content: {}, status: "confirmed" } as never])).toThrow();
    expect(() => validateCapaInvestigationActiveAdoptionIntent({})).toThrow();
  });

  it("enforces bounded, unique P# selections and object content", () => {
    expect(() => intent([{ proposal_key: "P0", adopted_content: {} }] as never)).toThrow();
    expect(() => intent([{ proposal_key: "P1", adopted_content: {} }, { proposal_key: "P1", adopted_content: {} }] as never)).toThrow();
    expect(() => intent([{ proposal_key: "P1", adopted_content: "not-object" } as never])).toThrow();
    expect(() => intent([{ proposal_key: "P1", adopted_content: { gap: "x".repeat(30_001) } }])).toThrow();
  });

  it("requires an exact UUID output_id", () => {
    expect(intent().output_id).toBe(OUTPUT);
    for (const output_id of ["not-a-uuid", "", ` ${OUTPUT}`, `${OUTPUT} `]) {
      expect(() => validateCapaInvestigationActiveAdoptionIntent({ expected_case_version_id: VERSION, expected_record_version: 4, output_id, selected_items: [{ proposal_key: "P1", adopted_content: {} }] })).toThrowError(expect.objectContaining({ reason_code: "INVALID_OUTPUT_ID" }));
    }
  });

  it("snapshots and recursively freezes caller-owned adopted content", () => {
    const adopted_content = { nested: { value: "before" } };
    const validated = validateCapaInvestigationActiveAdoptionIntent({ expected_case_version_id: VERSION, expected_record_version: 4, output_id: OUTPUT, selected_items: [{ proposal_key: "P1", adopted_content }] });
    adopted_content.nested.value = "after";
    expect(validated.selected_items[0]?.adopted_content).toEqual({ nested: { value: "before" } });
    expect(Object.isFrozen(validated.selected_items[0]?.adopted_content)).toBe(true);
    expect(Object.isFrozen((validated.selected_items[0]?.adopted_content as { nested: object }).nested)).toBe(true);
  });

  it("normalizes human content and validates all six resolved categories exactly", () => {
    expect((validateCapaInvestigationActiveAdoptedContent("evidence_gap", { gap: "  Ｇap  ", why_it_matters: "Why", recommended_next_step: "Next" }) as { gap: string }).gap).toBe("Gap");
    for (const [category, value] of Object.entries(content) as [CapaInvestigationActiveAdoptionCategory, object][]) {
      expect(validateCapaInvestigationActiveAdoptedContent(category, value)).toEqual(value);
    }
    expect(() => validateCapaInvestigationActiveAdoptedContent("causal_hypothesis", { hypothesis: "h", rationale: "r", suggested_role: "possible_root_cause" })).toThrow();
    expect(() => validateCapaInvestigationActiveAdoptedContent("assumption", { assumption: "a", verification_question: "v", human_review_question: "q" })).toThrow();
  });

  it("enforces server-owned R# bindings, manifest metadata, flags, and deep freeze", () => {
    expect(canonical().resolved_reference_bindings[0]?.reference_key).toBe("R1");
    expect(Object.isFrozen(canonical())).toBe(true);
    expect(Object.isFrozen(canonical().adopted_item.adopted_content)).toBe(true);
    expect(() => canonical({ resolved_reference_bindings: [{ reference_key: "R101", relationship: "related", trust: "untrusted_human_draft", source_kind: "ledger_item", source_id: "x" }] })).toThrow();
    expect(() => canonical({ resolved_reference_bindings: [{ reference_key: "R1", relationship: "related", trust: "untrusted_human_draft", source_kind: "ledger_item", source_id: "x" }, { reference_key: "R1", relationship: "related", trust: "untrusted_human_draft", source_kind: "ledger_item", source_id: "y" }] })).toThrow();
    expect(() => canonical({ workflow_mutated: true })).toThrow();
    expect(() => canonical({ resolved_reference_bindings: [{ reference_key: "R1", relationship: "related", trust: "authoritative_server_context", source_kind: "ledger_item", source_id: "x" }] })).toThrow();
  });

  it("preserves precise canonical identity reason codes", () => {
    for (const [field, reason_code] of [
      ["adoption_id", "INVALID_ADOPTION_ID"],
      ["organization_id", "INVALID_ORGANIZATION"],
      ["capa_case_id", "INVALID_CASE_ID"],
      ["case_version_id", "INVALID_EXPECTED_CASE_VERSION_ID"],
      ["output_id", "INVALID_OUTPUT_ID"],
    ] as const) {
      expect(() => canonical({ [field]: "not-a-uuid" })).toThrowError(expect.objectContaining({ reason_code }));
    }
    expect(() => constructCapaInvestigationActiveAdoption(null as never)).toThrowError(expect.objectContaining({ reason_code: "INVALID_ADOPTION_INPUT" }));
  });
});
