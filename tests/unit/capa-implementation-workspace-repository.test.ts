import { describe, expect, it } from "vitest";
import type { RequestTrace } from "../../lib/capa/domain/capa-types";
import type { SaveCapaImplementationWorkspaceInput } from "../../lib/database/repositories/capa-implementation-workspace-repository";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-evidence-contract";
import {
  CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-contract";
import {
  CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
} from "../../lib/capa/implementation/capa-implementation-return-response-contract";
import { InMemoryCapaDatabase } from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "10000000-0000-4000-8000-000000000001";
const OTHER_ORG = "10000000-0000-4000-8000-000000000002";
const CASE = "20000000-0000-4000-8000-000000000001";
const OTHER_CASE = "20000000-0000-4000-8000-000000000002";
const SOURCE_VERSION = "30000000-0000-4000-8000-000000000001";
const CURRENT_VERSION = "30000000-0000-4000-8000-000000000002";
const RETURNED_VERSION = "30000000-0000-4000-8000-000000000003";
const ACTION_SECTION = "40000000-0000-4000-8000-000000000001";
const APPROVAL_AUDIT = "50000000-0000-4000-8000-000000000001";
const USER = "60000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const ACTION_PLAN = {
  items: [{
    item_id: "ACTION-1",
    action_type: null,
    description: "Complete the approved implementation action.",
    linked_targets: [],
    owner_user_id: null,
    due_date: null,
    status: "approved",
    deliverable: null,
    implementation_evidence: null,
    dependency_item_ids: [],
    unintended_consequence_assessment: null,
    effectiveness_check_required: false,
    draft_provenance: {
      source_type: "human",
      source_reference: null,
      adopted_by_user_id: null,
      adopted_at: null,
    },
  }],
  effectiveness_checks: [],
};

const BASELINE = {
  source_case_version_id: SOURCE_VERSION,
  approved_action_plan_section_id: ACTION_SECTION,
  approval_decision_reference: APPROVAL_AUDIT,
};

function source(overrides: Record<string, unknown> = {}) {
  return {
    origin_kind: "uploaded_artifact",
    source_system_kind: "other",
    source_system_name: "Document store",
    source_record_reference: "TR-001",
    source_record_version: "1",
    artifact_reference: "artifact://TR-001",
    ...overrides,
  };
}

function evidence(id: string, overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_IMPLEMENTATION_EVIDENCE_SCHEMA_VERSION,
    evidence_id: id,
    approved_action_reference: "ACTION-1",
    evidence_kind: "training_record",
    description: "Training completion record",
    evidence_date: "2026-09-10",
    source: source(),
    ...overrides,
  };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    action_progress: [],
    implementation_review_return_response: null,
    ...overrides,
  };
}

function saveInput(
  value: Record<string, unknown> = {},
): SaveCapaImplementationWorkspaceInput {
  return {
    organization_id: ORG as never,
    capa_case_id: CASE as never,
    case_version_id: CURRENT_VERSION as never,
    record_version: 8,
    draft: draft() as never,
    draft_revision: 1,
    expected_draft_revision: null,
    actor_user_id: USER as never,
    approved_s70_baseline: BASELINE as never,
    ...value,
  } as SaveCapaImplementationWorkspaceInput;
}

function requestTrace(id: string): RequestTrace {
  return {
    request_id: `request-${id}` as never,
    correlation_id: `correlation-${id}` as never,
  };
}

function database() {
  let transactionNumber = 0;
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => `transaction-${++transactionNumber}` as never,
    now: () => new Date(AT),
  });
}

