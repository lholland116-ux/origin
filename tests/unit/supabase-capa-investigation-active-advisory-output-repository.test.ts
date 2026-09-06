import { describe, expect, it, vi } from "vitest";

let activeSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({
  requireSupabaseTransaction: vi.fn(() => activeSql),
}));

import {
  SupabaseCapaInvestigationActiveAdvisoryOutputRepository,
  SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError,
} from "../../lib/database/supabase/supabase-capa-investigation-active-advisory-output-repository";
import { createCapaInvestigationActiveAdvisoryGenerationTrace } from "../../lib/capa/ai/capa-ai-generation-trace";
import { CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA, CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE } from "../../lib/capa/ai/capa-investigation-active-advisory-model-profile";
import { createCapaInvestigationActiveAdvisoryReferenceManifest } from "../../lib/capa/ai/capa-investigation-active-advisory-reference-manifest";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";
const RUN = "60000000-0000-4000-8000-000000000001";
const OUTPUT = "70000000-0000-4000-8000-000000000001";
const PACKAGE = "80000000-0000-4000-8000-000000000001";

const emptyProposal = {
  evidence_gaps: [],
  conflicting_information: [],
  assumptions: [],
  causal_hypotheses: [],
  alternative_hypotheses: [],
  investigation_recommendations: [],
};

const response: any = {
  run_id: RUN,
  output_id: OUTPUT,
  output_schema_version: "capa_investigation_analysis_draft-1.0.0",
  status: "completed_draft",
  proposal: emptyProposal,
  uncertainty_and_limitations: [],
  citations: [],
  warnings: [],
  advisory_only: true,
  workflow_mutated: false,
  human_acceptance_required: true,
};

const modelSafeContext: any = {
  trust: "model_safe_context",
  workflow_state: "S40",
  references: [],
};

const context: any = {
  trust: "authoritative_server_context",
  organization_id: ORG,
  capa_case_id: CASE_ID,
  case_version_id: VERSION,
  record_version: 4,
  workflow_state: "S40",
  actor: "90000000-0000-4000-8000-000000000001",
  active_roles: [],
  investigation_plan: { items: [] },
};

const trace: any = {
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
      assembled_at: "2026-09-01T00:00:00.000Z",
    },
    context_provenance: { model_safe_context: modelSafeContext },
    generation_contract: {
      operation: "facilitate_root_cause",
      requested_output: "investigation_analysis_draft",
      output_schema_version: "capa_investigation_analysis_draft-1.0.0",
      store: false,
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
    authority: {
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    },
  },
  fingerprints: { algorithm: "sha256-canonical-json-v1" },
};

