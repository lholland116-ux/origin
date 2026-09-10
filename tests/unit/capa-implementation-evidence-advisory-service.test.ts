import { describe, expect, it, vi } from "vitest";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT,
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-agent-gate";
import {
  CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-contract";
import {
  CapaImplementationEvidenceAdvisoryService,
} from "../../lib/capa/ai/capa-implementation-evidence-advisory-service";
import type { CapaImplementationEvidenceAdvisoryContextAssembly } from "../../lib/capa/ai/capa-implementation-evidence-advisory-context";
import type { CapaImplementationEvidenceAdvisoryGenerationTraceCapture } from "../../lib/capa/ai/capa-implementation-evidence-advisory-model-generator";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const USER = "40000000-0000-4000-8000-000000000001";
const REQUEST = "50000000-0000-4000-8000-000000000001";
const CORRELATION = "60000000-0000-4000-8000-000000000001";
const RUN = "70000000-0000-4000-8000-000000000001";
const OUTPUT = "80000000-0000-4000-8000-000000000001";

function assembly(): CapaImplementationEvidenceAdvisoryContextAssembly {
  const action = {
    approved_action_reference: "ACTION-1",
    status: "approved",
    action_type: "corrective",
    description: "Complete the approved implementation action.",
    due_date: null,
    deliverable: "Validated record",
    implementation_expectation: "Verified evidence",
    effectiveness_check_required: false,
    acceptance_criteria: [],
  };
  const authoritative = {
    trust: "authoritative_server_context",
    organization_id: ORG,
    capa_case_id: CASE,
    case_version_id: VERSION,
    record_version: 8,
    workflow_state: "S80",
    actor: USER,
    active_roles: [],
    approved_s70_baseline: {
      source_case_version_id: "30000000-0000-4000-8000-000000000002",
      approved_action_plan_section_id: "30000000-0000-4000-8000-000000000003",
      approval_decision_reference: "30000000-0000-4000-8000-000000000004",
    },
    approved_actions: [action],
    workspace: { action_progress: [], implementation_review_return_response: null },
  } as any;
  return {
    authoritative,
    reference_manifest: [{ reference_key: "R1", source_kind: "approved_action", source_reference: "ACTION-1", source_status: "authoritative", locator: null }],
    model_safe_context: {
      trust: "model_safe_context",
      workflow_state: "S80",
      case_version_id: VERSION as never,
      record_version: 8,
      approved_s70_baseline: authoritative.approved_s70_baseline,
      approved_actions: [action],
      untrusted_human_workspace: authoritative.workspace,
      references: [{ reference_key: "R1", source_kind: "approved_action" }],
      governed_knowledge: [],
    },
    citations: [{ reference_key: "R1", source_kind: "approved_action", source_reference: "ACTION-1", source_status: "authoritative", locator: null }],
    knowledge_provenance: null,
    knowledge_warnings: [],
  } as CapaImplementationEvidenceAdvisoryContextAssembly;
}

function response(overrides: Record<string, unknown> = {}) {
  return {
    run_id: RUN,
    output_id: OUTPUT,
    output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION,
    schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION,
    status: "completed_draft",
    advisory_summary: "Review the implementation workspace.",
    findings: [],
    warnings: [],
    uncertainty_and_limitations: [],
    citations: [],
    advisory_only: true,
    workflow_mutated: false,
    controlled_record_mutated: false,
    approval_claimed: false,
    workflow_transition: null,
    human_acceptance_required: true,
    ...overrides,
  } as any;
}

function trace(): CapaImplementationEvidenceAdvisoryGenerationTraceCapture {
  return {
    trace_schema_version: "capa-ai-generation-trace-1.0.0",
    package: {
      package_schema_version: "capa-implementation-evidence-advisory-prompt-package-1.0.0",
      scope: { organization_id: ORG, capa_case_id: CASE, case_version_id: VERSION, record_version: 8, workflow_state: "S80" },
      agent: { agent_id: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_id, agent_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_AGENT.agent_version },
      trace: { run_id: RUN, request_id: REQUEST, correlation_id: CORRELATION },
      generation_contract: { operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION, output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION },
    },
    rendered_prompt: "S80 advisory prompt",
    model_profile_version: "capa-implementation-evidence-advisory-model-profile-1.0.0",
    output_schema_name: "capa_implementation_evidence_advisory_1_0_0",
    output_schema: {},
    store: false,
    maximum_output_characters: 40_000,
    evidence_manifest: {},
    policy_manifest: {},
    fingerprints: {},
  } as unknown as CapaImplementationEvidenceAdvisoryGenerationTraceCapture;
}

function invocation(overrides: Record<string, unknown> = {}) {
  return {
    organization_id: ORG,
    capa_case_id: CASE,
    user_id: USER,
    request_id: REQUEST,
    correlation_id: CORRELATION,
    request: { expected_case_version_id: VERSION, expected_record_version: 8 },
    ...overrides,
  } as any;
}

function subject(overrides: Record<string, unknown> = {}) {
  const generated = { response: response(), trace: trace() };
  const dependencies = {
    context_resolver: {
      resolve: vi.fn(async () => ({ status: "resolved", assembly: assembly() })),
      assertCaseUnchanged: vi.fn(async () => true),
    },
    authorizer: { authorize: vi.fn(async () => true) },
    agent_gate: { evaluate: vi.fn(() => true) },
    generator: { generate: vi.fn(async () => generated) },
    output_repository: { save: vi.fn(async () => "saved") },
    transaction_manager: { runInTransaction: vi.fn(async (_trace: unknown, work: (transaction: unknown) => unknown) => work({ transaction_id: "tx-1" })) },
    ...overrides,
  } as any;
  return { service: new CapaImplementationEvidenceAdvisoryService(dependencies), dependencies, generated };
}

describe("S80 implementation-evidence advisory service", () => {
  it("T: resolves, authorizes, validates, rechecks, and persists an advisory snapshot", async () => {
    const test = subject();
    const result = await test.service.execute(invocation());
    expect(result).toMatchObject({ advisory: { advisory_only: true }, snapshot: { capa_case_id: CASE, case_version_id: VERSION, record_version: 8 } });
    expect(test.dependencies.authorizer.authorize).toHaveBeenCalledWith(expect.objectContaining({ operation: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OPERATION }));
    expect(test.dependencies.context_resolver.assertCaseUnchanged).toHaveBeenCalledTimes(1);
    expect(test.dependencies.output_repository.save).toHaveBeenCalledTimes(1);
  });

  it("U/V: denies unauthorized, wrong-state, and ineligible requests before model or persistence work", async () => {
    const unauthorized = subject({ authorizer: { authorize: vi.fn(async () => false) } });
    await expect(unauthorized.service.execute(invocation())).rejects.toMatchObject({ reason_code: "ADVISORY_ACCESS_DENIED" });
    expect(unauthorized.dependencies.generator.generate).not.toHaveBeenCalled();
    expect(unauthorized.dependencies.output_repository.save).not.toHaveBeenCalled();

    const wrongState = subject({ context_resolver: { resolve: vi.fn(async () => ({ status: "wrong_workflow_state" })), assertCaseUnchanged: vi.fn() } });
    await expect(wrongState.service.execute(invocation())).rejects.toMatchObject({ reason_code: "CASE_NOT_IN_IMPLEMENTATION" });

    const ineligible = subject({ agent_gate: { evaluate: vi.fn(() => false) } });
    await expect(ineligible.service.execute(invocation())).rejects.toMatchObject({ reason_code: "AGENT_NOT_ELIGIBLE" });
  });

  it("W/X: rejects generated action/citation bindings and detects a changed case", async () => {
    const invalidAction = subject({ generator: { generate: vi.fn(async () => ({ response: response({ findings: [{ approved_action_reference: "ACTION-404" }] }), trace: trace() })) } });
    await expect(invalidAction.service.execute(invocation())).rejects.toMatchObject({ reason_code: "INVALID_ACTION_REFERENCE" });
    expect(invalidAction.dependencies.output_repository.save).not.toHaveBeenCalled();

    const changed = subject({ context_resolver: { resolve: vi.fn(async () => ({ status: "resolved", assembly: assembly() })), assertCaseUnchanged: vi.fn(async () => false) } });
    await expect(changed.service.execute(invocation())).rejects.toMatchObject({ reason_code: "WORKFLOW_MUTATION_DETECTED" });
    expect(changed.dependencies.output_repository.save).not.toHaveBeenCalled();
  });

  it("Y/Z: maps malformed generation and persistence failures without mutating the workspace", async () => {
    const generationFailure = subject({ generator: { generate: vi.fn(async () => { throw new Error("model unavailable"); }) } });
    await expect(generationFailure.service.execute(invocation())).rejects.toMatchObject({ reason_code: "ADVISORY_GENERATION_FAILED" });
    expect(generationFailure.dependencies.output_repository.save).not.toHaveBeenCalled();

    const persistenceFailure = subject({ output_repository: { save: vi.fn(async () => { throw new Error("database"); }) } });
    await expect(persistenceFailure.service.execute(invocation())).rejects.toMatchObject({ reason_code: "ADVISORY_PERSISTENCE_FAILED" });
  });
});
