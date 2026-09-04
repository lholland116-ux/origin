import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS,
  CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaInvestigationPlanAdvisoryAssumption,
  type CapaInvestigationPlanAdvisoryDependency,
  type CapaInvestigationPlanAdvisoryEvidenceRequest,
  type CapaInvestigationPlanAdvisoryGap,
  type CapaInvestigationPlanAdvisoryInvestigationQuestion,
  type CapaInvestigationPlanAdvisoryMethodSuggestion,
  type CapaInvestigationPlanAdvisoryOwnerRole,
  type CapaInvestigationPlanAdvisoryProposalKey,
  type CapaInvestigationPlanAdvisoryProposal,
  type CapaInvestigationPlanAdvisoryUncertainty,
  type RawCapaInvestigationPlanAdvisoryModelOutput,
} from "./capa-investigation-planning-advisory-contract";

const MAXIMUM_RAW_OUTPUT_CHARACTERS = 30_000;
const MAXIMUM_ITEMS = 20;
const MAXIMUM_TEXT_CHARACTERS = 1_000;

const TOP_LEVEL_FIELDS = [
  "proposal",
  "assumptions",
  "uncertainty_and_limitations",
  "citations",
  "advisory_only",
  "workflow_mutated",
  "human_acceptance_required",
] as const;

const PROPOSAL_FIELDS = [
  "investigation_questions",
  "evidence_requests",
  "method_suggestions",
  "dependencies",
  "proposed_owner_role",
  "gaps",
] as const;

const INVESTIGATION_QUESTION_FIELDS = [
  "proposal_key",
  "investigation_question",
  "scope_relationship",
  "due_date_consideration",
  "human_review_question",
] as const;

const EVIDENCE_REQUEST_FIELDS = [
  "proposal_key",
  "evidence_target",
  "human_review_question",
] as const;

const METHOD_SUGGESTION_FIELDS = [
  "proposal_key",
  "investigation_method",
  "human_review_question",
] as const;

const DEPENDENCY_FIELDS = [
  "dependent_proposal_key",
  "prerequisite_proposal_key",
  "sequencing_recommendation",
  "human_review_question",
] as const;

const OWNER_ROLE_FIELDS = [
  "proposal_key",
  "proposed_owner_role",
  "suggested_sme_function",
  "human_review_question",
] as const;

const GAP_FIELDS = [
  "gap",
  "human_review_question",
] as const;

const ASSUMPTION_FIELDS = [
  "unverified",
  "related_area",
  "verification_question",
] as const;

const UNCERTAINTY_FIELDS = [
  "category",
  "human_review_question",
] as const;

const EMPTY_MODEL_CITATIONS = Object.freeze([] as const);
const PROPOSAL_KEY_PATTERN = /^P[1-9][0-9]{0,2}$/;

/** Claims that would turn a planning recommendation into an authority claim. */
const PROHIBITED_S30_DECISION_CLAIM =
  /\b(?:g[\s-]?03|s30\s*(?:to|->|→)\s*s40)\b|\bworkflow\s+(?:state\s+)?(?:was|has been|is|should be)\s+(?:transitioned|advanced)|\b(?:approve|approved|approval|release|released|adopt|adopted|adoption|advance|advanced|transition|transitioned)\s+(?:this|the|a|an|plan|workflow|case|record)\b|\b(?:this|the|a|an)\s+(?:plan|workflow|case|record)\s+(?:is|was|has been)\s+(?:approved|released|adopted|advanced|transitioned)\b/i;

const QUESTION_ASSERTION_SEPARATOR =
  /[.!?;,\:\n\r\u2028\u2029]|\s-\s|\s+[—–]\s+|\b(?:but|however|although|though|yet|while|because|since|therefore|thus)\b/i;

const QUESTION_START =
  /^(?:does|do|did|is|are|was|were|may|might|can|could|should|must|what|which|who|whom|whose|why|how|when|where|whether)\b/i;

const QUESTION_COMPOUND_AND_CLAUSE =
  /\band\s+(?:does|do|did|is|are|was|were|may|might|can|could|should|must|what|which|who|whom|whose|why|how|when|where|whether)\b/i;

export const CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_VALIDATION_REASON_CODES = [
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
  "UNKNOWN_PROPOSAL_KEY",
  "INVALID_INVESTIGATION_QUESTION",
  "INVALID_EVIDENCE_REQUEST",
  "INVALID_METHOD_SUGGESTION",
  "INVALID_DEPENDENCY",
  "SELF_DEPENDENCY",
  "DUPLICATE_DEPENDENCY_EDGE",
  "DEPENDENCY_CYCLE",
  "INVALID_OWNER_ROLE",
  "INVALID_GAP",
  "INVALID_ASSUMPTION",
  "INVALID_UNCERTAINTY_OR_LIMITATION",
  "INVALID_CITATIONS",
  "INVALID_ADVISORY_FLAGS",
  "PROHIBITED_S30_DECISION_CLAIM",
] as const;

