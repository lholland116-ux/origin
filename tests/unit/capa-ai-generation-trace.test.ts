import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CapaAiGenerationFingerprintError,
  canonicalJson,
  fingerprintCanonicalJson,
  sha256Utf8,
  createCapaContainmentRiskAdvisoryGenerationTrace,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
} from "../../lib/capa/ai/capa-ai-generation-trace";
import type { CapaAiRunId, CapaPromptPackageId } from "../../lib/capa/ai/capa-prompt-contract";
import type { CorrelationId, IsoDateTime, RequestId } from "../../lib/capa/domain/capa-types";

it("captures immutable S20 trace with truthful evidence and schema fingerprint", () => {
  const input = { rendered_prompt: "prompt", model_profile_version: "profile", output_schema_name: "schema", output_schema: { type: "object" }, maximum_output_characters: 30000, package: { scope: { organization_id: "o", capa_case_id: "c", case_version_id: "v", record_version: 1, workflow_state: "S20" as const }, agent: { agent_id: "AG-INTAKE" as const, agent_version: "v" }, trace: { run_id: "run-1" as CapaAiRunId, prompt_package_id: "package-1" as CapaPromptPackageId, request_id: "request-1" as RequestId, correlation_id: "correlation-1" as CorrelationId, assembled_at: "2026-09-01T00:00:00.000Z" as IsoDateTime }, context_provenance: { authoritative_server_context: {}, untrusted_human_draft: null, focus: null }, governance: { advisory_only: true as const, workflow_mutated: false as const, human_acceptance_required: true as const } }, policy_manifest: { agent: { agent_id: "AG-INTAKE", agent_version: "v" }, workflow_state: "S20" as const, operation: "op", requested_output: "out", output_schema_version: "v", generation: { model_profile_version: "p", output_schema_name: "s" }, authority: { advisory_only: true as const, workflow_mutated: false as const, human_acceptance_required: true as const }, prohibitions: [] } };
  const trace = createCapaContainmentRiskAdvisoryGenerationTrace(input);
  expect(trace.trace_schema_version).toBe(CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION);
  expect(trace.evidence_manifest).toMatchObject({ retrieval_performed: false, item_count: 0, items: [] });
  expect(trace.fingerprints.output_schema_sha256).toHaveLength(64);
  expect(Object.isFrozen(trace)).toBe(true);
  expect(Object.isFrozen(trace.package)).toBe(true);
  expect(Object.isFrozen(trace.evidence_manifest)).toBe(true);
  expect(Object.isFrozen(trace.policy_manifest)).toBe(true);
  expect(Object.isFrozen(trace.package.trace)).toBe(true);
});

describe("S20 prompt trace identity fingerprint binding", () => {
  const trace = (identity: Partial<{ run_id: CapaAiRunId; prompt_package_id: CapaPromptPackageId; request_id: RequestId; correlation_id: CorrelationId; assembled_at: IsoDateTime }> = {}) => createCapaContainmentRiskAdvisoryGenerationTrace({ rendered_prompt: "prompt", model_profile_version: "profile", output_schema_name: "schema", output_schema: { type: "object" }, maximum_output_characters: 30000, package: { scope: { organization_id: "o", capa_case_id: "c", case_version_id: "v", record_version: 1, workflow_state: "S20" as const }, agent: { agent_id: "AG-INTAKE" as const, agent_version: "ag-intake-1.0.0" }, trace: { run_id: "run-1" as CapaAiRunId, prompt_package_id: "package-1" as CapaPromptPackageId, request_id: "request-1" as RequestId, correlation_id: "correlation-1" as CorrelationId, assembled_at: "2026-09-01T00:00:00.000Z" as IsoDateTime, ...identity }, context_provenance: { authoritative_server_context: {}, untrusted_human_draft: null, focus: null }, governance: { advisory_only: true as const, workflow_mutated: false as const, human_acceptance_required: true as const } }, policy_manifest: { agent: { agent_id: "AG-INTAKE", agent_version: "ag-intake-1.0.0" }, workflow_state: "S20" as const, operation: "analyze_containment_impact_risk", requested_output: "containment_risk_analysis", output_schema_version: "capa-containment-risk-advisory-1.0.0", generation: { model_profile_version: "profile", output_schema_name: "schema" }, authority: { advisory_only: true as const, workflow_mutated: false as const, human_acceptance_required: true as const }, prohibitions: [] } });
  it("binds every required trace identity to the package fingerprint", () => {
    const baseline = trace().fingerprints.prompt_package_sha256;
    expect(trace({ run_id: "run-2" as CapaAiRunId }).fingerprints.prompt_package_sha256).not.toBe(baseline);
    expect(trace({ prompt_package_id: "package-2" as CapaPromptPackageId }).fingerprints.prompt_package_sha256).not.toBe(baseline);
    expect(trace({ request_id: "request-2" as RequestId }).fingerprints.prompt_package_sha256).not.toBe(baseline);
    expect(trace({ correlation_id: "correlation-2" as CorrelationId }).fingerprints.prompt_package_sha256).not.toBe(baseline);
    expect(trace({ assembled_at: "2026-09-01T00:00:01.000Z" as IsoDateTime }).fingerprints.prompt_package_sha256).not.toBe(baseline);
  });
});

