import { describe, expect, it, vi } from "vitest";

let activeSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({
  requireSupabaseTransaction: vi.fn(() => activeSql),
}));

import { SupabaseCapaImplementationEvidenceAdvisoryOutputRepository } from "../../lib/database/supabase/supabase-capa-implementation-evidence-advisory-output-repository";
import { CapaImplementationEvidenceAdvisoryModelGenerator } from "../../lib/capa/ai/capa-implementation-evidence-advisory-model-generator";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION } from "../../lib/capa/ai/capa-implementation-evidence-advisory-contract";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";
const RUN = "60000000-0000-4000-8000-000000000001";
const PACKAGE = "70000000-0000-4000-8000-000000000001";
const OUTPUT = "80000000-0000-4000-8000-000000000001";
const AT = "2026-09-10T12:00:00.000Z";

const context = {
  trust: "authoritative_server_context",
  organization_id: ORG,
  capa_case_id: CASE,
  case_version_id: VERSION,
  record_version: 8,
  workflow_state: "S80",
  actor: "90000000-0000-4000-8000-000000000001",
  active_roles: [],
  approved_s70_baseline: {
    source_case_version_id: "30000000-0000-4000-8000-000000000002",
    approved_action_plan_section_id: "30000000-0000-4000-8000-000000000003",
    approval_decision_reference: "30000000-0000-4000-8000-000000000004",
  },
  approved_actions: [{
    approved_action_reference: "ACTION-1",
    status: "approved",
    action_type: "corrective",
    description: "Complete the approved implementation action.",
    due_date: null,
    deliverable: "Validated record",
    implementation_expectation: "Verified evidence",
    effectiveness_check_required: false,
    acceptance_criteria: [],
  }],
  workspace: null,
} as any;

const assembly = {
  authoritative: context,
  reference_manifest: [{ reference_key: "R1", source_kind: "approved_action", source_reference: "ACTION-1", source_status: "authoritative", locator: null }],
  model_safe_context: {
    trust: "model_safe_context",
    workflow_state: "S80",
    case_version_id: VERSION,
    record_version: 8,
    approved_s70_baseline: context.approved_s70_baseline,
    approved_actions: context.approved_actions,
    untrusted_human_workspace: null,
    references: [{ reference_key: "R1", source_kind: "approved_action" }],
    governed_knowledge: [],
  },
  citations: [{ reference_key: "R1", source_kind: "approved_action", source_reference: "ACTION-1", source_status: "authoritative", locator: null }],
  knowledge_provenance: null,
  knowledge_warnings: [],
} as any;

async function generated() {
  return new CapaImplementationEvidenceAdvisoryModelGenerator({
    model_client: { generateStructured: vi.fn(async () => ({ output_text: JSON.stringify({ schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, status: "completed_draft", advisory_summary: "No additional evidence conclusion was prepared.", findings: [], warnings: [], uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true }) })) },
    createRunId: () => RUN as never,
    createPromptPackageId: () => PACKAGE as never,
    createOutputId: () => OUTPUT as never,
    now: () => AT as never,
  }).generate({ context: assembly, request_id: REQUEST as never, correlation_id: CORRELATION as never });
}

