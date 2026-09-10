import type { CapaImplementationEvidenceId } from "../domain/capa-types";
import { CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_CATEGORIES, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION, CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SEVERITIES, type CapaImplementationEvidenceAdvisoryFinding, type RawCapaImplementationEvidenceAdvisoryModelOutput } from "./capa-implementation-evidence-advisory-contract";

const MAX_ITEMS = 40;
const MAX_TEXT = 4_000;
const MAX_ACTION = 2_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[A-Za-z][A-Za-z0-9._:-]{0,127}$/;
const REF = /^R[1-9][0-9]{0,2}$/;

export type CapaImplementationEvidenceAdvisoryValidationLocation = "root" | "finding" | "adoption";
export type CapaImplementationEvidenceAdvisoryValidationReasonCode = "INVALID_JSON" | "INVALID_SHAPE" | "INVALID_CONTROLLED_FIELDS" | "INVALID_TEXT" | "INVALID_CATEGORY" | "INVALID_SEVERITY" | "INVALID_REFERENCE" | "INVALID_EVIDENCE_ID" | "INVALID_ADOPTION" | "INVALID_CITATION";

export class CapaImplementationEvidenceAdvisoryOutputValidationError extends Error {
  constructor(readonly reason_code: CapaImplementationEvidenceAdvisoryValidationReasonCode, readonly diagnostic_location: CapaImplementationEvidenceAdvisoryValidationLocation) {
    super("The governed S80 implementation-evidence advisory output is invalid.");
    this.name = "CapaImplementationEvidenceAdvisoryOutputValidationError";
  }
}

function fail(reason: CapaImplementationEvidenceAdvisoryValidationReasonCode, location: CapaImplementationEvidenceAdvisoryValidationLocation): never { throw new CapaImplementationEvidenceAdvisoryOutputValidationError(reason, location); }
function object(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, fields: readonly string[]): boolean { return Object.keys(value).length === fields.length && fields.every((field) => Object.hasOwn(value, field)); }
function text(value: unknown, maximum = MAX_TEXT): value is string { return typeof value === "string" && value.length > 0 && value.length <= maximum && value.trim() === value; }
function nullableText(value: unknown): value is string | null { return value === null || text(value); }
function refs(value: unknown): readonly string[] { if (!Array.isArray(value) || value.length > MAX_ITEMS || value.some((item) => typeof item !== "string" || !REF.test(item))) fail("INVALID_REFERENCE", "finding"); if (new Set(value).size !== value.length) fail("INVALID_REFERENCE", "finding"); return value; }
function evidenceIds(value: unknown): readonly CapaImplementationEvidenceId[] { if (!Array.isArray(value) || value.length > MAX_ITEMS || value.some((item) => typeof item !== "string" || !UUID.test(item))) fail("INVALID_EVIDENCE_ID", "finding"); if (new Set(value).size !== value.length) fail("INVALID_EVIDENCE_ID", "finding"); return value as CapaImplementationEvidenceId[]; }

function adoption(value: unknown, category: string): CapaImplementationEvidenceAdvisoryFinding["adoption"] {
  if (!object(value) || !exact(value, ["eligible", "field", "suggested_value"]) || typeof value.eligible !== "boolean" || (value.field !== null && value.field !== "implementation_narrative") || !nullableText(value.suggested_value)) fail("INVALID_ADOPTION", "adoption");
  if (value.eligible !== (category === "documentation_improvement")) fail("INVALID_ADOPTION", "adoption");
  if (value.eligible && (value.field !== "implementation_narrative" || value.suggested_value === null || !text(value.suggested_value, MAX_TEXT))) fail("INVALID_ADOPTION", "adoption");
  if (!value.eligible && (value.field !== null || value.suggested_value !== null)) fail("INVALID_ADOPTION", "adoption");
  return { eligible: value.eligible, field: value.field, suggested_value: value.suggested_value };
}

function finding(value: unknown): CapaImplementationEvidenceAdvisoryFinding {
  if (!object(value) || !exact(value, ["finding_id", "approved_action_reference", "category", "severity", "finding", "rationale", "evidence_reference_ids", "reference_keys", "suggested_human_action", "adoption"]) || typeof value.finding_id !== "string" || !KEY.test(value.finding_id) || !text(value.approved_action_reference, 256) || !text(value.finding) || !text(value.rationale) || !text(value.suggested_human_action, MAX_ACTION)) fail("INVALID_SHAPE", "finding");
  if (typeof value.category !== "string" || !(CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_CATEGORIES as readonly string[]).includes(value.category)) fail("INVALID_CATEGORY", "finding");
  if (typeof value.severity !== "string" || !(CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_SEVERITIES as readonly string[]).includes(value.severity)) fail("INVALID_SEVERITY", "finding");
  return { finding_id: value.finding_id, approved_action_reference: value.approved_action_reference, category: value.category as CapaImplementationEvidenceAdvisoryFinding["category"], severity: value.severity as CapaImplementationEvidenceAdvisoryFinding["severity"], finding: value.finding, rationale: value.rationale, evidence_reference_ids: evidenceIds(value.evidence_reference_ids), reference_keys: refs(value.reference_keys), suggested_human_action: value.suggested_human_action, adoption: adoption(value.adoption, value.category) };
}

export function validateCapaImplementationEvidenceAdvisoryModelOutput(value: string): RawCapaImplementationEvidenceAdvisoryModelOutput {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { fail("INVALID_JSON", "root"); }
  if (!object(parsed) || !exact(parsed, ["schema_version", "status", "advisory_summary", "findings", "warnings", "uncertainty_and_limitations", "citations", "advisory_only", "workflow_mutated", "controlled_record_mutated", "approval_claimed", "workflow_transition", "human_acceptance_required"])) fail("INVALID_SHAPE", "root");
  if (parsed.schema_version !== CAPA_IMPLEMENTATION_EVIDENCE_ADVISORY_OUTPUT_SCHEMA_VERSION || parsed.status !== "completed_draft" || parsed.advisory_only !== true || parsed.workflow_mutated !== false || parsed.controlled_record_mutated !== false || parsed.approval_claimed !== false || parsed.workflow_transition !== null || parsed.human_acceptance_required !== true) fail("INVALID_CONTROLLED_FIELDS", "root");
  if (!text(parsed.advisory_summary) || !Array.isArray(parsed.findings) || parsed.findings.length > MAX_ITEMS || !Array.isArray(parsed.warnings) || parsed.warnings.length > MAX_ITEMS || parsed.warnings.some((item) => !text(item)) || !Array.isArray(parsed.uncertainty_and_limitations) || parsed.uncertainty_and_limitations.length > MAX_ITEMS || parsed.uncertainty_and_limitations.some((item) => !text(item))) fail("INVALID_TEXT", "root");
  if (!Array.isArray(parsed.citations) || parsed.citations.length !== 0) fail("INVALID_CITATION", "root");
  const findings = parsed.findings.map(finding);
  if (new Set(findings.map((item) => item.finding_id)).size !== findings.length) fail("INVALID_SHAPE", "root");
  return Object.freeze({ schema_version: parsed.schema_version, status: "completed_draft", advisory_summary: parsed.advisory_summary, findings: Object.freeze(findings), warnings: Object.freeze([...parsed.warnings]), uncertainty_and_limitations: Object.freeze([...parsed.uncertainty_and_limitations]), citations: [], advisory_only: true, workflow_mutated: false, controlled_record_mutated: false, approval_claimed: false, workflow_transition: null, human_acceptance_required: true });
}
