import type {
  CapaAiOutputId,
  CapaAiRunId,
  CapaControlledPromptPackage,
  ControlledVersion,
} from "./capa-prompt-contract";

import type {
  CapaIntakeAdvisoryGenerationResult,
} from "./capa-ai-generation-trace";

import type {
  CapaIntakeAdvisoryResponse,
} from "./capa-intake-advisory-contract";

import type {
  CapaIntakeAdvisoryGenerationInput,
  CapaIntakeAdvisoryGenerator,
} from "./capa-intake-advisory-service";

import {
  validateCapaIntakeAdvisoryModelOutput,
} from "./capa-intake-advisory-output-validator";

/** Controlled, provider-neutral structured model invocation. */

export const CAPA_INTAKE_ADVISORY_MODEL_PROFILE =
  Object.freeze({
    profile_version:
      "capa-model-profile-1.0.0" as const,
    output_schema_name:
      "capa_intake_advisory_1_0_0" as const,
    maximum_output_characters: 30_000,
    store_provider_response: false,
  });

export const CAPA_INTAKE_ADVISORY_JSON_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "proposal",
      "assumptions",
      "missing_information",
      "conflicts_and_alternatives",
      "uncertainty_and_limitations",
      "human_action_required",
      "warnings",
    ],
    properties: {
      proposal: {
        type: "object",
        additionalProperties: false,
        required: [
          "problem_statement_draft",
          "scope_dimensions",
          "missing_dimensions",
          "containment_risk_questions",
          "investigation_questions",
        ],
        properties: {
          problem_statement_draft: {
            type: "string",
          },
          scope_dimensions: {
            type: "array",
            items: { type: "string" },
          },
          missing_dimensions: {
            type: "array",
            items: { type: "string" },
          },
          containment_risk_questions: {
            type: "array",
            items: { type: "string" },
          },
          investigation_questions: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
      assumptions: {
        type: "array",
        items: { type: "string" },
      },
      missing_information: {
        type: "array",
        items: { type: "string" },
      },
      conflicts_and_alternatives: {
        type: "array",
        items: { type: "string" },
      },
      uncertainty_and_limitations: {
        type: "array",
        items: { type: "string" },
      },
      human_action_required: {
        type: "array",
        items: { type: "string" },
      },
      warnings: {
        type: "array",
        items: { type: "string" },
      },
    },
  } as const);

export interface CapaIntakeAdvisoryPromptRenderer {
  build(input: {
    readonly generation_input:
      CapaIntakeAdvisoryGenerationInput;
    readonly run_id: CapaAiRunId;
  }): {
    readonly prompt_package:
      CapaControlledPromptPackage;
    readonly rendered_prompt: string;
  };
}

export interface CapaIntakeAdvisoryStructuredModelClient {
  generateStructured(input: {
    readonly model_profile_version:
      typeof CAPA_INTAKE_ADVISORY_MODEL_PROFILE.profile_version;
    readonly prompt: string;
    readonly output_schema_name:
      typeof CAPA_INTAKE_ADVISORY_MODEL_PROFILE.output_schema_name;
    readonly output_schema:
      typeof CAPA_INTAKE_ADVISORY_JSON_SCHEMA;
    readonly maximum_output_characters:
      number;
    readonly store: false;
  }): Promise<{
    readonly output_text: string;
  }>;
}

export interface CapaIntakeAdvisoryIdFactory {
  createRunId(): CapaAiRunId;
  createOutputId(): CapaAiOutputId;
}

export interface CapaIntakeAdvisoryModelGeneratorDependencies {
  readonly prompt_renderer:
    CapaIntakeAdvisoryPromptRenderer;
  readonly model_client:
    CapaIntakeAdvisoryStructuredModelClient;
  readonly id_factory:
    CapaIntakeAdvisoryIdFactory;
}

function controlledPrompt(
  value: string,
): string {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.length > 120_000
  ) {
    throw new Error(
      "CONTROLLED_CAPA_PROMPT_INVALID",
    );
  }

  return value;
}

