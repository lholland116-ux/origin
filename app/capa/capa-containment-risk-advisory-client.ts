import type {
  CapaContainmentRiskContent,
} from "../../lib/capa/domain/capa-containment-risk";

import {
  CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS,
  CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES,
  CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS,
  CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS,
  CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES,
  type CapaContainmentRiskAdvisoryAssumptionArea,
  type CapaContainmentRiskAdvisoryEvidenceGapCategory,
  type CapaContainmentRiskAdvisoryImpactDimension,
  type CapaContainmentRiskAdvisoryRiskInputTopic,
  type CapaContainmentRiskAdvisoryUncertaintyCategory,
} from "../../lib/capa/ai/capa-containment-risk-advisory-contract";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const SUCCESS_FIELDS = ["advisory", "snapshot", "correlation_id"] as const;
const ADVISORY_FIELDS = [
  "run_id", "output_id", "output_schema_version", "status", "proposal",
  "containment_summary", "citations", "assumptions", "uncertainty_and_limitations",
  "warnings", "advisory_only", "workflow_mutated", "human_acceptance_required",
] as const;
const PROPOSAL_FIELDS = [
  "missing_risk_inputs", "missing_impact_dimensions", "human_review_questions",
  "evidence_provenance_gaps",
] as const;
const QUESTION_ASSERTION_SEPARATOR = /[.!?;,\n\r\u2028\u2029]|\s-\s|\band\b|\s+[—–]\s+|\b(?:but|however|although|though|yet|while|because|since|therefore|thus)\b/i;

export interface CapaContainmentRiskAdvisorySnapshot {
  readonly capaCaseId: string;
  readonly caseVersionId: string;
  readonly recordVersion: number;
}

export interface CapaContainmentRiskAdvisoryResult {
  readonly runId: string;
  readonly outputId: string;
  readonly proposal: {
    readonly missingRiskInputs: readonly {
      readonly topic: CapaContainmentRiskAdvisoryRiskInputTopic;
      readonly humanReviewQuestion: string;
    }[];
    readonly missingImpactDimensions: readonly {
      readonly dimension: CapaContainmentRiskAdvisoryImpactDimension;
      readonly humanReviewQuestion: string;
    }[];
    readonly humanReviewQuestions: readonly string[];
    readonly evidenceProvenanceGaps: readonly {
      readonly category: CapaContainmentRiskAdvisoryEvidenceGapCategory;
      readonly humanReviewQuestion: string;
    }[];
  };
  readonly assumptions: readonly {
    readonly relatedArea: CapaContainmentRiskAdvisoryAssumptionArea;
    readonly verificationQuestion: string;
  }[];
  readonly uncertaintyAndLimitations: readonly {
    readonly category: CapaContainmentRiskAdvisoryUncertaintyCategory;
    readonly humanReviewQuestion: string;
  }[];
}

export interface CapaContainmentRiskAdvisorySuccess {
  readonly advisory: CapaContainmentRiskAdvisoryResult;
  readonly snapshot: CapaContainmentRiskAdvisorySnapshot;
  readonly correlationId: string | null;
}

export interface CapaContainmentRiskAdvisoryFailure {
  readonly code: string | null;
  readonly message: string;
  readonly correlationId: string | null;
}

export interface CapaContainmentRiskAdvisoryRequestBody {
  readonly focus?: string;
  readonly untrusted_human_draft?: {
    readonly trust: "untrusted_human_draft";
    readonly content: CapaContainmentRiskContent;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length && keys.every((key) => expected.includes(key));
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.trim() === value;
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && value === value.trim() && UUID_PATTERN.test(value);
}

function positiveSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function enumValue<T extends string>(values: readonly T[], value: unknown): value is T {
  return typeof value === "string" && values.some((candidate) => candidate === value);
}

function question(value: unknown): value is string {
  if (!nonEmptyString(value) || !value.endsWith("?") || value.indexOf("?") !== value.length - 1) return false;
  const body = value.slice(0, -1).trim();
  return !QUESTION_ASSERTION_SEPARATOR.test(body) && /^(?:does|do|is|are|may|can|could|should|must|what|which|who|how|when|where|whether)\b/i.test(body);
}

function stringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every(nonEmptyString);
}

