import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCapaPromptConfiguration,
  type CapaPromptConfigurationInput,
} from "../../lib/capa/ai/capa-prompt-configuration";

import {
  createCapaIntakeAdvisoryControlledPromptRenderer,
} from "../../lib/capa/ai/capa-intake-advisory-controlled-prompt-renderer";

import type {
  CapaIntakeAdvisoryGenerationInput,
} from "../../lib/capa/ai/capa-intake-advisory-service";

const ORGANIZATION_ID =
  "550e8400-e29b-41d4-a716-446655440000";

const CASE_ID =
  "3d1e7eb7-3e24-4483-b934-1c59ff78cc90";

const CASE_VERSION_ID =
  "a65d17e5-4688-4412-aa08-f2832b37f671";

const USER_ID =
  "17e5a590-8e2c-4b08-8fb2-5a6c6fe87d23";

const REQUEST_ID =
  "c206f86c-2ba7-490e-bbfd-e31f562c4f30";

const CORRELATION_ID =
  "98e82790-e9f9-4b3d-a7eb-ed0e99c3d444";

const RUN_ID =
  "098c6760-7c3a-4de2-92fa-cd45f46c2321";

const PROMPT_PACKAGE_ID =
  "55633f2e-eb6a-4dc6-840f-d4be782f9f23";

function configurationInput():
  CapaPromptConfigurationInput {
  return {
    registry_version: "registry-1.0.0",
    agent_id: "AG-INTAKE",
    agent_version: "ag-intake-1.0.0",
    component_versions: {
      assembly_version: "assembly-1.0.0",
      platform_policy_version:
        "platform-1.0.0",
      product_policy_version:
        "product-1.0.0",
      agent_version:
        "ag-intake-1.0.0",
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
        "capa-intake-advisory-1.0.0",
      model_profile_version:
        "capa-model-profile-1.0.0",
      evaluation_suite_version:
        "evaluation-1.0.0",
    },
    allowed_workflow_states: ["S10"],
    allowed_operations: [
      "draft_intake_analysis",
    ],
    controlled_instructions: {
      platform_system_policy: {
        version: "platform-1.0.0",
        content: "Platform policy.",
      },
      product_policy: {
        version: "product-1.0.0",
        content: "Product policy.",
      },
      agent_definition: {
        version: "ag-intake-1.0.0",
        content:
          "CAPA intake advisory agent.",
      },
      output_contract: {
        version:
          "capa-intake-advisory-1.0.0",
        content:
          "Return only the controlled advisory output.",
      },
    },
    maximum_prompt_characters: 50_000,
    maximum_untrusted_block_characters:
      2_000,
  };
}

function generationInput():
  CapaIntakeAdvisoryGenerationInput {
  return {
    context: {
      organization_id:
        ORGANIZATION_ID as never,
      user_id:
        USER_ID as never,
      active_role_ids: [
        "CAPA_OWNER" as never,
      ],
      capa_case_id:
        CASE_ID as never,
      case_version_id:
        CASE_VERSION_ID as never,
      record_version: 2,
      workflow_state: "S10",
      minimum_case_context: [
        {
          field_code:
            "INITIATING_EVENT" as never,
          value:
            "Complaint indicates a possible sealing defect.",
          source_object_id:
            CASE_ID,
          source_object_version_id:
            CASE_VERSION_ID,
        },
      ],
    },
    request: {
      requested_output:
        "intake_advisory",
      focus:
        "Assess intake completeness.",
    } as never,
    evidence: {
      citations: Object.freeze([]),
      warnings: Object.freeze([]),
      prompt_context: Object.freeze([
        Object.freeze({
          organization_id:
            ORGANIZATION_ID,
          collection_id:
            "collection-1",
          collection_version_id:
            "collection-version-1",
          retrieval_run_id:
            "retrieval-run-1",
          source_id:
            "source-1",
          source_version_id:
            "source-1.0.0",
          passage_id:
            "passage-1",
          source_status_at_use:
            "current_effective",
          source_type:
            "CUSTOMER_PROCEDURE",
          title:
            "CAPA procedure",
          locators: Object.freeze([
            Object.freeze({
              kind: "section",
              label: "Section 4.2",
            }),
          ]),
          text: Object.freeze({
            trust: "untrusted_data",
            provenance_type:
              "retrieved_passage",
            content:
              "The procedure requires documented triage.",
          }),
        }),
      ]),
    },
    agent: {
      agent_id:
        "AG-INTAKE",
      agent_version:
        "ag-intake-1.0.0",
      output_schema_version:
        "capa-intake-advisory-1.0.0",
    } as never,
    request_id:
      REQUEST_ID as never,
    correlation_id:
      CORRELATION_ID as never,
  };
}

function renderer() {
  return createCapaIntakeAdvisoryControlledPromptRenderer(
    {
      configuration:
        createCapaPromptConfiguration(
          configurationInput(),
        ),
      identity_factory: {
        createPromptPackageId: () =>
          PROMPT_PACKAGE_ID as never,
      },
      clock: {
        now: () =>
          new Date(
            "2026-08-25T14:00:00.000Z",
          ),
      },
    },
  );
}

