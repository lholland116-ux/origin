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

import type {
  CapaContainmentRiskAdvisoryResponse,
} from "../../lib/capa/ai/capa-containment-risk-advisory-contract";

import type {
  CapaAiOutputId,
  CapaAiRunId,
  CapaPromptPackageId,
} from "../../lib/capa/ai/capa-prompt-contract";

import type {
  CapaContainmentRiskAdvisoryGenerationTraceCapture,
} from "../../lib/capa/ai/capa-ai-generation-trace";

import type {
  AuthoritativeS20ContainmentRiskContext,
} from "../../lib/capa/ai/capa-containment-risk-advisory-context";

import type {
  CapaContainmentRiskAdvisoryOutputRepository,
} from "../../lib/database/repositories/capa-containment-risk-advisory-output-repository";

import type {
  TransactionId,
} from "../../lib/database/transactions";

import {
  InMemoryCapaContainmentRiskAdvisoryPersistenceError,
  InMemoryCapaDatabase,
  InMemoryDuplicateRecordError,
  InMemoryTransactionNotActiveError,
} from "../../lib/database/in-memory/in-memory-capa-database";

const ORGANIZATION_ID =
  "10000000-0000-4000-8000-000000000001" as OrganizationId;
const CASE_ID =
  "20000000-0000-4000-8000-000000000001" as CapaCaseId;
const VERSION_ID =
  "30000000-0000-4000-8000-000000000001" as CapaCaseVersionId;
const REQUEST_ID =
  "40000000-0000-4000-8000-000000000001" as RequestId;
const CORRELATION_ID =
  "50000000-0000-4000-8000-000000000001" as CorrelationId;
const RUN_ID =
  "60000000-0000-4000-8000-000000000001" as CapaAiRunId;
const OUTPUT_ID =
  "70000000-0000-4000-8000-000000000001" as CapaAiOutputId;
const PROMPT_PACKAGE_ID =
  "80000000-0000-4000-8000-000000000001" as CapaPromptPackageId;
const NOW = "2026-09-01T00:00:00.000Z" as IsoDateTime;

function requestTrace(
  requestId: RequestId = REQUEST_ID,
  correlationId: CorrelationId = CORRELATION_ID,
): RequestTrace {
  return {
    request_id: requestId,
    correlation_id: correlationId,
    idempotency_key: "in-memory-s20-test",
  } as RequestTrace;
}

function database(): InMemoryCapaDatabase {
  let sequence = 0;

  return new InMemoryCapaDatabase({
    generate_transaction_id: () => {
      sequence += 1;
      return `transaction-${sequence}` as TransactionId;
    },
    now: () => new Date(NOW),
  });
}

