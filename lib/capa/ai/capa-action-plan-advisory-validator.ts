import {
  CAPA_ACTION_TYPES,
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../domain/capa-action-plan";
import {
  CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaActionPlanAdvisoryActionCandidate,
  type CapaActionPlanAdvisoryEffectivenessPlanning,
  type RawCapaActionPlanAdvisoryModelOutput,
} from "./capa-action-plan-advisory-contract";

const MAX_ITEMS = 20;
const MAX_TEXT = 2_000;
const MAX_QUESTION = 1_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const REF = /^R[1-9][0-9]{0,2}$/;

export type CapaActionPlanAdvisoryValidationLocation =
  | "root" | "proposal" | "concern" | "suggestion" | "action_candidate" | "effectiveness_suggestion" | "proposed_action_plan";
export type CapaActionPlanAdvisoryValidationReasonCode =
  | "INVALID_JSON" | "INVALID_SHAPE" | "INVALID_CONTROLLED_FIELDS" | "INVALID_TEXT" | "INVALID_REFERENCE" | "INVALID_ACTION_PLAN" | "INVALID_PROVENANCE";

export class CapaActionPlanAdvisoryOutputValidationError extends Error {
  constructor(readonly reason_code: CapaActionPlanAdvisoryValidationReasonCode, readonly diagnostic_location: CapaActionPlanAdvisoryValidationLocation) {
    super("The governed S60 action-plan advisory output is invalid.");
    this.name = "CapaActionPlanAdvisoryOutputValidationError";
  }
}

function fail(reason: CapaActionPlanAdvisoryValidationReasonCode, location: CapaActionPlanAdvisoryValidationLocation): never { throw new CapaActionPlanAdvisoryOutputValidationError(reason, location); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean { return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)); }
function text(value: unknown, maximum = MAX_TEXT): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value; }
function nullableText(value: unknown): value is string | null { return value === null || text(value); }
function question(value: unknown): value is string { return text(value, MAX_QUESTION) && /^[^.!?;,:\n\r]+\?$/.test(value); }
function references(value: unknown, location: CapaActionPlanAdvisoryValidationLocation): readonly string[] {
  if (!Array.isArray(value) || value.length > MAX_ITEMS || value.some((item) => typeof item !== "string" || !REF.test(item))) fail("INVALID_REFERENCE", location);
  return value;
}
function nullableUuid(value: unknown): value is string | null { return value === null || (typeof value === "string" && UUID.test(value)); }

function validateEffectivenessPlanning(value: unknown): CapaActionPlanAdvisoryEffectivenessPlanning | null {
  if (value === null) return null;
  if (!object(value) || !exact(value, ["recommendation", "acceptance_criteria", "evaluation_method", "data_source", "timing", "responsible_role", "sample_or_rationale"]) || !text(value.recommendation) || !text(value.acceptance_criteria) || !text(value.evaluation_method) || !text(value.data_source) || !text(value.timing) || !text(value.responsible_role) || !text(value.sample_or_rationale)) fail("INVALID_SHAPE", "action_candidate");
  return {
    recommendation: value.recommendation,
    acceptance_criteria: value.acceptance_criteria,
    evaluation_method: value.evaluation_method,
    data_source: value.data_source,
    timing: value.timing,
    responsible_role: value.responsible_role,
    sample_or_rationale: value.sample_or_rationale,
  };
}

