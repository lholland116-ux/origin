import type { CapaCaseVersionId, IsoDateTime, UserId } from "../domain/capa-types";
import type { CapaAiOutputId } from "./capa-prompt-contract";
import {
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM,
  CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION,
} from "./capa-investigation-active-advisory-reference-manifest";
import { isCapaInvestigationActiveAdvisoryReferenceKey } from "./capa-investigation-active-advisory-reference-manifest";
import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS,
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_ITEMS,
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_SERIALIZED_REQUEST_CHARACTERS,
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_TEXT_CHARACTERS,
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
  type CapaInvestigationActiveAdoptedContent,
  type CapaInvestigationActiveAdoptionCategory,
  type CapaInvestigationActiveAdoptionIntentRequest,
  type CapaInvestigationActiveAdoptionRecord,
  type CapaInvestigationActiveHumanCausalRole,
  type CapaInvestigationActiveResolvedReferenceBinding,
  type ConstructCapaInvestigationActiveAdoptionInput,
} from "./capa-investigation-active-adoption-contract";

export const CAPA_INVESTIGATION_ACTIVE_ADOPTION_VALIDATION_REASON_CODES = [
  "INVALID_ADOPTION_INPUT", "UNSUPPORTED_ADOPTION_INPUT_FIELD", "INVALID_EXPECTED_CASE_VERSION_ID",
  "INVALID_EXPECTED_RECORD_VERSION", "INVALID_OUTPUT_ID", "INVALID_SELECTED_ITEMS", "INVALID_PROPOSAL_KEY",
  "DUPLICATE_PROPOSAL_KEY", "INVALID_ADOPTED_CONTENT", "ADOPTION_TEXT_TOO_LONG", "INVALID_ADOPTION_ID",
  "INVALID_ORGANIZATION", "INVALID_CASE_ID", "INVALID_ADOPTION_TIMESTAMP", "INVALID_ADOPTER",
  "INVALID_ADOPTION_POLICY_VERSION", "INVALID_REQUEST_ID", "INVALID_CORRELATION_ID", "INVALID_IDEMPOTENCY_KEY",
  "INVALID_REFERENCE_BINDING", "INVALID_REFERENCE_MANIFEST", "INVALID_AUTHORITY_FLAGS",
] as const;
export type CapaInvestigationActiveAdoptionValidationReasonCode =
  (typeof CAPA_INVESTIGATION_ACTIVE_ADOPTION_VALIDATION_REASON_CODES)[number];
export class CapaInvestigationActiveAdoptionValidationError extends Error {
  readonly reason_code: CapaInvestigationActiveAdoptionValidationReasonCode;
  constructor(reason: CapaInvestigationActiveAdoptionValidationReasonCode) {
    super("The governed CAPA investigation-active adoption is invalid.");
    this.name = "CapaInvestigationActiveAdoptionValidationError";
    this.reason_code = reason;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const P = /^P[1-9][0-9]{0,2}$/;
const VERSION = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const RELATIONSHIPS = new Set(["related", "conflicting", "supporting", "contradictory"]);
const TRUSTS = new Set(["authoritative_server_context", "untrusted_human_draft"]);
const SOURCES = new Set(["investigation_plan_item", "ledger_item", "causal_hypothesis", "root_cause_not_confirmed"]);
const HUMAN_CAUSAL_ROLES = new Set<CapaInvestigationActiveHumanCausalRole>(["proposed_root_cause", "contributing_factor"]);
const fail = (reason: CapaInvestigationActiveAdoptionValidationReasonCode): never => { throw new CapaInvestigationActiveAdoptionValidationError(reason); };
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const timestamp = (value: unknown): value is IsoDateTime => typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) && Number.isFinite(Date.parse(value));
const text = (value: unknown): string => { if (typeof value !== "string") fail("INVALID_ADOPTED_CONTENT"); const normalized = (value as string).normalize("NFKC").trim(); if (normalized.length === 0) fail("INVALID_ADOPTED_CONTENT"); if (normalized.length > CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_TEXT_CHARACTERS) fail("ADOPTION_TEXT_TOO_LONG"); return normalized; };
function freeze<T>(value: T): T { if (value !== null && typeof value === "object") { Object.freeze(value); for (const child of Object.values(value as Record<string, unknown>)) freeze(child); } return value; }

function snapshotJsonValue(value: unknown, ancestors = new Set<object>()): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) fail("INVALID_ADOPTED_CONTENT");
    return value;
  }
  if (Array.isArray(value)) {
    if (ancestors.has(value)) fail("INVALID_ADOPTED_CONTENT");
    ancestors.add(value);
    try { return value.map((item) => snapshotJsonValue(item, ancestors)); }
    finally { ancestors.delete(value); }
  }
  if (!record(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) fail("INVALID_ADOPTED_CONTENT");
  const sourceObject = value as object;
  if (ancestors.has(sourceObject)) fail("INVALID_ADOPTED_CONTENT");
  ancestors.add(sourceObject);
  const source = value as Record<string, unknown>;
  const snapshot: Record<string, unknown> = {};
  try {
    for (const key of Object.keys(source)) {
      if (source[key] === undefined) fail("INVALID_ADOPTED_CONTENT");
      snapshot[key] = snapshotJsonValue(source[key], ancestors);
    }
  } finally {
    ancestors.delete(sourceObject);
  }
  return snapshot;
}

