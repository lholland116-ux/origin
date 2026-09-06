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
  CapaRootCauseReviewAdvisoryContextAssembly,
} from "./capa-root-cause-review-advisory-context";
import {
  buildCapaRootCauseReviewAdvisoryPrompt,
} from "./capa-root-cause-review-advisory-prompt-builder";
import {
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_PROPOSAL_FIELDS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES,
  CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaRootCauseReviewAdvisoryResponse,
  type RawCapaRootCauseReviewAdvisoryModelOutput,
} from "./capa-root-cause-review-advisory-contract";
import {
  validateCapaRootCauseReviewAdvisoryModelOutput,
} from "./capa-root-cause-review-advisory-validator";
import {
  createCapaRootCauseReviewAdvisoryGenerationTrace,
} from "./capa-ai-generation-trace";

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE =
  Object.freeze({
    profile_version:
      "capa-root-cause-review-model-profile-1.0.0" as const,
    output_schema_name:
      "capa_root_cause_review_advisory_1_0_0" as const,
    output_schema_version:
      CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
    maximum_output_characters: 40_000,
  });

const MAXIMUM_ITEMS = 20;
const MAXIMUM_TEXT_CHARACTERS = 2_000;
const MAXIMUM_QUESTION_CHARACTERS = 1_000;

const text = {
  type: "string",
  minLength: 1,
  maxLength: MAXIMUM_TEXT_CHARACTERS,
} as const;

const question = {
  type: "string",
  minLength: 1,
  maxLength: MAXIMUM_QUESTION_CHARACTERS,
  pattern:
    "^(?:[Dd]oes|[Dd]o|[Dd]id|[Ii]s|[Aa]re|[Ww]as|[Ww]ere|[Mm]ay|[Mm]ight|[Cc]an|[Cc]ould|[Ss]hould|[Ww]ould|[Mm]ust|[Ww]hat|[Ww]hich|[Ww]ho|[Ww]hom|[Ww]hose|[Ww]hy|[Hh]ow|[Ww]hen|[Ww]here|[Ww]hether) [^.!?;,:\\n\\r]+\\?$",
} as const;

const referenceKey = {
  type: "string",
  pattern: "^R[1-9][0-9]{0,2}$",
} as const;

const localKey = (prefix: string) => ({
  type: "string",
  pattern: `^${prefix}[1-9][0-9]{0,2}$`,
} as const);

const identifier = {
  type: ["string", "null"],
  pattern: "^[A-Za-z][A-Za-z0-9._:-]{0,127}$",
} as const;

const nullableText = {
  type: ["string", "null"],
  minLength: 1,
  maxLength: MAXIMUM_TEXT_CHARACTERS,
} as const;

const references = {
  type: "array",
  maxItems: MAXIMUM_ITEMS,
  items: referenceKey,
} as const;

const versionChange = {
  type: "object",
  additionalProperties: false,
  required: [
    "change_key",
    "subject",
    "change_type",
    "previous_value",
    "current_value",
    "authoritative_identifier",
    "reference_keys",
    "human_review_question",
  ],
  properties: {
    change_key: localKey("V"),
    subject: text,
    change_type: {
      type: "string",
      enum: [...CAPA_ROOT_CAUSE_REVIEW_ADVISORY_CHANGE_TYPES],
    },
    previous_value: nullableText,
    current_value: nullableText,
    authoritative_identifier: identifier,
    reference_keys: references,
    human_review_question: question,
  },
} as const;

const blockerWarning = {
  type: "object",
  additionalProperties: false,
  required: [
    "warning_key",
    "kind",
    "subject",
    "description",
    "authoritative_identifier",
    "reference_keys",
    "human_review_question",
  ],
  properties: {
    warning_key: localKey("B"),
    kind: {
      type: "string",
      enum: [...CAPA_ROOT_CAUSE_REVIEW_ADVISORY_BLOCKER_WARNING_KINDS],
    },
    subject: text,
    description: text,
    authoritative_identifier: identifier,
    reference_keys: references,
    human_review_question: question,
  },
} as const;