function validateActionCandidate(value: unknown): CapaActionPlanAdvisoryActionCandidate {
  if (!object(value) || !exact(value, ["suggestion_key", "action_type", "description", "deliverable", "implementation_evidence", "unintended_consequence_assessment", "linked_targets", "effectiveness_planning", "reference_keys", "human_review_question"]) || typeof value.suggestion_key !== "string" || !KEY.test(value.suggestion_key) || typeof value.action_type !== "string" || !(CAPA_ACTION_TYPES as readonly string[]).includes(value.action_type) || !text(value.description) || !text(value.deliverable) || !text(value.implementation_evidence) || !text(value.unintended_consequence_assessment) || !question(value.human_review_question)) fail("INVALID_SHAPE", "action_candidate");
  if (!Array.isArray(value.linked_targets) || value.linked_targets.length === 0 || value.linked_targets.length > MAX_ITEMS) fail("INVALID_SHAPE", "action_candidate");
  const linkedTargets = value.linked_targets.map((target) => {
    if (!object(target) || !exact(target, ["target_type", "target_id", "rationale"]) || (target.target_type !== "cause" && target.target_type !== "contributing_factor" && target.target_type !== "gap") || !text(target.target_id) || !text(target.rationale)) fail("INVALID_SHAPE", "action_candidate");
    return { target_type: target.target_type, target_id: target.target_id, rationale: target.rationale } as const;
  });
  const identities = linkedTargets.map((target) => `${target.target_type}:${target.target_id}`);
  if (new Set(identities).size !== identities.length) fail("INVALID_SHAPE", "action_candidate");
  return {
    suggestion_key: value.suggestion_key,
    action_type: value.action_type as CapaActionPlanAdvisoryActionCandidate["action_type"],
    description: value.description,
    deliverable: value.deliverable,
    implementation_evidence: value.implementation_evidence,
    unintended_consequence_assessment: value.unintended_consequence_assessment,
    linked_targets: Object.freeze(linkedTargets),
    effectiveness_planning: validateEffectivenessPlanning(value.effectiveness_planning),
    reference_keys: references(value.reference_keys, "action_candidate"),
    human_review_question: value.human_review_question,
  };
}

function validateConcern(value: unknown): RawCapaActionPlanAdvisoryModelOutput["proposal"]["completeness_linkage_concerns"][number] {
  if (!object(value) || !exact(value, ["concern_key", "subject", "description", "reference_keys", "human_review_question"]) || typeof value.concern_key !== "string" || !KEY.test(value.concern_key) || !text(value.subject) || !text(value.description) || !question(value.human_review_question)) fail("INVALID_SHAPE", "concern");
  return { concern_key: value.concern_key, subject: value.subject, description: value.description, reference_keys: references(value.reference_keys, "concern"), human_review_question: value.human_review_question };
}

function validateSuggestion(value: unknown): RawCapaActionPlanAdvisoryModelOutput["proposal"]["action_improvements"][number] {
  if (!object(value) || !exact(value, ["suggestion_key", "action_item_id", "issue", "recommendation", "rationale", "reference_keys", "human_review_question"]) || typeof value.suggestion_key !== "string" || !KEY.test(value.suggestion_key) || !nullableUuid(value.action_item_id) || !text(value.issue) || !text(value.recommendation) || !text(value.rationale) || !question(value.human_review_question)) fail("INVALID_SHAPE", "suggestion");
  return { suggestion_key: value.suggestion_key, action_item_id: value.action_item_id, issue: value.issue, recommendation: value.recommendation, rationale: value.rationale, reference_keys: references(value.reference_keys, "suggestion"), human_review_question: value.human_review_question };
}

function validateEffectivenessSuggestion(value: unknown): RawCapaActionPlanAdvisoryModelOutput["proposal"]["effectiveness_planning_improvements"][number] {
  if (!object(value) || !exact(value, ["suggestion_key", "action_item_id", "recommendation", "rationale", "reference_keys", "human_review_question"]) || typeof value.suggestion_key !== "string" || !KEY.test(value.suggestion_key) || !nullableUuid(value.action_item_id) || !text(value.recommendation) || !text(value.rationale) || !question(value.human_review_question)) fail("INVALID_SHAPE", "effectiveness_suggestion");
  return { suggestion_key: value.suggestion_key, action_item_id: value.action_item_id, recommendation: value.recommendation, rationale: value.rationale, reference_keys: references(value.reference_keys, "effectiveness_suggestion"), human_review_question: value.human_review_question };
}

