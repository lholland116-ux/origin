import { describe, expect, it, vi } from "vitest";

let activeSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({ requireSupabaseTransaction: vi.fn(() => activeSql) }));

import { SupabaseCapaRootCauseReviewAdvisoryOutputRepository, SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError } from "../../lib/database/supabase/supabase-capa-root-cause-review-advisory-output-repository";
import { createCapaRootCauseReviewAdvisoryGenerationTrace } from "../../lib/capa/ai/capa-ai-generation-trace";
import { CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA, CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE } from "../../lib/capa/ai/capa-root-cause-review-advisory-model-generator";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";
const RUN = "60000000-0000-4000-8000-000000000001";
const OUTPUT = "70000000-0000-4000-8000-000000000001";
const PACKAGE = "80000000-0000-4000-8000-000000000001";

const emptyProposal = { neutral_review_summary: "No additional review summary was supplied.", version_changes: [], blockers_warnings: [], evidence_map: [] };
const emptyModelSafeContext: any = { trust: "model_safe_context", workflow_state: "S50", current_version_number: 4, comparison_version_number: null, current_section_versions: { investigation_ledger: "L1", root_cause_package: "R1", investigation_plan: null }, comparison_section_versions: null, references: [] };
const reference = { reference_key: "R1", trust: "authoritative_server_context", source_kind: "causal_hypothesis", version_scope: "current" };

function trace(modelSafeContext: any = emptyModelSafeContext): any {
  return createCapaRootCauseReviewAdvisoryGenerationTrace({
    rendered_prompt: "controlled S50 prompt",
    model_profile_version: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
    output_schema_name: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
    maximum_output_characters: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
    package: {
      scope: { organization_id: ORG as any, capa_case_id: CASE_ID as any, case_version_id: VERSION as any, record_version: 4, workflow_state: "S50" },
      agent: { agent_id: "AG-REVIEW", agent_version: "ag-review-1.0.0" },
      trace: { run_id: RUN as any, prompt_package_id: PACKAGE as any, request_id: REQUEST as any, correlation_id: CORRELATION as any, assembled_at: "2026-09-01T00:00:00.000Z" as any },
      context_provenance: { model_safe_context: modelSafeContext },
      governance: { advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, human_acceptance_required: true },
    },
  });
}

function response(overrides: Record<string, unknown> = {}): any {
  return { run_id: RUN, output_id: OUTPUT, output_schema_version: "capa_review_packet_draft-1.0.0", status: "completed_draft", proposal: emptyProposal, uncertainty_and_limitations: [], citations: [], warnings: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, review_disposition: null, workflow_transition: null, human_acceptance_required: true, ...overrides };
}

function context(overrides: Record<string, unknown> = {}): any {
  return { trust: "authoritative_server_context", organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 4, workflow_state: "S50", actor: "90000000-0000-4000-8000-000000000001", active_roles: [{ role_id: "CAPA_REVIEWER" }], sections: { investigation_ledger: {}, root_cause_package: {}, investigation_plan: null }, ...overrides };
}

function input(overrides: Record<string, unknown> = {}): any {
  return { context: context(), response: response(), generation_trace: trace(), reference_manifest: [], request_id: REQUEST, correlation_id: CORRELATION, ...overrides };
}

function harness(...queued: unknown[]) {
  const failOn = typeof queued[queued.length - 1] === "string" ? queued.pop() as string : undefined;
  const calls: { query: string; values: unknown[] }[] = [];
  const responses = [...queued];
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => { const query = strings.join("?").replace(/\s+/g, " ").trim(); calls.push({ query, values }); if (failOn !== undefined && query.includes(failOn)) throw new Error("controlled SQL failure"); const next = responses.shift(); if (next instanceof Error || (next as any)?.__throw === true) throw new Error("controlled SQL failure"); return next ?? []; };
  activeSql = Object.assign(tagged, { json: (value: unknown) => value });
  return { calls, transaction: { transaction_id: "transaction-1", started_at: "2026-09-01T00:00:00.000Z", request_trace: { request_id: REQUEST, correlation_id: CORRELATION } } as any };
}