const evidenceMapEntry = {
  type: "object",
  additionalProperties: false,
  required: [
    "mapping_key",
    "subject",
    "relationship",
    "description",
    "evidence_reference_keys",
    "source_status",
    "authoritative_identifier",
    "human_review_question",
  ],
  properties: {
    mapping_key: localKey("E"),
    subject: text,
    relationship: {
      type: "string",
      enum: [...CAPA_ROOT_CAUSE_REVIEW_ADVISORY_EVIDENCE_RELATIONSHIPS],
    },
    description: text,
    evidence_reference_keys: references,
    source_status: {
      type: "string",
      enum: [...CAPA_ROOT_CAUSE_REVIEW_ADVISORY_SOURCE_STATUSES],
    },
    authoritative_identifier: identifier,
    human_review_question: question,
  },
} as const;

const bounded = <T>(items: T) => ({
  type: "array",
  maxItems: MAXIMUM_ITEMS,
  items,
} as const);

export const CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "schema_version",
      "status",
      "proposal",
      "uncertainty_and_limitations",
      "citations",
      "advisory_only",
      "workflow_mutated",
      "controlled_record_mutated",
      "review_disposition",
      "workflow_transition",
      "human_acceptance_required",
    ],
    properties: {
      schema_version: {
        type: "string",
        const: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION,
      },
      status: {
        type: "string",
        const: "completed_draft",
      },
      proposal: {
        type: "object",
        additionalProperties: false,
        required: [...CAPA_ROOT_CAUSE_REVIEW_ADVISORY_PROPOSAL_FIELDS],
        properties: {
          neutral_review_summary: {
            ...text,
            maxLength: 4_000,
          },
          version_changes: bounded(versionChange),
          blockers_warnings: bounded(blockerWarning),
          evidence_map: bounded(evidenceMapEntry),
        },
      },
      uncertainty_and_limitations: bounded({
        type: "object",
        additionalProperties: false,
        required: ["category", "human_review_question"],
        properties: {
          category: {
            type: "string",
            enum: [...CAPA_ROOT_CAUSE_REVIEW_ADVISORY_UNCERTAINTY_CATEGORIES],
          },
          human_review_question: question,
        },
      }),
      citations: {
        type: "array",
        maxItems: 0,
        items: { type: "string" },
      },
      advisory_only: { type: "boolean", const: true },
      workflow_mutated: { type: "boolean", const: false },
      controlled_record_mutated: { type: "boolean", const: false },
      review_disposition: { type: "null" },
      workflow_transition: { type: "null" },
      human_acceptance_required: { type: "boolean", const: true },
    },
    description: `Strict structured output for ${CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT} at ${CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION}.`,
  } as const);

export interface CapaRootCauseReviewAdvisoryStructuredModelClient {
  generateStructured(input: {
    readonly prompt: string;
    readonly model_profile_version:
      typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version;
    readonly output_schema_name:
      typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name;
    readonly output_schema:
      typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA;
    readonly maximum_output_characters:
      typeof CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters;
    readonly store: false;
  }): Promise<{
    readonly output_text: string;
  }>;
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) {
      deepFreeze(child);
    }
  }
  return value;
}

export class CapaRootCauseReviewAdvisoryReferenceMembershipError
  extends Error {
  constructor() {
    super(
      "The CAPA S50 review advisory references context not supplied to the model.",
    );
    this.name =
      "CapaRootCauseReviewAdvisoryReferenceMembershipError";
  }
}

function assertReferenceMembership(
  advisory: RawCapaRootCauseReviewAdvisoryModelOutput,
  context: CapaRootCauseReviewAdvisoryContextAssembly,
): void {
  const suppliedReferences = new Set(
    context.model_safe_context.references.map(
      (reference) => reference.reference_key,
    ),
  );
  const suppliedIdentifiers = new Set(
    context.reference_manifest.map(
      (reference) => reference.source_id,
    ),
  );

  const usedReferences = [
    ...advisory.proposal.version_changes.flatMap(
      (item) => item.reference_keys,
    ),
    ...advisory.proposal.blockers_warnings.flatMap(
      (item) => item.reference_keys,
    ),
    ...advisory.proposal.evidence_map.flatMap(
      (item) => item.evidence_reference_keys,
    ),
  ];

  if (usedReferences.some((key) => !suppliedReferences.has(key))) {
    throw new CapaRootCauseReviewAdvisoryReferenceMembershipError();
  }

  const usedIdentifiers = [
    ...advisory.proposal.version_changes.map(
      (item) => item.authoritative_identifier,
    ),
    ...advisory.proposal.blockers_warnings.map(
      (item) => item.authoritative_identifier,
    ),
    ...advisory.proposal.evidence_map.map(
      (item) => item.authoritative_identifier,
    ),
  ];

  if (usedIdentifiers.some((identifier) =>
    identifier !== null && !suppliedIdentifiers.has(identifier),
  )) {
    throw new CapaRootCauseReviewAdvisoryReferenceMembershipError();
  }
}

