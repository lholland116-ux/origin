import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";

let activeSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({ requireSupabaseTransaction: vi.fn(() => activeSql) }));

import { SupabaseCapaContainmentRiskAdvisoryOutputRepository, SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError } from "../../lib/database/supabase/supabase-capa-containment-risk-advisory-output-repository";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const REQUEST = "50000000-0000-4000-8000-000000000001";
const CORRELATION = "60000000-0000-4000-8000-000000000001";
const RUN = "70000000-0000-4000-8000-000000000001";
const OUTPUT = "80000000-0000-4000-8000-000000000001";
const PACKAGE = "90000000-0000-4000-8000-000000000001";

const response: any = { run_id: RUN, output_id: OUTPUT, output_schema_version: "capa-containment-risk-advisory-1.0.0", status: "completed_draft", proposal: { missing_risk_inputs: [], missing_impact_dimensions: [], human_review_questions: ["Is review required?"], evidence_provenance_gaps: [] }, containment_summary: [], citations: [], assumptions: [], uncertainty_and_limitations: [], warnings: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true };
const context: any = { trust: "authoritative_server_context", organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 2, workflow_state: "S20", actor: "user", active_roles: [], intake_scope: {}, persisted_containment_risk: null };
const trace: any = { trace_schema_version: "capa-ai-generation-trace-1.0.0", package: { scope: { organization_id: ORG, capa_case_id: CASE_ID, case_version_id: VERSION, record_version: 2, workflow_state: "S20" }, agent: { agent_id: "AG-INTAKE", agent_version: "ag-intake-1.0.0" }, trace: { run_id: RUN, prompt_package_id: PACKAGE, request_id: REQUEST, correlation_id: CORRELATION, assembled_at: "2026-09-01T00:00:00.000Z" }, context_provenance: {}, governance: {} }, rendered_prompt: "prompt", model_profile_version: "capa-model-profile-1.0.0", output_schema_name: "schema", output_schema: {}, store: false, maximum_output_characters: 30000, evidence_manifest: { evidence_manifest_schema_version: "capa-containment-risk-evidence-manifest-1.0.0", retrieval_performed: false, item_count: 0, items: [] }, policy_manifest: { policy_manifest_schema_version: "capa-containment-risk-policy-manifest-1.0.0", agent: { agent_id: "AG-INTAKE", agent_version: "ag-intake-1.0.0" }, workflow_state: "S20", operation: "analyze_containment_impact_risk", requested_output: "containment_risk_analysis", output_schema_version: "capa-containment-risk-advisory-1.0.0", generation: { model_profile_version: "capa-model-profile-1.0.0", output_schema_name: "schema", output_schema_sha256: "hash" }, authority: { advisory_only: true, workflow_mutated: false, human_acceptance_required: true }, prohibitions: [] }, fingerprints: { algorithm: "sha256-canonical-json-v1", prompt_package_sha256: "a".repeat(64), rendered_prompt_sha256: "b".repeat(64), evidence_manifest_sha256: "c".repeat(64), policy_manifest_sha256: "d".repeat(64), output_schema_sha256: "e".repeat(64) } };