describe(
  "CAPA AI generation trace fingerprints",
  () => {
    it(
      "canonicalizes object keys deterministically",
      () => {
        expect(
          canonicalJson({
            b: 2,
            a: 1,
          }),
        ).toBe(
          '{"a":1,"b":2}',
        );

        expect(
          fingerprintCanonicalJson({
            b: 2,
            a: 1,
          }),
        ).toBe(
          "43258cff783fe7036d8a43033f830adfc60ec037382473548ac742b888292777",
        );
      },
    );

    it(
      "produces the same fingerprint for equivalent object key order",
      () => {
        expect(
          fingerprintCanonicalJson({
            z: {
              b: 2,
              a: 1,
            },
            a: "value",
          }),
        ).toBe(
          fingerprintCanonicalJson({
            a: "value",
            z: {
              a: 1,
              b: 2,
            },
          }),
        );
      },
    );

    it(
      "preserves array order",
      () => {
        expect(
          fingerprintCanonicalJson(
            ["first", "second"],
          ),
        ).not.toBe(
          fingerprintCanonicalJson(
            ["second", "first"],
          ),
        );
      },
    );

    it(
      "normalizes negative zero",
      () => {
        expect(
          canonicalJson({
            value: -0,
          }),
        ).toBe(
          '{"value":0}',
        );
      },
    );

    it(
      "rejects undefined object values",
      () => {
        expect(
          () =>
            canonicalJson({
              value:
                undefined,
            }),
        ).toThrow(
          CapaAiGenerationFingerprintError,
        );
      },
    );

    it(
      "rejects non-finite numbers",
      () => {
        expect(
          () =>
            canonicalJson({
              value:
                Number.NaN,
            }),
        ).toThrow(
          CapaAiGenerationFingerprintError,
        );

        expect(
          () =>
            canonicalJson({
              value:
                Number.POSITIVE_INFINITY,
            }),
        ).toThrow(
          CapaAiGenerationFingerprintError,
        );
      },
    );

    it(
      "rejects non-plain objects",
      () => {
        expect(
          () =>
            canonicalJson(
              new Date(
                "2026-08-27T00:00:00.000Z",
              ),
            ),
        ).toThrow(
          CapaAiGenerationFingerprintError,
        );
      },
    );

    it(
      "fingerprints exact rendered prompt bytes",
      () => {
        expect(
          sha256Utf8(
            "prompt",
          ),
        ).not.toBe(
          sha256Utf8(
            "prompt ",
          ),
        );
      },
    );
  },
);