export interface CapaRootCauseReviewAdvisoryGenerationInput {
  readonly context: CapaRootCauseReviewAdvisoryContextAssembly;
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
}

export interface CapaRootCauseReviewAdvisoryModelGeneratorDependencies {
  readonly model_client:
    CapaRootCauseReviewAdvisoryStructuredModelClient;
  readonly createRunId: () => CapaAiRunId;
  readonly createPromptPackageId: () => CapaPromptPackageId;
  readonly now: () => IsoDateTime;
  readonly createOutputId: () => CapaAiOutputId;
}

export class CapaRootCauseReviewAdvisoryModelGenerator {
  constructor(
    private readonly dependencies:
      CapaRootCauseReviewAdvisoryModelGeneratorDependencies,
  ) {}

  async generate(input: CapaRootCauseReviewAdvisoryGenerationInput): Promise<{
    readonly response: CapaRootCauseReviewAdvisoryResponse;
    readonly trace: ReturnType<
      typeof createCapaRootCauseReviewAdvisoryGenerationTrace
    >;
  }> {
    const run_id = this.dependencies.createRunId();
    const prompt_package_id = this.dependencies.createPromptPackageId();
    const assembled_at = this.dependencies.now();
    const prompt = buildCapaRootCauseReviewAdvisoryPrompt({
      model_safe_context: input.context.model_safe_context,
    });

    if (
      typeof prompt !== "string" ||
      prompt.trim().length === 0 ||
      prompt.length > 120_000
    ) {
      throw new Error("CONTROLLED_CAPA_PROMPT_INVALID");
    }

    const trace = createCapaRootCauseReviewAdvisoryGenerationTrace({
      rendered_prompt: prompt,
      model_profile_version:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.maximum_output_characters,
      package: {
        scope: {
          organization_id: input.context.authoritative.organization_id,
          capa_case_id: input.context.authoritative.capa_case_id,
          case_version_id: input.context.authoritative.case_version_id,
          record_version: input.context.authoritative.record_version,
          workflow_state: "S50" as const,
        },
        agent: {
          agent_id: "AG-REVIEW" as const,
          agent_version: "ag-review-1.0.0" as const,
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
          advisory_only: true as const,
          workflow_mutated: false as const,
          controlled_record_mutated: false as const,
          human_acceptance_required: true as const,
        },
      },
    });

    const modelInput = Object.freeze({
      prompt,
      model_profile_version:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.profile_version,
      output_schema_name:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE.output_schema_name,
      output_schema: CAPA_ROOT_CAUSE_REVIEW_ADVISORY_JSON_SCHEMA,
      maximum_output_characters:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_MODEL_PROFILE
          .maximum_output_characters,
      store: false as const,
    });

    const raw = await this.dependencies.model_client.generateStructured(
      modelInput,
    );
    const advisory = validateCapaRootCauseReviewAdvisoryModelOutput(
      raw.output_text,
    );
    assertReferenceMembership(advisory, input.context);

    const output_id = this.dependencies.createOutputId();
    const response = deepFreeze({
      run_id,
      output_id,
      output_schema_version:
        CAPA_ROOT_CAUSE_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION as CapaRootCauseReviewAdvisoryResponse["output_schema_version"],
      status: "completed_draft" as const,
      proposal: advisory.proposal,
      uncertainty_and_limitations:
        advisory.uncertainty_and_limitations,
      citations: [] as const,
      warnings: [] as const,
      advisory_only: true as const,
      workflow_mutated: false as const,
      controlled_record_mutated: false as const,
      review_disposition: null,
      workflow_transition: null,
      human_acceptance_required: true as const,
    }) as CapaRootCauseReviewAdvisoryResponse;

    return Object.freeze({ response, trace });
  }
}
