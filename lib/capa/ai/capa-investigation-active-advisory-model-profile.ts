import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_SUGGESTED_CAUSAL_ROLES,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_UNCERTAINTY_CATEGORIES,
} from "./capa-investigation-active-advisory-contract";

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE =
  Object.freeze({
    profile_version: "capa-investigation-active-model-profile-1.0.0" as const,
    output_schema_name:
      "capa_investigation_active_advisory_1_0_0" as const,
    output_schema_version:
      CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
    maximum_output_characters: 40_000,
  });

const MAXIMUM_ITEMS = 20;
const MAXIMUM_TEXT_CHARACTERS = 1_000;

const text = {
  type: "string",
  minLength: 1,
  maxLength: MAXIMUM_TEXT_CHARACTERS,
} as const;

const proposalKey = {
  type: "string",
  pattern: "^P[1-9][0-9]{0,2}$",
} as const;

const referenceKey = {
  type: "string",
  pattern: "^R[1-9][0-9]{0,2}$",
} as const;

const referenceKeys = (minimumItems = 0) => ({
  type: "array",
  minItems: minimumItems,
  maxItems: MAXIMUM_ITEMS,
  items: referenceKey,
} as const);

const evidenceGap = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "gap",
    "why_it_matters",
    "related_reference_keys",
    "recommended_next_step",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    gap: text,
    why_it_matters: text,
    related_reference_keys: referenceKeys(),
    recommended_next_step: text,
    human_review_question: text,
  },
} as const;

const conflict = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "conflict",
    "conflicting_reference_keys",
    "why_it_matters",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    conflict: text,
    conflicting_reference_keys: referenceKeys(2),
    why_it_matters: text,
    human_review_question: text,
  },
} as const;

const assumption = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "assumption",
    "related_reference_keys",
    "verification_question",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    assumption: text,
    related_reference_keys: referenceKeys(),
    verification_question: text,
    human_review_question: text,
  },
} as const;

const causalHypothesis = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "hypothesis",
    "suggested_role",
    "rationale",
    "supporting_reference_keys",
    "contradictory_reference_keys",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    hypothesis: text,
    suggested_role: {
      type: "string",
      enum: [
        ...CAPA_INVESTIGATION_ACTIVE_ADVISORY_SUGGESTED_CAUSAL_ROLES,
      ],
    },
    rationale: text,
    supporting_reference_keys: referenceKeys(),
    contradictory_reference_keys: referenceKeys(),
    human_review_question: text,
  },
} as const;

const alternativeHypothesis = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "hypothesis",
    "rationale",
    "supporting_reference_keys",
    "contradictory_reference_keys",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    hypothesis: text,
    rationale: text,
    supporting_reference_keys: referenceKeys(),
    contradictory_reference_keys: referenceKeys(),
    human_review_question: text,
  },
} as const;

const recommendation = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "recommendation",
    "rationale",
    "related_reference_keys",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    recommendation: text,
    rationale: text,
    related_reference_keys: referenceKeys(),
    human_review_question: text,
  },
} as const;

const boundedArray = <T>(items: T) => ({
  type: "array",
  maxItems: MAXIMUM_ITEMS,
  items,
} as const);

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "proposal",
      "uncertainty_and_limitations",
      "citations",
      "advisory_only",
      "workflow_mutated",
      "human_acceptance_required",
    ],
    properties: {
      proposal: {
        type: "object",
        additionalProperties: false,
        required: [
          ...CAPA_INVESTIGATION_ACTIVE_ADVISORY_PROPOSAL_FIELDS,
        ],
        properties: {
          evidence_gaps: boundedArray(evidenceGap),
          conflicting_information: boundedArray(conflict),
          assumptions: boundedArray(assumption),
          causal_hypotheses: boundedArray(causalHypothesis),
          alternative_hypotheses: boundedArray(alternativeHypothesis),
          investigation_recommendations: boundedArray(recommendation),
        },
      },
      uncertainty_and_limitations: boundedArray({
        type: "object",
        additionalProperties: false,
        required: ["category", "human_review_question"],
        properties: {
          category: {
            type: "string",
            enum: [
              ...CAPA_INVESTIGATION_ACTIVE_ADVISORY_UNCERTAINTY_CATEGORIES,
            ],
          },
          human_review_question: text,
        },
      }),
      citations: {
        type: "array",
        maxItems: 0,
        items: { type: "string" },
      },
      advisory_only: { type: "boolean", const: true },
      workflow_mutated: { type: "boolean", const: false },
      human_acceptance_required: { type: "boolean", const: true },
    },
    description: `Strict structured output for ${CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT} at ${CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION}.`,
  } as const);

export interface CapaInvestigationActiveAdvisoryStructuredModelClient {
  generateStructured(input: {
    readonly prompt: string;
    readonly model_profile_version:
      typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.profile_version;
    readonly output_schema_name:
      typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.output_schema_name;
    readonly output_schema:
      typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_JSON_SCHEMA;
    readonly maximum_output_characters:
      typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_MODEL_PROFILE.maximum_output_characters;
    readonly store: false;
  }): Promise<{
    readonly output_text: string;
  }>;
}