export function validateCapaInvestigationActiveAdoptionIntent(value: unknown): CapaInvestigationActiveAdoptionIntentRequest {
  if (!record(value)) fail("INVALID_ADOPTION_INPUT");
  const input = value as Record<string, unknown>;
  if (!exact(input, ["expected_case_version_id", "expected_record_version", "output_id", "selected_items"])) fail(Object.keys(input).some((key) => !["expected_case_version_id", "expected_record_version", "output_id", "selected_items"].includes(key)) ? "UNSUPPORTED_ADOPTION_INPUT_FIELD" : "INVALID_ADOPTION_INPUT");
  if (!uuid(input.expected_case_version_id)) fail("INVALID_EXPECTED_CASE_VERSION_ID");
  if (typeof input.expected_record_version !== "number" || !Number.isSafeInteger(input.expected_record_version) || input.expected_record_version < 1) fail("INVALID_EXPECTED_RECORD_VERSION");
  if (!uuid(input.output_id)) fail("INVALID_OUTPUT_ID");
  if (!Array.isArray(input.selected_items) || input.selected_items.length < 1 || input.selected_items.length > CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_ITEMS) fail("INVALID_SELECTED_ITEMS");
  const selected_items = (input.selected_items as unknown[]).map((item: unknown) => {
    if (!record(item) || Object.keys(item).some((key) => !["proposal_key", "adopted_content", "human_causal_role"].includes(key)) || !Object.hasOwn(item, "proposal_key") || !Object.hasOwn(item, "adopted_content") || Object.keys(item).length < 2 || Object.keys(item).length > 3) fail("INVALID_ADOPTED_CONTENT");
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.proposal_key !== "string" || !P.test(candidate.proposal_key)) fail("INVALID_PROPOSAL_KEY");
    if (Object.hasOwn(candidate, "human_causal_role") && (typeof candidate.human_causal_role !== "string" || !HUMAN_CAUSAL_ROLES.has(candidate.human_causal_role as CapaInvestigationActiveHumanCausalRole))) fail("INVALID_ADOPTED_CONTENT");
    if (!record(candidate.adopted_content)) fail("INVALID_ADOPTED_CONTENT");
    const adopted_content = snapshotJsonValue(candidate.adopted_content);
    if (!record(adopted_content)) fail("INVALID_ADOPTED_CONTENT");
    return Object.freeze({ proposal_key: candidate.proposal_key as string, adopted_content: freeze(adopted_content), ...(candidate.human_causal_role === undefined ? {} : { human_causal_role: candidate.human_causal_role as CapaInvestigationActiveHumanCausalRole }) });
  });
  const keys = new Set<string>(); for (const item of selected_items) { if (keys.has(item.proposal_key)) fail("DUPLICATE_PROPOSAL_KEY"); keys.add(item.proposal_key); }
  let serialized: string | undefined; try { serialized = JSON.stringify(input); } catch { fail("INVALID_ADOPTION_INPUT"); }
  if (serialized === undefined || serialized.length > CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_SERIALIZED_REQUEST_CHARACTERS) fail("ADOPTION_TEXT_TOO_LONG");
  return Object.freeze({ expected_case_version_id: input.expected_case_version_id as CapaCaseVersionId, expected_record_version: input.expected_record_version as number, output_id: input.output_id as CapaAiOutputId, selected_items: Object.freeze(selected_items) });
}

