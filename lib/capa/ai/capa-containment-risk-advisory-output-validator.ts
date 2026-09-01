import {
  CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES,
  CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS,
  CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS,
  CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS,
  CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaContainmentRiskAdvisoryEvidenceGap,
  type CapaContainmentRiskAdvisoryMissingImpactDimension,
  type CapaContainmentRiskAdvisoryMissingRiskInput,
  type CapaContainmentRiskAdvisoryProposal,
  type CapaContainmentRiskAdvisoryUnverifiedAssumption,
  type CapaContainmentRiskAdvisoryUncertainty,
  type RawCapaContainmentRiskAdvisoryModelOutput,
} from "./capa-containment-risk-advisory-contract";

const MAXIMUM_RAW_OUTPUT_CHARACTERS = 30_000;
const MAXIMUM_ITEMS = 20;
const MAXIMUM_TEXT_CHARACTERS = 1_000;
const EMPTY_MODEL_CITATIONS = Object.freeze([] as const);
const TOP_LEVEL_FIELDS = ["proposal", "assumptions", "uncertainty_and_limitations", "citations", "advisory_only", "workflow_mutated", "human_acceptance_required"] as const;
const PROPOSAL_FIELDS = ["missing_risk_inputs", "missing_impact_dimensions", "human_review_questions", "evidence_provenance_gaps"] as const;
const QUESTION_ASSERTION_SEPARATOR = /[.!?;,:\n\r\u2028\u2029]|\s-\s|\band\b|\s+[—–]\s+|\b(?:but|however|although|though|yet|while|because|since|therefore|thus)\b/i;

export const CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT_VALIDATION_REASON_CODES = ["EMPTY_MODEL_OUTPUT", "MODEL_OUTPUT_TOO_LARGE", "MODEL_OUTPUT_NOT_JSON", "MODEL_OUTPUT_NOT_OBJECT", "UNSUPPORTED_MODEL_OUTPUT_FIELD", "MISSING_MODEL_OUTPUT_FIELD", "INVALID_PROPOSAL", "INVALID_OUTPUT_TEXT", "INVALID_OUTPUT_LIST", "INVALID_ADVISORY_QUESTION", "INVALID_MISSING_RISK_INPUT", "INVALID_IMPACT_DIMENSION", "INVALID_EVIDENCE_GAP", "INVALID_UNVERIFIED_ASSUMPTION", "INVALID_UNCERTAINTY_OR_LIMITATION", "INVALID_CITATIONS", "INVALID_ADVISORY_FLAGS", "PROHIBITED_S20_DECISION_CLAIM"] as const;
export type CapaContainmentRiskAdvisoryOutputValidationReasonCode = (typeof CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT_VALIDATION_REASON_CODES)[number];

