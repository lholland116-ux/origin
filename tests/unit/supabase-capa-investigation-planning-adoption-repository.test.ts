import { describe, expect, it, vi } from "vitest";

let activeSql: unknown;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({
  requireSupabaseTransaction: vi.fn(() => activeSql),
}));

import {
  constructCapaInvestigationPlanningAdoption,
  validateCapaInvestigationPlanningAdoptionIntent,
} from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";
import {
  SupabaseCapaInvestigationPlanningAdoptionRepository,
  SupabaseCapaInvestigationPlanningAdoptionRepositoryError,
} from "../../lib/database/supabase/supabase-capa-investigation-planning-adoption-repository";
import type { CapaInvestigationPlanningAdoptionRecord } from "../../lib/capa/ai/capa-investigation-planning-adoption-contract";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const REQUEST = "50000000-0000-4000-8000-000000000001";
const CORRELATION = "60000000-0000-4000-8000-000000000001";
const ADOPTION = "70000000-0000-4000-8000-000000000001";
const AUDIT = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-09-03T12:00:00.000Z";

function adoption(overrides: Record<string, unknown> = {}): CapaInvestigationPlanningAdoptionRecord {
  const item = validateCapaInvestigationPlanningAdoptionIntent({
    expected_case_version_id: VERSION,
    expected_record_version: 2,
    output_id: OUTPUT,
    selected_items: [{
      proposal_key: "P1",
      investigation_question: "Question",
      evidence_target: "Evidence",
      investigation_method: "Method",
      scope_relationship: "Scope",
      owner_user_id: null,
      due_date: null,
      dependency_proposal_keys: [],
    }],
  }).selected_items[0]!;
  return constructCapaInvestigationPlanningAdoption({
    adoption_id: ADOPTION as never,
    organization_id: ORG as never,
    capa_case_id: CASE_ID as never,
    case_version_id: VERSION as never,
    record_version: 2,
    output_id: OUTPUT as never,
    adopted_item: item,
    adopted_at: NOW as never,
    adopted_by: { actor_type: "human", actor_id: "human-1" },
    request_id: REQUEST as never,
    correlation_id: CORRELATION as never,
    idempotency_key: "adoption-1" as never,
    ...overrides,
  });
}

function persistenceInput(
  record = adoption(),
  overrides: Record<string, unknown> = {},
) {
  return {
    adoption: record,
    request_fingerprint: "a".repeat(64) as never,
    record_fingerprint: "b".repeat(64) as never,
    audit_event_id: AUDIT as never,
    ...overrides,
  };
}

function rowFor(input = persistenceInput()) {
  const record = input.adoption;
  return {
    organization_id: record.organization_id,
    adoption_id: record.adoption_id,
    output_id: record.output_id,
    capa_case_id: record.capa_case_id,
    case_version_id: record.case_version_id,
    record_version: record.record_version,
    output_status: "completed_draft",
    proposal_key: record.proposal_key,
    adopted_item: record.adopted_item,
    adopted_at: record.adopted_at,
    adopted_by_actor_type: record.adopted_by.actor_type,
    adopted_by_actor_id: record.adopted_by.actor_id,
    adoption_policy_version: record.adoption_policy_version,
    request_id: record.request_id,
    correlation_id: record.correlation_id,
    idempotency_key: record.idempotency_key,
    request_fingerprint: input.request_fingerprint,
    audit_event_id: input.audit_event_id,
    adoption_record: record,
    record_fingerprint_algorithm: "sha256",
    record_fingerprint: input.record_fingerprint,
    workflow_mutated: false,
    controlled_record_mutated: false,
    gate_approved: false,
    created_at: record.adopted_at,
  };
}

function outputRow(overrides: Record<string, unknown> = {}) {
  return {
    output_id: OUTPUT,
    capa_case_id: CASE_ID,
    case_version_id: VERSION,
    record_version: 2,
    status: "completed_draft",
    agent_id: "AG-PLAN",
    agent_version: "ag-plan-1.0.0",
    output_schema_version: "capa_investigation_plan_draft-1.0.0",
    proposal: {
      investigation_questions: [{ proposal_key: "P1" }],
      evidence_requests: [],
      method_suggestions: [],
      dependencies: [],
      proposed_owner_role: [],
      gaps: [],
    },
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
    ...overrides,
  };
}