function harness(...queued: unknown[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const responses = [...queued];
  const tagged = async (strings: TemplateStringsArray, ...values: unknown[]) => { calls.push({ query: strings.join("?").replace(/\s+/g, " ").trim(), values }); const next = responses.shift(); if (next instanceof Error) throw next; return next ?? []; };
  activeSql = Object.assign(tagged, { json: (value: unknown) => value });
  return { calls, transaction: { transaction_id: "tx", started_at: "2026-09-01T00:00:00.000Z", request_trace: { request_id: REQUEST, correlation_id: CORRELATION } } as any };
}

function input(overrides: Record<string, unknown> = {}) { return { context, response, generation_trace: trace, request_id: REQUEST, correlation_id: CORRELATION, ...overrides } as any; }

describe("S20 output/trace repository", () => {
  it("persists exact output payload and matching trace rows in one transaction context", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaContainmentRiskAdvisoryOutputRepository().save(h.transaction, input())).resolves.toBe("saved");
    expect(h.calls).toHaveLength(3);
    const output = h.calls[1];
    expect(output.query).toContain("output_payload");
    expect(output.query).not.toMatch(/missing_information|conflicts_and_alternatives|human_action_required/);
    expect(output.values).toContain(ORG);
    expect(output.values).toContain(RUN);
    expect(output.values).toContain(OUTPUT);
    expect(output.values).toContain("AG-INTAKE");
    expect(output.values).toContain("ag-intake-1.0.0");
    const payload = output.values.find((value) => value && typeof value === "object" && "proposal" in (value as object)) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(["proposal", "containment_summary", "citations", "assumptions", "uncertainty_and_limitations", "warnings"]);
    const generation = h.calls[2];
    expect(generation.values).toContain(PACKAGE);
    expect(generation.values).toContain("capa-ai-generation-trace-1.0.0");
    expect(generation.values).toContain("sha256-canonical-json-v1");
  });

  it("preserves retrieval truth and does not mutate caller objects", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    const before = JSON.stringify({ response, trace });
    await new SupabaseCapaContainmentRiskAdvisoryOutputRepository().save(h.transaction, input());
    expect(trace.evidence_manifest).toEqual({ evidence_manifest_schema_version: "capa-containment-risk-evidence-manifest-1.0.0", retrieval_performed: false, item_count: 0, items: [] });
    expect(JSON.stringify({ response, trace })).toBe(before);
  });

  it.each([
    ["run mismatch", { response: { ...response, run_id: "70000000-0000-4000-8000-000000000002" } }],
    ["non-S20 scope", { generation_trace: { ...trace, package: { ...trace.package, scope: { ...trace.package.scope, workflow_state: "S30" } } } }],
    ["invalid record version", { generation_trace: { ...trace, package: { ...trace.package, scope: { ...trace.package.scope, record_version: 0 } } } }],
    ["malformed schema", { response: { ...response, output_schema_version: "wrong" } }],
    ["malformed status", { response: { ...response, status: "service_failed" } }],
    ["malformed flags", { response: { ...response, advisory_only: false } }],
    ["missing proposal", { response: { ...response, proposal: null } }],
    ["malformed trace identity", { generation_trace: { ...trace, package: { ...trace.package, trace: { ...trace.package.trace, request_id: null } } } }],
  ] as const)("fails closed for %s before any write", async (_name, overrides) => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(new SupabaseCapaContainmentRiskAdvisoryOutputRepository().save(h.transaction, input(overrides))).rejects.toThrow(SupabaseCapaContainmentRiskAdvisoryOutputRepositoryError);
    expect(h.calls).toHaveLength(0);
  });

  it("returns case_changed without inserts when the locked case is stale", async () => {
    const h = harness([]);
    await expect(new SupabaseCapaContainmentRiskAdvisoryOutputRepository().save(h.transaction, input())).resolves.toBe("case_changed");
    expect(h.calls).toHaveLength(1);
  });

  it("rejects output and trace insert failures", async () => {
    const outputFailure = harness([{ capa_case_id: CASE_ID }], new Error("output"));
    await expect(new SupabaseCapaContainmentRiskAdvisoryOutputRepository().save(outputFailure.transaction, input())).rejects.toThrow("output");
    const traceFailure = harness([{ capa_case_id: CASE_ID }], undefined, new Error("trace"));
    await expect(new SupabaseCapaContainmentRiskAdvisoryOutputRepository().save(traceFailure.transaction, input())).rejects.toThrow("trace");
  });

  it("defines the additive nullable object-only payload migration", () => {
    const migration = readFileSync("supabase/migrations/20260901163000_add_capa_ai_output_payload.sql", "utf8");
    expect(migration).toContain("add column output_payload jsonb");
    expect(migration).toContain("capa_ai_outputs_payload_object");
    expect(migration).toContain("output_payload is null");
    expect(migration).toContain("jsonb_typeof(output_payload) = 'object'");
    expect(migration).not.toMatch(/backfill|update public\.capa_ai_outputs|drop column|enable row level security/i);
  });
});
