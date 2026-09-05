import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_SUGGESTED_CAUSAL_ROLES,
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaInvestigationActiveAdvisoryAlternativeHypothesis,
  type CapaInvestigationActiveAdvisoryAssumption,
  type CapaInvestigationActiveAdvisoryCausalHypothesis,
  type CapaInvestigationActiveAdvisoryConflict,
  type CapaInvestigationActiveAdvisoryEvidenceGap,
  type CapaInvestigationActiveAdvisoryProposal,
  type CapaInvestigationActiveAdvisoryProposalKey,
  type CapaInvestigationActiveAdvisoryRecommendation,
  type CapaInvestigationActiveAdvisoryReferenceKey,
  type CapaInvestigationActiveAdvisoryUncertainty,
  type RawCapaInvestigationActiveAdvisoryModelOutput,
} from "./capa-investigation-active-advisory-contract";

const MAXIMUM_RAW_OUTPUT_CHARACTERS = 40_000;
const MAXIMUM_ITEMS = 20;
const MAXIMUM_TEXT_CHARACTERS = 1_000;

const TOP_LEVEL_FIELDS = [
  "proposal",
  "uncertainty_and_limitations",
  "citations",
  "advisory_only",
  "workflow_mutated",
  "human_acceptance_required",
] as const;

const PROPOSAL_FIELDS = [
  "evidence_gaps",
  "conflicting_information",
  "assumptions",
  "causal_hypotheses",
  "alternative_hypotheses",
  "investigation_recommendations",
] as const;

const EVIDENCE_GAP_FIELDS = [
  "proposal_key",
  "gap",
  "why_it_matters",
  "related_reference_keys",
  "recommended_next_step",
  "human_review_question",
] as const;

const CONFLICT_FIELDS = [
  "proposal_key",
  "conflict",
  "conflicting_reference_keys",
  "why_it_matters",
  "human_review_question",
] as const;

const ASSUMPTION_FIELDS = [
  "proposal_key",
  "assumption",
  "related_reference_keys",
  "verification_question",
  "human_review_question",
] as const;

const CAUSAL_HYPOTHESIS_FIELDS = [
  "proposal_key",
  "hypothesis",
  "suggested_role",
  "rationale",
  "supporting_reference_keys",
  "contradictory_reference_keys",
  "human_review_question",
] as const;

const ALTERNATIVE_HYPOTHESIS_FIELDS = [
  "proposal_key",
  "hypothesis",
  "rationale",
  "supporting_reference_keys",
  "contradictory_reference_keys",
  "human_review_question",
] as const;

const INVESTIGATION_RECOMMENDATION_FIELDS = [
  "proposal_key",
  "recommendation",
  "rationale",
  "related_reference_keys",
  "human_review_question",
] as const;

const UNCERTAINTY_FIELDS = [
  "category",
  "human_review_question",
] as const;

const EMPTY_MODEL_CITATIONS = Object.freeze([] as const);

const PROPOSAL_KEY_PATTERN = /^P[1-9][0-9]{0,2}$/;
const REFERENCE_KEY_PATTERN = /^R[1-9][0-9]{0,2}$/;

/**
 * Reject language that would convert advisory analysis into authoritative
 * S40 evidence, causal disposition, human conclusion, or workflow action.
 */
const PROHIBITED_S40_DECISION_CLAIM =
  /\bs40\s*(?:to|->|→)\s*s50\b|\b(?:workflow|case)\s+(?:state\s+)?(?:was|has been|is|should be)\s+(?:transitioned|advanced|released)\b|\b(?:advance|advanced|transition|transitioned|release|released|submit|submitted)\s+(?:this|the|a|an)?\s*(?:workflow|case|root[- ]cause(?:\s+package)?)\b|\b(?:root[- ]cause|hypothesis|evidence|assumption)\s+(?:is|was|has been)\s+(?:confirmed|approved|accepted|rejected|verified|resolved|disproven|established)\b|\b(?:confirm|confirmed|approve|approved|accept|accepted|reject|rejected|verify|verified|resolve|resolved|disprove|disproven)\s+(?:this|the|a|an)?\s*(?:root[- ]cause|hypothesis|evidence|assumption)\b/i;