export type CapaInvestigationPlanAdvisoryOutputValidationReasonCode =
  (typeof CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_VALIDATION_REASON_CODES)[number];

export class CapaInvestigationPlanAdvisoryOutputValidationError
  extends Error {
  readonly reason_code:
    CapaInvestigationPlanAdvisoryOutputValidationReasonCode;

  constructor(
    reasonCode:
      CapaInvestigationPlanAdvisoryOutputValidationReasonCode,
  ) {
    super(
      "The CAPA investigation-planning advisory model output failed controlled validation.",
    );
    this.name =
      "CapaInvestigationPlanAdvisoryOutputValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(
  reasonCode:
    CapaInvestigationPlanAdvisoryOutputValidationReasonCode,
): never {
  throw new CapaInvestigationPlanAdvisoryOutputValidationError(
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

function text(
  value: unknown,
): string {
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

  if (PROHIBITED_S30_DECISION_CLAIM.test(normalized)) {
    fail("PROHIBITED_S30_DECISION_CLAIM");
  }

  return normalized;
}

function proposalKey(
  value: unknown,
): CapaInvestigationPlanAdvisoryProposalKey {
  if (
    typeof value !== "string" ||
    !PROPOSAL_KEY_PATTERN.test(value)
  ) {
    fail("INVALID_PROPOSAL_KEY");
  }

  return value as CapaInvestigationPlanAdvisoryProposalKey;
}

function referencedProposalKey(
  value: unknown,
  proposalKeys: ReadonlySet<string>,
): CapaInvestigationPlanAdvisoryProposalKey {
  const key = proposalKey(value);

  if (!proposalKeys.has(key)) {
    fail("UNKNOWN_PROPOSAL_KEY");
  }

  return key;
}

function question(
  value: unknown,
): string {
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

function boundedList(
  value: unknown,
): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ITEMS) {
    fail("INVALID_OUTPUT_LIST");
  }

  return value;
}

function investigationQuestions(
  value: unknown,
  proposalKeys: Set<string>,
): readonly CapaInvestigationPlanAdvisoryInvestigationQuestion[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_INVESTIGATION_QUESTION");
      }

      exactFields(source, INVESTIGATION_QUESTION_FIELDS);

      const key = proposalKey(source.proposal_key);

      if (proposalKeys.has(key)) {
        fail("DUPLICATE_PROPOSAL_KEY");
      }

      proposalKeys.add(key);

      return Object.freeze({
        proposal_key: key,
        investigation_question: question(source.investigation_question),
        scope_relationship: text(source.scope_relationship),
        due_date_consideration: question(source.due_date_consideration),
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

function evidenceRequests(
  value: unknown,
  proposalKeys: ReadonlySet<string>,
): readonly CapaInvestigationPlanAdvisoryEvidenceRequest[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_EVIDENCE_REQUEST");
      }

      exactFields(source, EVIDENCE_REQUEST_FIELDS);

      return Object.freeze({
        proposal_key: referencedProposalKey(
          source.proposal_key,
          proposalKeys,
        ),
        evidence_target: text(source.evidence_target),
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

function methodSuggestions(
  value: unknown,
  proposalKeys: ReadonlySet<string>,
): readonly CapaInvestigationPlanAdvisoryMethodSuggestion[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_METHOD_SUGGESTION");
      }

      exactFields(source, METHOD_SUGGESTION_FIELDS);

      return Object.freeze({
        proposal_key: referencedProposalKey(
          source.proposal_key,
          proposalKeys,
        ),
        investigation_method: text(source.investigation_method),
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

function dependencies(
  value: unknown,
  proposalKeys: ReadonlySet<string>,
): readonly CapaInvestigationPlanAdvisoryDependency[] {
  const edges = new Set<string>();

  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_DEPENDENCY");
      }

      exactFields(source, DEPENDENCY_FIELDS);

      const dependent = referencedProposalKey(
        source.dependent_proposal_key,
        proposalKeys,
      );
      const prerequisite = referencedProposalKey(
        source.prerequisite_proposal_key,
        proposalKeys,
      );

      if (dependent === prerequisite) {
        fail("SELF_DEPENDENCY");
      }

      const edge = `${dependent}\u0000${prerequisite}`;
      if (edges.has(edge)) {
        fail("DUPLICATE_DEPENDENCY_EDGE");
      }
      edges.add(edge);

      return Object.freeze({
        dependent_proposal_key: dependent,
        prerequisite_proposal_key: prerequisite,
        sequencing_recommendation: text(source.sequencing_recommendation),
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

function hasDependencyCycle(
  dependencyList: readonly CapaInvestigationPlanAdvisoryDependency[],
): boolean {
  const graph = new Map<string, readonly string[]>();

  for (const dependency of dependencyList) {
    const current = graph.get(dependency.dependent_proposal_key) ?? [];
    graph.set(
      dependency.dependent_proposal_key,
      [...current, dependency.prerequisite_proposal_key],
    );
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string): boolean {
    if (visiting.has(key)) {
      return true;
    }

    if (visited.has(key)) {
      return false;
    }

    visiting.add(key);

    for (const prerequisite of graph.get(key) ?? []) {
      if (visit(prerequisite)) {
        return true;
      }
    }

    visiting.delete(key);
    visited.add(key);
    return false;
  }

  return [...graph.keys()].some(visit);
}

function proposedOwnerRoles(
  value: unknown,
  proposalKeys: ReadonlySet<string>,
): readonly CapaInvestigationPlanAdvisoryOwnerRole[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_OWNER_ROLE");
      }

      exactFields(source, OWNER_ROLE_FIELDS);

      return Object.freeze({
        proposal_key: referencedProposalKey(
          source.proposal_key,
          proposalKeys,
        ),
        proposed_owner_role: text(source.proposed_owner_role),
        suggested_sme_function: text(source.suggested_sme_function),
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

function gaps(
  value: unknown,
): readonly CapaInvestigationPlanAdvisoryGap[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_GAP");
      }

      exactFields(source, GAP_FIELDS);

      return Object.freeze({
        gap: text(source.gap),
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

function proposal(
  value: unknown,
): CapaInvestigationPlanAdvisoryProposal {
  if (!isRecord(value)) {
    fail("INVALID_PROPOSAL");
  }

  exactFields(value, PROPOSAL_FIELDS);

  const proposalKeys = new Set<string>();
  const parsedInvestigationQuestions = investigationQuestions(
    value.investigation_questions,
    proposalKeys,
  );
  const parsedDependencies = dependencies(
    value.dependencies,
    proposalKeys,
  );

  if (hasDependencyCycle(parsedDependencies)) {
    fail("DEPENDENCY_CYCLE");
  }

  return Object.freeze({
    investigation_questions: parsedInvestigationQuestions,
    evidence_requests: evidenceRequests(
      value.evidence_requests,
      proposalKeys,
    ),
    method_suggestions: methodSuggestions(
      value.method_suggestions,
      proposalKeys,
    ),
    dependencies: parsedDependencies,
    proposed_owner_role: proposedOwnerRoles(
      value.proposed_owner_role,
      proposalKeys,
    ),
    gaps: gaps(value.gaps),
  });
}

function assumptions(
  value: unknown,
): readonly CapaInvestigationPlanAdvisoryAssumption[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_ASSUMPTION");
      }

      exactFields(source, ASSUMPTION_FIELDS);

      if (
        source.unverified !== true ||
        !CAPA_INVESTIGATION_PLAN_ADVISORY_ASSUMPTION_AREAS.includes(
          source.related_area as never,
        )
      ) {
        fail("INVALID_ASSUMPTION");
      }

      return Object.freeze({
        unverified: true as const,
        related_area: source.related_area as CapaInvestigationPlanAdvisoryAssumption["related_area"],
        verification_question: question(source.verification_question),
      });
    }),
  );
}

function uncertainties(
  value: unknown,
): readonly CapaInvestigationPlanAdvisoryUncertainty[] {
  return Object.freeze(
    boundedList(value).map((source) => {
      if (!isRecord(source)) {
        fail("INVALID_UNCERTAINTY_OR_LIMITATION");
      }

      exactFields(source, UNCERTAINTY_FIELDS);

      if (
        !CAPA_INVESTIGATION_PLAN_ADVISORY_UNCERTAINTY_CATEGORIES.includes(
          source.category as never,
        )
      ) {
        fail("INVALID_UNCERTAINTY_OR_LIMITATION");
      }

      return Object.freeze({
        category: source.category as CapaInvestigationPlanAdvisoryUncertainty["category"],
        human_review_question: question(source.human_review_question),
      });
    }),
  );
}

export function validateCapaInvestigationPlanAdvisoryModelOutput(
  rawOutput: string,
): RawCapaInvestigationPlanAdvisoryModelOutput {
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
    assumptions: assumptions(parsed.assumptions),
    uncertainty_and_limitations: uncertainties(
      parsed.uncertainty_and_limitations,
    ),
    citations: EMPTY_MODEL_CITATIONS,
    advisory_only: true,
    workflow_mutated: false,
    human_acceptance_required: true,
  });
}
