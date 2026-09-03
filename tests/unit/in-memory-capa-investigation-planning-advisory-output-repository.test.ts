import { describe, expect, it } from "vitest";

import type {
  CapaCase,
  CapaCaseStatus,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaCaseId,
  CorrelationId,
  IsoDateTime,
  OrganizationId,
  RequestId,
  RequestTrace,
} from "../../lib/capa/domain/capa-types";
import type { TransactionId } from "../../lib/database/transactions";
import type { CapaInvestigationPlanningAdvisoryOutputRepository } from "../../lib/database/repositories/capa-investigation-planning-advisory-output-repository";
import {
  InMemoryCapaDatabase,
  InMemoryCapaInvestigationPlanningAdvisoryPersistenceError,
  InMemoryDuplicateRecordError,
  InMemoryTransactionNotActiveError,
} from "../../lib/database/in-memory/in-memory-capa-database";

const ORG = "10000000-0000-4000-8000-000000000001" as OrganizationId;
const CASE_ID = "20000000-0000-4000-8000-000000000001" as CapaCaseId;
const VERSION = "30000000-0000-4000-8000-000000000001" as CapaCaseVersionId;
const REQUEST = "40000000-0000-4000-8000-000000000001" as RequestId;
const CORRELATION = "50000000-0000-4000-8000-000000000001" as CorrelationId;
const RUN = "60000000-0000-4000-8000-000000000001";
const OUTPUT = "70000000-0000-4000-8000-000000000001";
const PACKAGE = "80000000-0000-4000-8000-000000000001";
const NOW = "2026-09-01T00:00:00.000Z" as IsoDateTime;

function database() {
  let sequence = 0;
  return new InMemoryCapaDatabase({
    generate_transaction_id: () => `transaction-${++sequence}` as TransactionId,
    now: () => new Date(NOW),
  });
}

function requestTrace(): RequestTrace {
  return { request_id: REQUEST, correlation_id: CORRELATION } as RequestTrace;
}

function capaCase(status: CapaCaseStatus = "S30" as CapaCaseStatus): CapaCase {
  return {
    organization_id: ORG,
    capa_case_id: CASE_ID,
    case_number: "CAPA-000001",
    current_version_id: VERSION,
    status,
    owner_user_id: "90000000-0000-4000-8000-000000000001" as CapaCase["owner_user_id"],
    confidentiality: "CUSTOMER_CONFIDENTIAL" as CapaCase["confidentiality"],
    effective_at: NOW,
    record_version: 2,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "user" },
    updated_at: NOW,
    updated_by: { actor_type: "human", actor_id: "user" },
  };
}

function caseVersion(status: CapaCaseStatus = "S30" as CapaCaseStatus): CapaCaseVersion {
  return {
    organization_id: ORG,
    case_version_id: VERSION,
    capa_case_id: CASE_ID,
    version_number: 2,
    change_reason: "S30 test fixture",
    status,
    section_version_ids: [],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "user" },
  };
}

async function seed(databaseInstance: InMemoryCapaDatabase, status: CapaCaseStatus = "S30" as CapaCaseStatus) {
  await databaseInstance.runInTransaction(requestTrace(), async (transaction) => {
    await databaseInstance.insertCase(transaction, capaCase(status));
    await databaseInstance.insertCaseVersion(transaction, caseVersion(status));
  });
}

