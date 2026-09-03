import { describe, expect, it, vi } from "vitest";

let activeSql: any;
vi.mock("../../lib/database/supabase/supabase-transactions", () => ({
  requireSupabaseTransaction: vi.fn(() => activeSql),
}));

import {
  SupabaseCapaInvestigationPlanningAdvisoryOutputRepository,
  SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError,
} from "../../lib/database/supabase/supabase-capa-investigation-planning-advisory-output-repository";

const ORG = "10000000-0000-4000-8000-000000000001";
const CASE_ID = "20000000-0000-4000-8000-000000000001";
const VERSION = "30000000-0000-4000-8000-000000000001";
const REQUEST = "40000000-0000-4000-8000-000000000001";
const CORRELATION = "50000000-0000-4000-8000-000000000001";
const RUN = "60000000-0000-4000-8000-000000000001";
const OUTPUT = "70000000-0000-4000-8000-000000000001";
const PACKAGE = "80000000-0000-4000-8000-000000000001";

const response: any = {
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
};

const context: any = {
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
};

const trace: any = {
  trace_schema_version: "capa-ai-generation-trace-1.0.0",
  package: {
    package_schema_version: "capa-investigation-planning-prompt-package-1.0.0",
    scope: {
      organization_id: ORG,
      capa_case_id: CASE_ID,
      case_version_id: VERSION,
      record_version: 2,
      workflow_state: "S30",
    },
    agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" },
    trace: {
      run_id: RUN,
      prompt_package_id: PACKAGE,
      request_id: REQUEST,
      correlation_id: CORRELATION,
      assembled_at: "2026-09-01T00:00:00.000Z",
    },
    generation_contract: {
      operation: "draft_investigation_plan",
      requested_output: "investigation_plan_draft",
      output_schema_version: "capa_investigation_plan_draft-1.0.0",
      model_profile_version: "capa-model-profile-1.0.0",
      output_schema_name: "capa_investigation_planning_advisory_1_0_0",
      output_schema_sha256: "a".repeat(64),
      store: false,
      maximum_output_characters: 30000,
    },
    context_provenance: {},
    governance: {
      advisory_only: true,
      workflow_mutated: false,
      human_acceptance_required: true,
    },
  },
  rendered_prompt: "controlled prompt",
  model_profile_version: "capa-model-profile-1.0.0",
  output_schema_name: "capa_investigation_planning_advisory_1_0_0",
  output_schema: { type: "object" },
  store: false,
  maximum_output_characters: 30000,
  evidence_manifest: {
    evidence_manifest_schema_version:
      "capa-investigation-planning-evidence-manifest-1.0.0",
    retrieval_performed: false,
    item_count: 0,
    items: [],
  },
  policy_manifest: {
    policy_manifest_schema_version:
      "capa-investigation-planning-policy-manifest-1.0.0",
    agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" },
    workflow_state: "S30",
    operation: "draft_investigation_plan",
    requested_output: "investigation_plan_draft",
    output_schema_version: "capa_investigation_plan_draft-1.0.0",
    generation: {
      model_profile_version: "capa-model-profile-1.0.0",
      output_schema_name: "capa_investigation_planning_advisory_1_0_0",
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
};

function harness(...queued: unknown[]) {
  const calls: { query: string; values: unknown[] }[] = [];
  const responses = [...queued];
  const tagged = async (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    calls.push({
      query: strings.join("?").replace(/\s+/g, " ").trim(),
      values,
    });
    const next = responses.shift();
    if (next instanceof Error) throw next;
    return next ?? [];
  };
  activeSql = Object.assign(tagged, {
    json: (value: unknown) => value,
  });
  return {
    calls,
    transaction: {
      transaction_id: "transaction-1",
      started_at: "2026-09-01T00:00:00.000Z",
      request_trace: {
        request_id: REQUEST,
        correlation_id: CORRELATION,
      },
    } as any,
  };
}

function input(overrides: Record<string, unknown> = {}) {
  return {
    context,
    response,
    generation_trace: trace,
    request_id: REQUEST,
    correlation_id: CORRELATION,
    ...overrides,
  } as any;
}

describe("S30 investigation-planning advisory output repository", () => {
  it("locks first, then writes the exact output and generation trace", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(
      new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository().save(
        h.transaction,
        input(),
      ),
    ).resolves.toBe("saved");

    expect(h.calls).toHaveLength(3);
    expect(h.calls[0].query).toContain("for update");
    expect(h.calls[1].values).toContain("AG-PLAN");
    expect(h.calls[1].values).toContain("ag-plan-1.0.0");
    expect(h.calls[1].values).toContain(
      "capa_investigation_plan_draft-1.0.0",
    );
    const payload = h.calls[1].values.find(
      (value) => value && typeof value === "object" && "proposal" in (value as object),
    ) as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual([
      "proposal",
      "citations",
      "assumptions",
      "uncertainty_and_limitations",
      "warnings",
    ]);
    expect(payload).not.toHaveProperty("containment_summary");
    expect(h.calls[2].values).toContain(PACKAGE);
    expect(h.calls[2].values).toContain("capa-ai-generation-trace-1.0.0");
    expect(h.calls[2].values).toContain("sha256-canonical-json-v1");
  });

  it("preserves retrieval truth and caller objects", async () => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    const before = JSON.stringify({ response, trace });
    await new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository().save(
      h.transaction,
      input(),
    );
    expect(trace.evidence_manifest).toMatchObject({
      retrieval_performed: false,
      item_count: 0,
      items: [],
    });
    expect(JSON.stringify({ response, trace })).toBe(before);
  });

  it.each([
    ["run mismatch", { response: { ...response, run_id: "90000000-0000-4000-8000-000000000001" } }],
    ["non-S30 scope", { generation_trace: { ...trace, package: { ...trace.package, scope: { ...trace.package.scope, workflow_state: "S20" } } } }],
    ["invalid record version", { generation_trace: { ...trace, package: { ...trace.package, scope: { ...trace.package.scope, record_version: 0 } } } }],
    ["wrong schema", { response: { ...response, output_schema_version: "wrong" } }],
    ["wrong status", { response: { ...response, status: "service_failed" } }],
    ["wrong flags", { response: { ...response, workflow_mutated: true } }],
    ["missing proposal", { response: { ...response, proposal: null } }],
    ["malformed trace identity", { generation_trace: { ...trace, package: { ...trace.package, trace: { ...trace.package.trace, request_id: null } } } }],
    ["request mismatch", { request_id: "90000000-0000-4000-8000-000000000001" }],
    ["correlation mismatch", { correlation_id: "90000000-0000-4000-8000-000000000001" }],
  ] as const)("fails closed for %s before SQL", async (_name, overrides) => {
    const h = harness([{ capa_case_id: CASE_ID }]);
    await expect(
      new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository().save(
        h.transaction,
        input(overrides),
      ),
    ).rejects.toThrow(
      SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError,
    );
    expect(h.calls).toHaveLength(0);
  });

  it("returns case_changed after one lock query when the case is stale", async () => {
    const h = harness([]);
    await expect(
      new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository().save(
        h.transaction,
        input(),
      ),
    ).resolves.toBe("case_changed");
    expect(h.calls).toHaveLength(1);
  });

  it("wraps output and trace insert failures as the controlled repository error", async () => {
    const outputFailure = harness([{ capa_case_id: CASE_ID }], new Error("output"));
    await expect(
      new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository().save(
        outputFailure.transaction,
        input(),
      ),
    ).rejects.toThrow(SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError);

    const traceFailure = harness(
      [{ capa_case_id: CASE_ID }],
      undefined,
      new Error("trace"),
    );
    await expect(
      new SupabaseCapaInvestigationPlanningAdvisoryOutputRepository().save(
        traceFailure.transaction,
        input(),
      ),
    ).rejects.toThrow(SupabaseCapaInvestigationPlanningAdvisoryOutputRepositoryError);
  });
});