describe(
  "CAPA intake advisory controlled prompt renderer",
  () => {
    it(
      "assembles the advisory through the governed ten-layer prompt",
      () => {
        const result =
          renderer().build({
            generation_input:
              generationInput(),
            run_id:
              RUN_ID as never,
          });

        expect(
          result.prompt_package.layers,
        ).toHaveLength(10);

        expect(
          result.prompt_package.layers.map(
            (layer) => layer.name,
          ),
        ).toEqual([
          "platform_system_policy",
          "product_policy",
          "agent_definition",
          "workflow_context",
          "authorization_context",
          "minimum_case_context",
          "retrieved_sources",
          "user_request",
          "tool_results",
          "output_contract",
        ]);
      },
    );

    it(
      "binds server-controlled run and request identities to the prompt trace",
      () => {
        const result =
          renderer().build({
            generation_input:
              generationInput(),
            run_id:
              RUN_ID as never,
          });

        expect(
          result.prompt_package.trace,
        ).toMatchObject({
          run_id: RUN_ID,
          prompt_package_id:
            PROMPT_PACKAGE_ID,
          request_id: REQUEST_ID,
          correlation_id:
            CORRELATION_ID,
          assembled_at:
            "2026-08-25T14:00:00.000Z",
        });
      },
    );

    it(
      "keeps retrieved evidence in untrusted layer seven",
      () => {
        const result =
          renderer().build({
            generation_input:
              generationInput(),
            run_id:
              RUN_ID as never,
          });

        const layer =
          result.prompt_package.layers[6];

        expect(layer?.position).toBe(7);
        expect(layer?.name).toBe(
          "retrieved_sources",
        );
        expect(layer?.trust).toBe(
          "untrusted_data",
        );

        expect(
          JSON.stringify(layer?.content),
        ).toContain(
          "The procedure requires documented triage.",
        );

        expect(
          JSON.stringify(layer?.content),
        ).toContain("collection-1");
      },
    );

    it(
      "keeps the advisory request in untrusted layer eight",
      () => {
        const result =
          renderer().build({
            generation_input:
              generationInput(),
            run_id:
              RUN_ID as never,
          });

        const layer =
          result.prompt_package.layers[7];

        expect(layer?.position).toBe(8);
        expect(layer?.name).toBe(
          "user_request",
        );
        expect(layer?.trust).toBe(
          "untrusted_data",
        );

        expect(
          JSON.stringify(layer?.content),
        ).toContain(
          "Assess intake completeness.",
        );
      },
    );

    it(
      "renders only the already assembled controlled package",
      () => {
        const rendered =
          renderer().render({
            generation_input:
              generationInput(),
            run_id:
              RUN_ID as never,
          });

        const parsed =
          JSON.parse(rendered) as {
            run_id: string;
            prompt_package_id: string;
            layers: readonly unknown[];
          };

        expect(parsed.run_id).toBe(
          RUN_ID,
        );
        expect(
          parsed.prompt_package_id,
        ).toBe(PROMPT_PACKAGE_ID);
        expect(parsed.layers).toHaveLength(
          10,
        );
      },
    );

    it(
      "fails closed on cross-organization evidence",
      () => {
        const input =
          generationInput();

        const original =
          input.evidence
            .prompt_context[0] as Record<
              string,
              unknown
            >;

        const changed = {
          ...input,
          evidence: {
            ...input.evidence,
            prompt_context: [
              {
                ...original,
                organization_id:
                  "6ba7b810-9dad-41d1-80b4-00c04fd430c8",
              },
            ],
          },
        };

        expect(
          () =>
            renderer().build({
              generation_input:
                changed,
              run_id:
                RUN_ID as never,
            }),
        ).toThrow(
          "CONTROLLED_CAPA_EVIDENCE_SCOPE_MISMATCH",
        );
      },
    );

    it(
      "fails closed when retrieved evidence loses its untrusted classification",
      () => {
        const input =
          generationInput();

        const original =
          input.evidence
            .prompt_context[0] as Record<
              string,
              unknown
            >;

        const originalText =
          original.text as Record<
            string,
            unknown
          >;

        const changed = {
          ...input,
          evidence: {
            ...input.evidence,
            prompt_context: [
              {
                ...original,
                text: {
                  ...originalText,
                  trust:
                    "trusted_control",
                },
              },
            ],
          },
        };

        expect(
          () =>
            renderer().build({
              generation_input:
                changed,
              run_id:
                RUN_ID as never,
            }),
        ).toThrow(
          "CONTROLLED_CAPA_EVIDENCE_TRUST_INVALID",
        );
      },
    );

    it(
      "preserves the real collection identity rather than substituting collection version",
      () => {
        const result =
          renderer().build({
            generation_input:
              generationInput(),
            run_id:
              RUN_ID as never,
          });

        const serialized =
          JSON.stringify(
            result.prompt_package
              .layers[6]?.content,
          );

        expect(serialized).toContain(
          "collection-1",
        );

        expect(serialized).not.toContain(
          '"collection_id":"collection-version-1"',
        );
      },
    );
  },
);
