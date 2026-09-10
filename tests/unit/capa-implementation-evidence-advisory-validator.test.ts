import { describe, expect, it } from "vitest";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-contract";
import {
  validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-authoritative-validator";
import {
  validateCapaImplementationEvidenceAdvisoryModelOutput,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-validator";
import type {
  AuthoritativeS80ImplementationEvidenceContext,
  CapaImplementationEvidenceAdvisoryReferenceManifestEntry,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-context";

const ACTION = "ACTION-1";
const OTHER_ACTION = "ACTION-2";
const EVIDENCE = "20000000-0000-4000-8000-000000000001";

function finding(overrides: Record<string, unknown> = {}) {
  return {
    finding_id: "finding-1",
    approved_action_reference: ACTION,
    category: "missing_evidence",
    severity: "medium",
    finding: "The implementation record does not contain the expected evidence.",
    rationale: "The approved action expects a validated completion record.",
    evidence_reference_ids: [],
    reference_keys: ["R1"],
    suggested_human_action: "Review the approved action and add only verified evidence.",
    adoption: { eligible: false, field: null, suggested_value: null },
    ...overrides,
  };
}

function raw(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION,
    status: "completed_draft",
    advisory_summary: "The implementation workspace needs human review.",
    findings: [finding()],
    warnings: [],
    uncertainty_and_limitations: ["This is an advisory draft, not an implementation decision."],
    citations: [],
    advisory_only: true,
    workflow_mutated: false,
    controlled_record_mutated: false,
    approval_claimed: false,
    workflow_transition: null,
    human_acceptance_required: true,
    ...overrides,
  };
}

function authoritativeContext(overrides: Record<string, unknown> = {}) {
  return {
    trust: "authoritative_server_context",
    organization_id: "10000000-0000-4000-8000-000000000001",
    capa_case_id: "30000000-0000-4000-8000-000000000001",
    case_version_id: "40000000-0000-4000-8000-000000000001",
    record_version: 8,
    workflow_state: "S80",
    actor: "50000000-0000-4000-8000-000000000001",
    active_roles: [],
    approved_s70_baseline: {
      source_case_version_id: "40000000-0000-4000-8000-000000000002",
      approved_action_plan_section_id: "60000000-0000-4000-8000-000000000001",
      approval_decision_reference: "70000000-0000-4000-8000-000000000001",
    },
    approved_actions: [{ approved_action_reference: ACTION }],
    workspace: {
      action_progress: [{
        approved_action_reference: ACTION,
        evidence: [{ evidence_id: EVIDENCE }],
      }],
    },
    ...overrides,
  } as unknown as AuthoritativeS80ImplementationEvidenceContext;
}

const manifest: CapaImplementationEvidenceAdvisoryReferenceManifestEntry[] = [{
  reference_key: "R1",
  source_kind: "approved_action",
  source_reference: ACTION,
  source_status: "authoritative",
  locator: null,
}];

describe("S80 implementation-evidence advisory output contract", () => {
  it("A: accepts the strict advisory-only output shape", () => {
    expect(validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw()))).toMatchObject({
      status: "completed_draft",
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    });
  });

  it("B: rejects an unsupported schema version", () => {
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ schema_version: "capa_implementation_evidence_advisory-9.9.9" })))).toThrow(/invalid/i);
  });

  it("C: rejects unsupported finding categories and malformed severity values", () => {
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ category: "implementation_complete" })] })))).toThrow(/invalid/i);
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ severity: "certain" })] })))).toThrow(/invalid/i);
  });

  it("D: rejects status, baseline, and evidence-authority fields supplied by a model", () => {
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ owner_reported_status: "reported_complete" })))).toThrow(/invalid/i);
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ evidence: [{ evidence_id: EVIDENCE }], approved_s70_baseline: "invented" })] })))).toThrow(/invalid/i);
  });

  it("E/F: rejects model citations, malformed evidence IDs, duplicate references, and overlong text", () => {
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ citations: ["invented-source"] })))).toThrow(/invalid/i);
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ evidence_reference_ids: ["not-a-uuid"] })] })))).toThrow(/invalid/i);
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ reference_keys: ["R1", "R1"] })] })))).toThrow(/invalid/i);
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ advisory_summary: "x".repeat(4_001) })))).toThrow(/invalid/i);
  });

  it("G: permits a documentation-only narrative suggestion and rejects other adoption", () => {
    const result = validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ category: "documentation_improvement", adoption: { eligible: true, field: "implementation_narrative", suggested_value: "Document the verified training record and its source." } })] })));
    expect(result.findings[0].adoption.eligible).toBe(true);
    expect(() => validateCapaImplementationEvidenceAdvisoryModelOutput(JSON.stringify(raw({ findings: [finding({ category: "missing_evidence", adoption: { eligible: true, field: "implementation_narrative", suggested_value: "Add evidence." } })] })))).toThrow(/invalid/i);
  });
});

describe("S80 implementation-evidence advisory authoritative bindings", () => {
  it("H: binds findings to approved actions and server-manifest references", () => {
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw() as never, authoritativeContext(), manifest)).toBe(true);
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw({ findings: [finding({ approved_action_reference: OTHER_ACTION })] }) as never, authoritativeContext(), manifest)).toBe(false);
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw({ findings: [finding({ evidence_reference_ids: [EVIDENCE] })] }) as never, authoritativeContext(), manifest)).toBe(false);
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw({ findings: [finding({ reference_keys: ["R99"] })] }) as never, authoritativeContext(), manifest)).toBe(false);
  });

  it("I/J/K: prevents cross-action evidence, invented citations, and non-documentation adoption", () => {
    const otherEvidenceContext = authoritativeContext({ workspace: { action_progress: [{ approved_action_reference: ACTION, evidence: [{ evidence_id: EVIDENCE, approved_action_reference: OTHER_ACTION }] }] } });
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw({ findings: [finding({ evidence_reference_ids: [EVIDENCE] })] }) as never, otherEvidenceContext, manifest)).toBe(false);
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw({ citations: [{ reference_key: "R1", source_kind: "governed_knowledge", source_reference: "invented", source_status: "governed_current_effective", locator: null }] }) as never, authoritativeContext(), manifest)).toBe(false);
    expect(validateCapaImplementationEvidenceAdvisoryAuthoritativeBindings(raw({ findings: [finding({ category: "missing_evidence", adoption: { eligible: true, field: "implementation_narrative", suggested_value: "Claim completion." } })] }) as never, authoritativeContext(), manifest)).toBe(false);
  });
});
