import {
  validateCapaEvidenceAssumptionLedger,
} from "../domain/capa-evidence-assumption-ledger";
import {
  validateCapaRootCausePackage,
} from "../domain/capa-root-cause-package";
import type {
  CapaInvestigationActiveWorkspaceDraft,
} from "./capa-investigation-active-workspace-draft-contract";
import {
  CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "./capa-investigation-active-workspace-draft-contract";

export const CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_VALIDATION_REASON_CODES = [
  "INVALID_WORKSPACE_DRAFT_OBJECT",
  "INVALID_WORKSPACE_DRAFT_FIELDS",
  "INVALID_WORKSPACE_DRAFT_SCHEMA_VERSION",
  "INVALID_WORKSPACE_DRAFT_TRUST",
  "INVALID_WORKSPACE_DRAFT_WORKFLOW_STATE",
  "INVALID_WORKSPACE_DRAFT_IDENTITY",
  "INVALID_WORKSPACE_DRAFT_UPDATED_AT",
  "INVALID_WORKSPACE_DRAFT_RECORD_VERSION",
  "INVALID_WORKSPACE_DRAFT_REVISION",
  "INVALID_WORKSPACE_DRAFT_LEDGER",
  "INVALID_WORKSPACE_DRAFT_ROOT_CAUSE_PACKAGE",
] as const;

export type CapaInvestigationActiveWorkspaceDraftValidationReasonCode =
  (typeof CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_VALIDATION_REASON_CODES)[number];

export type CapaInvestigationActiveWorkspaceDraftValidationResult =
  | { readonly status: "valid"; readonly value: CapaInvestigationActiveWorkspaceDraft }
  | { readonly status: "invalid"; readonly reason_code: CapaInvestigationActiveWorkspaceDraftValidationReasonCode };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = [
  "schema_version",
  "trust",
  "workflow_state",
  "organization_id",
  "capa_case_id",
  "case_version_id",
  "record_version",
  "draft_revision",
  "evidence_assumption_ledger",
  "root_cause_package",
  "updated_by_user_id",
  "updated_at",
] as const;

function invalid(
  reason_code: CapaInvestigationActiveWorkspaceDraftValidationReasonCode,
): CapaInvestigationActiveWorkspaceDraftValidationResult {
  return Object.freeze({ status: "invalid", reason_code });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === FIELDS.length &&
    FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function structurallyValidAiProvenance(value: {
  readonly source_type: string;
  readonly source_reference: string | null;
  readonly adopted_by_user_id: string | null;
  readonly adopted_at: string | null;
}): boolean {
  return value.source_type !== "ai_proposal" ||
    (uuid(value.source_reference) &&
      uuid(value.adopted_by_user_id) &&
      isoDateTime(value.adopted_at));
}

/** Validates a durable but non-authoritative S40 workspace snapshot. */
export function validateCapaInvestigationActiveWorkspaceDraft(
  value: unknown,
): CapaInvestigationActiveWorkspaceDraftValidationResult {
  if (!record(value)) return invalid("INVALID_WORKSPACE_DRAFT_OBJECT");
  if (!exactFields(value)) return invalid("INVALID_WORKSPACE_DRAFT_FIELDS");
  if (value.schema_version !== CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION) return invalid("INVALID_WORKSPACE_DRAFT_SCHEMA_VERSION");
  if (value.trust !== "untrusted_human_draft") return invalid("INVALID_WORKSPACE_DRAFT_TRUST");
  if (value.workflow_state !== "S40") return invalid("INVALID_WORKSPACE_DRAFT_WORKFLOW_STATE");
  if (!uuid(value.organization_id) || !uuid(value.capa_case_id) || !uuid(value.case_version_id) || !uuid(value.updated_by_user_id)) return invalid("INVALID_WORKSPACE_DRAFT_IDENTITY");
  if (!isoDateTime(value.updated_at)) return invalid("INVALID_WORKSPACE_DRAFT_UPDATED_AT");
  if (typeof value.record_version !== "number" || !Number.isSafeInteger(value.record_version) || value.record_version < 1) return invalid("INVALID_WORKSPACE_DRAFT_RECORD_VERSION");
  if (typeof value.draft_revision !== "number" || !Number.isSafeInteger(value.draft_revision) || value.draft_revision < 1) return invalid("INVALID_WORKSPACE_DRAFT_REVISION");

  const ledger = validateCapaEvidenceAssumptionLedger(value.evidence_assumption_ledger);
  if (ledger.status !== "valid") return invalid("INVALID_WORKSPACE_DRAFT_LEDGER");
  if (ledger.value.items.some((item) => !structurallyValidAiProvenance(item.provenance))) return invalid("INVALID_WORKSPACE_DRAFT_LEDGER");
  const rootCause = validateCapaRootCausePackage(value.root_cause_package, ledger.value);
  if (rootCause.status !== "valid") return invalid("INVALID_WORKSPACE_DRAFT_ROOT_CAUSE_PACKAGE");
  if (
    rootCause.value.hypotheses.some((hypothesis) =>
      !structurallyValidAiProvenance(hypothesis.provenance),
    ) ||
    (rootCause.value.root_cause_not_confirmed !== null &&
      !structurallyValidAiProvenance(
        rootCause.value.root_cause_not_confirmed.provenance,
      ))
  ) return invalid("INVALID_WORKSPACE_DRAFT_ROOT_CAUSE_PACKAGE");

  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_INVESTIGATION_ACTIVE_WORKSPACE_DRAFT_SCHEMA_VERSION,
      trust: "untrusted_human_draft" as const,
      workflow_state: "S40" as const,
      organization_id: value.organization_id as never,
      capa_case_id: value.capa_case_id as never,
      case_version_id: value.case_version_id as never,
      record_version: value.record_version,
      draft_revision: value.draft_revision,
      evidence_assumption_ledger: ledger.value,
      root_cause_package: rootCause.value,
      updated_by_user_id: value.updated_by_user_id as never,
      updated_at: value.updated_at as never,
    }),
  });
}