const CONTENT_FIELDS: Record<CapaInvestigationActiveAdoptionCategory, readonly string[]> = {
  evidence_gap: ["gap", "why_it_matters", "recommended_next_step"],
  conflicting_information: ["conflict", "why_it_matters"],
  assumption: ["assumption", "verification_question"],
  causal_hypothesis: ["hypothesis", "rationale"],
  alternative_hypothesis: ["hypothesis", "rationale"],
  investigation_recommendation: ["recommendation", "rationale"],
};
export function validateCapaInvestigationActiveAdoptedContent(category: CapaInvestigationActiveAdoptionCategory, value: unknown): CapaInvestigationActiveAdoptedContent {
  const fields = CONTENT_FIELDS[category]; if (fields === undefined || !record(value) || !exact(value, fields)) fail("INVALID_ADOPTED_CONTENT");
  const input = value as Record<string, unknown>;
  return Object.freeze(Object.fromEntries(fields.map((field) => [field, text(input[field])])) as unknown as CapaInvestigationActiveAdoptedContent);
}

function validateBindings(bindings: unknown): readonly CapaInvestigationActiveResolvedReferenceBinding[] {
  if (!Array.isArray(bindings)) fail("INVALID_REFERENCE_BINDING");
  const seen = new Set<string>();
  const result = (bindings as unknown[]).map((value: unknown) => {
    if (!record(value) || !exact(value, ["reference_key", "relationship", "trust", "source_kind", "source_id"]) || !isCapaInvestigationActiveAdvisoryReferenceKey(value.reference_key) || typeof value.relationship !== "string" || !RELATIONSHIPS.has(value.relationship) || typeof value.trust !== "string" || !TRUSTS.has(value.trust) || typeof value.source_kind !== "string" || !SOURCES.has(value.source_kind) || (value.trust === "authoritative_server_context" && value.source_kind !== "investigation_plan_item") || (value.trust === "untrusted_human_draft" && value.source_kind === "investigation_plan_item") || typeof value.source_id !== "string" || value.source_id.trim() !== value.source_id || value.source_id.length === 0) fail("INVALID_REFERENCE_BINDING");
    const candidate = value as Record<string, unknown>;
    const key = `${candidate.relationship}:${candidate.reference_key}`; if (seen.has(key)) fail("INVALID_REFERENCE_BINDING"); seen.add(key);
    return Object.freeze(candidate) as unknown as CapaInvestigationActiveResolvedReferenceBinding;
  });
  return Object.freeze(result);
}

