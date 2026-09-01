import {
  CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT,
  type CapaContainmentRiskAdvisoryRequest,
  type CapaContainmentRiskAdvisoryUntrustedHumanDraft,
} from "./capa-containment-risk-advisory-contract";

import {
  validateCapaContainmentRiskContent,
} from "../domain/capa-containment-risk";

const MAXIMUM_FOCUS_CHARACTERS = 1_000;
const MAXIMUM_DRAFT_CHARACTERS = 30_000;
const MAXIMUM_ACTIONS = 50;
const MAXIMUM_ESCALATIONS = 50;
const MAXIMUM_LIST_ITEMS = 100;
const MAXIMUM_TEXT_CHARACTERS = 4_000;
const ALLOWED_FIELDS = new Set([
  "focus",
  "untrusted_human_draft",
]);

export const CAPA_CONTAINMENT_RISK_ADVISORY_VALIDATION_REASON_CODES = [
  "INVALID_ADVISORY_INPUT",
  "UNSUPPORTED_ADVISORY_INPUT_FIELD",
  "ADVISORY_FOCUS_TOO_LONG",
  "INVALID_UNTRUSTED_HUMAN_DRAFT",
  "UNTRUSTED_HUMAN_DRAFT_TOO_LARGE",
] as const;

export type CapaContainmentRiskAdvisoryValidationReasonCode =
  (typeof CAPA_CONTAINMENT_RISK_ADVISORY_VALIDATION_REASON_CODES)[number];

export class CapaContainmentRiskAdvisoryValidationError extends Error {
  readonly reason_code: CapaContainmentRiskAdvisoryValidationReasonCode;

  constructor(reasonCode: CapaContainmentRiskAdvisoryValidationReasonCode) {
    super("The governed CAPA containment/risk advisory request is invalid.");
    this.name = "CapaContainmentRiskAdvisoryValidationError";
    this.reason_code = reasonCode;
  }
}

function fail(reasonCode: CapaContainmentRiskAdvisoryValidationReasonCode): never {
  throw new CapaContainmentRiskAdvisoryValidationError(reasonCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizedFocus(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") fail("INVALID_ADVISORY_INPUT");
  const normalized = value.normalize("NFKC").trim();
  if (normalized.length === 0) return null;
  if (normalized.length > MAXIMUM_FOCUS_CHARACTERS) {
    fail("ADVISORY_FOCUS_TOO_LONG");
  }
  return normalized;
}

function boundedText(value: string | null): boolean {
  return value === null || value.length <= MAXIMUM_TEXT_CHARACTERS;
}

function boundedList(value: readonly string[]): boolean {
  return value.length <= MAXIMUM_LIST_ITEMS && value.every(
    (item) => item.length <= MAXIMUM_TEXT_CHARACTERS,
  );
}

function boundedDraft(
  value: CapaContainmentRiskAdvisoryUntrustedHumanDraft["content"],
): boolean {
  return (
    value.actions.length <= MAXIMUM_ACTIONS &&
    value.escalations.length <= MAXIMUM_ESCALATIONS &&
    value.actions.every((action) =>
      action.action_id.length <= MAXIMUM_TEXT_CHARACTERS &&
      action.description.length <= MAXIMUM_TEXT_CHARACTERS &&
      boundedText(action.owner_user_id) &&
      action.rationale.length <= MAXIMUM_TEXT_CHARACTERS &&
      boundedList(action.supporting_evidence_references)
    ) &&
    boundedList(value.impact_scope.products) &&
    boundedList(value.impact_scope.processes) &&
    boundedList(value.impact_scope.data) &&
    boundedList(value.impact_scope.customers) &&
    boundedList(value.impact_scope.patients) &&
    boundedList(value.missing_risk_information) &&
    (
      value.risk_evaluation === null ||
      (
        value.risk_evaluation.method.length <= MAXIMUM_TEXT_CHARACTERS &&
        boundedText(value.risk_evaluation.terminology_version) &&
        value.risk_evaluation.result.length <= MAXIMUM_TEXT_CHARACTERS &&
        value.risk_evaluation.rationale.length <= MAXIMUM_TEXT_CHARACTERS
      )
    ) &&
    value.escalations.every((item) =>
      item.process.length <= MAXIMUM_TEXT_CHARACTERS &&
      item.reference.length <= MAXIMUM_TEXT_CHARACTERS &&
      item.status.length <= MAXIMUM_TEXT_CHARACTERS &&
      item.rationale.length <= MAXIMUM_TEXT_CHARACTERS
    )
  );
}

function untrustedDraft(value: unknown): CapaContainmentRiskAdvisoryUntrustedHumanDraft | null {
  if (value === undefined || value === null) return null;

  if (
    !isRecord(value) ||
    Object.keys(value).length !== 2 ||
    !Object.prototype.hasOwnProperty.call(value, "trust") ||
    !Object.prototype.hasOwnProperty.call(value, "content") ||
    value.trust !== "untrusted_human_draft"
  ) {
    fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(value);
  } catch {
    fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  }
  if (serialized.length > MAXIMUM_DRAFT_CHARACTERS) {
    fail("UNTRUSTED_HUMAN_DRAFT_TOO_LARGE");
  }

  const result = validateCapaContainmentRiskContent(value.content);
  if (result.status !== "valid" || !boundedDraft(result.value)) {
    fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  }
  return Object.freeze({
    trust: "untrusted_human_draft",
    content: result.value,
  });
}

export function validateCapaContainmentRiskAdvisoryBrowserRequest(
  value: unknown,
): CapaContainmentRiskAdvisoryRequest {
  if (!isRecord(value)) fail("INVALID_ADVISORY_INPUT");
  for (const field of Object.keys(value)) {
    if (!ALLOWED_FIELDS.has(field)) fail("UNSUPPORTED_ADVISORY_INPUT_FIELD");
  }

  return Object.freeze({
    requested_output: CAPA_CONTAINMENT_RISK_ADVISORY_OUTPUT,
    focus: normalizedFocus(value.focus),
    untrusted_human_draft: untrustedDraft(value.untrusted_human_draft),
  });
}
