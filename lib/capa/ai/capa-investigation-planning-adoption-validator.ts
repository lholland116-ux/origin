import type { CapaCaseVersionId, IsoDateTime, UserId } from "../domain/capa-types";

import type {
  CapaAiOutputId,
  ControlledVersion,
} from "./capa-prompt-contract";

import {
  type CapaInvestigationPlanAdvisoryProposalKey,
} from "./capa-investigation-planning-advisory-contract";

import {
  CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION,
  CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_DEPENDENCIES,
  CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_ITEMS,
  CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_TEXT_CHARACTERS,
  type CapaInvestigationPlanningAdoptedItem,
  type CapaInvestigationPlanningAdoptionItemIntent,
  type CapaInvestigationPlanningAdoptionIntentRequest,
  type CapaInvestigationPlanningAdoptionRecord,
  type ConstructCapaInvestigationPlanningAdoptionInput,
} from "./capa-investigation-planning-adoption-contract";

export const CAPA_INVESTIGATION_PLANNING_ADOPTION_VALIDATION_REASON_CODES = [
  "INVALID_ADOPTION_INPUT",
  "UNSUPPORTED_ADOPTION_INPUT_FIELD",
  "INVALID_EXPECTED_CASE_VERSION_ID",
  "INVALID_EXPECTED_RECORD_VERSION",
  "INVALID_OUTPUT_ID",
  "INVALID_SELECTED_ITEMS",
  "INVALID_PROPOSAL_KEY",
  "DUPLICATE_PROPOSAL_KEY",
  "INVALID_ADOPTED_ITEM",
  "INVALID_OWNER_USER_ID",
  "INVALID_DUE_DATE",
  "INVALID_DEPENDENCY_PROPOSAL_KEY",
  "SELF_DEPENDENCY",
  "DEPENDENCY_CYCLE",
  "ADOPTION_TEXT_TOO_LONG",
  "INVALID_ADOPTION_ID",
  "INVALID_ORGANIZATION",
  "INVALID_CASE_ID",
  "INVALID_ADOPTION_TIMESTAMP",
  "INVALID_ADOPTER",
  "INVALID_ADOPTION_POLICY_VERSION",
  "INVALID_REQUEST_ID",
  "INVALID_CORRELATION_ID",
  "INVALID_IDEMPOTENCY_KEY",
] as const;

export type CapaInvestigationPlanningAdoptionValidationReasonCode =
  (typeof CAPA_INVESTIGATION_PLANNING_ADOPTION_VALIDATION_REASON_CODES)[number];

export class CapaInvestigationPlanningAdoptionValidationError extends Error {
  readonly reason_code:
    CapaInvestigationPlanningAdoptionValidationReasonCode;