async function seedApprovedS80Database() {
  const db = database();
  await db.runInTransaction(requestTrace("seed"), async (transaction) => {
    await db.insertCase(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      case_number: "CAPA-000001",
      current_version_id: CURRENT_VERSION,
      status: "S80",
      owner_user_id: USER,
      confidentiality: "CUSTOMER_CONFIDENTIAL",
      record_version: 8,
      effective_at: AT,
      created_at: AT,
      updated_at: AT,
      created_by: { actor_type: "human", actor_id: USER },
      updated_by: { actor_type: "human", actor_id: USER },
    } as never);
    await db.insertCaseVersion(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: SOURCE_VERSION,
      version_number: 7,
      parent_version_id: undefined,
      change_reason: "Approved S70 action plan",
      status: "S70",
      effective_at: AT,
      created_at: AT,
      created_by: { actor_type: "human", actor_id: USER },
      section_version_ids: [ACTION_SECTION],
    } as never);
    await db.insertCaseVersion(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      case_version_id: CURRENT_VERSION,
      version_number: 8,
      parent_version_id: SOURCE_VERSION,
      change_reason: "S80 implementation workspace",
      status: "S80",
      effective_at: AT,
      created_at: AT,
      created_by: { actor_type: "human", actor_id: USER },
      section_version_ids: [ACTION_SECTION],
    } as never);
    await db.insertSectionVersion(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      section_version_id: ACTION_SECTION,
      section_type: "CAPA.ACTION_PLAN",
      version_number: 1,
      schema_version: "capa-action-plan-1.0.0",
      content: ACTION_PLAN,
      change_reason: "Approved action plan",
      effective_at: AT,
      created_at: AT,
      created_by: { actor_type: "human", actor_id: USER },
    } as never);
    await db.saveDecision(transaction, {
      organization_id: ORG,
      capa_case_id: CASE,
      source_case_version_id: SOURCE_VERSION,
      action_plan_section_version_id: ACTION_SECTION,
      schema_version: "capa-action-plan-review-decision-1.0.0",
      decision: "approve",
      rationale: "Approved for implementation.",
      reviewer_user_id: USER,
      decided_at: AT,
      resulting_case_version_id: CURRENT_VERSION,
      transition_audit_event_id: APPROVAL_AUDIT,
    } as never);
  });
  return db;
}