function input(overrides: Record<string, unknown> = {}): any {
  return {
    context: {
      trust: "authoritative_server_context",
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: VERSION,
      record_version: 2,
      workflow_state: "S30",
      actor: "90000000-0000-4000-8000-000000000001",
      active_roles: [],
      intake_scope: {},
      accepted_scope: {},
      accepted_containment_risk: {},
    },
    response: {
      run_id: RUN,
      output_id: OUTPUT,
      output_schema_version: "capa_investigation_plan_draft-1.0.0",
      status: "completed_draft",
      proposal: {
        investigation_questions: [],
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
    },
    generation_trace: {
      trace_schema_version: "capa-ai-generation-trace-1.0.0",
      package: {
        package_schema_version: "capa-investigation-planning-prompt-package-1.0.0",
        scope: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 2, workflow_state: "S30" },
        agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" },
        trace: { run_id: RUN, prompt_package_id: PACKAGE, request_id: REQUEST, correlation_id: CORRELATION, assembled_at: NOW },
        generation_contract: { operation: "draft_investigation_plan", requested_output: "investigation_plan_draft", output_schema_version: "capa_investigation_plan_draft-1.0.0", store: false },
      },
      rendered_prompt: "prompt",
      model_profile_version: "profile",
      output_schema_name: "schema",
      output_schema: {},
      store: false,
      maximum_output_characters: 30000,
      evidence_manifest: { evidence_manifest_schema_version: "capa-investigation-planning-evidence-manifest-1.0.0", retrieval_performed: false, item_count: 0, items: [] },
      policy_manifest: { policy_manifest_schema_version: "capa-investigation-planning-policy-manifest-1.0.0", agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" }, workflow_state: "S30", operation: "draft_investigation_plan", requested_output: "investigation_plan_draft", output_schema_version: "capa_investigation_plan_draft-1.0.0", authority: { advisory_only: true, workflow_mutated: false, human_acceptance_required: true }, prohibitions: [] },
      fingerprints: { algorithm: "sha256-canonical-json-v1" },
    },
    request_id: REQUEST,
    correlation_id: CORRELATION,
    ...overrides,
  };
}

async function saveValid(databaseInstance: InMemoryCapaDatabase, overrides: Record<string, unknown> = {}) {
  const repository: CapaInvestigationPlanningAdvisoryOutputRepository = databaseInstance;
  return databaseInstance.runInTransaction(requestTrace(), (transaction) =>
    repository.save(transaction, input(overrides)),
  );
}

describe("InMemoryCapaDatabase S30 advisory persistence", () => {
  it("persists the advisory and matching trace without mutating callers", async () => {
    const db = database();
    await seed(db);
    const supplied = input();
    const before = JSON.stringify(supplied);
    await db.runInTransaction(requestTrace(), (transaction) =>
      db.save(transaction, supplied),
    );
    expect(JSON.stringify(supplied)).toBe(before);
    const state = (db as any).committed_state;
    const record = [...state.advisory_outputs.values()][0];
    expect(record.response.run_id).toBe(RUN);
    expect(record.response.output_id).toBe(OUTPUT);
    expect(record.generation_trace.package.trace.run_id).toBe(RUN);
    expect(record.generation_trace.evidence_manifest.retrieval_performed).toBe(false);
  });

  it.each([
    ["wrong workflow state", "S20"],
    ["missing case", "missing"],
  ])("returns case_changed for %s", async (_name, kind) => {
    const db = database();
    if (kind === "S20") await seed(db, "S20" as CapaCaseStatus);
    await expect(saveValid(db)).resolves.toBe("case_changed");
  });

  it("returns case_changed for version and record mismatches", async () => {
    const db = database();
    await seed(db);
    await expect(saveValid(db, {
      context: { ...input().context, case_version_id: "90000000-0000-4000-8000-000000000001" },
      generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, scope: { ...input().generation_trace.package.scope, case_version_id: "90000000-0000-4000-8000-000000000001" } } },
    })).resolves.toBe("case_changed");
    await expect(saveValid(db, {
      context: { ...input().context, record_version: 3 },
      generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, scope: { ...input().generation_trace.package.scope, record_version: 3 } } },
    })).resolves.toBe("case_changed");
  });

  it("rejects inactive transactions and duplicate output/run identities", async () => {
    const db = database();
    await seed(db);
    let completed: any;
    await db.runInTransaction(requestTrace(), async (transaction) => { completed = transaction; });
    await expect(db.save(completed, input())).rejects.toThrow(InMemoryTransactionNotActiveError);
    await expect(saveValid(db)).resolves.toBe("saved");
    await expect(saveValid(db, { response: { ...input().response, output_id: "90000000-0000-4000-8000-000000000001" } })).rejects.toThrow(InMemoryDuplicateRecordError);
    await expect(saveValid(db, { response: { ...input().response, run_id: RUN, output_id: "90000000-0000-4000-8000-000000000002" }, generation_trace: { ...input().generation_trace, package: { ...input().generation_trace.package, trace: { ...input().generation_trace.package.trace, run_id: RUN } } } })).rejects.toThrow(InMemoryDuplicateRecordError);
  });

  it("rolls back output and trace together and rejects transaction identity mismatches", async () => {
    const db = database();
    await seed(db);
    await expect(db.runInTransaction(requestTrace(), async (transaction) => {
      await db.save(transaction, input());
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    await expect(saveValid(db)).resolves.toBe("saved");

    const mismatch = database();
    await seed(mismatch);
    await expect(mismatch.runInTransaction(requestTrace(), (transaction) =>
      mismatch.save(transaction, input({ request_id: "90000000-0000-4000-8000-000000000001" })),
    )).rejects.toThrow(InMemoryCapaInvestigationPlanningAdvisoryPersistenceError);

    await expect(mismatch.runInTransaction(requestTrace(), (transaction) =>
      mismatch.save(transaction, input({ correlation_id: "90000000-0000-4000-8000-000000000001" })),
    )).rejects.toThrow(InMemoryCapaInvestigationPlanningAdvisoryPersistenceError);
  });
});