const QUESTION_ASSERTION_SEPARATOR =
  /[.!?;,\:\n\r\u2028\u2029]|\s-\s|\s+[—–]\s+|\b(?:but|however|although|though|yet|while|because|since|therefore|thus)\b/i;

const QUESTION_START =
  /^(?:does|do|did|is|are|was|were|may|might|can|could|should|would|must|what|which|who|whom|whose|why|how|when|where|whether)\b/i;

const QUESTION_COMPOUND_AND_CLAUSE =
  /\band\s+(?:does|do|did|is|are|was|were|may|might|can|could|should|would|must|what|which|who|whom|whose|why|how|when|where|whether)\b/i;

export const CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_VALIDATION_REASON_CODES = [
  "EMPTY_MODEL_OUTPUT",
  "MODEL_OUTPUT_TOO_LARGE",
  "MODEL_OUTPUT_NOT_JSON",
  "MODEL_OUTPUT_NOT_OBJECT",
  "UNSUPPORTED_MODEL_OUTPUT_FIELD",
  "MISSING_MODEL_OUTPUT_FIELD",
  "INVALID_PROPOSAL",
  "INVALID_OUTPUT_TEXT",
  "INVALID_OUTPUT_LIST",
  "INVALID_ADVISORY_QUESTION",
  "INVALID_PROPOSAL_KEY",
  "DUPLICATE_PROPOSAL_KEY",
  "INVALID_REFERENCE_KEY",
  "DUPLICATE_REFERENCE_KEY",
  "INVALID_EVIDENCE_GAP",
  "INVALID_CONFLICT",
  "CONFLICT_REQUIRES_MULTIPLE_REFERENCES",
  "INVALID_ASSUMPTION",
  "INVALID_CAUSAL_HYPOTHESIS",
  "INVALID_ALTERNATIVE_HYPOTHESIS",
  "INVALID_INVESTIGATION_RECOMMENDATION",
  "INVALID_UNCERTAINTY_OR_LIMITATION",
  "INVALID_CITATIONS",
  "INVALID_ADVISORY_FLAGS",
  "PROHIBITED_S40_DECISION_CLAIM",
] as const;

export type CapaInvestigationActiveAdvisoryOutputValidationReasonCode =
  (typeof CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_VALIDATION_REASON_CODES)[number];

export class CapaInvestigationActiveAdvisoryOutputValidationError
  extends Error {
  readonly reason_code:
    CapaInvestigationActiveAdvisoryOutputValidationReasonCode;

  constructor(
    reasonCode:
      CapaInvestigationActiveAdvisoryOutputValidationReasonCode,
  ) {
    super(
      "The CAPA investigation-active advisory model output failed controlled validation.",
    );
    this.name =
      "CapaInvestigationActiveAdvisoryOutputValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(
  reasonCode:
    CapaInvestigationActiveAdvisoryOutputValidationReasonCode,
): never {
  throw new CapaInvestigationActiveAdvisoryOutputValidationError(
    reasonCode,
  );
}

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === "object" &&
    value !== null &&
    !Array.isArray(value);
}

function exactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): void {
  const expected = new Set(fields);

  for (const field of Object.keys(value)) {
    if (!expected.has(field)) {
      fail("UNSUPPORTED_MODEL_OUTPUT_FIELD");
    }
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      fail("MISSING_MODEL_OUTPUT_FIELD");
    }
  }
}

function text(value: unknown): string {
  if (typeof value !== "string") {
    fail("INVALID_OUTPUT_TEXT");
  }

  const normalized = value.normalize("NFKC").trim();

  if (
    normalized.length === 0 ||
    normalized.length > MAXIMUM_TEXT_CHARACTERS
  ) {
    fail("INVALID_OUTPUT_TEXT");
  }

  if (PROHIBITED_S40_DECISION_CLAIM.test(normalized)) {
    fail("PROHIBITED_S40_DECISION_CLAIM");
  }

  return normalized;
}