describe(
  "CAPA AI generation evidence and policy manifests",
  () => {
    function controlledPackage() {
      const layers = [
        {
          position: 1,
          name: "platform_system_policy",
          trust: "controlled_system",
          content: {
            instruction:
              "Platform policy",
          },
          content_version:
            "platform-1.0.0",
        },
        {
          position: 2,
          name: "product_policy",
          trust: "controlled_system",
          content: {
            instruction:
              "Product policy",
          },
          content_version:
            "product-1.0.0",
        },
        {
          position: 3,
          name: "agent_definition",
          trust: "controlled_system",
          content: {
            instruction:
              "Agent definition",
          },
          content_version:
            "agent-1.0.0",
        },
        {
          position: 4,
          name: "workflow_context",
          trust: "trusted_server_context",
          content: {
            workflow_state: "S10",
          },
          content_version:
            "workflow-1.0.0",
        },
        {
          position: 5,
          name: "authorization_context",
          trust: "trusted_server_context",
          content: {
            authorized_operation:
              "draft_intake_analysis",
            authorization_policy_version:
              "authorization-1.0.0",
          },
          content_version:
            "authorization-1.0.0",
        },
        {
          position: 6,
          name: "minimum_case_context",
          trust: "trusted_server_context",
          content: [],
          content_version:
            "case-context-1.0.0",
        },
        {
          position: 7,
          name: "retrieved_sources",
          trust: "untrusted_data",
          content: [
            {
              organization_id:
                "org-1",
              collection_id:
                "collection-1",
              source_id:
                "source-1",
              source_version:
                "source-version-1",
              passage_id:
                "passage-1",
              source_status:
                "approved",
              source_type:
                "controlled_reference",
              title:
                "CAPA reference",
              precise_locator:
                "Section 4",
              retrieved_at:
                "2026-08-27T12:00:00.000Z",
              text: {
                trust:
                  "untrusted_data",
                provenance_type:
                  "retrieved_passage",
                content:
                  "Documented triage is required.",
              },
            },
          ],
          content_version:
            "retrieval-1.0.0",
        },
        {
          position: 8,
          name: "user_request",
          trust: "untrusted_data",
          content: {
            trust:
              "untrusted_data",
            provenance_type:
              "user_request",
            content:
              "Assess intake completeness.",
          },
          content_version:
            "assembly-1.0.0",
        },
        {
          position: 9,
          name: "tool_results",
          trust: "untrusted_data",
          content: [],
          content_version:
            "tools-1.0.0",
        },
        {
          position: 10,
          name: "output_contract",
          trust: "controlled_system",
          content: {
            instruction:
              "Output contract",
          },
          content_version:
            "output-1.0.0",
        },
      ];

      return {
        scope: {
          organization_id:
            "org-1",
          capa_case_id:
            "case-1",
          case_version_id:
            "version-1",
          record_version: 2,
          workflow_state: "S10",
        },

        trace: {
          run_id:
            "run-1",
          prompt_package_id:
            "prompt-package-1",
          request_id:
            "request-1",
          correlation_id:
            "correlation-1",
          assembled_at:
            "2026-08-27T12:00:00.000Z",
        },

        agent: {
          agent_id:
            "AG-INTAKE",
          agent_version:
            "agent-1.0.0",
          output_type:
            "output-1.0.0",
        },

        component_versions: {
          assembly_version:
            "assembly-1.0.0",
          platform_policy_version:
            "platform-1.0.0",
          product_policy_version:
            "product-1.0.0",
          agent_version:
            "agent-1.0.0",
          workflow_context_version:
            "workflow-1.0.0",
          authorization_context_version:
            "authorization-1.0.0",
          case_context_schema_version:
            "case-context-1.0.0",
          retrieval_policy_version:
            "retrieval-1.0.0",
          tool_policy_version:
            "tools-1.0.0",
          output_schema_version:
            "output-1.0.0",
          model_profile_version:
            "model-1.0.0",
          evaluation_suite_version:
            "evaluation-1.0.0",
        },

        layers,
        reduction_applied:
          false,
      } as unknown as
        import("../../lib/capa/ai/capa-prompt-contract")
          .CapaControlledPromptPackage;
    }

    it(
      "derives exact admitted evidence fingerprints from layer seven",
      async () => {
        const module =
          await import(
            "../../lib/capa/ai/capa-ai-generation-trace"
          );

        const manifest =
          module
            .createCapaAiGenerationEvidenceManifest(
              controlledPackage(),
            );

        expect(
          manifest.layer_position,
        ).toBe(7);

        expect(
          manifest.layer_name,
        ).toBe(
          "retrieved_sources",
        );

        expect(
          manifest.item_count,
        ).toBe(1);

        expect(
          manifest.items[0],
        ).toMatchObject({
          collection_id:
            "collection-1",
          source_id:
            "source-1",
          source_version:
            "source-version-1",
          passage_id:
            "passage-1",
        });

        expect(
          manifest.items[0]
            ?.item_sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          manifest.items[0]
            ?.text_sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      "changes the evidence fingerprint when exact evidence text changes",
      async () => {
        const module =
          await import(
            "../../lib/capa/ai/capa-ai-generation-trace"
          );

        const first =
          controlledPackage();

        const second =
          structuredClone(
            first,
          ) as typeof first;

        const evidenceLayer =
          second.layers[6];

        if (
          evidenceLayer ===
            undefined ||
          !Array.isArray(
            evidenceLayer.content,
          )
        ) {
          throw new Error(
            "invalid test fixture",
          );
        }

        const item =
          evidenceLayer
            .content[0] as
              Record<string, unknown>;

        item.text = {
          trust:
            "untrusted_data",
          provenance_type:
            "retrieved_passage",
          content:
            "Changed evidence text.",
        };

        const firstManifest =
          module
            .createCapaAiGenerationEvidenceManifest(
              first,
            );

        const secondManifest =
          module
            .createCapaAiGenerationEvidenceManifest(
              second,
            );

        expect(
          module
            .fingerprintCanonicalJson(
              firstManifest,
            ),
        ).not.toBe(
          module
            .fingerprintCanonicalJson(
              secondManifest,
            ),
        );
      },
    );

    it(
      "binds all controlled component versions into the policy manifest",
      async () => {
        const module =
          await import(
            "../../lib/capa/ai/capa-ai-generation-trace"
          );

        const manifest =
          module
            .createCapaAiGenerationPolicyManifest(
              controlledPackage(),
            );

        expect(
          manifest.component_versions,
        ).toMatchObject({
          assembly_version:
            "assembly-1.0.0",
          platform_policy_version:
            "platform-1.0.0",
          product_policy_version:
            "product-1.0.0",
          retrieval_policy_version:
            "retrieval-1.0.0",
          tool_policy_version:
            "tools-1.0.0",
          output_schema_version:
            "output-1.0.0",
          model_profile_version:
            "model-1.0.0",
          evaluation_suite_version:
            "evaluation-1.0.0",
        });

        expect(
          manifest.governance_layers
            .map(
              (layer) =>
                layer.name,
            ),
        ).toEqual([
          "platform_system_policy",
          "product_policy",
          "agent_definition",
          "authorization_context",
          "output_contract",
        ]);
      },
    );

    it(
      "produces complete prompt evidence and policy trace artifacts",
      async () => {
        const module =
          await import(
            "../../lib/capa/ai/capa-ai-generation-trace"
          );

        const promptPackage =
          controlledPackage();

        const renderedPrompt =
          JSON.stringify({
            prompt_package_id:
              promptPackage.trace
                .prompt_package_id,
            run_id:
              promptPackage.trace
                .run_id,
            layers:
              promptPackage.layers,
          });

        const artifacts =
          module
            .createCapaAiGenerationTraceArtifacts({
              prompt_package:
                promptPackage,
              rendered_prompt:
                renderedPrompt,
              model_profile_version:
                "model-1.0.0" as never,
            });

        expect(
          artifacts.algorithm,
        ).toBe(
          "sha256-canonical-json-v1",
        );

        expect(
          artifacts
            .prompt_package_sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          artifacts
            .rendered_prompt_sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          artifacts
            .evidence_manifest_sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );

        expect(
          artifacts
            .policy_manifest_sha256,
        ).toMatch(
          /^[a-f0-9]{64}$/,
        );
      },
    );

    it(
      "fails closed when layer seven is not the governed evidence layer",
      async () => {
        const module =
          await import(
            "../../lib/capa/ai/capa-ai-generation-trace"
          );

        const promptPackage =
          controlledPackage();

        const changed =
          structuredClone(
            promptPackage,
          ) as typeof promptPackage;

        Object.assign(
          changed.layers[6] ?? {},
          {
            name:
              "user_request",
          },
        );

        expect(
          () =>
            module
              .createCapaAiGenerationEvidenceManifest(
                changed,
              ),
        ).toThrow(
          module
            .CapaAiGenerationFingerprintError,
        );
      },
    );
  },
);
