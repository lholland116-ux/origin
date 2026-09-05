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
  CapaInvestigationActiveAdvisoryContextAssembly,
  CapaInvestigationActiveAdvisoryModelSafeContext,
} from "./capa-investigation-active-advisory-context";
import {
  buildCapaInvestigationActiveAdvisoryPrompt,
} from "./capa-investigation-active-advisory-prompt";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationActiveAdvisoryResponse,
  type RawCapaInvestigationActiveAdvisoryModelOutput,
} from "./capa-investigation-active-advisory-contract";
import {
  validateCapaInvestigationActiveAdvisoryModelOutput,
} from "./capa-investigation-active-advisory-output-validator";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE,
  type CapaInvestigationActiveAdvisoryStructuredModelClient,
} from "./capa-investigation-active-advisory-model-profile";
import {
  createCapaInvestigationActiveAdvisoryGenerationTrace,
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

export class CapaInvestigationActiveAdvisoryReferenceMembershipError
  extends Error {
  constructor() {
    super(
      "The CAPA investigation-active advisory references context not supplied to the model.",
    );
    this.name = "CapaInvestigationActiveAdvisoryReferenceMembershipError";
  }
}

function assertReferenceMembership(
  advisory: RawCapaInvestigationActiveAdvisoryModelOutput,
  context: CapaInvestigationActiveAdvisoryModelSafeContext,
): void {
  const supplied = new Set(
    context.references.map((reference) => reference.reference_key),
  );
  const used = [
    ...advisory.proposal.evidence_gaps.flatMap(
      (item) => item.related_reference_keys,
    ),
    ...advisory.proposal.conflicting_information.flatMap(
      (item) => item.conflicting_reference_keys,
    ),
    ...advisory.proposal.assumptions.flatMap(
      (item) => item.related_reference_keys,
    ),
    ...advisory.proposal.causal_hypotheses.flatMap((item) => [
      ...item.supporting_reference_keys,
      ...item.contradictory_reference_keys,
    ]),
    ...advisory.proposal.alternative_hypotheses.flatMap((item) => [
      ...item.supporting_reference_keys,
      ...item.contradictory_reference_keys,
    ]),
    ...advisory.proposal.investigation_recommendations.flatMap(
      (item) => item.related_reference_keys,
    ),
  ];

  if (used.some((referenceKey) => !supplied.has(referenceKey))) {
    throw new CapaInvestigationActiveAdvisoryReferenceMembershipError();
  }
}

export interface CapaInvestigationActiveAdvisoryGenerationInput {
  readonly context: CapaInvestigationActiveAdvisoryContextAssembly;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
}

export interface CapaInvestigationActiveAdvisoryModelGeneratorDependencies {
  readonly model_client:
    CapaInvestigationActiveAdvisoryStructuredModelClient;
  readonly createRunId: () => CapaAiRunId;
  readonly createPromptPackageId: () => CapaPromptPackageId;
  readonly now: () => IsoDateTime;
  readonly createOutputId: () => CapaAiOutputId;
}

/**
 * CS3 generation boundary: it renders and transmits only model-safe context.
 * It does not activate AG-RCA, persist output, or mutate any CAPA record.
 */
export class CapaInvestigationActiveAdvisoryModelGenerator {
  constructor(
    private readonly dependencies:
      CapaInvestigationActiveAdvisoryModelGeneratorDependencies,
  ) {}

  async generate(input: CapaInvestigationActiveAdvisoryGenerationInput):
    Promise<{
      readonly response: CapaInvestigationActiveAdvisoryResponse;
      readonly trace: ReturnType<
        typeof createCapaInvestigationActiveAdvisoryGenerationTrace
      >;
    }> {
    const run_id = this.dependencies.createRunId();
    const prompt_package_id = this.dependencies.createPromptPackageId();
    const assembled_at = this.dependencies.now();
    const prompt = buildCapaInvestigationActiveAdvisoryPrompt({
      model_safe_context: input.context.model_safe_context,
    });

    if (
      typeof prompt !== "string" ||
      prompt.trim().length === 0 ||
      prompt.length > 120_000
    ) {
      throw new Error("CONTROLLED_CAPA_PROMPT_INVALID");
    }

    const trace = createCapaInvestigationActiveAdvisoryGenerationTrace({
      rendered_prompt: prompt,
      model_profile_version:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      package: {
        scope: {
          organization_id: input.context.authoritative.organization_id,
          capa_case_id: input.context.authoritative.capa_case_id,
          case_version_id: input.context.authoritative.case_version_id,
          record_version: input.context.authoritative.record_version,
          workflow_state: "S40",
        },
        agent: {
          agent_id: "AG-RCA",
          agent_version: "ag-rca-1.0.0",
        },
        trace: {
          run_id,
          prompt_package_id,
          request_id: input.request_id,
          correlation_id: input.correlation_id,
          assembled_at,
        },
        context_provenance: {
          model_safe_context: input.context.model_safe_context,
        },
        governance: {
          advisory_only: true,
          workflow_mutated: false,
          human_acceptance_required: true,
        },
      },
    });

    const raw = await this.dependencies.model_client.generateStructured({
      prompt,
      model_profile_version:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      store: false,
    });
    const advisory = validateCapaInvestigationActiveAdvisoryModelOutput(
      raw.output_text,
    );
    assertReferenceMembership(
      advisory,
      input.context.model_safe_context,
    );

    const output_id = this.dependencies.createOutputId();
    const response = deepFreeze({
      run_id,
      output_id,
      output_schema_version:
        CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION as CapaInvestigationActiveAdvisoryResponse["output_schema_version"],
      status: "completed_draft" as const,
      proposal: advisory.proposal,
      uncertainty_and_limitations:
        advisory.uncertainty_and_limitations,
      citations: [] as const,
      warnings: [] as const,
      advisory_only: true as const,
      workflow_mutated: false as const,
      human_acceptance_required: true as const,
    }) as CapaInvestigationActiveAdvisoryResponse;

    return Object.freeze({ response, trace });
  }
}

export {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT,
};