function harness(...responses: unknown[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const queue = [...responses];
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    const next = queue.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  activeSql = Object.assign(tagged, { json: (value: unknown) => value });
  return {
    calls,
    transaction: {
      transaction_id: "transaction-1",
      started_at: NOW,
      request_trace: { request_id: REQUEST, correlation_id: CORRELATION },
    } as never,
  };
}

describe("Supabase S30 investigation-planning adoption repository", () => {
  it("locks the current case, binds the exact output, and inserts the immutable shape", async () => {
    const input = persistenceInput();
    const h = harness([], [outputRow()], [{ current_version_id: VERSION, record_version: 2, status: "S30" }], [rowFor(input)]);
    const repository = new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never);

    await expect(repository.appendAdoption(h.transaction, input)).resolves.toMatchObject({ status: "saved" });
    expect(h.calls).toHaveLength(4);
    expect(h.calls[2].query).toContain("for update");
    expect(h.calls[3].query).toContain("on conflict do nothing");
    expect(h.calls[3].values).toContain("human");
    expect(h.calls[3].query).toContain("sha256");
  });

  it("returns the original record for batch-level idempotent replay", async () => {
    const originalInput = persistenceInput();
    const replayInput = persistenceInput(adoption({
      adoption_id: "70000000-0000-4000-8000-000000000002",
      adopted_at: "2026-09-03T12:01:00.000Z",
      request_id: "50000000-0000-4000-8000-000000000002",
      correlation_id: "60000000-0000-4000-8000-000000000002",
    }), {
      record_fingerprint: "c".repeat(64),
      audit_event_id: "80000000-0000-4000-8000-000000000002",
    });
    const h = harness([rowFor(originalInput)]);
    const suppliedBefore = JSON.stringify(replayInput);
    const result = await new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(h.transaction, replayInput);
    expect(result).toEqual({
      status: "already_recorded",
      record: expect.objectContaining({
        adoption: expect.objectContaining({ adoption_id: ADOPTION }),
        audit_event_id: AUDIT,
        record_fingerprint: "b".repeat(64),
      }),
    });
    expect(h.calls).toHaveLength(1);
    expect(JSON.stringify(replayInput)).toBe(suppliedBefore);
  });

  it("preserves request, adoption, and audit identity conflicts", async () => {
    const differentRequest = persistenceInput(adoption(), {
      request_fingerprint: "c".repeat(64),
    });
    const requestHarness = harness([rowFor(persistenceInput())]);
    await expect(new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(requestHarness.transaction, differentRequest)).resolves.toMatchObject({
        status: "conflict",
        reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
      });

    const adoptionIdCollision = persistenceInput(adoption({
      idempotency_key: "adoption-2",
      adopted_item: { ...adoption().adopted_item, proposal_key: "P2" },
    }));
    const adoptionIdHarness = harness([rowFor(adoptionIdCollision)]);
    await expect(new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(adoptionIdHarness.transaction, persistenceInput())).resolves.toMatchObject({
        status: "conflict",
        reason_code: "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT",
      });

    const auditCollision = persistenceInput(adoption({
      adoption_id: "70000000-0000-4000-8000-000000000003",
      idempotency_key: "adoption-3",
    }));
    const auditHarness = harness([rowFor(auditCollision)]);
    await expect(new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(auditHarness.transaction, persistenceInput())).resolves.toMatchObject({
        status: "conflict",
        reason_code: "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION",
      });
  });

  it("fails malformed persistence input before SQL", async () => {
    const h = harness();
    const input = persistenceInput({
      ...adoption(),
      workflow_mutated: true,
    } as never);
    await expect(new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(h.transaction, input)).rejects.toThrow(SupabaseCapaInvestigationPlanningAdoptionRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ["missing output", [], "output_not_found_or_not_authorized"],
    ["wrong agent", [outputRow({ agent_id: "OTHER" })], "output_not_adoptable"],
  ] as const)("rejects %s without inserting", async (_name, outputs, expected) => {
    const h = harness([], outputs);
    const result = await new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(h.transaction, persistenceInput());
    expect(result).toEqual({ status: expected });
    expect(h.calls).toHaveLength(2);
  });

  it("returns case_changed after the exact output is found but the aggregate is stale", async () => {
    const h = harness([], [outputRow()], []);
    await expect(new SupabaseCapaInvestigationPlanningAdoptionRepository({} as never)
      .appendAdoption(h.transaction, persistenceInput())).resolves.toEqual({ status: "case_changed" });
    expect(h.calls[2].query).toContain("for update");
  });

  it("resolves tenant-scoped records and preserves caller objects", async () => {
    const input = persistenceInput();
    const suppliedBefore = JSON.stringify(input);
    const row = rowFor(input);
    const h = harness([row], [row]);
    const repository = new SupabaseCapaInvestigationPlanningAdoptionRepository(activeSql as never);
    const found = await repository.findAdoptionById(ORG as never, ADOPTION as never);
    const listed = await repository.listAdoptionsForOutput(ORG as never, OUTPUT as never);
    expect(found?.adoption.adoption_id).toBe(ADOPTION);
    expect(listed).toHaveLength(1);
    expect(h.calls).toHaveLength(2);
    expect(JSON.stringify(input)).toBe(suppliedBefore);
  });
});
