import { describe, expect, it } from "vitest";

import type {
  CapaCase,
  CapaCaseStatus,
  CapaCaseVersion,
  CapaCaseId,
  CapaCaseVersionId,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";
import type { TransactionId } from "../../lib/database/transactions";
import {
  InMemoryCapaDatabase,
  InMemoryCapaInvestigationActiveAdvisoryPersistenceError,
  InMemoryDuplicateRecordError,
} from "../../lib/database/in-memory/in-memory-capa-database";
import { constructCapaInvestigationActiveAdoption } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import { createCapaInvestigationActiveAdvisoryReferenceManifest } from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";

const ORG = "10000000-0000-4000-8000-000000000001" as OrganizationId;
const CASE_ID = "20000000-0000-4000-8000-000000000001" as CapaCaseId;
const VERSION = "30000000-0000-4000-8000-000000000001" as CapaCaseVersionId;
const REQUEST = "40000000-0000-4000-8000-000000000001" as RequestId;
const CORRELATION = "50000000-0000-4000-8000-000000000001" as CorrelationId;
const RUN = "60000000-0000-4000-8000-000000000001";
const OUTPUT = "70000000-0000-4000-8000-000000000001";
const PACKAGE = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-09-01T00:00:00.000Z" as IsoDateTime;

function requestTrace(): RequestTrace {
  return { request_id: REQUEST, correlation_id: CORRELATION } as RequestTrace;
}

function database(): InMemoryCapaDatabase {
  let sequence = 0;
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => `s40-transaction-${++sequence}` as TransactionId,
    now: () => new Date(NOW),
  });
}

function capaCase(status: CapaCaseStatus = "S40"): CapaCase {
  return {
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_number: "CAPA-000001",
    current_version_id: VERSION,
    status,
    owner_user_id: "90000000-0000-4000-8000-000000000001" as CapaCase["owner_user_id"],
    confidentiality: "CUSTOMER_CONFIDENTIAL" as CapaCase["confidentiality"],
    effective_at: NOW,
    record_version: 4,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "user" },
    updated_at: NOW,
    updated_by: { actor_type: "human", actor_id: "user" },
  };
}

function caseVersion(status: CapaCaseStatus = "S40"): CapaCaseVersion {
  return {
    organization_id: ORG,
    case_version_id: VERSION,
    capa_case_id: CASE_ID,
    version_number: 4,
    change_reason: "S40 qualification fixture",
    status,
    section_version_ids: [],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "user" },
  };
}

async function seed(
  db: InMemoryCapaDatabase,
  status: CapaCaseStatus = "S40",
): Promise<void> {
  await db.runInTransaction(requestTrace(), async (transaction) => {
    await db.insertCase(transaction, capaCase(status));
    await db.insertCaseVersion(transaction, caseVersion(status));
  });
}

function modelSafeContext(references: readonly unknown[] = []): any {
  return { trust: "model_safe_context", workflow_state: "S40", references };
}