describe("S50 root-cause review advisory output repository", () => {
  it("returns null without a durable adapter", async () => {
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().findById(ORG, OUTPUT)).resolves.toBeNull();
  });

  it("locks and persists exactly one generic output, trace, and reference manifest", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input())).resolves.toBe("saved");
    expect(h.calls).toHaveLength(4);
    expect(h.calls[0]?.query).toContain("for update");
    expect(h.calls[0]?.values).toEqual(expect.arrayContaining([ORG, CASE_ID, VERSION, 4]));
    expect(h.calls[0]?.query).toContain("status = 'S50'");
    expect(h.calls[1]?.query).toContain("capa_ai_outputs");
    expect(h.calls[1]?.query).toContain("'AG-REVIEW'");
    expect(h.calls[1]?.query).toContain("'ag-review-1.0.0'");
    expect(h.calls[1]?.values).toEqual(expect.arrayContaining(["capa_review_packet_draft-1.0.0", "completed_draft"]));
    expect(h.calls[1]?.values).toEqual(expect.arrayContaining([expect.objectContaining({ controlled_record_mutated: false, review_disposition: null, workflow_transition: null })]));
    expect(h.calls[2]?.query).toContain("capa_ai_generation_traces");
    expect(h.calls[2]?.values).toEqual(expect.arrayContaining([REQUEST, CORRELATION, CASE_ID, VERSION, 4]));
    expect(h.calls[3]?.query).toContain("capa_ai_reference_manifests");
    expect(h.calls[3]?.values).toEqual(expect.arrayContaining([REQUEST, CORRELATION, CASE_ID, VERSION, { manifest_schema_version: "capa-root-cause-review-reference-manifest-1.0.0", entries: [] }]));
  });

  it("persists exact server-only reference mappings", async () => {
    const modelSafe = { ...emptyModelSafeContext, references: [reference] };
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input({ generation_trace: trace(modelSafe), reference_manifest: [{ ...reference, source_id: "H1" }] }))).resolves.toBe("saved");
    expect(h.calls[3]?.values).toEqual(expect.arrayContaining([expect.objectContaining({ entries: [{ ...reference, source_id: "H1" }] })]));
  });

  it.each([
    ["current version", {}],
    ["record version", {}],
    ["workflow", {}],
    ["organization/case", {}],
  ])("returns case_changed before inserts for stale %s", async (_name, overrides) => {
    const h = harness([]);
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input(overrides))).resolves.toBe("case_changed");
    expect(h.calls).toHaveLength(1);
  });

  it.each([
    ["transaction request", { transaction: { request_trace: { request_id: "90000000-0000-4000-8000-000000000001", correlation_id: CORRELATION } } }],
    ["transaction correlation", { transaction: { request_trace: { request_id: REQUEST, correlation_id: "90000000-0000-4000-8000-000000000001" } } }],
    ["run identity", { generation_trace: { ...trace(), package: { ...trace().package, trace: { ...trace().package.trace, run_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["request identity", { generation_trace: { ...trace(), package: { ...trace().package, trace: { ...trace().package.trace, request_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["correlation identity", { generation_trace: { ...trace(), package: { ...trace().package, trace: { ...trace().package.trace, correlation_id: "90000000-0000-4000-8000-000000000001" } } } }],
    ["fingerprint", { generation_trace: { ...trace(), fingerprints: { ...trace().fingerprints, prompt_package_sha256: "f".repeat(64) } } }],
    ["model profile", { generation_trace: { ...trace(), model_profile_version: "wrong-profile" } }],
  ])("rejects invalid %s before persistence", async (_name, overrides: any) => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(overrides.transaction ?? h.transaction, input(overrides))).rejects.toThrow(SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ["advisory_only", { advisory_only: false }],
    ["workflow_mutated", { workflow_mutated: true }],
    ["controlled_record_mutated", { controlled_record_mutated: true }],
    ["review_disposition", { review_disposition: "approved" }],
    ["workflow_transition", { workflow_transition: "S60" }],
    ["human_acceptance_required", { human_acceptance_required: false }],
  ])("rejects invalid governance: %s", async (_name, governance) => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input({ response: response(governance) }))).rejects.toThrow(SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    ["duplicate server key", [{ ...reference, source_id: "H1" }, { ...reference, source_id: "H2" }], [reference, { ...reference, reference_key: "R2" }]],
    ["missing server reference", [], [reference]],
    ["extra server reference", [{ ...reference, source_id: "H1" }], []],
    ["empty server with nonempty safe", [], [reference]],
    ["duplicate safe key", [{ ...reference, source_id: "H1" }, { ...reference, source_id: "H2" }], [reference, reference]],
  ])("requires exact reference-manifest equality: %s", async (_name, manifest, references) => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    const modelSafe = { ...emptyModelSafeContext, references };
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input({ generation_trace: trace(modelSafe), reference_manifest: manifest }))).rejects.toThrow(SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it("accepts an empty and empty reference set", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input())).resolves.toBe("saved");
  });

  it("propagates insert failure and never reports saved", async () => {
    const h = harness([{ capa_case_id: CASE_ID }], "capa_ai_generation_traces");
    await expect(new SupabaseCapaRootCauseReviewAdvisoryOutputRepository().save(h.transaction, input())).rejects.toThrow(SupabaseCapaRootCauseReviewAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(3);
  });
});
