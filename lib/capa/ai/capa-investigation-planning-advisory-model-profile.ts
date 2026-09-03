import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS,
  CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES,
} from "./capa-investigation-planning-advisory-contract";

export const CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE =
  Object.freeze({
    profile_version: "capa-model-profile-1.0.0" as const,
    output_schema_name:
      "capa_investigation_planning_advisory_1_0_0" as const,
    output_schema_version:
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
    maximum_output_characters: 30_000,
  });

const MAXIMUM_ITEMS = 20;
const MAXIMUM_TEXT_CHARACTERS = 1_000;

const text = {
  type: "string",
  minLength: 1,
  maxLength: MAXIMUM_TEXT_CHARACTERS,
} as const;

const question = text;

const proposalKey = {
  type: "string",
  pattern: "^P[1-9][0-9]{0,2}$",
} as const;

const humanReviewQuestion = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "investigation_question",
    "scope_relationship",
    "due_date_consideration",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    investigation_question: text,
    scope_relationship: text,
    due_date_consideration: text,
    human_review_question: question,
  },
} as const;

const evidenceRequest = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "evidence_target",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    evidence_target: text,
    human_review_question: question,
  },
} as const;

const methodSuggestion = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "investigation_method",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    investigation_method: text,
    human_review_question: question,
  },
} as const;

const dependency = {
  type: "object",
  additionalProperties: false,
  required: [
    "dependent_proposal_key",
    "prerequisite_proposal_key",
    "sequencing_recommendation",
    "human_review_question",
  ],
  properties: {
    dependent_proposal_key: proposalKey,
    prerequisite_proposal_key: proposalKey,
    sequencing_recommendation: text,
    human_review_question: question,
  },
} as const;

const ownerRole = {
  type: "object",
  additionalProperties: false,
  required: [
    "proposal_key",
    "proposed_owner_role",
    "suggested_sme_function",
    "human_review_question",
  ],
  properties: {
    proposal_key: proposalKey,
    proposed_owner_role: text,
    suggested_sme_function: text,
    human_review_question: question,
  },
} as const;

const gap = {
  type: "object",
  additionalProperties: false,
  required: ["gap", "human_review_question"],
  properties: {
    gap: text,
    human_review_question: question,
  },
} as const;

const assumption = {
  type: "object",
  additionalProperties: false,
  required: ["unverified", "related_area", "verification_question"],
  properties: {
    unverified: { type: "boolean", const: true },
    related_area: {
      type: "string",
      enum: [...CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS],
    },
    verification_question: question,
  },
} as const;

const uncertainty = {
  type: "object",
  additionalProperties: false,
  required: ["category", "human_review_question"],
  properties: {
    category: {
      type: "string",
      enum: [...CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES],
    },
    human_review_question: question,
  },
} as const;

const boundedArray = <T>(items: T) => ({
  type: "array",
  maxItems: MAXIMUM_ITEMS,
  items,
} as const);

export const CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA =
  Object.freeze({
    type: "object",
    additionalProperties: false,
    required: [
      "proposal",
      "assumptions",
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
        required: [...CAPA_INVESTIGATION_PLAN_ADVISORY_PROPOSAL_FIELDS],
        properties: {
          investigation_questions: boundedArray(humanReviewQuestion),
          evidence_requests: boundedArray(evidenceRequest),
          method_suggestions: boundedArray(methodSuggestion),
          dependencies: boundedArray(dependency),
          proposed_owner_role: boundedArray(ownerRole),
          gaps: boundedArray(gap),
        },
      },
      assumptions: boundedArray(assumption),
      uncertainty_and_limitations: boundedArray(uncertainty),
      citations: {
        type: "array",
        maxItems: 0,
        items: { type: "string" },
      },
      advisory_only: { type: "boolean", const: true },
      workflow_mutated: { type: "boolean", const: false },
      human_acceptance_required: { type: "boolean", const: true },
    },
    description: `Strict structured output for ${CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT} at ${CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION}.`,
  } as const);

export interface CapaInvestigationPlanningAdvisoryStructuredModelClient {
  generateStructured(input: {
    readonly prompt: string;
    readonly model_profile_version:
      typeof CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.profile_version;
    readonly output_schema_name:
      typeof CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.output_schema_name;
    readonly output_schema:
      typeof CAPA_INVESTIGATION_PLAN_ADVISORY_JSON_SCHEMA;
    readonly maximum_output_characters:
      typeof CAPA_INVESTIGATION_PLAN_ADVISORY_MODEL_PROFILE.maximum_output_characters;
    readonly store: false;
  }): Promise<{
    readonly output_text: string;
  }>;
}