function snapshot(value: unknown): CapaContainmentRiskAdvisorySnapshot | null {
  if (!isRecord(value) || !exactKeys(value, ["capa_case_id", "case_version_id", "record_version"])) {
    return null;
  }
  if (!validUuid(value.capa_case_id) || !validUuid(value.case_version_id) || !positiveSafeInteger(value.record_version)) {
    return null;
  }
  return Object.freeze({
    capaCaseId: value.capa_case_id,
    caseVersionId: value.case_version_id,
    recordVersion: value.record_version,
  });
}

function missingRiskInputs(value: unknown): CapaContainmentRiskAdvisoryResult["proposal"]["missingRiskInputs"] | null {
  if (!Array.isArray(value)) return null;
  const result: CapaContainmentRiskAdvisoryResult["proposal"]["missingRiskInputs"][number][] = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["topic", "human_review_question"]) ||
      !enumValue(CAPA_CONTAINMENT_RISK_ADVISORY_RISK_INPUT_TOPICS, item.topic) ||
      !question(item.human_review_question)) return null;
    result.push({ topic: item.topic, humanReviewQuestion: item.human_review_question });
  }
  return Object.freeze(result);
}

function missingImpactDimensions(value: unknown): CapaContainmentRiskAdvisoryResult["proposal"]["missingImpactDimensions"] | null {
  if (!Array.isArray(value)) return null;
  const result: CapaContainmentRiskAdvisoryResult["proposal"]["missingImpactDimensions"][number][] = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["dimension", "human_review_question"]) ||
      !enumValue(CAPA_CONTAINMENT_RISK_ADVISORY_IMPACT_DIMENSIONS, item.dimension) ||
      !question(item.human_review_question)) return null;
    result.push({ dimension: item.dimension, humanReviewQuestion: item.human_review_question });
  }
  return Object.freeze(result);
}

function evidenceGaps(value: unknown): CapaContainmentRiskAdvisoryResult["proposal"]["evidenceProvenanceGaps"] | null {
  if (!Array.isArray(value)) return null;
  const result: CapaContainmentRiskAdvisoryResult["proposal"]["evidenceProvenanceGaps"][number][] = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["category", "human_review_question"]) ||
      !enumValue(CAPA_CONTAINMENT_RISK_ADVISORY_EVIDENCE_GAP_CATEGORIES, item.category) ||
      !question(item.human_review_question)) return null;
    result.push({ category: item.category, humanReviewQuestion: item.human_review_question });
  }
  return Object.freeze(result);
}

function assumptions(value: unknown): CapaContainmentRiskAdvisoryResult["assumptions"] | null {
  if (!Array.isArray(value)) return null;
  const result: CapaContainmentRiskAdvisoryResult["assumptions"][number][] = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["unverified", "related_area", "verification_question"]) ||
      item.unverified !== true || !enumValue(CAPA_CONTAINMENT_RISK_ADVISORY_ASSUMPTION_AREAS, item.related_area) ||
      !question(item.verification_question)) return null;
    result.push({ relatedArea: item.related_area, verificationQuestion: item.verification_question });
  }
  return Object.freeze(result);
}

function uncertainties(value: unknown): CapaContainmentRiskAdvisoryResult["uncertaintyAndLimitations"] | null {
  if (!Array.isArray(value)) return null;
  const result: CapaContainmentRiskAdvisoryResult["uncertaintyAndLimitations"][number][] = [];
  for (const item of value) {
    if (!isRecord(item) || !exactKeys(item, ["category", "human_review_question"]) ||
      !enumValue(CAPA_CONTAINMENT_RISK_ADVISORY_UNCERTAINTY_CATEGORIES, item.category) ||
      !question(item.human_review_question)) return null;
    result.push({ category: item.category, humanReviewQuestion: item.human_review_question });
  }
  return Object.freeze(result);
}

