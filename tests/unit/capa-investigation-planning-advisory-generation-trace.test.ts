import { describe, expect, it } from "vitest";

import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  canonicalJson,
  createCapaInvestigationPlanningAdvisoryGenerationTrace,
  fingerprintCanonicalJson,
} from "../../lib/capa/ai/capa-ai-generation-trace";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
} from "../../lib/capa/ai/capa-investigation-planning-advisory-model-profile";
import type {
  CapaAiRunId,
  CapaPromptPackageId,
} from "../../lib/capa/ai/capa-prompt-contract";
import type {
  CorrelationId,
  IsoDateTime,
  RequestId,
} from "../../lib/capa/domain/capa-types";

function input(overrides: any = {}) {
  return {
    rendered_prompt: "CONTROLLED S30 PROMPT",
    model_profile_version:
      CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version,
    output_schema_name:
      CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name,
    output_schema: CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
    maximum_output_characters:
      CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.maximum_output_characters,
    package: {
      scope: {
        organization_id: "org-1",
        capa_case_id: "case-1",
        case_version_id: "version-1",
        record_version: 2,
        workflow_state: "S30" as const,
      },
      agent: {
        agent_id: "AG-PLAN" as const,
        agent_version: "ag-plan-1.0.0" as const,
      },
      trace: {
        run_id: "run-1" as CapaAiRunId,
        prompt_package_id: "package-1" as CapaPromptPackageId,
        request_id: "request-1" as RequestId,
        correlation_id: "correlation-1" as CorrelationId,
        assembled_at: "2026-09-01T00:00:00.000Z" as IsoDateTime,
      },
      context_provenance: {
        authoritative_server_context: {
          trust: "authoritative_server_context",
          record_version: 2,
        },
        untrusted_human_draft: null,
        focus: "Review scope",
      },
      governance: {
        advisory_only: true as const,
        workflow_mutated: false as const,
        human_acceptance_required: true as const,
      },
    },
    ...overrides,
  };
}

describe("S30 investigation-planning generation trace", () => {
  it("captures the S30 package, empty retrieval manifest, policy prohibitions, and fingerprints", () => {
    const trace = createCapaInvestigationPlanningAdvisoryGenerationTrace(input());

    expect(trace.trace_schema_version).toBe(CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION);
    expect(trace.package).toMatchObject({
      package_schema_version:
        "capa-investigation-planning-prompt-package-1.0.0",
      scope: { workflow_state: "S30" },
      agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" },
      generation_contract: {
        operation: "draft_investigation_plan",
        requested_output: "investigation_plan_draft",
        output_schema_version: "capa_investigation_plan_draft-1.0.0",
        store: false,
      },
    });
    expect(trace.evidence_manifest).toEqual({
      evidence_manifest_schema_version:
        "capa-investigation-planning-evidence-manifest-1.0.0",
      retrieval_performed: false,
      item_count: 0,
      items: [],
    });
    expect(trace.policy_manifest).toMatchObject({
      policy_manifest_schema_version:
        "capa-investigation-planning-policy-manifest-1.0.0",
      agent: { agent_id: "AG-PLAN", agent_version: "ag-plan-1.0.0" },
      workflow_state: "S30",
      operation: "draft_investigation_plan",
    });
    for (const prohibition of [
      "G-03 release",
      "investigation-plan approval",
      "workflow advancement",
      "S30 to S40 transition",
      "controlled-record mutation",
      "human adoption",
      "authoritative user assignment",
      "authoritative due-date commitment",
      "investigation execution",
      "evidence verification",
      "root-cause conclusion",
      "final causal determination",
      "disposition",
      "audit-event creation",
      "authorization decisions",
    ]) {
      expect(trace.policy_manifest.prohibitions).toContain(prohibition);
    }
    expect(trace.fingerprints.algorithm).toBe(
      CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
    );
    for (const fingerprint of Object.values(trace.fingerprints).slice(1)) {
      expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(trace.fingerprints.output_schema_sha256).toBe(
      fingerprintCanonicalJson(CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA),
    );
  });

  it("is deterministic while binding prompt, schema, and provenance changes", () => {
    const baseline = createCapaInvestigationPlanningAdvisoryGenerationTrace(input());
    const same = createCapaInvestigationPlanningAdvisoryGenerationTrace(input());
    expect(same.fingerprints).toEqual(baseline.fingerprints);
    expect(canonicalJson(same.package)).toBe(canonicalJson(baseline.package));

    const promptChanged = createCapaInvestigationPlanningAdvisoryGenerationTrace(
      input({ rendered_prompt: "CONTROLLED S30 PROMPT CHANGED" }),
    );
    expect(promptChanged.fingerprints.rendered_prompt_sha256).not.toBe(
      baseline.fingerprints.rendered_prompt_sha256,
    );

    const schemaChanged = createCapaInvestigationPlanningAdvisoryGenerationTrace(
      input({ output_schema: { type: "object" } }),
    );
    expect(schemaChanged.fingerprints.output_schema_sha256).not.toBe(
      baseline.fingerprints.output_schema_sha256,
    );
    expect(schemaChanged.fingerprints.prompt_package_sha256).not.toBe(
      baseline.fingerprints.prompt_package_sha256,
    );
    expect(schemaChanged.fingerprints.policy_manifest_sha256).not.toBe(
      baseline.fingerprints.policy_manifest_sha256,
    );

    const provenanceChanged = createCapaInvestigationPlanningAdvisoryGenerationTrace(
      input({
        package: {
          ...input().package,
          context_provenance: {
            ...input().package.context_provenance,
            authoritative_server_context: {
              record_version: 3,
            },
          },
        },
      }),
    );
    expect(provenanceChanged.fingerprints.prompt_package_sha256).not.toBe(
      baseline.fingerprints.prompt_package_sha256,
    );
  });

  it("snapshots and deeply freezes trace-controlled artifacts", () => {
    const original = input();
    const trace = createCapaInvestigationPlanningAdvisoryGenerationTrace(original);
    original.package.context_provenance.authoritative_server_context.record_version = 9;
    original.package.scope.record_version = 9;

    expect(trace.package.context_provenance.authoritative_server_context).toEqual({
      trust: "authoritative_server_context",
      record_version: 2,
    });
    expect(trace.package.scope.record_version).toBe(2);
    expect(Object.isFrozen(trace)).toBe(true);
    expect(Object.isFrozen(trace.package)).toBe(true);
    expect(Object.isFrozen(trace.package.trace)).toBe(true);
    expect(Object.isFrozen(trace.package.context_provenance)).toBe(true);
    expect(Object.isFrozen(trace.output_schema)).toBe(true);
    expect(Object.isFrozen(trace.evidence_manifest)).toBe(true);
    expect(Object.isFrozen(trace.policy_manifest)).toBe(true);
    expect(Object.isFrozen(trace.fingerprints)).toBe(true);
  });
});