  constructor(reasonCode: CapaInvestigationPlanningAdoptionValidationReasonCode) {
    super("The governed CAPA investigation-planning adoption is invalid.");
    this.name = "CapaInvestigationPlanningAdoptionValidationError";
    this.reason_code = reasonCode;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const PROPOSAL_KEY_PATTERN = /^P[1-9][0-9]{0,2}$/;
const MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS = 128;

function fail(
  reasonCode: CapaInvestigationPlanningAdoptionValidationReasonCode,
): never {
  throw new CapaInvestigationPlanningAdoptionValidationError(reasonCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === expected.length &&
    expected.every((key) => Object.hasOwn(value, key));
}

function validUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function validProposalKey(
  value: unknown,
): value is CapaInvestigationPlanAdvisoryProposalKey {
  return typeof value === "string" && PROPOSAL_KEY_PATTERN.test(value);
}

function validIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validIsoTimestamp(value: unknown): value is IsoDateTime {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function validControlledVersion(value: unknown): value is ControlledVersion {
  return typeof value === "string" && VERSION_PATTERN.test(value);
}

function normalizedNullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== "string") return undefined;
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length > CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_TEXT_CHARACTERS) {
    return undefined;
  }
  return normalized.length === 0 ? null : normalized;
}

const ITEM_FIELDS = [
  "proposal_key",
  "investigation_question",
  "evidence_target",
  "investigation_method",
  "scope_relationship",
  "owner_user_id",
  "due_date",
  "dependency_proposal_keys",
] as const;

function normalizeItem(
  value: unknown,
  reasonForKey: CapaInvestigationPlanningAdoptionValidationReasonCode =
    "INVALID_ADOPTED_ITEM",
): CapaInvestigationPlanningAdoptionItemIntent {
  if (!isRecord(value) || !hasExactKeys(value, ITEM_FIELDS)) {
    fail(reasonForKey);
  }

  if (!validProposalKey(value.proposal_key)) {
    fail("INVALID_PROPOSAL_KEY");
  }

  const investigationQuestion = normalizedNullableText(value.investigation_question);
  const evidenceTarget = normalizedNullableText(value.evidence_target);
  const investigationMethod = normalizedNullableText(value.investigation_method);
  const scopeRelationship = normalizedNullableText(value.scope_relationship);
  if (
    investigationQuestion === undefined ||
    evidenceTarget === undefined ||
    investigationMethod === undefined ||
    scopeRelationship === undefined
  ) {
    fail("ADOPTION_TEXT_TOO_LONG");
  }

  if (value.owner_user_id !== null && !validUuid(value.owner_user_id)) {
    fail("INVALID_OWNER_USER_ID");
  }

  if (value.due_date !== null && !validIsoDate(value.due_date)) {
    fail("INVALID_DUE_DATE");
  }

  if (
    !Array.isArray(value.dependency_proposal_keys) ||
    value.dependency_proposal_keys.length > CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_DEPENDENCIES
  ) {
    fail("INVALID_DEPENDENCY_PROPOSAL_KEY");
  }

  const dependencies: CapaInvestigationPlanAdvisoryProposalKey[] = [];
  for (const dependency of value.dependency_proposal_keys) {
    if (!validProposalKey(dependency)) fail("INVALID_DEPENDENCY_PROPOSAL_KEY");
    if (dependency === value.proposal_key) fail("SELF_DEPENDENCY");
    if (dependencies.includes(dependency)) fail("INVALID_DEPENDENCY_PROPOSAL_KEY");
    dependencies.push(dependency);
  }

  return Object.freeze({
    proposal_key: value.proposal_key,
    investigation_question: investigationQuestion,
    evidence_target: evidenceTarget,
    investigation_method: investigationMethod,
    scope_relationship: scopeRelationship,
    owner_user_id: value.owner_user_id as UserId | null,
    due_date: value.due_date as string | null,
    dependency_proposal_keys: Object.freeze(dependencies),
  });
}

function ensureNoDependencyCycle(
  items: readonly CapaInvestigationPlanningAdoptionItemIntent[],
): void {
  const keys = new Set<string>(items.map((item) => item.proposal_key));
  const graph = new Map<string, readonly string[]>(
    items.map((item) => [item.proposal_key, item.dependency_proposal_keys]),
  );
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function visit(key: string): boolean {
    if (visiting.has(key)) return true;
    if (visited.has(key)) return false;
    visiting.add(key);
    for (const dependency of graph.get(key) ?? []) {
      if (!keys.has(dependency) || visit(dependency)) return true;
    }
    visiting.delete(key);
    visited.add(key);
    return false;
  }

  if (items.some((item) => visit(item.proposal_key))) {
    fail("DEPENDENCY_CYCLE");
  }
}

export function validateCapaInvestigationPlanningAdoptionIntent(
  value: unknown,
): CapaInvestigationPlanningAdoptionIntentRequest {
  if (!isRecord(value)) fail("INVALID_ADOPTION_INPUT");
  if (!hasExactKeys(value, [
    "expected_case_version_id",
    "expected_record_version",
    "output_id",
    "selected_items",
  ])) {
    const allowed = new Set([
      "expected_case_version_id",
      "expected_record_version",
      "output_id",
      "selected_items",
    ]);
    fail(Object.keys(value).some((key) => !allowed.has(key))
      ? "UNSUPPORTED_ADOPTION_INPUT_FIELD"
      : "INVALID_ADOPTION_INPUT");
  }

  if (!validUuid(value.expected_case_version_id)) {
    fail("INVALID_EXPECTED_CASE_VERSION_ID");
  }
  if (
    typeof value.expected_record_version !== "number" ||
    !Number.isSafeInteger(value.expected_record_version) ||
    value.expected_record_version < 1
  ) {
    fail("INVALID_EXPECTED_RECORD_VERSION");
  }
  if (!validUuid(value.output_id)) fail("INVALID_OUTPUT_ID");
  if (
    !Array.isArray(value.selected_items) ||
    value.selected_items.length < 1 ||
    value.selected_items.length > CAPA_INVESTIGATION_PLANNING_ADOPTION_MAXIMUM_ITEMS
  ) {
    fail("INVALID_SELECTED_ITEMS");
  }

  const items = value.selected_items.map((item) => normalizeItem(item, "INVALID_ADOPTED_ITEM"));
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.proposal_key)) fail("DUPLICATE_PROPOSAL_KEY");
    seen.add(item.proposal_key);
  }
  ensureNoDependencyCycle(items);

  let serialized: string | undefined;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("INVALID_ADOPTION_INPUT");
  }
  if (
    serialized === undefined ||
    serialized.length > 30_000
  ) {
    fail("ADOPTION_TEXT_TOO_LONG");
  }

  return Object.freeze({
    expected_case_version_id: value.expected_case_version_id as CapaCaseVersionId,
    expected_record_version: value.expected_record_version as number,
    output_id: value.output_id as CapaAiOutputId,
    selected_items: Object.freeze(items),
  });
}