function harness(...queued: unknown[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const responses = [...queued];
  const tagged = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  activeSql = Object.assign(tagged, { json: (value: unknown) => value });
  return {
    calls,
    transaction: {
      transaction_id: "transaction-1",
      started_at: "2026-09-01T00:00:00.000Z",
      request_trace: { request_id: REQUEST, correlation_id: CORRELATION },
    } as any,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    context,
    response,
    generation_trace: trace,
    reference_manifest: [],
    request_id: REQUEST,
    correlation_id: CORRELATION,
    ...overrides,
  } as any;
}

describe("S40 investigation-active advisory output repository", () => {
  function durableRows(overrides: { output?: Record<string, unknown>; trace?: Record<string, unknown>; manifest?: Record<string, unknown> } = {}) {
    const generatedTrace = createCapaInvestigationActiveAdvisoryGenerationTrace({ rendered_prompt: "controlled prompt", model_profile_version: CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version, output_schema_name: CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name, output_schema: CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA, maximum_output_characters: CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.maximum_output_characters, package: { scope: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, workflow_state: "S40" }, agent: { agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0" }, trace: { run_id: RUN as any, prompt_package_id: PACKAGE as any, request_id: REQUEST as any, correlation_id: CORRELATION as any, assembled_at: "2026-09-01T00:00:00.000Z" as any }, context_provenance: { model_safe_context: modelSafeContext }, governance: { advisory_only: true, workflow_mutated: false, human_acceptance_required: true } } });
    const generatedManifest = createCapaInvestigationActiveAdvisoryReferenceManifest({ reference_manifest: [], model_safe_context: modelSafeContext });
    return {
      output: { organization_id: ORG, output_id: OUTPUT, run_id: RUN, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, request_id: REQUEST, correlation_id: CORRELATION, agent_id: "AG-RCA", agent_version: "ag-rca-1.0.0", output_schema_version: "capa_investigation_analysis_draft-1.0.0", status: "completed_draft", output_payload: { proposal: emptyProposal, uncertainty_and_limitations: [], citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true }, advisory_only: true, workflow_mutated: false, human_acceptance_required: true, warnings: [] },
      trace: { organization_id: ORG, output_id: OUTPUT, run_id: RUN, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, output_status: "completed_draft", request_id: REQUEST, correlation_id: CORRELATION, trace_schema_version: generatedTrace.trace_schema_version, fingerprint_algorithm: generatedTrace.fingerprints.algorithm, prompt_package: generatedTrace.package, prompt_package_sha256: generatedTrace.fingerprints.prompt_package_sha256, rendered_prompt_sha256: generatedTrace.fingerprints.rendered_prompt_sha256, evidence_manifest: generatedTrace.evidence_manifest, evidence_manifest_sha256: generatedTrace.fingerprints.evidence_manifest_sha256, policy_manifest: generatedTrace.policy_manifest, policy_manifest_sha256: generatedTrace.fingerprints.policy_manifest_sha256, model_profile_version: generatedTrace.model_profile_version, assembled_at: generatedTrace.package.trace.assembled_at },
      manifest: { organization_id: ORG, output_id: OUTPUT, run_id: RUN, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, request_id: REQUEST, correlation_id: CORRELATION, output_status: "completed_draft", manifest_schema_version: generatedManifest.document.manifest_schema_version, fingerprint_algorithm: generatedManifest.fingerprint_algorithm, reference_manifest: generatedManifest.document, reference_manifest_sha256: generatedManifest.reference_manifest_sha256 },
      ...overrides,
    };
  }

  it("returns a valid durable output only when output, trace, and manifest identities agree", async () => {
    const rows = durableRows();
    const h = harness([rows.output], [rows.trace], [rows.manifest]);
    const result = await new SupabaseCapaInvestigationActiveAdvisoryOutputRepository(activeSql as any).findById(ORG, OUTPUT);
    expect(result).toMatchObject({ organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, response: { output_id: OUTPUT, advisory_only: true }, reference_manifest: { reference_manifest_sha256: rows.manifest.reference_manifest_sha256 } });
  });

  it("normalizes PostgreSQL bigint record_version values when reconstructing durable output", async () => {
    const rows = durableRows();

    const output = {
      ...rows.output,
      record_version: "4",
    };

    const traceRow = {
      ...rows.trace,
      record_version: "4",
    };

    const manifest = {
      ...rows.manifest,
      record_version: "4",
    };

    const h = harness(
      [output],
      [traceRow],
      [manifest],
    );

    const result =
      await new SupabaseCapaInvestigationActiveAdvisoryOutputRepository(
        activeSql as any,
      ).findById(ORG, OUTPUT);

    expect(result).toMatchObject({
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: VERSION,
      record_version: 4,
      response: {
        output_id: OUTPUT,
        advisory_only: true,
      },
    });
  });

  it.each([
    ["output agent", { output: { ...durableRows().output, agent_id: "AG-PLAN" } }],
    ["output authority", { output: { ...durableRows().output, advisory_only: false } }],
    ["payload authority", { output: { ...durableRows().output, output_payload: { ...(durableRows().output as any).output_payload, workflow_mutated: true } } }],
    ["trace identity", { trace: { ...durableRows().trace, run_id: "90000000-0000-4000-8000-000000000001" } }],
    ["trace fingerprint", { trace: { ...durableRows().trace, evidence_manifest_sha256: "f".repeat(64) } }],
    ["manifest identity", { manifest: { ...durableRows().manifest, correlation_id: "90000000-0000-4000-8000-000000000001" } }],
    ["manifest fingerprint", { manifest: { ...durableRows().manifest, reference_manifest_sha256: "f".repeat(64) } }],
  ])("fails closed for corrupt persisted %s metadata", async (_name, override) => {
    const rows = durableRows(override);
    const h = harness([rows.output], [rows.trace], [rows.manifest]);
    await expect(new SupabaseCapaInvestigationActiveAdvisoryOutputRepository(activeSql as any).findById(ORG, OUTPUT)).resolves.toBeNull();
  });

  it("persists a valid completed advisory after independent validation", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);

    await expect(
      new SupabaseCapaInvestigationActiveAdvisoryOutputRepository().save(
        h.transaction,
        input(),
      ),
    ).resolves.toBe("saved");

    expect(h.calls).toHaveLength(4);
    expect(h.calls[0].query).toContain("for update");
    expect(h.calls[1].values).toContainEqual(expect.objectContaining({
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    }));
    expect(h.calls[3].query).toContain("capa_ai_reference_manifests");
  });

  it("preserves valid R# manifest membership behavior", async () => {
    const reference = {
      reference_key: "R1",
      trust: "authoritative_server_context",
      source_kind: "investigation_plan_item",
    };
    const h = harness([{ capa_case_id: CASE_ID }]);

    await expect(
      new SupabaseCapaInvestigationActiveAdvisoryOutputRepository().save(
        h.transaction,
        input({
          response: {
            ...response,
            proposal: {
              ...emptyProposal,
              evidence_gaps: [{
                proposal_key: "P1",
                gap: "An evidence gap.",
                why_it_matters: "It matters.",
                related_reference_keys: ["R1"],
                recommended_next_step: "Review the evidence.",
                human_review_question: "Does this require review?",
              }],
            },
          },
          generation_trace: {
            ...trace,
            package: {
              ...trace.package,
              context_provenance: {
                model_safe_context: {
                  ...modelSafeContext,
                  references: [reference],
                },
              },
            },
          },
          reference_manifest: [{ ...reference, source_id: "INV-1" }],
        }),
      ),
    ).resolves.toBe("saved");
  });

  it.each([
    ["extra response field", { response: { ...response, extra: true } }],
    ["missing response field", { response: (() => { const value = { ...response }; delete value.warnings; return value; })() }],
    ["non-empty warnings", { response: { ...response, warnings: ["warning"] } }],
    ["non-empty citations", { response: { ...response, citations: [{ citation: "x" }] } }],
  ])("rejects %s before SQL", async (_name, overrides) => {
    const h = harness([{ capa_case_id: CASE_ID }]);

    await expect(
      new SupabaseCapaInvestigationActiveAdvisoryOutputRepository().save(
        h.transaction,
        input(overrides),
      ),
    ).rejects.toThrow(SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it("rejects semantically invalid model output through the existing validator", async () => {
    const invalidResponse = {
      ...response,
      proposal: {
        ...emptyProposal,
        evidence_gaps: [{
          proposal_key: "P1",
          gap: "An evidence gap.",
          why_it_matters: "It matters.",
          related_reference_keys: [],
          recommended_next_step: "Review the evidence.",
          human_review_question: "This is not a question.",
        }],
      },
    };
    const h = harness([{ capa_case_id: CASE_ID }]);

    await expect(
      new SupabaseCapaInvestigationActiveAdvisoryOutputRepository().save(
        h.transaction,
        input({ response: invalidResponse }),
      ),
    ).rejects.toThrow(SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ["wrong trust", { ...modelSafeContext, trust: "authoritative_server_context" }],
    ["wrong workflow state", { ...modelSafeContext, workflow_state: "S30" }],
    ["non-array references", { ...modelSafeContext, references: {} }],
    ["duplicate reference key", { ...modelSafeContext, references: [{ reference_key: "R1", trust: "authoritative_server_context", source_kind: "investigation_plan_item" }, { reference_key: "R1", trust: "authoritative_server_context", source_kind: "investigation_plan_item" }] }],
    ["R101", { ...modelSafeContext, references: [{ reference_key: "R101", trust: "authoritative_server_context", source_kind: "investigation_plan_item" }] }],
  ])("rejects malformed model-safe provenance: %s", async (_name, model_safe_context) => {
    const h = harness([{ capa_case_id: CASE_ID }]);

    await expect(
      new SupabaseCapaInvestigationActiveAdvisoryOutputRepository().save(
        h.transaction,
        input({ generation_trace: { ...trace, package: { ...trace.package, context_provenance: { model_safe_context } } } }),
      ),
    ).rejects.toThrow(SupabaseCapaInvestigationActiveAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });
});
