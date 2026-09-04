import { describe, expect, it } from "vitest";

import type {
  AuditEvent,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaCaseStatus,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";
import type { CapaInvestigationPlanAdvisoryResponse } from "../../lib/capa/ai/capa-investigation-planning-advisory-contract";
import type { TransactionId } from "../../lib/database/transactions";
import {
  constructCapaInvestigationPlanningAdoption,
  validateCapaInvestigationPlanningAdoptionIntent,
} from "../../lib/capa/ai/capa-investigation-planning-adoption-validator";
import type { CapaInvestigationPlanningAdoptionRecord } from "../../lib/capa/ai/capa-investigation-planning-adoption-contract";
import type { CapaInvestigationPlanningAdoptionPersistenceInput } from "../../lib/database/repositories/capa-investigation-planning-adoption-repository";
import {
  InMemoryCapaDatabase,
  InMemoryIntegrityError,
  InMemoryTransactionNotActiveError,
} from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "10000000-0000-4000-8000-000000000001" as OrganizationId;
const CASE_ID = "20000000-0000-4000-8000-000000000001" as CapaCaseId;
const VERSION = "30000000-0000-4000-8000-000000000001" as CapaCaseVersionId;
const OUTPUT = "40000000-0000-4000-8000-000000000001";
const REQUEST = "50000000-0000-4000-8000-000000000001" as RequestId;
const CORRELATION = "60000000-0000-4000-8000-000000000001" as CorrelationId;
const AUDIT = "70000000-0000-4000-8000-000000000001";
const NOW = "2026-09-03T12:00:00.000Z" as IsoDateTime;

function database(): InMemoryCapaDatabase {
  let transactionNumber = 0;
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => `transaction-${++transactionNumber}` as TransactionId,
    now: () => new Date(NOW),
  });
}

function trace(): RequestTrace {
  return { request_id: REQUEST, correlation_id: CORRELATION };
}

function capaCase(): CapaCase {
  return {
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_number: "CAPA-000001",
    current_version_id: VERSION,
    status: "S30" as CapaCaseStatus,
    owner_user_id: "80000000-0000-4000-8000-000000000001" as never,
    confidentiality: "CUSTOMER_CONFIDENTIAL" as never,
    effective_at: NOW,
    record_version: 2,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "seed" },
    updated_at: NOW,
    updated_by: { actor_type: "human", actor_id: "seed" },
  };
}

function caseVersion(): CapaCaseVersion {
  return {
    organization_id: ORG,
    case_version_id: VERSION,
    capa_case_id: CASE_ID,
    version_number: 2,
    change_reason: "S30 adoption test",
    status: "S30" as CapaCaseStatus,
    section_version_ids: [],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "seed" },
  };
}

function auditEvent(): AuditEvent {
  return {
    organization_id: ORG,
    event_id: AUDIT as never,
    event_type: "EVT-AI-PROPOSAL-ADOPTED" as never,
    schema_version: "audit-1.0.0",
    aggregate_type: "CAPA_CASE" as never,
    aggregate_id: CASE_ID,
    aggregate_version: 2,
    actor: { actor_type: "human", actor_id: "human-1" },
    occurred_at: NOW,
    request_id: REQUEST,
    correlation_id: CORRELATION,
    action: "ADOPT_CAPA_INVESTIGATION_PLANNING_AI_PROPOSALS" as never,
    target: {
      object_type: "CAPA_INVESTIGATION_PLANNING_ADOPTION" as never,
      object_id: adoption().adoption_id,
      object_version_id: VERSION,
    },
    outcome: "succeeded",
    configuration_versions: { audit: "audit-1.0.0" },
    metadata: {},
  };
}

async function seededDatabase(): Promise<InMemoryCapaDatabase> {
  const db = database();
  await db.runInTransaction(trace(), async (transaction) => {
    await db.insertCase(transaction, capaCase());
    await db.insertCaseVersion(transaction, caseVersion());
  });

  const state = (db as unknown as {
    committed_state: {
      advisory_outputs: Map<string, unknown>;
      audit_events: Map<string, unknown>;
    };
  }).committed_state;
  const response: CapaInvestigationPlanAdvisoryResponse = {
    run_id: "90000000-0000-4000-8000-000000000001" as never,
    output_id: OUTPUT as never,
    output_schema_version: "capa_investigation_plan_draft-1.0.0" as never,
    status: "completed_draft",
    proposal: {
      investigation_questions: [{
        proposal_key: "P1" as never,
        investigation_question: "Question",
        scope_relationship: "Scope",
        due_date_consideration: "Due date",
        human_review_question: "Review?",
      }],
      evidence_requests: [],
      method_suggestions: [],
      dependencies: [],
      proposed_owner_role: [],
      gaps: [],
    },
    assumptions: [],
    uncertainty_and_limitations: [],
    citations: [],
    warnings: [],
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
  };
  state.advisory_outputs.set(`${ORG}:${OUTPUT}`, {
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_version_id: VERSION,
    record_version: 2,
    request_trace: trace(),
    response,
    generation_trace: { package: { agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" } } },
    created_at: NOW,
  });
  state.audit_events.set(`${ORG}:${AUDIT}`, {
    organization_id: ORG,
    event_id: AUDIT,
    aggregate_id: CASE_ID,
  });
  return db;
}

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
    adoption_id: "10000000-0000-4000-8000-000000000001" as never,
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_version_id: VERSION,
    record_version: 2,
    output_id: OUTPUT as never,
    adopted_item: item,
    adopted_at: NOW,
    adopted_by: { actor_type: "human", actor_id: "human-1" },
    request_id: REQUEST,
    correlation_id: CORRELATION,
    idempotency_key: "adoption-1" as never,
    ...overrides,
  });
}

