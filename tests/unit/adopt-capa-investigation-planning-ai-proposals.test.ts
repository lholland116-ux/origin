import { describe, expect, it, vi } from "vitest";

import {
  adoptCapaInvestigationPlanningAiProposals,
  type AdoptCapaInvestigationPlanningAiProposalsDependencies,
} from "../../lib/capa/application/adopt-capa-investigation-planning-ai-proposals";
import { validateCapaInvestigationPlanningAdoptionIntent } from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const USER = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-09-03T12:00:00.000Z");

function intent() {
  return validateCapaInvestigationPlanningAdoptionIntent({
    expected_case_version_id: VERSION,
    expected_record_version: 3,
    output_id: OUTPUT,
    selected_items: [
      {
        proposal_key: "P2",
        investigation_question: "Question 2",
        evidence_target: "Evidence 2",
        investigation_method: "Method 2",
        scope_relationship: "Scope 2",
        owner_user_id: USER,
        due_date: "2026-09-30",
        dependency_proposal_keys: [],
      },
      {
        proposal_key: "P1",
        investigation_question: "Question 1",
        evidence_target: "Evidence 1",
        investigation_method: "Method 1",
        scope_relationship: "Scope 1",
        owner_user_id: USER,
        due_date: "2026-09-29",
        dependency_proposal_keys: [],
      },
    ],
  });
}

function dependencies(
  overrides: Partial<AdoptCapaInvestigationPlanningAiProposalsDependencies> = {},
) {
  let id = 0;
  const appendEvent = vi.fn(async (_transaction, event) => ({
    status: "appended" as const,
    event_id: event.event_id,
  }));
  const appendAdoption = vi.fn(async (_transaction, input) => ({
    status: "saved" as const,
    record: {
      adoption: input.adoption,
      request_fingerprint: input.request_fingerprint,
      record_fingerprint: input.record_fingerprint,
      audit_event_id: input.audit_event_id,
    },
  }));
  const base: AdoptCapaInvestigationPlanningAiProposalsDependencies = {
    tenant: { organization_id: ORG } as never,
    adopter: { actor_type: "human", actor_id: USER },
    transaction_manager: {
      runInTransaction: vi.fn(async (_trace, work) => work({
        transaction_id: "transaction-1" as never,
        started_at: NOW.toISOString() as never,
        request_trace: { request_id: "request", correlation_id: "correlation" } as never,
      })),
    },
    adoption_repository: { appendAdoption } as never,
    audit_repository: { appendEvent } as never,
    authorizer: { authorize: vi.fn().mockResolvedValue(true) },
    id_generator: {
      generateAdoptionId: () => `60000000-0000-4000-8000-${String(++id).padStart(12, "0")}` as never,
      generateAuditEventId: () => `70000000-0000-4000-8000-${String(++id).padStart(12, "0")}` as never,
    },
    clock: { now: () => NOW },
    configuration: { audit_schema_version: "audit-1.0.0" },
  };
  return {
    ...base,
    ...overrides,
    appendAdoption,
    appendEvent,
  };
}

function command() {
  return {
    capa_case_id: CASE_ID as never,
    adoption_intent: intent(),
    request_trace: {
      request_id: "80000000-0000-4000-8000-000000000001" as never,
      correlation_id: "90000000-0000-4000-8000-000000000001" as never,
      idempotency_key: "batch-1" as never,
    },
  };
}

describe("S30 batch AI-proposal adoption service", () => {
  it("binds one trusted batch timestamp/fingerprint and unique record identities", async () => {
    const test = dependencies();
    const result = await adoptCapaInvestigationPlanningAiProposals(test, command());

    expect(result.status).toBe("adopted");
    if (result.status !== "adopted") throw new Error("expected adoption");
    expect(result.records).toHaveLength(2);
    expect(new Set(result.records.map((record) => record.adoption.adoption_id)).size).toBe(2);
    expect(new Set(result.records.map((record) => record.audit_event_id)).size).toBe(2);
    expect(new Set(result.records.map((record) => record.record_fingerprint)).size).toBe(2);
    expect(new Set(result.records.map((record) => record.request_fingerprint)).size).toBe(1);
    expect(new Set(result.records.map((record) => record.adoption.adopted_at)).size).toBe(1);
    expect(new Set(result.records.map((record) => record.adoption.idempotency_key)).size).toBe(1);
    expect(test.appendEvent).toHaveBeenCalledTimes(2);
    expect(test.appendEvent.mock.calls[0]![1]).toMatchObject({
      event_type: "EVT-AI-PROPOSAL-ADOPTED",
      action: "ADOPT_CAPA_INVESTIGATION_PLANNING_AI_PROPOSALS",
      metadata: {
        workflow_mutated: false,
        controlled_record_mutated: false,
        gate_approved: false,
      },
    });
  });

  it("rolls back through the transaction boundary when a later adoption fails", async () => {
    const appendAdoption = vi.fn()
      .mockImplementationOnce(async (_transaction, input) => ({
        status: "saved" as const,
        record: {
          adoption: input.adoption,
          request_fingerprint: input.request_fingerprint,
          record_fingerprint: input.record_fingerprint,
          audit_event_id: input.audit_event_id,
        },
      }))
      .mockResolvedValueOnce({ status: "output_not_adoptable" });
    const test = dependencies({ adoption_repository: { appendAdoption } as never });

    await expect(adoptCapaInvestigationPlanningAiProposals(test, command()))
      .resolves.toEqual({ status: "output_not_adoptable" });
    expect(test.appendEvent).toHaveBeenCalledOnce();
  });

  it("does not open a transaction when authorization fails", async () => {
    const transaction = vi.fn();
    const test = dependencies({
      authorizer: { authorize: vi.fn().mockResolvedValue(false) },
      transaction_manager: { runInTransaction: transaction } as never,
    });
    await expect(adoptCapaInvestigationPlanningAiProposals(test, command()))
      .resolves.toEqual({ status: "authorization_denied", reason_code: "ADOPTION_NOT_AUTHORIZED" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