describe("S80 implementation workspace persistence", () => {
  it("A/B/C/D/E/F: initializes, reloads, updates, and rejects stale revisions", async () => {
    const db = await seedApprovedS80Database();
    await expect(db.findWorkspace(ORG as never, CASE as never)).resolves.toBeNull();
    await expect(db.runInTransaction(requestTrace("create"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput()),
    )).resolves.toMatchObject({
      status: "saved",
      workspace: {
        draft_revision: 1,
        draft: { implementation_review_return_response: null },
      },
    });

    const first = await db.findWorkspace(ORG as never, CASE as never);
    expect(first).toMatchObject({
      draft_revision: 1,
      approved_s70_baseline: BASELINE,
      draft: { implementation_review_return_response: null },
    });
    await expect(db.runInTransaction(requestTrace("update"), (transaction) =>
      db.saveWorkspace(transaction, saveInput({
        draft: draft({
          action_progress: [{
            approved_action_reference: "ACTION-1",
            owner_reported_status: "blocked",
            implementation_narrative: "Implementation is paused.",
            blocked_reason: "Awaiting validated equipment access.",
            evidence: [],
          }],
        }),
        draft_revision: 2,
        expected_draft_revision: 1,
      })),
    )).resolves.toMatchObject({ status: "saved", workspace: { draft_revision: 2 } });
    await expect(db.runInTransaction(requestTrace("stale"), (transaction) =>
      db.saveWorkspace(transaction, saveInput({
        draft_revision: 2,
        expected_draft_revision: 1,
      })),
    )).resolves.toEqual({ status: "concurrency_conflict" });
  });

  it("G/H/M: preserves multiple evidence records, blocked state, return response, and provenance", async () => {
    const db = await seedApprovedS80Database();
    const response = {
      schema_version: CAPA_IMPLEMENTATION_REVIEW_RETURN_RESPONSE_DRAFT_SCHEMA_VERSION,
      return_transition_audit_event_id: "70000000-0000-4000-8000-000000000001",
      source_case_version_id: SOURCE_VERSION,
      resulting_case_version_id: CURRENT_VERSION,
      response_narrative: "The returned implementation comments were addressed.",
    };
    const firstEvidence = evidence("80000000-0000-4000-8000-000000000001");
    const secondEvidence = evidence("80000000-0000-4000-8000-000000000002", {
      source: source({
        source_system_name: null,
        source_record_reference: null,
        source_record_version: null,
        artifact_reference: null,
        origin_kind: "human_observation",
      }),
    });
    await db.runInTransaction(requestTrace("round-trip"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput({
        draft: draft({
          action_progress: [{
            approved_action_reference: "ACTION-1",
            owner_reported_status: "blocked",
            implementation_narrative: "Implementation is paused.",
            blocked_reason: "Awaiting validated equipment access.",
            evidence: [firstEvidence, secondEvidence],
          }],
          implementation_review_return_response: response,
        }),
      })),
    );
    await expect(db.findWorkspace(ORG as never, CASE as never)).resolves.toMatchObject({
      draft: {
        action_progress: [{
          owner_reported_status: "blocked",
          blocked_reason: "Awaiting validated equipment access.",
          evidence: [
            { evidence_id: firstEvidence.evidence_id, source: firstEvidence.source },
            { evidence_id: secondEvidence.evidence_id, source: secondEvidence.source },
          ],
        }],
        implementation_review_return_response: response,
      },
    });
  });

  it("rolls an existing workspace forward only while the authoritative case remains S80", async () => {
    const db = await seedApprovedS80Database();
    await db.runInTransaction(requestTrace("create"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput()),
    );
    await db.runInTransaction(requestTrace("return"), async (transaction) => {
      await db.insertCaseVersion(transaction, {
        organization_id: ORG,
        capa_case_id: CASE,
        case_version_id: RETURNED_VERSION,
        version_number: 9,
        parent_version_id: CURRENT_VERSION,
        change_reason: "Returned S90 implementation review cycle",
        status: "S80",
        effective_at: AT,
        created_at: AT,
        created_by: { actor_type: "human", actor_id: USER },
        section_version_ids: [ACTION_SECTION],
      } as never);
      await expect(db.advanceCurrentVersion(transaction, {
        organization_id: ORG,
        capa_case_id: CASE,
        expected_record_version: 8,
        expected_current_version_id: CURRENT_VERSION,
        next_current_version_id: RETURNED_VERSION,
        next_status: "S80",
        updated_at: AT,
        updated_by: { actor_type: "human", actor_id: USER },
      } as never)).resolves.toMatchObject({ status: "updated" });
    });
    await expect(db.runInTransaction(requestTrace("rollover"), (transaction) =>
      db.saveWorkspace(transaction, saveInput({
        case_version_id: RETURNED_VERSION,
        record_version: 9,
      })),
    )).resolves.toMatchObject({
      status: "saved",
      workspace: { case_version_id: RETURNED_VERSION, record_version: 9 },
    });
  });

  it("I/J/K: prevents baseline replacement and preserves transactional rollback", async () => {
    const db = await seedApprovedS80Database();
    await db.runInTransaction(requestTrace("create"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput()),
    );
    await expect(db.runInTransaction(requestTrace("baseline-change"), (transaction) =>
      db.saveWorkspace(transaction, saveInput({
        draft: draft({ action_progress: [{
          approved_action_reference: "ACTION-1",
          owner_reported_status: "in_progress",
          implementation_narrative: "Changed draft.",
          blocked_reason: null,
          evidence: [],
        }] }),
        draft_revision: 2,
        expected_draft_revision: 1,
        approved_s70_baseline: {
          ...BASELINE,
          approval_decision_reference: "70000000-0000-4000-8000-000000000002",
        },
      })),
    )).resolves.toEqual({ status: "baseline_conflict" });
    await expect(db.runInTransaction(requestTrace("rollback"), async (transaction) => {
      await db.saveWorkspace(transaction, saveInput({
        draft: draft({ action_progress: [{
          approved_action_reference: "ACTION-1",
          owner_reported_status: "in_progress",
          implementation_narrative: "Rolled-back draft.",
          blocked_reason: null,
          evidence: [],
        }] }),
        draft_revision: 2,
        expected_draft_revision: 1,
      }));
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    await expect(db.findWorkspace(ORG as never, CASE as never)).resolves.toMatchObject({ draft_revision: 1 });
  });

  it("L/M/N: enforces action authority, organization/case isolation, and malformed-domain rejection", async () => {
    const db = await seedApprovedS80Database();
    await expect(db.runInTransaction(requestTrace("non-authoritative"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput({
        draft: draft({ action_progress: [{
          approved_action_reference: "ACTION-OTHER",
          owner_reported_status: "in_progress",
          implementation_narrative: "Wrong action.",
          blocked_reason: null,
          evidence: [],
        }] }),
      })),
    )).rejects.toThrow("non-authoritative");
    await expect(db.findWorkspace(OTHER_ORG as never, CASE as never)).resolves.toBeNull();
    await expect(db.findWorkspace(ORG as never, OTHER_CASE as never)).resolves.toBeNull();
    await expect(db.runInTransaction(requestTrace("malformed"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput({
        draft: { ...draft(), unexpected: true },
      })),
    )).rejects.toThrow("initialization input is invalid");
  });

  it("round-trips the persisted workspace through the existing development snapshot", async () => {
    const db = await seedApprovedS80Database();
    await db.runInTransaction(requestTrace("snapshot"), (transaction) =>
      db.initializeWorkspace(transaction, saveInput()),
    );
    const snapshot = db.exportSnapshot();
    expect(snapshot.implementation_workspace_records).toHaveLength(1);
    const restored = new InMemoryCapaDatabase({
      generate_transaction_id: () => "restored-transaction" as never,
      now: () => new Date(AT),
      initial_snapshot: snapshot,
    });
    await expect(restored.findWorkspace(ORG as never, CASE as never)).resolves.toMatchObject({
      approved_s70_baseline: BASELINE,
      draft: { implementation_review_return_response: null },
      draft_revision: 1,
    });
  });
});