function assertPromptPackageBoundToGeneration(
  promptPackage:
    CapaControlledPromptPackage,
  input:
    CapaIntakeAdvisoryGenerationInput,
  runId:
    CapaAiRunId,
): void {
  if (
    promptPackage.trace.run_id !==
      runId ||
    promptPackage.trace.request_id !==
      input.request_id ||
    promptPackage.trace.correlation_id !==
      input.correlation_id ||
    promptPackage.scope.organization_id !==
      input.context.organization_id ||
    promptPackage.scope.capa_case_id !==
      input.context.capa_case_id ||
    promptPackage.scope.case_version_id !==
      input.context.case_version_id ||
    promptPackage.scope.record_version !==
      input.context.record_version ||
    promptPackage.scope.workflow_state !==
      input.context.workflow_state ||
    promptPackage.agent.agent_id !==
      input.agent.agent_id ||
    promptPackage.agent.agent_version !==
      input.agent.agent_version ||
    promptPackage.agent.output_type !==
      input.agent.output_schema_version ||
    promptPackage.component_versions
      .model_profile_version !==
      CAPA_INTAKE_ADVISORY_MODEL_PROFILE
        .profile_version ||
    promptPackage.component_versions
      .output_schema_version !==
      input.agent.output_schema_version
  ) {
    throw new Error(
      "CONTROLLED_CAPA_PROMPT_TRACE_INVALID",
    );
  }
}

export class CapaIntakeAdvisoryModelGenerator
  implements CapaIntakeAdvisoryGenerator {
  constructor(
    private readonly dependencies:
      CapaIntakeAdvisoryModelGeneratorDependencies,
  ) {}

  async generate(
    input:
      CapaIntakeAdvisoryGenerationInput,
  ): Promise<CapaIntakeAdvisoryGenerationResult> {
    /*
     * Create the AI run identity before prompt assembly.
     *
     * This same server-controlled identity is bound to the controlled
     * prompt trace and the final advisory response.
     */
    const runId =
      this.dependencies.id_factory
        .createRunId();

    const promptArtifact =
      this.dependencies.prompt_renderer
        .build({
          generation_input: input,
          run_id: runId,
        });

    assertPromptPackageBoundToGeneration(
      promptArtifact.prompt_package,
      input,
      runId,
    );

    const prompt =
      controlledPrompt(
        promptArtifact.rendered_prompt,
      );

    const raw =
      await this.dependencies.model_client
        .generateStructured({
          model_profile_version:
            CAPA_INTAKE_ADVISORY_MODEL_PROFILE
              .profile_version,
          prompt,
          output_schema_name:
            CAPA_INTAKE_ADVISORY_MODEL_PROFILE
              .output_schema_name,
          output_schema:
            CAPA_INTAKE_ADVISORY_JSON_SCHEMA,
          maximum_output_characters:
            CAPA_INTAKE_ADVISORY_MODEL_PROFILE
              .maximum_output_characters,
          store: false,
        });
    const validated =
      validateCapaIntakeAdvisoryModelOutput(
        raw.output_text,
      );

    const response =
      Object.freeze({
        run_id: runId,
      output_id:
        this.dependencies.id_factory
          .createOutputId(),
      output_schema_version: input.agent.output_schema_version as unknown as ControlledVersion,
      status: "completed_draft",
      proposal: validated.proposal,
      citations: Object.freeze([
        ...input.evidence.citations,
      ]),
      assumptions:
        validated.assumptions,
      missing_information:
        validated.missing_information,
      conflicts_and_alternatives:
        validated.conflicts_and_alternatives,
      uncertainty_and_limitations:
        validated.uncertainty_and_limitations,
      human_action_required:
        validated.human_action_required,
      warnings: Object.freeze([
        ...input.evidence.warnings,
        ...validated.warnings,
      ]),
      advisory_only: true,
      workflow_mutated: false,
        human_acceptance_required: true,
      });

    return Object.freeze({
      response,

      trace: Object.freeze({
        prompt_package:
          promptArtifact.prompt_package,

        rendered_prompt:
          prompt,

        model_profile_version:
          CAPA_INTAKE_ADVISORY_MODEL_PROFILE
            .profile_version as unknown as
              ControlledVersion,
      }),
    });
  }
}

export function createCapaIntakeAdvisoryModelGenerator(
  dependencies:
    CapaIntakeAdvisoryModelGeneratorDependencies,
): CapaIntakeAdvisoryModelGenerator {
  return new CapaIntakeAdvisoryModelGenerator(
    dependencies,
  );
}