function question(value: unknown): string {
  const normalized = text(value);
  const body = normalized.slice(0, -1).trim();

  if (
    !normalized.endsWith("?") ||
    normalized.indexOf("?") !== normalized.length - 1 ||
    QUESTION_ASSERTION_SEPARATOR.test(body) ||
    QUESTION_COMPOUND_AND_CLAUSE.test(body) ||
    !QUESTION_START.test(body)
  ) {
    fail("INVALID_ADVISORY_QUESTION");
  }

  return normalized;
}

function boundedList(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ITEMS) {
    fail("INVALID_OUTPUT_LIST");
  }

  return value;
}

function proposalKey(
  value: unknown,
  used: Set<string>,
): CapaInvestigationActiveAdvisoryProposalKey {
  if (
    typeof value !== "string" ||
    !PROPOSAL_KEY_PATTERN.test(value)
  ) {
    fail("INVALID_PROPOSAL_KEY");
  }

  if (used.has(value)) {
    fail("DUPLICATE_PROPOSAL_KEY");
  }

  used.add(value);

  return value as CapaInvestigationActiveAdvisoryProposalKey;
}

function referenceKeys(
  value: unknown,
  minimum = 0,
): readonly CapaInvestigationActiveAdvisoryReferenceKey[] {
  const raw = boundedList(value);

  if (raw.length < minimum) {
    fail("CONFLICT_REQUIRES_MULTIPLE_REFERENCES");
  }

  const used = new Set<string>();

  return Object.freeze(
    raw.map((entry) => {
      if (
        typeof entry !== "string" ||
        !REFERENCE_KEY_PATTERN.test(entry)
      ) {
        fail("INVALID_REFERENCE_KEY");
      }

      if (used.has(entry)) {
        fail("DUPLICATE_REFERENCE_KEY");
      }

      used.add(entry);

      return entry as CapaInvestigationActiveAdvisoryReferenceKey;
    }),
  );
}