export function constructCapaInvestigationPlanningAdoption(
  input: ConstructCapaInvestigationPlanningAdoptionInput,
): CapaInvestigationPlanningAdoptionRecord {
  if (!isRecord(input)) fail("INVALID_ADOPTION_INPUT");
  if (!validUuid(input.adoption_id)) fail("INVALID_ADOPTION_ID");
  if (!validUuid(input.organization_id)) fail("INVALID_ORGANIZATION");
  if (!validUuid(input.capa_case_id)) fail("INVALID_CASE_ID");
  if (!validUuid(input.case_version_id)) fail("INVALID_EXPECTED_CASE_VERSION_ID");
  if (!Number.isSafeInteger(input.record_version) || input.record_version < 1) {
    fail("INVALID_EXPECTED_RECORD_VERSION");
  }
  if (!validUuid(input.output_id)) fail("INVALID_OUTPUT_ID");
  if (!validIsoTimestamp(input.adopted_at)) fail("INVALID_ADOPTION_TIMESTAMP");
  if (
    !isRecord(input.adopted_by) ||
    input.adopted_by.actor_type !== "human" ||
    typeof input.adopted_by.actor_id !== "string" ||
    input.adopted_by.actor_id.trim() !== input.adopted_by.actor_id ||
    input.adopted_by.actor_id.length < 1 ||
    input.adopted_by.actor_id.length > 256
  ) {
    fail("INVALID_ADOPTER");
  }
  if (!validUuid(input.request_id)) fail("INVALID_REQUEST_ID");
  if (!validUuid(input.correlation_id)) fail("INVALID_CORRELATION_ID");
  if (
    typeof input.idempotency_key !== "string" ||
    input.idempotency_key.trim() !== input.idempotency_key ||
    input.idempotency_key.length < 1 ||
    input.idempotency_key.length > MAXIMUM_IDEMPOTENCY_KEY_CHARACTERS
  ) {
    fail("INVALID_IDEMPOTENCY_KEY");
  }

  const item = normalizeItem(input.adopted_item);
  if (item.proposal_key !== input.adopted_item.proposal_key) {
    fail("INVALID_ADOPTED_ITEM");
  }
  const policyVersion = input.adoption_policy_version ??
    CAPA_INVESTIGATION_PLANNING_ADOPTION_POLICY_VERSION;
  if (!validControlledVersion(policyVersion)) fail("INVALID_ADOPTION_POLICY_VERSION");

  return Object.freeze({
    adoption_id: input.adoption_id,
    organization_id: input.organization_id,
    capa_case_id: input.capa_case_id,
    case_version_id: input.case_version_id,
    record_version: input.record_version,
    output_id: input.output_id as CapaAiOutputId,
    proposal_key: item.proposal_key,
    adopted_item: Object.freeze(item as CapaInvestigationPlanningAdoptedItem),
    adopted_at: input.adopted_at,
    adopted_by: Object.freeze({
      ...input.adopted_by,
      actor_type: "human" as const,
    }),
    adoption_policy_version: policyVersion,
    request_id: input.request_id,
    correlation_id: input.correlation_id,
    idempotency_key: input.idempotency_key,
    workflow_mutated: false,
    controlled_record_mutated: false,
    gate_approved: false,
  });
}