function input(
  record: CapaInvestigationPlanningAdoptionRecord = adoption(),
  overrides: Partial<Omit<CapaInvestigationPlanningAdoptionPersistenceInput, "adoption">> = {},
): CapaInvestigationPlanningAdoptionPersistenceInput {
  return {
    adoption: record,
    request_fingerprint: "a".repeat(64) as never,
    record_fingerprint: "b".repeat(64) as never,
    audit_event_id: AUDIT as never,
    ...overrides,
  };
}

describe("in-memory S30 investigation-planning adoption repository", () => {
  it("persists tenant-bound immutable adoption evidence and returns clones", async () => {
    const db = await seededDatabase();
    const result = await db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, input()),
    );

    expect(result.status).toBe("saved");
    const stored = await db.findAdoptionById(ORG, adoption().adoption_id);
    expect(stored?.adoption.proposal_key).toBe("P1");
    expect(stored?.adoption.adopted_by.actor_type).toBe("human");
    expect(stored?.adoption.workflow_mutated).toBe(false);
    expect(stored?.adoption.controlled_record_mutated).toBe(false);
    expect(stored?.adoption.gate_approved).toBe(false);
    expect((await db.listAdoptionsForOutput(ORG, OUTPUT))).toHaveLength(1);
  });

  it("defers adoption audit-event integrity until transaction commit", async () => {
    const db = await seededDatabase();
    const state = (db as unknown as {
      committed_state: { audit_events: Map<string, unknown> };
    }).committed_state;
    state.audit_events.clear();

    await db.runInTransaction(trace(), async (transaction) => {
      await expect(db.appendAdoption(transaction, input())).resolves.toMatchObject({
        status: "saved",
      });
      await expect(db.appendEvent(transaction, auditEvent())).resolves.toEqual({
        status: "appended",
        event_id: AUDIT,
      });
    });

    expect(await db.findAdoptionById(ORG, adoption().adoption_id)).toMatchObject({
      adoption: { adoption_id: adoption().adoption_id },
      audit_event_id: AUDIT,
    });
  });

  it("supports batch-level idempotent replay and preserves independent identity conflicts", async () => {
    const db = await seededDatabase();
    const first = await db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, input()),
    );
    expect(first.status).toBe("saved");
    if (first.status !== "saved") throw new Error("expected first adoption to save");

    const replay = input(adoption({
      adoption_id: "10000000-0000-4000-8000-000000000002" as never,
      adopted_at: "2026-09-03T12:01:00.000Z" as IsoDateTime,
      request_id: "50000000-0000-4000-8000-000000000002" as never,
      correlation_id: "60000000-0000-4000-8000-000000000002" as never,
    }), {
      record_fingerprint: "c".repeat(64) as never,
      audit_event_id: "70000000-0000-4000-8000-000000000002" as never,
    });
    const replayBefore = JSON.stringify(replay);
    const replayResult = await db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, replay),
    );
    expect(replayResult).toEqual({ status: "already_recorded", record: first.record });
    expect(JSON.stringify(replay)).toBe(replayBefore);

    await expect(db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, input(adoption(), {
        request_fingerprint: "c".repeat(64) as never,
      })),
    )).resolves.toMatchObject({
      status: "conflict",
      reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    });

    const differentId = adoption({
      idempotency_key: "adoption-2" as never,
      adopted_item: { ...adoption().adopted_item, proposal_key: "P2" as never },
    });
    await expect(db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, input(differentId)),
    )).resolves.toMatchObject({
      status: "conflict",
      reason_code: "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT",
    });

    const differentAudit = adoption({
      adoption_id: "10000000-0000-4000-8000-000000000003" as never,
      idempotency_key: "adoption-3" as never,
    });
    await expect(db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, input(differentAudit)),
    )).resolves.toMatchObject({
      status: "conflict",
      reason_code: "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION",
    });
  });

  it("requires a stored completed S30 output and selected proposal key", async () => {
    const db = await seededDatabase();
    const unknown = adoption({ adopted_item: { ...adoption().adopted_item, proposal_key: "P2" as never } });
    await expect(db.runInTransaction(trace(), (transaction) =>
      db.appendAdoption(transaction, input(unknown)),
    )).resolves.toEqual({ status: "output_not_adoptable" });
  });

  it("participates in rollback and rejects inactive transactions", async () => {
    const db = await seededDatabase();
    let completed: unknown;
    await expect(db.runInTransaction(trace(), async (transaction) => {
      completed = transaction;
      await db.appendAdoption(transaction, input());
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await db.findAdoptionById(ORG, adoption().adoption_id)).toBeNull();
    await expect(db.appendAdoption(completed as never, input())).rejects.toThrow(InMemoryTransactionNotActiveError);
  });

  it("fails missing adoption audit evidence at commit and rolls back", async () => {
    const db = await seededDatabase();
    const supplied = input(adoption());
    const before = JSON.stringify(supplied);
    const state = (db as unknown as {
      committed_state: {
        audit_events: Map<string, unknown>;
      };
    }).committed_state;
    state.audit_events.clear();

    await expect(db.runInTransaction(trace(), async (transaction) => {
      await expect(db.appendAdoption(transaction, supplied)).resolves.toMatchObject({
        status: "saved",
      });
    })).rejects.toThrow(InMemoryIntegrityError);

    expect(await db.findAdoptionById(ORG, adoption().adoption_id)).toBeNull();
    expect(JSON.stringify(supplied)).toBe(before);
  });
});