function evidenceGaps(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationActiveAdvisoryEvidenceGap[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_EVIDENCE_GAP");
      }

      exactFields(source, EVIDENCE_GAP_FIELDS);

      return Object.freeze({
        proposal_key: proposalKey(source.proposal_key, proposalKeys),
        gap: text(source.gap),
        why_it_matters: text(source.why_it_matters),
        related_reference_keys:
          referenceKeys(source.related_reference_keys),
        recommended_next_step:
          text(source.recommended_next_step),
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

function conflicts(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationActiveAdvisoryConflict[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_CONFLICT");
      }

      exactFields(source, CONFLICT_FIELDS);

      return Object.freeze({
        proposal_key: proposalKey(source.proposal_key, proposalKeys),
        conflict: text(source.conflict),
        conflicting_reference_keys:
          referenceKeys(source.conflicting_reference_keys, 2),
        why_it_matters: text(source.why_it_matters),
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

function assumptions(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationActiveAdvisoryAssumption[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_ASSUMPTION");
      }

      exactFields(source, ASSUMPTION_FIELDS);

      return Object.freeze({
        proposal_key: proposalKey(source.proposal_key, proposalKeys),
        assumption: text(source.assumption),
        related_reference_keys:
          referenceKeys(source.related_reference_keys),
        verification_question:
          question(source.verification_question),
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

function causalHypotheses(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationActiveAdvisoryCausalHypothesis[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_CAUSAL_HYPOTHESIS");
      }

      exactFields(source, CAUSAL_HYPOTHESIS_FIELDS);

      if (
        !CAPA_INVESTIGATION_ACTIVE_ADVISORY_SUGGESTED_CAUSAL_ROLES.includes(
          source.suggested_role as never,
        )
      ) {
        fail("INVALID_CAUSAL_HYPOTHESIS");
      }

      return Object.freeze({
        proposal_key: proposalKey(source.proposal_key, proposalKeys),
        hypothesis: text(source.hypothesis),
        suggested_role:
          source.suggested_role as
            CapaInvestigationActiveAdvisoryCausalHypothesis["suggested_role"],
        rationale: text(source.rationale),
        supporting_reference_keys:
          referenceKeys(source.supporting_reference_keys),
        contradictory_reference_keys:
          referenceKeys(source.contradictory_reference_keys),
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

function alternativeHypotheses(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationActiveAdvisoryAlternativeHypothesis[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_ALTERNATIVE_HYPOTHESIS");
      }

      exactFields(source, ALTERNATIVE_HYPOTHESIS_FIELDS);

      return Object.freeze({
        proposal_key: proposalKey(source.proposal_key, proposalKeys),
        hypothesis: text(source.hypothesis),
        rationale: text(source.rationale),
        supporting_reference_keys:
          referenceKeys(source.supporting_reference_keys),
        contradictory_reference_keys:
          referenceKeys(source.contradictory_reference_keys),
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

function investigationRecommendations(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationActiveAdvisoryRecommendation[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_INVESTIGATION_RECOMMENDATION");
      }

      exactFields(source, INVESTIGATION_RECOMMENDATION_FIELDS);

      return Object.freeze({
        proposal_key: proposalKey(source.proposal_key, proposalKeys),
        recommendation: text(source.recommendation),
        rationale: text(source.rationale),
        related_reference_keys:
          referenceKeys(source.related_reference_keys),
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

function proposal(
  value: unknown,
): CapaInvestigationActiveAdvisoryProposal {
  if (!isRecord(value)) {
    fail("INVALID_PROPOSAL");
  }

  exactFields(value, PROPOSAL_FIELDS);

  const proposalKeys = new Set<string>();

  return Object.freeze({
    evidence_gaps:
      evidenceGaps(value.evidence_gaps, proposalKeys),
    conflicting_information:
      conflicts(value.conflicting_information, proposalKeys),
    assumptions:
      assumptions(value.assumptions, proposalKeys),
    causal_hypotheses:
      causalHypotheses(value.causal_hypotheses, proposalKeys),
    alternative_hypotheses:
      alternativeHypotheses(
        value.alternative_hypotheses,
        proposalKeys,
      ),
    investigation_recommendations:
      investigationRecommendations(
        value.investigation_recommendations,
        proposalKeys,
      ),
  });
}

function uncertainties(
  value: unknown,
): readonly CapaInvestigationActiveAdvisoryUncertainty[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_UNCERTAINTY_OR_LIMITATION");
      }

      exactFields(source, UNCERTAINTY_FIELDS);

      if (
        !CAPA_INVESTIGATION_ACTIVE_ADVISORY_UNCERTAINTY_CATEGORIES.includes(
          source.category as never,
        )
      ) {
        fail("INVALID_UNCERTAINTY_OR_LIMITATION");
      }

      return Object.freeze({
        category:
          source.category as
            CapaInvestigationActiveAdvisoryUncertainty["category"],
        human_review_question:
          question(source.human_review_question),
      });
    }),
  );
}

export function validateCapaInvestigationActiveAdvisoryModelOutput(
  rawOutput: string,
): RawCapaInvestigationActiveAdvisoryModelOutput {
  if (
    typeof rawOutput !== "string" ||
    rawOutput.trim().length === 0
  ) {
    fail("EMPTY_MODEL_OUTPUT");
  }

  const normalized = rawOutput.trim();

  if (normalized.length > MAXIMUM_RAW_OUTPUT_CHARACTERS) {
    fail("MODEL_OUTPUT_TOO_LARGE");
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(normalized);
  } catch {
    fail("MODEL_OUTPUT_NOT_JSON");
  }

  if (!isRecord(parsed)) {
    fail("MODEL_OUTPUT_NOT_OBJECT");
  }

  exactFields(parsed, TOP_LEVEL_FIELDS);

  if (
    parsed.advisory_only !== true ||
    parsed.workflow_mutated !== false ||
    parsed.human_acceptance_required !== true
  ) {
    fail("INVALID_ADVISORY_FLAGS");
  }

  if (
    !Array.isArray(parsed.citations) ||
    parsed.citations.length !== 0
  ) {
    fail("INVALID_CITATIONS");
  }

  return Object.freeze({
    proposal: proposal(parsed.proposal),
    uncertainty_and_limitations:
      uncertainties(parsed.uncertainty_and_limitations),
    citations: EMPTY_MODEL_CITATIONS,
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
  });
}
