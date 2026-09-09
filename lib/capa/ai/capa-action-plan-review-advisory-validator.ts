import { CAPA_ACTION_PLAN_REVIEW_ADVISORY_ASSESSMENTS, CAPA_ACTION_PLAN_REVIEW_ADVISORY_CATEGORIES, CAPA_ACTION_PLAN_REVIEW_ADVISORY_DISPOSITIONS, CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION, CAPA_ACTION_PLAN_REVIEW_ADVISORY_SEVERITIES, type RawCapaActionPlanReviewAdvisoryModelOutput } from "./capa-action-plan-review-advisory-contract";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const REF = /^R[1-9][0-9]{0,2}$/;
const MAX = 40;
const TEXT = 4_000;

export type CapaActionPlanReviewAdvisoryValidationReasonCode = "INVALID_JSON" | "INVALID_SHAPE" | "INVALID_CONTROLLED_FIELDS" | "INVALID_TEXT" | "INVALID_REFERENCE" | "INVALID_IDENTIFIER" | "DUPLICATE_FINDING_ID";
export class CapaActionPlanReviewAdvisoryOutputValidationError extends Error {
  constructor(readonly reason_code: CapaActionPlanReviewAdvisoryValidationReasonCode) { super("The governed S70 action-plan review advisory output is invalid."); this.name = "CapaActionPlanReviewAdvisoryOutputValidationError"; }
}
const fail = (reason: CapaActionPlanReviewAdvisoryValidationReasonCode): never => { throw new CapaActionPlanReviewAdvisoryOutputValidationError(reason); };
const object = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, fields: readonly string[]) => Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field));
const text = (value: unknown, max = TEXT): value is string => typeof value === "string" && value.length > 0 && value.length <= max && value.trim() === value;
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const ids = (value: unknown): readonly string[] => { if (!Array.isArray(value) || value.length > MAX || value.some((item) => !uuid(item))) fail("INVALID_IDENTIFIER"); return value as readonly string[]; };
const refs = (value: unknown): readonly string[] => { if (!Array.isArray(value) || value.length > MAX || value.some((item) => typeof item !== "string" || !REF.test(item))) fail("INVALID_REFERENCE"); return value as readonly string[]; };

export function validateCapaActionPlanReviewAdvisoryModelOutput(value: string): RawCapaActionPlanReviewAdvisoryModelOutput {
  let parsed: unknown; try { parsed = JSON.parse(value); } catch { fail("INVALID_JSON"); }
  if (!object(parsed)) fail("INVALID_SHAPE");
  const root = parsed as Record<string, unknown>;
  if (!exact(root, ["schema_version", "status", "source_case_version_id", "action_plan_section_version_id", "proposal", "citations", "advisory_only", "workflow_mutated", "controlled_record_mutated", "approval_claimed", "workflow_transition", "human_acceptance_required"])) fail("INVALID_SHAPE");
  if (root.schema_version !== CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION || root.status !== "completed_draft" || !uuid(root.source_case_version_id) || !uuid(root.action_plan_section_version_id) || root.advisory_only !== true || root.workflow_mutated !== false || root.controlled_record_mutated !== false || root.approval_claimed !== false || root.workflow_transition !== null || root.human_acceptance_required !== true) fail("INVALID_CONTROLLED_FIELDS");
  if (!Array.isArray(root.citations) || root.citations.length !== 0) fail("INVALID_CONTROLLED_FIELDS");
  if (!object(root.proposal)) fail("INVALID_SHAPE");
  const proposal = root.proposal as Record<string, unknown>;
  const proposalFindings = proposal.findings as unknown;
  const proposalLimitations = proposal.limitations as unknown;
  if (!exact(proposal, ["overall_assessment", "findings", "recommended_disposition", "limitations"]) || !CAPA_ACTION_PLAN_REVIEW_ADVISORY_ASSESSMENTS.includes(proposal.overall_assessment as never) || !CAPA_ACTION_PLAN_REVIEW_ADVISORY_DISPOSITIONS.includes(proposal.recommended_disposition as never) || !Array.isArray(proposalFindings) || proposalFindings.length > MAX || !Array.isArray(proposalLimitations) || proposalLimitations.length > MAX || proposalLimitations.some((item: unknown) => !text(item))) fail("INVALID_SHAPE");
  const findingIds = new Set<string>();
  const findings = (proposalFindings as readonly unknown[]).map((finding: unknown) => {
    if (!object(finding)) fail("INVALID_SHAPE");
    const findingRecord = finding as Record<string, unknown>;
    if (!exact(findingRecord, ["finding_id", "category", "severity", "summary", "rationale", "affected_action_ids", "affected_root_cause_ids", "reference_keys", "suggested_reviewer_attention"]) || typeof findingRecord.finding_id !== "string" || !KEY.test(findingRecord.finding_id) || findingIds.has(findingRecord.finding_id) || !CAPA_ACTION_PLAN_REVIEW_ADVISORY_CATEGORIES.includes(findingRecord.category as never) || !CAPA_ACTION_PLAN_REVIEW_ADVISORY_SEVERITIES.includes(findingRecord.severity as never) || !text(findingRecord.summary) || !text(findingRecord.rationale) || !text(findingRecord.suggested_reviewer_attention)) fail(findingIds.has(findingRecord.finding_id as string) ? "DUPLICATE_FINDING_ID" : "INVALID_SHAPE");
    findingIds.add(findingRecord.finding_id as string);
    return { finding_id: findingRecord.finding_id as string, category: findingRecord.category as never, severity: findingRecord.severity as never, summary: findingRecord.summary as string, rationale: findingRecord.rationale as string, affected_action_ids: ids(findingRecord.affected_action_ids), affected_root_cause_ids: ids(findingRecord.affected_root_cause_ids), reference_keys: refs(findingRecord.reference_keys), suggested_reviewer_attention: findingRecord.suggested_reviewer_attention as string };
  });
  return Object.freeze({ schema_version: CAPA_ACTION_PLAN_REVIEW_ADVISORY_OUTPUT_SCHEMA_VERSION, status: "completed_draft" as const, source_case_version_id: root.source_case_version_id as never, action_plan_section_version_id: root.action_plan_section_version_id as never, proposal: Object.freeze({ overall_assessment: proposal.overall_assessment as never, findings: Object.freeze(findings), recommended_disposition: proposal.recommended_disposition as never, limitations: Object.freeze([...(proposalLimitations as readonly string[])]) }), citations: [] as const, advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true });
}
