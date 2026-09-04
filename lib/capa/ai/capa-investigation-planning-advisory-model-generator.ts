import type {
  CapaAiOutputId,
  CapaAiRunId,
  CapaPromptPackageId,
} from "./capa-prompt-contract";
import type {
  CorrelationId,
  IsoDateTime,
  RequestId,
} from "../domain/capa-types";
import type {
  CapaInvestigationPlanningAdvisoryContextAssembly,
} from "./capa-investigation-planning-advisory-context";
import {
  buildCapaInvestigationPlanningAdvisoryPrompt,
} from "./capa-investigation-planning-advisory-prompt";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationPlanAdvisoryResponse,
} from "./capa-investigation-planning-advisory-contract";
import {
  CapaInvestigationPlanAdvisoryOutputValidationError,
  validateCapaInvestigationPlanAdvisoryModelOutput,
} from "./capa-investigation-planning-advisory-output-validator";
import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE,
  type CapaInvestigationPlanningAdvisoryStructuredModelClient,
} from "./capa-investigation-planning-advisory-model-profile";
import {
  createCapaInvestigationPlanningAdvisoryGenerationTrace,
} from "./capa-ai-generation-trace";

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }

  return value;
}

export interface CapaInvestigationPlanningAdvisoryGenerationInput {
  readonly context: CapaInvestigationPlanningAdvisoryContextAssembly;
  readonly focus?: string | null;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
}

export interface CapaInvestigationPlanningAdvisoryModelGeneratorDependencies {
  readonly model_client:
    CapaInvestigationPlanningAdvisoryStructuredModelClient;
  readonly createRunId: () => CapaAiRunId;
  readonly createPromptPackageId: () => CapaPromptPackageId;
  readonly now: () => IsoDateTime;
  readonly createOutputId: () => CapaAiOutputId;
}

export class CapaInvestigationPlanningAdvisoryModelGenerator {
  constructor(
    private readonly dependencies:
      CapaInvestigationPlanningAdvisoryModelGeneratorDependencies,
  ) {}

  async generate(input: CapaInvestigationPlanningAdvisoryGenerationInput):
    Promise<{
      readonly response: CapaInvestigationPlanAdvisoryResponse;
      readonly trace: ReturnType<
        typeof createCapaInvestigationPlanningAdvisoryGenerationTrace
      >;
    }> {
    const run_id = this.dependencies.createRunId();
    const prompt_package_id = this.dependencies.createPromptPackageId();
    const assembled_at = this.dependencies.now();
    const prompt = buildCapaInvestigationPlanningAdvisoryPrompt({
      context: input.context,
      focus: input.focus,
    });

    if (
      typeof prompt !== "string" ||
      prompt.trim().length === 0 ||
      prompt.length > 120_000
    ) {
      throw new Error("CONTROLLED_CAPA_PROMPT_INVALID");
    }

    const trace = createCapaInvestigationPlanningAdvisoryGenerationTrace({
      rendered_prompt: prompt,
      model_profile_version:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      package: {
        scope: {
          organization_id: input.context.authoritative.organization_id,
          capa_case_id: input.context.authoritative.capa_case_id,
          case_version_id: input.context.authoritative.case_version_id,
          record_version: input.context.authoritative.record_version,
          workflow_state: "S30",
        },
        agent: {
          agent_id: "AG-PLAN",
          agent_version: "ag-plan-1.0.0",
        },
        trace: {
          run_id,
          prompt_package_id,
          request_id: input.request_id,
          correlation_id: input.correlation_id,
          assembled_at,
        },
        context_provenance: {
          authoritative_server_context:
            input.context.authoritative,
          untrusted_human_draft:
            input.context.untrusted_human_draft,
          focus: input.focus ?? null,
        },
        governance: {
          advisory_only: true,
          workflow_mutated: false,
          human_acceptance_required: true,
        },
      },
    });

    const model_generation_input = Object.freeze({
      prompt,
      model_profile_version:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      store: false,
    });

    let advisory:
      | ReturnType<typeof validateCapaInvestigationPlanAdvisoryModelOutput>
      | undefined;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const raw = await this.dependencies.model_client.generateStructured(
        model_generation_input,
      );

      try {
        advisory = validateCapaInvestigationPlanAdvisoryModelOutput(
          raw.output_text,
        );
        break;
      } catch (error) {
        if (
          !(error instanceof CapaInvestigationPlanAdvisoryOutputValidationError) ||
          attempt === 1
        ) {
          throw error;
        }
      }
    }

    if (advisory === undefined) {
      throw new Error("CONTROLLED_CAPA_ADVISORY_VALIDATION_RETRY_EXHAUSTED");
    }

    const output_id = this.dependencies.createOutputId();
    const response = deepFreeze({
      run_id,
      output_id,
      output_schema_version:
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION as CapaInvestigationPlanAdvisoryResponse["output_schema_version"],
      status: "completed_draft" as const,
      proposal: advisory.proposal,
      assumptions: advisory.assumptions,
      uncertainty_and_limitations:
        advisory.uncertainty_and_limitations,
      citations: [] as const,
      warnings: [] as const,
      advisory_only: true as const,
      workflow_mutated: false as const,
      human_acceptance_required: true as const,
    }) as CapaInvestigationPlanAdvisoryResponse;

    return Object.freeze({ response, trace });
  }
}

export {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
};