function validatePlan(value: unknown): CapaActionPlanContent | null {
  if (value === null) return null;
  const result = validateCapaActionPlan(value);
  if (result.status !== "valid" || result.value.items.some((item) => item.draft_provenance.source_type !== "ai_proposal" || item.draft_provenance.source_reference !== null || item.draft_provenance.adopted_by_user_id !== null || item.draft_provenance.adopted_at !== null || item.owner_user_id !== null) || result.value.effectiveness_checks.some((check) => check.draft_provenance.source_type !== "ai_proposal" || check.draft_provenance.source_reference !== null || check.draft_provenance.adopted_by_user_id !== null || check.draft_provenance.adopted_at !== null)) fail("INVALID_PROVENANCE", "proposed_action_plan");
  return result.value;
}

export function validateCapaActionPlanAdvisoryModelOutput(value: string): RawCapaActionPlanAdvisoryModelOutput {
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { fail("INVALID_JSON", "root"); }
  if (!object(parsed) || !exact(parsed, ["schema_version", "status", "proposal", "warnings", "uncertainty_and_limitations", "citations", "advisory_only", "workflow_mutated", "controlled_record_mutated", "approval_claimed", "workflow_transition", "human_acceptance_required"])) fail("INVALID_SHAPE", "root");
  if (parsed.schema_version !== CAPA_ACTION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION || parsed.status !== "completed_draft" || parsed.advisory_only !== true || parsed.workflow_mutated !== false || parsed.controlled_record_mutated !== false || parsed.approval_claimed !== false || parsed.workflow_transition !== null || parsed.human_acceptance_required !== true) fail("INVALID_CONTROLLED_FIELDS", "root");
  if (!Array.isArray(parsed.warnings) || parsed.warnings.length > MAX_ITEMS || parsed.warnings.some((item) => !text(item))) fail("INVALID_TEXT", "root");
  if (!Array.isArray(parsed.uncertainty_and_limitations) || parsed.uncertainty_and_limitations.length > MAX_ITEMS || parsed.uncertainty_and_limitations.some((item) => !text(item))) fail("INVALID_TEXT", "root");
  if (!Array.isArray(parsed.citations) || parsed.citations.length !== 0) fail("INVALID_CONTROLLED_FIELDS", "root");
  const proposal = parsed.proposal;
  if (!object(proposal) || !exact(proposal, ["advisory_summary", "completeness_linkage_concerns", "action_improvements", "action_candidates", "effectiveness_planning_improvements", "proposed_action_plan"]) || !text(proposal.advisory_summary)) fail("INVALID_SHAPE", "proposal");
  if (!Array.isArray(proposal.completeness_linkage_concerns) || proposal.completeness_linkage_concerns.length > MAX_ITEMS) fail("INVALID_SHAPE", "proposal");
  if (!Array.isArray(proposal.action_improvements) || proposal.action_improvements.length > MAX_ITEMS) fail("INVALID_SHAPE", "proposal");
  if (!Array.isArray(proposal.action_candidates) || proposal.action_candidates.length > MAX_ITEMS) fail("INVALID_SHAPE", "proposal");
  if (!Array.isArray(proposal.effectiveness_planning_improvements) || proposal.effectiveness_planning_improvements.length > MAX_ITEMS) fail("INVALID_SHAPE", "proposal");
  const actionCandidates = proposal.action_candidates.map(validateActionCandidate);
  if (new Set(actionCandidates.map((candidate) => candidate.suggestion_key)).size !== actionCandidates.length) fail("INVALID_SHAPE", "proposal");
  return Object.freeze({ schema_version: parsed.schema_version, status: parsed.status, proposal: { advisory_summary: proposal.advisory_summary, completeness_linkage_concerns: Object.freeze(proposal.completeness_linkage_concerns.map(validateConcern)), action_improvements: Object.freeze(proposal.action_improvements.map(validateSuggestion)), action_candidates: Object.freeze(actionCandidates), effectiveness_planning_improvements: Object.freeze(proposal.effectiveness_planning_improvements.map(validateEffectivenessSuggestion)), proposed_action_plan: validatePlan(proposal.proposed_action_plan) }, warnings: Object.freeze([...parsed.warnings]), uncertainty_and_limitations: Object.freeze([...parsed.uncertainty_and_limitations]), citations: [] as readonly [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true });
}