function constructCapaInvestigationActiveAdoptionInternal(input: ConstructCapaInvestigationActiveAdoptionInput, allowLegacyCausalRole = false): CapaInvestigationActiveAdoptionRecord {
  if (!record(input)) fail("INVALID_ADOPTION_INPUT");
  if (!uuid(input.adoption_id)) fail("INVALID_ADOPTION_ID");
  if (!uuid(input.organization_id)) fail("INVALID_ORGANIZATION");
  if (!uuid(input.capa_case_id)) fail("INVALID_CASE_ID");
  if (!uuid(input.case_version_id)) fail("INVALID_EXPECTED_CASE_VERSION_ID");
  if (!Number.isSafeInteger(input.record_version) || input.record_version < 1) fail("INVALID_EXPECTED_RECORD_VERSION");
  if (!uuid(input.output_id)) fail("INVALID_OUTPUT_ID");
  if (typeof input.proposal_key !== "string" || !P.test(input.proposal_key)) fail("INVALID_ADOPTED_CONTENT");
  if (!(input.proposal_category in CONTENT_FIELDS)) fail("INVALID_ADOPTED_CONTENT");
  if (!record(input.adopted_item) || Object.keys(input.adopted_item).some((key) => !["proposal_key", "adopted_content", "human_causal_role"].includes(key)) || !Object.hasOwn(input.adopted_item, "proposal_key") || !Object.hasOwn(input.adopted_item, "adopted_content") || Object.keys(input.adopted_item).length < 2 || Object.keys(input.adopted_item).length > 3 || input.adopted_item.proposal_key !== input.proposal_key) fail("INVALID_ADOPTED_CONTENT");
  if (input.proposal_category === "causal_hypothesis" ? ((!allowLegacyCausalRole && input.adopted_item.human_causal_role === undefined) || (input.adopted_item.human_causal_role !== undefined && !HUMAN_CAUSAL_ROLES.has(input.adopted_item.human_causal_role as CapaInvestigationActiveHumanCausalRole))) : input.adopted_item.human_causal_role !== undefined) fail("INVALID_ADOPTED_CONTENT");
  const adopted_content = validateCapaInvestigationActiveAdoptedContent(input.proposal_category, input.adopted_item.adopted_content);
  if (!record(input.adopted_by) || input.adopted_by.actor_type !== "human" || typeof input.adopted_by.actor_id !== "string" || !uuid(input.adopted_by.actor_id)) fail("INVALID_ADOPTER");
  if (!timestamp(input.adopted_at)) fail("INVALID_ADOPTION_TIMESTAMP");
  if (!uuid(input.request_id)) fail("INVALID_REQUEST_ID"); if (!uuid(input.correlation_id)) fail("INVALID_CORRELATION_ID");
  if (typeof input.idempotency_key !== "string" || input.idempotency_key.length < 1 || input.idempotency_key.length > CAPA_INVESTIGATION_ACTIVE_ADOPTION_MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS || input.idempotency_key.trim() !== input.idempotency_key) fail("INVALID_IDEMPOTENCY_KEY");
  if (input.adoption_policy_version !== undefined && input.adoption_policy_version !== CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION) fail("INVALID_ADOPTION_POLICY_VERSION");
  if (!VERSION.test(input.reference_manifest_schema_version) || !VERSION.test(input.reference_manifest_fingerprint_algorithm) || !/^[0-9a-f]{64}$/.test(input.reference_manifest_sha256)) fail("INVALID_REFERENCE_MANIFEST");
  if (input.reference_manifest_schema_version !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_SCHEMA_VERSION || input.reference_manifest_fingerprint_algorithm !== CAPA_INVESTIGATION_ACTIVE_REFERENCE_MANIFEST_FINGERPRINT_ALGORITHM) fail("INVALID_REFERENCE_MANIFEST");
  if (input.workflow_mutated !== false || input.controlled_record_mutated !== false || input.gate_approved !== false) fail("INVALID_AUTHORITY_FLAGS");
  const recordValue: CapaInvestigationActiveAdoptionRecord = {
    adoption_id: input.adoption_id, organization_id: input.organization_id, capa_case_id: input.capa_case_id, case_version_id: input.case_version_id, record_version: input.record_version, output_id: input.output_id as CapaAiOutputId, proposal_key: input.proposal_key, proposal_category: input.proposal_category, adopted_item: { proposal_key: input.proposal_key, adopted_content, ...(input.adopted_item.human_causal_role === undefined ? {} : { human_causal_role: input.adopted_item.human_causal_role }) }, resolved_reference_bindings: validateBindings(input.resolved_reference_bindings), reference_manifest_schema_version: input.reference_manifest_schema_version, reference_manifest_fingerprint_algorithm: input.reference_manifest_fingerprint_algorithm, reference_manifest_sha256: input.reference_manifest_sha256, adopted_at: input.adopted_at, adopted_by: { actor_type: "human", actor_id: input.adopted_by.actor_id }, adoption_policy_version: CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION, request_id: input.request_id, correlation_id: input.correlation_id, idempotency_key: input.idempotency_key, workflow_mutated: false, controlled_record_mutated: false, gate_approved: false,
  };
  return freeze(recordValue);
}

export function constructCapaInvestigationActiveAdoption(input: ConstructCapaInvestigationActiveAdoptionInput): CapaInvestigationActiveAdoptionRecord {
  return constructCapaInvestigationActiveAdoptionInternal(input);
}

export function validateCapaInvestigationActiveAdoptionRecord(
  value: unknown,
): CapaInvestigationActiveAdoptionRecord {
  if (!record(value)) fail("INVALID_ADOPTION_INPUT");
  const candidate = value as Record<string, unknown>;
  return constructCapaInvestigationActiveAdoptionInternal({
    adoption_id: candidate.adoption_id as never,
    organization_id: candidate.organization_id as never,
    capa_case_id: candidate.capa_case_id as never,
    case_version_id: candidate.case_version_id as never,
    record_version: candidate.record_version as number,
    output_id: candidate.output_id as string,
    proposal_key: candidate.proposal_key as string,
    proposal_category: candidate.proposal_category as CapaInvestigationActiveAdoptionCategory,
    adopted_item: candidate.adopted_item as never,
    resolved_reference_bindings: candidate.resolved_reference_bindings as never,
    reference_manifest_schema_version: candidate.reference_manifest_schema_version as string,
    reference_manifest_fingerprint_algorithm: candidate.reference_manifest_fingerprint_algorithm as string,
    reference_manifest_sha256: candidate.reference_manifest_sha256 as string,
    adopted_at: candidate.adopted_at as IsoDateTime,
    adopted_by: candidate.adopted_by as never,
    adoption_policy_version: candidate.adoption_policy_version as string,
    request_id: candidate.request_id as never,
    correlation_id: candidate.correlation_id as never,
    idempotency_key: candidate.idempotency_key as never,
    workflow_mutated: candidate.workflow_mutated as false,
    controlled_record_mutated: candidate.controlled_record_mutated as false,
    gate_approved: candidate.gate_approved as false,
  }, true);
}