function harness(...queued: unknown[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const responses = [...queued];
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  activeSql = Object.assign(tagged, { json: (value: unknown) => value });
  return { calls, transaction: { transaction_id: "transaction-1", started_at: AT, request_trace: { request_id: REQUEST, correlation_id: CORRELATION } } as any };
}

function durableRows(generatedValue: Awaited<ReturnType<typeof generated>>, overrides: Record<string, unknown> = {}) {
  const trace = generatedValue.trace;
  const document = { manifest_schema_version: "capa-implementation-evidence-advisory-reference-manifest-1.0.0", entries: assembly.reference_manifest };
  return {
    output: { organization_id: ORG, output_id: OUTPUT, run_id: RUN, capa_case_id: CASE, case_version_id: VERSION, record_version: 8, request_id: REQUEST, correlation_id: CORRELATION, agent_id: "AG-IMPLEMENT", agent_version: "ag-implement-1.0.0", output_schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, status: "completed_draft", output_payload: { schema_version: CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, status: "completed_draft", advisory_summary: "No additional evidence conclusion was prepared.", findings: [], warnings: [], uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true }, advisory_only: true, workflow_mutated: false, human_acceptance_required: true },
    trace: { organization_id: ORG, output_id: OUTPUT, run_id: RUN, capa_case_id: CASE, case_version_id: VERSION, record_version: 8, output_status: "completed_draft", request_id: REQUEST, correlation_id: CORRELATION, trace_schema_version: trace.trace_schema_version, fingerprint_algorithm: trace.fingerprints.algorithm, prompt_package: trace.package, prompt_package_sha256: trace.fingerprints.prompt_package_sha256, rendered_prompt_sha256: trace.fingerprints.rendered_prompt_sha256, evidence_manifest: trace.evidence_manifest, evidence_manifest_sha256: trace.fingerprints.evidence_manifest_sha256, policy_manifest: trace.policy_manifest, policy_manifest_sha256: trace.fingerprints.policy_manifest_sha256, model_profile_version: trace.model_profile_version, assembled_at: (trace.package as any).trace.assembled_at },
    manifest: { organization_id: ORG, output_id: OUTPUT, run_id: RUN, capa_case_id: CASE, case_version_id: VERSION, record_version: 8, request_id: REQUEST, correlation_id: CORRELATION, output_status: "completed_draft", manifest_schema_version: document.manifest_schema_version, fingerprint_algorithm: "sha256-canonical-json-v1", reference_manifest: document, reference_manifest_sha256: "" },
    ...overrides,
  };
}

describe("S80 advisory output repository", () => {
  it("persists only a validated advisory and its immutable trace/manifest tuple", async () => {
    const value = await generated();
    const h = harness([{ capa_case_id: CASE }]);
    await expect(new SupabaseCapaImplementationEvidenceAdvisoryOutputRepository().save(h.transaction, { context, response: value.response, generation_trace: value.trace, reference_manifest: assembly.reference_manifest, request_id: REQUEST as never, correlation_id: CORRELATION as never })).resolves.toBe("saved");
    expect(h.calls).toHaveLength(4);
    expect(h.calls[0]!.query).toContain("status = 'S80'");
    expect(h.calls[1]!.values).toContainEqual(expect.objectContaining({ advisory_only: true, workflow_mutated: false, controlled_record_mutated: false }));
    expect(h.calls[3]!.query).toContain("capa_ai_reference_manifests");
  });

  it("rejects invalid authority and stale transaction identity before durable writes", async () => {
    const value = await generated();
    const h = harness([{ capa_case_id: CASE }]);
    await expect(new SupabaseCapaImplementationEvidenceAdvisoryOutputRepository().save(h.transaction, { context: { ...context, workflow_state: "S90" }, response: value.response, generation_trace: value.trace, reference_manifest: assembly.reference_manifest, request_id: REQUEST as never, correlation_id: CORRELATION as never } as any)).rejects.toThrow(/could not be persisted/i);
    expect(h.calls).toHaveLength(0);
    await expect(new SupabaseCapaImplementationEvidenceAdvisoryOutputRepository().save(h.transaction, { context, response: value.response, generation_trace: value.trace, reference_manifest: assembly.reference_manifest, request_id: "90000000-0000-4000-8000-000000000001" as never, correlation_id: CORRELATION as never })).rejects.toThrow(/could not be persisted/i);
  });

  it("returns only a fully linked durable output and rejects corrupt fingerprints", async () => {
    const value = await generated();
    const rows = durableRows(value);
    const manifestHash = (await import("../../lib/capa/ai/capa-ai-generation-trace")).fingerprintCanonicalJson(rows.manifest.reference_manifest);
    rows.manifest.reference_manifest_sha256 = manifestHash;
    harness([rows.output], [rows.trace], [rows.manifest]);
    await expect(new SupabaseCapaImplementationEvidenceAdvisoryOutputRepository(activeSql).findById(ORG, OUTPUT)).resolves.toMatchObject({ capa_case_id: CASE, response: { output_id: OUTPUT, advisory_only: true }, reference_manifest: { reference_manifest_sha256: manifestHash } });

    harness([rows.output], [{ ...rows.trace, policy_manifest_sha256: "f".repeat(64) }], [rows.manifest]);
    await expect(new SupabaseCapaImplementationEvidenceAdvisoryOutputRepository(activeSql).findById(ORG, OUTPUT)).resolves.toBeNull();
  });

  it("returns case_changed when the locked S80 version no longer matches", async () => {
    const value = await generated();
    const h = harness([]);
    await expect(new SupabaseCapaImplementationEvidenceAdvisoryOutputRepository().save(h.transaction, { context, response: value.response, generation_trace: value.trace, reference_manifest: assembly.reference_manifest, request_id: REQUEST as never, correlation_id: CORRELATION as never })).resolves.toBe("case_changed");
  });
});
