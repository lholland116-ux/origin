import {
  validateCapaEvidenceAssumptionLedger,
  type CapaEvidenceAssumptionLedgerContent,
} from "../domain/capa-evidence-assumption-ledger";
import {
  validateCapaRootCausePackage,
  type CapaRootCausePackageContent,
} from "../domain/capa-root-cause-package";

export interface CapaInvestigationActiveWorkspaceDraftSaveRequest {
  readonly expected_draft_revision: number | null;
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
}

export type CapaInvestigationActiveWorkspaceDraftRequestValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaInvestigationActiveWorkspaceDraftSaveRequest;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        | "INVALID_WORKSPACE_REQUEST_OBJECT"
        | "INVALID_WORKSPACE_REQUEST_FIELDS"
        | "INVALID_WORKSPACE_REQUEST_REVISION"
        | "INVALID_WORKSPACE_REQUEST_LEDGER"
        | "INVALID_WORKSPACE_REQUEST_ROOT_CAUSE_PACKAGE";
      readonly detail_reason_code?: string;
    };

const FIELDS = [
  "expected_draft_revision",
  "evidence_assumption_ledger",
  "root_cause_package",
] as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>): boolean {
  return Object.keys(value).length === FIELDS.length &&
    FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function structurallyValidAiProvenance(value: { readonly source_type: string; readonly source_reference: string | null; readonly adopted_by_user_id: string | null; readonly adopted_at: string | null }): boolean {
  return value.source_type !== "ai_proposal" ||
    (typeof value.source_reference === "string" && UUID.test(value.source_reference) &&
      typeof value.adopted_by_user_id === "string" && UUID.test(value.adopted_by_user_id) &&
      typeof value.adopted_at === "string" && ISO_DATE_TIME.test(value.adopted_at) &&
      !Number.isNaN(Date.parse(value.adopted_at)));
}

export function validateCapaInvestigationActiveWorkspaceDraftSaveRequest(
  value: unknown,
): CapaInvestigationActiveWorkspaceDraftRequestValidationResult {
  if (!object(value)) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_OBJECT" };
  if (!exactFields(value)) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" };
  if (
    value.expected_draft_revision !== null &&
    (typeof value.expected_draft_revision !== "number" ||
      !Number.isSafeInteger(value.expected_draft_revision) ||
      value.expected_draft_revision < 1 ||
      value.expected_draft_revision >= Number.MAX_SAFE_INTEGER)
  ) {
    return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_REVISION" };
  }

  const ledger = validateCapaEvidenceAssumptionLedger(value.evidence_assumption_ledger);
  if (ledger.status !== "valid") {
    return {
      status: "invalid",
      reason_code: "INVALID_WORKSPACE_REQUEST_LEDGER",
      detail_reason_code: ledger.reason_code,
    };
  }

  const rootCause = validateCapaRootCausePackage(value.root_cause_package, ledger.value);
  if (rootCause.status !== "valid") {
    return {
      status: "invalid",
      reason_code: "INVALID_WORKSPACE_REQUEST_ROOT_CAUSE_PACKAGE",
      detail_reason_code: rootCause.reason_code,
    };
  }
  if (ledger.value.items.some((item) => !structurallyValidAiProvenance(item.provenance))) {
    return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_LEDGER" };
  }
  if (
    rootCause.value.hypotheses.some((hypothesis) => !structurallyValidAiProvenance(hypothesis.provenance)) ||
    (rootCause.value.root_cause_not_confirmed !== null &&
      !structurallyValidAiProvenance(rootCause.value.root_cause_not_confirmed.provenance))
  ) {
    return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_ROOT_CAUSE_PACKAGE" };
  }

  return {
    status: "valid",
    value: Object.freeze({
      expected_draft_revision: value.expected_draft_revision,
      evidence_assumption_ledger: ledger.value,
      root_cause_package: rootCause.value,
    }),
  };
}