function capaCase(
  status: CapaCaseStatus = "S20" as CapaCaseStatus,
): CapaCase {
  return {
    organization_id: ORGANIZATION_ID,
    capa_case_id: CASE_ID,
    case_number: "CAPA-000001",
    current_version_id: VERSION_ID,
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

function caseVersion(
  status: CapaCaseStatus = "S20" as CapaCaseStatus,
): CapaCaseVersion {
  return {
    organization_id: ORGANIZATION_ID,
    case_version_id: VERSION_ID,
    capa_case_id: CASE_ID,
    version_number: 2,
    change_reason: "S20 test fixture",
    status,
    section_version_ids: [],
    effective_at: NOW,
    created_at: NOW,
    created_by: { actor_type: "human", actor_id: "user" },
  };
}

async function seed(
  databaseInstance: InMemoryCapaDatabase,
  status: CapaCaseStatus = "S20" as CapaCaseStatus,
): Promise<void> {
  await databaseInstance.runInTransaction(
    requestTrace(),
    async (transaction) => {
      await databaseInstance.insertCase(
        transaction,
        capaCase(status),
      );
      await databaseInstance.insertCaseVersion(
        transaction,
        caseVersion(status),
      );
    },
  );
}

function context(
  overrides: Record<string, unknown> = {},
): AuthoritativeS20ContainmentRiskContext {
  return {
    trust: "authoritative_server_context",
    organization_id: ORGANIZATION_ID,
    capa_case_id: CASE_ID,
    case_version_id: VERSION_ID,
    record_version: 2,
    workflow_state: "S20",
    actor: "90000000-0000-4000-8000-000000000001" as AuthoritativeS20ContainmentRiskContext["actor"],
    active_roles: [],
    intake_scope: { initiating_event: "event" },
    persisted_containment_risk: null,
    ...overrides,
  } as AuthoritativeS20ContainmentRiskContext;
}

function response(
  overrides: Record<string, unknown> = {},
): CapaContainmentRiskAdvisoryResponse {
  return {
    run_id: RUN_ID as CapaContainmentRiskAdvisoryResponse["run_id"],
    output_id: OUTPUT_ID as CapaContainmentRiskAdvisoryResponse["output_id"],
    output_schema_version: "capa-containment-risk-advisory-1.0.0" as CapaContainmentRiskAdvisoryResponse["output_schema_version"],
    status: "completed_draft",
    proposal: {
      missing_risk_inputs: [],
      missing_impact_dimensions: [],
      human_review_questions: ["Is review required?"],
      evidence_provenance_gaps: [],
    },
    containment_summary: [],
    citations: [],
    assumptions: [],
    uncertainty_and_limitations: [],
    warnings: [],
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
    ...overrides,
  } as unknown as CapaContainmentRiskAdvisoryResponse;
}

function trace(
  overrides: Record<string, unknown> = {},
): CapaContainmentRiskAdvisoryGenerationTraceCapture {
  return {
    trace_schema_version: "capa-ai-generation-trace-1.0.0",
    package: {
      package_schema_version: "capa-containment-risk-prompt-package-1.0.0",
      scope: {
        organization_id: ORGANIZATION_ID,
        capa_case_id: CASE_ID,
        case_version_id: VERSION_ID,
        record_version: 2,
        workflow_state: "S20",
      },
      agent: {
        agent_id: "AG-INTAKE",
        agent_version: "ag-intake-1.0.0",
      },
      trace: {
        run_id: RUN_ID,
        prompt_package_id: PROMPT_PACKAGE_ID,
        request_id: REQUEST_ID,
        correlation_id: CORRELATION_ID,
        assembled_at: NOW,
      },
      generation_contract: {
        operation: "analyze_containment_impact_risk",
        requested_output: "containment_risk_analysis",
        output_schema_version: "capa-containment-risk-advisory-1.0.0",
        model_profile_version: "capa-model-profile-1.0.0",
        output_schema_name: "capa_containment_risk_advisory_1_0_0",
        output_schema_sha256: "a".repeat(64),
        store: false,
        maximum_output_characters: 30000,
      },
      context_provenance: {
        authoritative_server_context: {},
        untrusted_human_draft: null,
        focus: null,
      },
      governance: {
        advisory_only: true,
        workflow_mutated: false,
        human_acceptance_required: true,
      },
    },
    rendered_prompt: "controlled prompt",
    model_profile_version: "capa-model-profile-1.0.0",
    output_schema_name: "capa_containment_risk_advisory_1_0_0",
    output_schema: { type: "object" },
    store: false,
    maximum_output_characters: 30000,
    evidence_manifest: {
      evidence_manifest_schema_version: "capa-containment-risk-evidence-manifest-1.0.0",
      retrieval_performed: false,
      item_count: 0,
      items: [],
    },
    policy_manifest: {
      policy_manifest_schema_version: "capa-containment-risk-policy-manifest-1.0.0",
      agent: { agent_id: "AG-INTAKE", agent_version: "ag-intake-1.0.0" },
      workflow_state: "S20",
      operation: "analyze_containment_impact_risk",
      requested_output: "containment_risk_analysis",
      output_schema_version: "capa-containment-risk-advisory-1.0.0",
      generation: {
        model_profile_version: "capa-model-profile-1.0.0",
        output_schema_name: "capa_containment_risk_advisory_1_0_0",
        output_schema_sha256: "a".repeat(64),
      },
      authority: {
        advisory_only: true,
        workflow_mutated: false,
        human_acceptance_required: true,
      },
      prohibitions: [],
    },
    fingerprints: {
      algorithm: "sha256-canonical-json-v1",
      prompt_package_sha256: "b".repeat(64),
      rendered_prompt_sha256: "c".repeat(64),
      evidence_manifest_sha256: "d".repeat(64),
      policy_manifest_sha256: "e".repeat(64),
      output_schema_sha256: "f".repeat(64),
    },
    ...overrides,
  } as unknown as CapaContainmentRiskAdvisoryGenerationTraceCapture;
}

function input(
  overrides: Record<string, unknown> = {},
) {
  return {
    context: context(),
    response: response(),
    generation_trace: trace(),
    request_id: REQUEST_ID,
    correlation_id: CORRELATION_ID,
    ...overrides,
  } as Parameters<CapaContainmentRiskAdvisoryOutputRepository["save"]>[1];
}

describe("InMemoryCapaDatabase S20 advisory persistence", () => {
  it("satisfies the S20 repository contract and saves atomically", async () => {
    const databaseInstance = database();
    await seed(databaseInstance);
    const repository: CapaContainmentRiskAdvisoryOutputRepository = databaseInstance;

    await expect(
      databaseInstance.runInTransaction(
        requestTrace(),
        (transaction) => repository.save(transaction, input()),
      ),
    ).resolves.toBe("saved");
  });

  it.each([
    ["request", { request_id: "bad-request" }],
    ["correlation", { correlation_id: "bad-correlation" }],
  ])("rejects %s trace mismatch without reserving identity", async (_name, override) => {
    const databaseInstance = database();
    await seed(databaseInstance);

    await expect(
      databaseInstance.runInTransaction(
        requestTrace(),
        (transaction) => repository(databaseInstance).save(transaction, input(override)),
      ),
    ).rejects.toThrow(InMemoryCapaContainmentRiskAdvisoryPersistenceError);

    await expect(saveValid(databaseInstance)).resolves.toBe("saved");
  });

  it("returns case_changed for stale version, record, or workflow snapshots", async () => {
    for (const stale of [
      { context: { case_version_id: "stale-version" } },
      { context: { record_version: 3 } },
    ]) {
      const databaseInstance = database();
      await seed(databaseInstance);
      const staleContext = context(stale.context);
      const staleTrace = trace({
        package: {
          ...trace().package,
          scope: { ...trace().package.scope, ...stale.context },
        },
      });
      const result = await databaseInstance.runInTransaction(
        requestTrace(),
        (transaction) => repository(databaseInstance).save(transaction, input({ context: staleContext, generation_trace: staleTrace })),
      );
      expect(result).toBe("case_changed");
    }

    const workflowDatabase = database();
    await seed(workflowDatabase, "S30" as CapaCaseStatus);
    await expect(saveValid(workflowDatabase)).resolves.toBe("case_changed");
  });

  it.each([
    ["advisory_only", { advisory_only: false }],
    ["workflow_mutated", { workflow_mutated: true }],
    ["human_acceptance_required", { human_acceptance_required: false }],
    ["schema", { output_schema_version: "wrong" }],
    ["status", { status: "service_failed" }],
    ["proposal", { proposal: null }],
  ])("rejects invalid S20 authority envelope: %s", async (_name, override) => {
    const databaseInstance = database();
    await seed(databaseInstance);

    await expect(saveValid(databaseInstance, { response: response(override) })).rejects.toThrow(
      InMemoryCapaContainmentRiskAdvisoryPersistenceError,
    );
  });

  it.each([
    ["trace run", { trace: { package: { ...trace().package, trace: { ...trace().package.trace, run_id: "90000000-0000-4000-8000-000000000002" } } } }],
    ["trace request", { trace: { package: { ...trace().package, trace: { ...trace().package.trace, request_id: "90000000-0000-4000-8000-000000000002" } } } }],
    ["trace correlation", { trace: { package: { ...trace().package, trace: { ...trace().package.trace, correlation_id: "90000000-0000-4000-8000-000000000002" } } } }],
    ["trace case version", { trace: { package: { ...trace().package, scope: { ...trace().package.scope, case_version_id: "90000000-0000-4000-8000-000000000002" } } } }],
    ["trace record version", { trace: { package: { ...trace().package, scope: { ...trace().package.scope, record_version: 3 } } } }],
    ["trace workflow", { trace: { package: { ...trace().package, scope: { ...trace().package.scope, workflow_state: "S30" } } } }],
    ["agent", { trace: { package: { ...trace().package, agent: { agent_id: "AG-EVID", agent_version: "ag-evid-1.0.0" } } } }],
  ] as const)("rejects generation identity mismatch: %s", async (_name, override) => {
    const databaseInstance = database();
    await seed(databaseInstance);
    await expect(
      saveValid(databaseInstance, { generation_trace: override.trace }),
    ).rejects.toThrow(InMemoryCapaContainmentRiskAdvisoryPersistenceError);
  });

  it("enforces organization-scoped output and run uniqueness", async () => {
    const databaseInstance = database();
    await seed(databaseInstance);
    await expect(saveValid(databaseInstance)).resolves.toBe("saved");
    await expect(saveValid(databaseInstance, { response: response({ output_id: "70000000-0000-4000-8000-000000000002" }) })).rejects.toThrow(InMemoryDuplicateRecordError);
    const duplicateRun = RUN_ID;
    await expect(saveValid(databaseInstance, {
      response: response({ run_id: duplicateRun, output_id: "70000000-0000-4000-8000-000000000002" }),
      generation_trace: trace({
        package: {
          ...trace().package,
          trace: { ...trace().package.trace, run_id: duplicateRun },
        },
      }),
    })).rejects.toThrow(InMemoryDuplicateRecordError);
  });

  it("rolls back S20 output and trace together", async () => {
    const databaseInstance = database();
    await seed(databaseInstance);
    await expect(
      databaseInstance.runInTransaction(
        requestTrace(),
        async (transaction) => {
          await repository(databaseInstance).save(transaction, input());
          throw new Error("rollback");
        },
      ),
    ).rejects.toThrow("rollback");
    await expect(saveValid(databaseInstance)).resolves.toBe("saved");
  });

  it("protects inactive and manufactured transaction contexts", async () => {
    const databaseInstance = database();
    await seed(databaseInstance);
    let completed: Parameters<CapaContainmentRiskAdvisoryOutputRepository["save"]>[0] | undefined;
    await databaseInstance.runInTransaction(requestTrace(), async (transaction) => {
      completed = transaction;
    });
    await expect(repository(databaseInstance).save(completed!, input())).rejects.toThrow(InMemoryTransactionNotActiveError);
    await expect(repository(databaseInstance).save({ ...completed!, transaction_id: "transaction-2" as TransactionId }, input())).rejects.toThrow(InMemoryTransactionNotActiveError);
  });

  it("defensively clones caller response and generation trace values", async () => {
    const databaseInstance = database();
    await seed(databaseInstance);
    const suppliedResponse = response();
    const suppliedTrace = trace();
    const before = JSON.stringify({ suppliedResponse, suppliedTrace });
    await databaseInstance.runInTransaction(
      requestTrace(),
      (transaction) => repository(databaseInstance).save(transaction, input({ response: suppliedResponse, generation_trace: suppliedTrace })),
    );
    expect(JSON.stringify({ suppliedResponse, suppliedTrace })).toBe(before);
    Object.assign(suppliedResponse, {
      output_id: "70000000-0000-4000-8000-000000000009",
    });
    await expect(saveValid(databaseInstance)).rejects.toThrow(InMemoryDuplicateRecordError);
  });
});

function repository(
  databaseInstance: InMemoryCapaDatabase,
): CapaContainmentRiskAdvisoryOutputRepository {
  return databaseInstance;
}

async function saveValid(
  databaseInstance: InMemoryCapaDatabase,
  overrides: Record<string, unknown> = {},
) {
  return databaseInstance.runInTransaction(
    requestTrace(),
    (transaction) =>
      repository(databaseInstance).save(
        transaction,
        input(overrides),
      ),
  );
}
