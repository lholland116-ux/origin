import { describe, expect, it, vi } from "vitest";
import {
  adoptCapaInvestigationActiveAiProposals,
  type AdoptCapaInvestigationActiveAiProposalsDependencies,
} from "../../lib/capa/application/adopt-capa-investigation-active-ai-proposals";
import { validateCapaInvestigationActiveAdoptionIntent } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import type { CapaInvestigationActiveAdoptionCategory } from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
import {
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const USER = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-05T12:00:00.000Z");

const adoptedContent: Record<CapaInvestigationActiveAdoptionCategory, object> = {
  evidence_gap: { gap: "Gap", why_it_matters: "Why", recommended_next_step: "Next" },
  conflicting_information: { conflict: "Conflict", why_it_matters: "Why" },
  assumption: { assumption: "Assumption", verification_question: "Verify?" },
  causal_hypothesis: { hypothesis: "Hypothesis", rationale: "Rationale" },
  alternative_hypothesis: { hypothesis: "Alternative", rationale: "Rationale" },
  investigation_recommendation: { recommendation: "Recommendation", rationale: "Rationale" },
};
function intent(category: CapaInvestigationActiveAdoptionCategory = "evidence_gap", second = false) {
  const adopted_content = adoptedContent[category];
  return validateCapaInvestigationActiveAdoptionIntent({ expected_case_version_id: VERSION, expected_record_version: 4, output_id: OUTPUT, selected_items: [{ proposal_key: "P1", adopted_content }, ...(second ? [{ proposal_key: "P2", adopted_content }] : [])] });
}
function resolverResult(category: CapaInvestigationActiveAdoptionCategory = "evidence_gap", second = false) {
  const proposals = [{ proposal_key: "P1", proposal_category: category, source_proposal: {}, resolved_reference_bindings: [{ reference_key: "R1", relationship: "related", trust: "untrusted_human_draft", source_kind: "ledger_item", source_id: "ledger-1" }] }, ...(second ? [{ proposal_key: "P2", proposal_category: category, source_proposal: {}, resolved_reference_bindings: [] }] : [])];
  return { status: "resolved", organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, output_id: OUTPUT, selected_proposals: proposals, reference_manifest_schema_version: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION, reference_manifest_fingerprint_algorithm: CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM, reference_manifest_sha256: "a".repeat(64) } as never;
}
function setup(overrides: Partial<AdoptCapaInvestigationActiveAiProposalsDependencies> = {}, category: CapaInvestigationActiveAdoptionCategory = "evidence_gap", second = false) {
  let id = 0;
  const appendEvent = vi.fn(async (_transaction, event) => ({ status: "appended" as const, event_id: event.event_id }));
  const appendAdoption = vi.fn(async (_transaction, input) => ({ status: "saved" as const, record: { adoption: input.adoption, request_fingerprint: input.request_fingerprint, record_fingerprint: input.record_fingerprint, audit_event_id: input.audit_event_id } }));
  const source_resolver = { resolve: vi.fn().mockResolvedValue(resolverResult(category, second)) };
  const base: AdoptCapaInvestigationActiveAiProposalsDependencies = {
    tenant: { organization_id: ORG } as never,
    adopter: { actor_type: "human", actor_id: USER },
    transaction_manager: { runInTransaction: vi.fn(async (_trace, work) => work({ transaction_id: "tx" as never, started_at: NOW.toISOString() as never, request_trace: _trace })) } as never,
    adoption_repository: { appendAdoption } as never,
    audit_repository: { appendEvent } as never,
    authorizer: { authorize: vi.fn().mockResolvedValue(true) },
    source_resolver,
    id_generator: { generateAdoptionId: () => `60000000-0000-4000-8000-${String(++id).padStart(12, "0")}` as never, generateAuditEventId: () => `70000000-0000-4000-8000-${String(++id).padStart(12, "0")}` as never },
    clock: { now: () => NOW },
    configuration: { audit_schema_version: "audit-1.0.0" },
  };
  const dependencies = { ...base, ...overrides };
  return { ...dependencies, source_resolver: dependencies.source_resolver, appendAdoption, appendEvent };
}
function command(category: CapaInvestigationActiveAdoptionCategory = "evidence_gap", second = false) {
  return { capa_case_id: CASE_ID, adoption_intent: intent(category, second), request_trace: { request_id: "80000000-0000-4000-8000-000000000001", correlation_id: "90000000-0000-4000-8000-000000000001", idempotency_key: "batch-1" } } as never;
}

describe("S40 investigation-active adoption service", () => {
  it("resolves category and references server-side and records advisory-only evidence", async () => {
    const test = setup({}, "evidence_gap");
    const result = await adoptCapaInvestigationActiveAiProposals(test, command());
    expect(result.status).toBe("adopted");
    expect(test.source_resolver.resolve).toHaveBeenCalledWith(expect.objectContaining({ organization_id: ORG, capa_case_id: CASE_ID, expected_case_version_id: VERSION, expected_record_version: 4, output_id: OUTPUT, proposal_keys: ["P1"] }));
    expect(test.appendAdoption).toHaveBeenCalledOnce();
    const record = test.appendAdoption.mock.calls[0]![1].adoption;
    expect(record.proposal_category).toBe("evidence_gap");
    expect(record.resolved_reference_bindings[0]).toMatchObject({ reference_key: "R1", source_id: "ledger-1" });
    expect(record.reference_manifest_sha256).toHaveLength(64);
    expect(record.workflow_mutated).toBe(false);
    expect(record.controlled_record_mutated).toBe(false);
    expect(record.gate_approved).toBe(false);
    expect(test.appendEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ event_type: "EVT-AI-PROPOSAL-ADOPTED", target: expect.objectContaining({ object_type: "CAPA_INVESTIGATION_ACTIVE_ADOPTION" }), metadata: expect.objectContaining({ proposal_category: "evidence_gap", reference_manifest_sha256: "a".repeat(64), workflow_mutated: false }) }));
  });

  it("uses the resolved category for adopted-content validation and supports a multi-item batch", async () => {
    const test = setup({}, "assumption", true);
    const result = await adoptCapaInvestigationActiveAiProposals(test, command("assumption", true));
    expect(result.status).toBe("adopted");
    expect(test.appendAdoption).toHaveBeenCalledTimes(2);
    expect(test.appendAdoption.mock.calls[0]![1].adoption.adopted_item.adopted_content).toEqual({ assumption: "Assumption", verification_question: "Verify?" });
  });

  it.each([
    "evidence_gap", "conflicting_information", "assumption", "causal_hypothesis", "alternative_hypothesis", "investigation_recommendation",
  ] as CapaInvestigationActiveAdoptionCategory[]) ("supports server-derived %s adoption content", async (category) => {
    const test = setup({}, category);
    await expect(adoptCapaInvestigationActiveAiProposals(test, command(category))).resolves.toMatchObject({ status: "adopted" });
    expect(test.appendAdoption.mock.calls[0]![1].adoption.proposal_category).toBe(category);
  });

  it("maps safe source and repository outcomes and authorizes before resolving", async () => {
    const denied = setup({ authorizer: { authorize: vi.fn().mockResolvedValue(false) } });
    await expect(adoptCapaInvestigationActiveAiProposals(denied, command())).resolves.toEqual({ status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" });
    expect(denied.source_resolver.resolve).not.toHaveBeenCalled();
    const missing = setup({ source_resolver: { resolve: vi.fn().mockResolvedValue({ status: "output_not_found_or_not_authorized" }) } as never });
    await expect(adoptCapaInvestigationActiveAiProposals(missing, command())).resolves.toEqual({ status: "output_not_found_or_not_authorized" });
    const nonadoptable = setup({ source_resolver: { resolve: vi.fn().mockResolvedValue({ status: "output_not_adoptable" }) } as never });
    await expect(adoptCapaInvestigationActiveAiProposals(nonadoptable, command())).resolves.toEqual({ status: "output_not_adoptable" });
  });

  it("maps replay, idempotency, and concurrency outcomes and audits only saves", async () => {
    const replay = setup({ adoption_repository: { appendAdoption: vi.fn(async (_transaction, input) => ({ status: "already_recorded" as const, record: { adoption: input.adoption, request_fingerprint: input.request_fingerprint, record_fingerprint: input.record_fingerprint, audit_event_id: input.audit_event_id } })) } as never });
    await expect(adoptCapaInvestigationActiveAiProposals(replay, command())).resolves.toMatchObject({ status: "already_adopted" });
    expect(replay.appendEvent).not.toHaveBeenCalled();
    const conflict = setup({ adoption_repository: { appendAdoption: vi.fn(async () => ({ status: "conflict" as const, reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST", record: {} as never })) } as never });
    await expect(adoptCapaInvestigationActiveAiProposals(conflict, command())).resolves.toEqual({ status: "idempotency_conflict" });
    const changed = setup({ adoption_repository: { appendAdoption: vi.fn(async () => ({ status: "case_changed" as const })) } as never });
    await expect(adoptCapaInvestigationActiveAiProposals(changed, command())).resolves.toEqual({ status: "concurrency_conflict" });
  });

  it("rejects an empty batch before transaction persistence", async () => {
    const test = setup();
    await expect(adoptCapaInvestigationActiveAiProposals(test, { capa_case_id: CASE_ID, adoption_intent: { expected_case_version_id: VERSION, expected_record_version: 4, output_id: OUTPUT, selected_items: [] }, request_trace: { request_id: "80000000-0000-4000-8000-000000000001", correlation_id: "90000000-0000-4000-8000-000000000001", idempotency_key: "batch-1" } } as never)).rejects.toThrow();
    expect(test.appendAdoption).not.toHaveBeenCalled();
  });
});