export function buildCapaContainmentRiskAdvisoryRequest(
  focus: string,
  content: CapaContainmentRiskContent | null,
): CapaContainmentRiskAdvisoryRequestBody {
  const body: {
    focus?: string;
    untrusted_human_draft?: {
      trust: "untrusted_human_draft";
      content: CapaContainmentRiskContent;
    };
  } = {};
  if (focus.trim().length > 0) body.focus = focus;
  if (content !== null) body.untrusted_human_draft = {
    trust: "untrusted_human_draft",
    content,
  };
  return Object.freeze(body);
}

export function parseCapaContainmentRiskAdvisorySuccess(
  value: unknown,
): CapaContainmentRiskAdvisorySuccess | null {
  if (!isRecord(value) || !exactKeys(value, SUCCESS_FIELDS) || !isRecord(value.advisory)) return null;
  const advisory = value.advisory;
  if (!exactKeys(advisory, ADVISORY_FIELDS) || !nonEmptyString(advisory.run_id) || !nonEmptyString(advisory.output_id) ||
    advisory.output_schema_version !== "capa-containment-risk-advisory-1.0.0" || advisory.status !== "completed_draft" ||
    !isRecord(advisory.proposal) || !Array.isArray(advisory.containment_summary) || advisory.containment_summary.length !== 0 ||
    !Array.isArray(advisory.citations) || advisory.citations.length !== 0 || !Array.isArray(advisory.warnings) || advisory.warnings.length !== 0 ||
    advisory.advisory_only !== true || advisory.workflow_mutated !== false || advisory.human_acceptance_required !== true) return null;

  const proposal = advisory.proposal;
  if (!exactKeys(proposal, PROPOSAL_FIELDS)) return null;
  const missingRisk = missingRiskInputs(proposal.missing_risk_inputs);
  const missingImpact = missingImpactDimensions(proposal.missing_impact_dimensions);
  const humanQuestions = stringArray(proposal.human_review_questions) && proposal.human_review_questions.every(question) ? proposal.human_review_questions : null;
  const gaps = evidenceGaps(proposal.evidence_provenance_gaps);
  const parsedAssumptions = assumptions(advisory.assumptions);
  const parsedUncertainties = uncertainties(advisory.uncertainty_and_limitations);
  const parsedSnapshot = snapshot(value.snapshot);
  if (missingRisk === null || missingImpact === null || humanQuestions === null || gaps === null || parsedAssumptions === null || parsedUncertainties === null || parsedSnapshot === null) return null;

  return Object.freeze({
    advisory: Object.freeze({
      runId: advisory.run_id,
      outputId: advisory.output_id,
      proposal: Object.freeze({ missingRiskInputs: missingRisk, missingImpactDimensions: missingImpact, humanReviewQuestions: humanQuestions, evidenceProvenanceGaps: gaps }),
      assumptions: parsedAssumptions,
      uncertaintyAndLimitations: parsedUncertainties,
    }),
    snapshot: parsedSnapshot,
    correlationId: validUuid(value.correlation_id) ? value.correlation_id : null,
  });
}

export function parseCapaContainmentRiskAdvisoryFailure(
  value: unknown,
): CapaContainmentRiskAdvisoryFailure {
  const fallback = "The CAPA containment/risk advisory could not be completed.";
  if (!isRecord(value) || !isRecord(value.error)) return Object.freeze({ code: null, message: fallback, correlationId: null });
  const error = value.error;
  return Object.freeze({
    code: nonEmptyString(error.code) ? error.code : null,
    message: nonEmptyString(error.message) ? error.message : fallback,
    correlationId: validUuid(error.correlation_id) ? error.correlation_id : null,
  });
}