function input(overrides: Record<string, unknown> = {}): any {
  return {
    context: {
      trust: "authoritative_server_context",
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: VERSION,
      record_version: 4,
      workflow_state: "S40",
      actor: "90000000-0000-4000-8000-000000000001",
      active_roles: [],
      investigation_plan: { items: [] },
    },
    response: {
      run_id: RUN,
      output_id: OUTPUT,
      output_schema_version: "capa_investigation_analysis_draft-1.0.0",
      status: "completed_draft",
      proposal: {
        evidence_gaps: [],
        conflicting_information: [],
        assumptions: [],
        causal_hypotheses: [],
        alternative_hypotheses: [],
        investigation_recommendations: [],
      },
      uncertainty_and_limitations: [],
      citations: [],
      warnings: [],
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    },
    generation_trace: {
      trace_schema_version: "capa-ai-generation-trace-1.0.0",
      package: {
        package_schema_version: "capa-investigation-active-prompt-package-1.0.0",
        scope: {
          organization_id: ORG,
          capa_case_id: CASE_ID,
          case_version_id: VERSION,
          record_version: 4,
          workflow_state: "S40",
        },
        agent: { agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" },
        trace: {
          run_id: RUN,
          prompt_package_id: PACKAGE,
          request_id: REQUEST,
          correlation_id: CORRELATION,
          assembled_at: NOW,
        },
        context_provenance: { model_safe_context: modelSafeContext() },
        generation_contract: {
          operation: "facilitate_root_cause",
          requested_output: "investigation_analysis_draft",
          output_schema_version: "capa_investigation_analysis_draft-1.0.0",
        },
      },
      store: false,
      evidence_manifest: {
        evidence_manifest_schema_version: "capa-investigation-active-evidence-manifest-1.0.0",
        retrieval_performed: false,
        item_count: 0,
        items: [],
      },
      policy_manifest: {
        policy_manifest_schema_version: "capa-investigation-active-policy-manifest-1.0.0",
        agent: { agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" },
        workflow_state: "S40",
        operation: "facilitate_root_cause",
        requested_output: "investigation_analysis_draft",
        output_schema_version: "capa_investigation_analysis_draft-1.0.0",
        authority: { advisory_only: true, workflow_mutated: false, human_acceptance_required: true },
      },
      fingerprints: { algorithm: "sha256-canonical-json-v1" },
    },
    reference_manifest: [],
    request_id: REQUEST,
    correlation_id: CORRELATION,
    ...overrides,
  };
}

async function save(
  db: InMemoryCapaDatabase,
  overrides: Record<string, unknown> = {},
): Promise<unknown> {
  return db.runInTransaction(requestTrace(), (transaction) =>
    db.save(transaction, input(overrides)),
  );
}

function committedRecord(db: InMemoryCapaDatabase): any {
  return [...(db as any).committed_state.advisory_outputs.values()][0];
}

describe("InMemoryCapaDatabase S40 advisory persistence", () => {
  it("retains response, trace, separate manifest, fingerprint, and exact binding", async () => {
    const db = database();
    await seed(db);
    const reference = {
      reference_key: "R1",
      trust: "authoritative_server_context",
      source_kind: "investigation_plan_item",
    };

    await save(db, {
      generation_trace: {
        ...input().generation_trace,
        package: {
          ...input().generation_trace.package,
          context_provenance: { model_safe_context: modelSafeContext([reference]) },
        },
      },
      reference_manifest: [{ ...reference, source_id: "INV-1" }],
    });

    const record = committedRecord(db);
    expect(record.response.output_id).toBe(OUTPUT);
    expect(record.generation_trace.package.agent).toEqual({ agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" });
    expect(record.reference_manifest.document.entries[0].source_id).toBe("INV-1");
    expect(record.reference_manifest.reference_manifest_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(record).toMatchObject({ organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, request_trace: requestTrace() });
  });

  it("round-trips complete S40 state through a development snapshot", async () => {
    const db = database();
    await seed(db);
    await save(db);
    const snapshot = db.exportSnapshot();
    const hydrated = new InMemoryCapaDatabase({
      generate_transaction_id: () => "hydrated-s40" as TransactionId,
      now: () => new Date(NOW),
      initial_snapshot: snapshot,
    });
    const record = committedRecord(hydrated);
    expect(record.response).toEqual(committedRecord(db).response);
    expect(record.generation_trace).toEqual(committedRecord(db).generation_trace);
    expect(record.reference_manifest).toEqual(committedRecord(db).reference_manifest);
  });

  it.each([
    ["extra response field", { response: { ...input().response, extra: true } }],
    ["invalid semantic response", { response: { ...input().response, proposal: { ...input().response.proposal, evidence_gaps: [{ proposal_key: "P1", gap: "gap", why_it_matters: "matter", related_reference_keys: [], recommended_next_step: "step", human_review_question: "Not a question." }] } } }],
    ["invalid trace", { generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" } } } }],
    ["invalid manifest", { reference_manifest: [{ reference_key: "R1", trust: "authoritative_server_context", source_kind: "investigation_plan_item", source_id: " " }] }],
  ])("fails closed for %s", async (_name, overrides) => {
    const db = database();
    await seed(db);
    await expect(save(db, overrides)).rejects.toThrow(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
    expect((db as any).committed_state.advisory_outputs.size).toBe(0);
    expect((db as any).committed_state.advisory_runs.size).toBe(0);
  });

  it("rejects unknown output references", async () => {
    const db = database();
    await seed(db);
    const reference = { reference_key: "R1", trust: "authoritative_server_context", source_kind: "investigation_plan_item" };
    const invalidResponse = {
      ...input().response,
      proposal: {
        ...input().response.proposal,
        evidence_gaps: [{ proposal_key: "P1", gap: "gap", why_it_matters: "matter", related_reference_keys: ["R2"], recommended_next_step: "step", human_review_question: "Does this require review?" }],
      },
    };
    await expect(save(db, {
      response: invalidResponse,
      generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, context_provenance: { model_safe_context: modelSafeContext([reference]) } } },
      reference_manifest: [{ ...reference, source_id: "INV-1" }],
    })).rejects.toThrow(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
  });

  it("rejects duplicate output and run identities", async () => {
    const db = database();
    await seed(db);
    await save(db);
    await expect(save(db)).rejects.toThrow(InMemoryDuplicateRecordError);
    await expect(save(db, {
      response: { ...input().response, output_id: "70000000-0000-4000-8000-000000000002" },
      generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, trace: { ...input().generation_trace.package.trace, output_id: undefined } } },
    })).rejects.toThrow();
  });

  it.each([
    ["request/correlation mismatch", { request_id: "90000000-0000-4000-8000-000000000001" }],
    ["correlation mismatch", { correlation_id: "90000000-0000-4000-8000-000000000001" }],
  ])("rejects %s", async (_name, overrides) => {
    const db = database();
    await seed(db);
    await expect(save(db, overrides)).rejects.toThrow(InMemoryCapaInvestigationActiveAdvisoryPersistenceError);
  });

  it.each([
    ["case version", { context: { ...input().context, case_version_id: "90000000-0000-4000-8000-000000000001" }, generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, scope: { ...input().generation_trace.package.scope, case_version_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["record version", { context: { ...input().context, record_version: 5 }, generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, scope: { ...input().generation_trace.package.scope, record_version: 5 } } } }],
  ])("returns case_changed for stale %s", async (_name, overrides) => {
    const db = database();
    await seed(db);
    await expect(save(db, overrides)).resolves.toBe("case_changed");
    expect((db as any).committed_state.advisory_outputs.size).toBe(0);
  });

  it("returns case_changed when the current workflow is no longer S40", async () => {
    const db = database();
    await seed(db, "S30");
    await expect(save(db)).resolves.toBe("case_changed");
    expect((db as any).committed_state.advisory_outputs.size).toBe(0);
  });

  it("rolls back output, run index, and manifest together", async () => {
    const db = database();
    await seed(db);
    await expect(db.runInTransaction(requestTrace(), async (transaction) => {
      await db.save(transaction, input());
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((db as any).committed_state.advisory_outputs.size).toBe(0);
    expect((db as any).committed_state.advisory_runs.size).toBe(0);
    await expect(save(db)).resolves.toBe("saved");
  });

  it("appends and exactly replays durable S40 adoption evidence in the same snapshot", async () => {
    const db = database();
    await seed(db);
    const manifest = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest: [], model_safe_context: modelSafeContext() });
    const adoption = constructCapaInvestigationActiveAdoption({
      adoption_id: "71000000-0000-4000-8000-000000000001" as never,
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: VERSION,
      record_version: 4,
      output_id: OUTPUT,
      proposal_key: "P1",
      proposal_category: "evidence_gap",
      adopted_item: { proposal_key: "P1", adopted_content: { gap: "Gap", why_it_matters: "Why", recommended_next_step: "Next" } },
      resolved_reference_bindings: [],
      reference_manifest_schema_version: manifest.document.manifest_schema_version,
      reference_manifest_fingerprint_algorithm: manifest.fingerprint_algorithm,
      reference_manifest_sha256: manifest.reference_manifest_sha256,
      adopted_at: NOW,
      adopted_by: { actor_type: "human", actor_id: "90000000-0000-4000-8000-000000000001" },
      request_id: REQUEST,
      correlation_id: CORRELATION,
      idempotency_key: "batch-1" as never,
      workflow_mutated: false,
      controlled_record_mutated: false,
      gate_approved: false,
    });
    const persistedInput: any = { adoption, request_fingerprint: "a".repeat(64), record_fingerprint: "b".repeat(64), audit_event_id: "72000000-0000-4000-8000-000000000001" };
    const append = async (tx: any) => db.appendAdoption(tx, persistedInput);
    await db.runInTransaction(requestTrace(), async (transaction) => {
      await db.save(transaction, {
        ...input(),
        response: {
          ...input().response,
          proposal: {
            ...input().response.proposal,
            evidence_gaps: [{
              proposal_key: "P1", gap: "Gap", why_it_matters: "Why",
              related_reference_keys: [], recommended_next_step: "Next",
              human_review_question: "Does this require review?",
            }],
          },
        },
      });
      const result = await append(transaction);
      expect(result.status).toBe("saved");
      await db.appendEvent(transaction, {
        organization_id: ORG, event_id: persistedInput.audit_event_id,
        event_type: "EVT-AI-PROPOSAL-ADOPTED" as never, schema_version: "audit-1.0.0",
        aggregate_type: "CAPA_CASE" as never, aggregate_id: CASE_ID, aggregate_version: 4,
        actor: adoption.adopted_by, occurred_at: NOW, request_id: REQUEST, correlation_id: CORRELATION,
        action: "ADOPT_CAPA_INVESTIGATION_ACTIVE_AI_PROPOSALS" as never,
        target: { object_type: "CAPA_INVESTIGATION_ACTIVE_ADOPTION" as never, object_id: adoption.adoption_id },
        outcome: "succeeded", configuration_versions: {}, metadata: {},
      } as never);
    });
    await expect(db.runInTransaction(requestTrace(), append)).resolves.toMatchObject({ status: "already_recorded" });
    await expect(db.findAdoptionById(ORG, adoption.adoption_id)).resolves.toMatchObject({ adoption });
  });
});