export class CapaContainmentRiskAdvisoryOutputValidationError extends Error {
  readonly reason_code: CapaContainmentRiskAdvisoryOutputValidationReasonCode;
  constructor(reasonCode: CapaContainmentRiskAdvisoryOutputValidationReasonCode) {
    super("The CAPA containment/risk advisory model output failed controlled validation.");
    this.name = "CapaContainmentRiskAdvisoryOutputValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(reasonCode: CapaContainmentRiskAdvisoryOutputValidationReasonCode): never { throw new CapaContainmentRiskAdvisoryOutputValidationError(reasonCode); }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, fields: readonly string[]): void {
  const expected = new Set(fields);
  for (const field of Object.keys(value)) if (!expected.has(field)) fail("UNSUPPORTED_MODEL_OUTPUT_FIELD");
  for (const field of fields) if (!Object.prototype.hasOwnProperty.call(value, field)) fail("MISSING_MODEL_OUTPUT_FIELD");
}
function text(value: unknown): string {
  if (typeof value !== "string") fail("INVALID_OUTPUT_TEXT");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0 || normalized.length > MAXIMUM_TEXT_CHARACTERS) fail("INVALID_OUTPUT_TEXT");
  return normalized;
}
function list(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ITEMS) fail("INVALID_OUTPUT_LIST");
  return value;
}
function question(value: unknown): string {
  const normalized = text(value);
  const body = normalized.slice(0, -1).trim();
  if (!normalized.endsWith("?") || normalized.indexOf("?") !== normalized.length - 1 || QUESTION_ASSERTION_SEPARATOR.test(body) || !/^(?:does|do|is|are|may|can|could|should|must|what|which|who|how|when|where|whether)\b/i.test(body)) fail("INVALID_ADVISORY_QUESTION");
  return normalized;
}
function missingRiskInputs(value: unknown): readonly CapaContainmentRiskAdvisoryMissingRiskInput[] {
  return Object.freeze(list(value).map((item) => {
    if (!isRecord(item)) fail("INVALID_MISSING_RISK_INPUT");
    exact(item, ["topic", "human_review_question"]);
    if (!CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS.includes(item.topic as never)) fail("INVALID_MISSING_RISK_INPUT");
    return Object.freeze({ topic: item.topic as CapaContainmentRiskAdvisoryMissingRiskInput["topic"], human_review_question: question(item.human_review_question) });
  }));
}
function missingImpactDimensions(value: unknown): readonly CapaContainmentRiskAdvisoryMissingImpactDimension[] {
  return Object.freeze(list(value).map((item) => {
    if (!isRecord(item)) fail("INVALID_IMPACT_DIMENSION");
    exact(item, ["dimension", "human_review_question"]);
    if (!CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS.includes(item.dimension as never)) fail("INVALID_IMPACT_DIMENSION");
    return Object.freeze({ dimension: item.dimension as CapaContainmentRiskAdvisoryMissingImpactDimension["dimension"], human_review_question: question(item.human_review_question) });
  }));
}
function evidenceGaps(value: unknown): readonly CapaContainmentRiskAdvisoryEvidenceGap[] {
  return Object.freeze(list(value).map((item) => {
    if (!isRecord(item)) fail("INVALID_EVIDENCE_GAP");
    exact(item, ["category", "human_review_question"]);
    if (!CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES.includes(item.category as never)) fail("INVALID_EVIDENCE_GAP");
    return Object.freeze({ category: item.category as CapaContainmentRiskAdvisoryEvidenceGap["category"], human_review_question: question(item.human_review_question) });
  }));
}
function assumptions(value: unknown): readonly CapaContainmentRiskAdvisoryUnverifiedAssumption[] {
  return Object.freeze(list(value).map((item) => {
    if (!isRecord(item)) fail("INVALID_UNVERIFIED_ASSUMPTION");
    exact(item, ["unverified", "related_area", "verification_question"]);
    if (item.unverified !== true) fail("INVALID_UNVERIFIED_ASSUMPTION");
    if (!CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS.includes(item.related_area as never)) fail("INVALID_UNVERIFIED_ASSUMPTION");
    return Object.freeze({ unverified: true as const, related_area: item.related_area as CapaContainmentRiskAdvisoryUnverifiedAssumption["related_area"], verification_question: question(item.verification_question) });
  }));
}
function uncertainties(value: unknown): readonly CapaContainmentRiskAdvisoryUncertainty[] {
  return Object.freeze(list(value).map((item) => {
    if (!isRecord(item)) fail("INVALID_UNCERTAINTY_OR_LIMITATION");
    exact(item, ["category", "human_review_question"]);
    if (!CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES.includes(item.category as never)) fail("INVALID_UNCERTAINTY_OR_LIMITATION");
    return Object.freeze({ category: item.category as CapaContainmentRiskAdvisoryUncertainty["category"], human_review_question: question(item.human_review_question) });
  }));
}
function proposal(value: unknown): CapaContainmentRiskAdvisoryProposal {
  if (!isRecord(value)) fail("INVALID_PROPOSAL");
  exact(value, PROPOSAL_FIELDS);
  return Object.freeze({ missing_risk_inputs: missingRiskInputs(value.missing_risk_inputs), missing_impact_dimensions: missingImpactDimensions(value.missing_impact_dimensions), human_review_questions: Object.freeze(list(value.human_review_questions).map(question)), evidence_provenance_gaps: evidenceGaps(value.evidence_provenance_gaps) });
}

export function validateCapaContainmentRiskAdvisoryModelOutput(rawOutput: string): RawCapaContainmentRiskAdvisoryModelOutput {
  if (typeof rawOutput !== "string" || rawOutput.trim().length === 0) fail("EMPTY_MODEL_OUTPUT");
  const normalized = rawOutput.trim();
  if (normalized.length > MAXIMUM_RAW_OUTPUT_CHARACTERS) fail("MODEL_OUTPUT_TOO_LARGE");
  let parsed: unknown;
  try { parsed = JSON.parse(normalized); } catch { fail("MODEL_OUTPUT_NOT_JSON"); }
  if (!isRecord(parsed)) fail("MODEL_OUTPUT_NOT_OBJECT");
  exact(parsed, TOP_LEVEL_FIELDS);
  if (parsed.advisory_only !== true || parsed.workflow_mutated !== false || parsed.human_acceptance_required !== true) fail("INVALID_ADVISORY_FLAGS");
  if (!Array.isArray(parsed.citations) || parsed.citations.length !== 0) fail("INVALID_CITATIONS");
  return Object.freeze({ proposal: proposal(parsed.proposal), assumptions: assumptions(parsed.assumptions), uncertainty_and_limitations: uncertainties(parsed.uncertainty_and_limitations), citations: EMPTY_MODEL_CITATIONS, advisory_only: true, workflow_mutated: false, human_acceptance_required: true });
}
