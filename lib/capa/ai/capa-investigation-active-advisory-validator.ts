import type { CapaCaseVersionId } from "../domain/capa-types";
import {
  validateCapaEvidenceAssumptionLedger,
} from "../domain/capa-evidence-assumption-ledger";
import {
  validateCapaRootCausePackage,
} from "../domain/capa-root-cause-package";
import type { CapaInvestigationActiveAdvisoryRequest } from "./capa-investigation-active-advisory-service";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class CapaInvestigationActiveAdvisoryValidationError extends Error {
  readonly reason_code: "INVALID_ADVISORY_INPUT" | "UNSUPPORTED_ADVISORY_INPUT_FIELD" | "INVALID_UNTRUSTED_HUMAN_DRAFT";
  constructor(reason_code: CapaInvestigationActiveAdvisoryValidationError["reason_code"]) {
    super("The governed CAPA investigation-active advisory request is invalid.");
    this.name = "CapaInvestigationActiveAdvisoryValidationError";
    this.reason_code = reason_code;
  }
}

function fail(reason: CapaInvestigationActiveAdvisoryValidationError["reason_code"]): never { throw new CapaInvestigationActiveAdvisoryValidationError(reason); }
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean { return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key)); }

export function validateCapaInvestigationActiveAdvisoryBrowserRequest(value: unknown): CapaInvestigationActiveAdvisoryRequest {
  if (!record(value)) fail("INVALID_ADVISORY_INPUT");
  const allowed = ["expected_case_version_id", "expected_record_version", "untrusted_human_draft"] as const;
  if (Object.keys(value).some((key) => !allowed.includes(key as never))) fail("UNSUPPORTED_ADVISORY_INPUT_FIELD");
  if (typeof value.expected_case_version_id !== "string" || !UUID.test(value.expected_case_version_id) ||
      typeof value.expected_record_version !== "number" || !Number.isSafeInteger(value.expected_record_version) || value.expected_record_version < 1) fail("INVALID_ADVISORY_INPUT");
  if (value.untrusted_human_draft === undefined || value.untrusted_human_draft === null) {
    return Object.freeze({
      expected_case_version_id: value.expected_case_version_id as CapaCaseVersionId,
      expected_record_version: value.expected_record_version,
      untrusted_human_draft: null,
    });
  }
  if (!record(value.untrusted_human_draft) || !exact(value.untrusted_human_draft, ["trust", "evidence_assumption_ledger", "root_cause_package"]) || value.untrusted_human_draft.trust !== "untrusted_human_draft") fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  const ledger = validateCapaEvidenceAssumptionLedger(value.untrusted_human_draft.evidence_assumption_ledger);
  if (ledger.status !== "valid") fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  const root = validateCapaRootCausePackage(value.untrusted_human_draft.root_cause_package, ledger.value);
  if (root.status !== "valid") fail("INVALID_UNTRUSTED_HUMAN_DRAFT");
  return Object.freeze({
    expected_case_version_id: value.expected_case_version_id as CapaCaseVersionId,
    expected_record_version: value.expected_record_version,
    untrusted_human_draft: Object.freeze({ trust: "untrusted_human_draft" as const, evidence_assumption_ledger: ledger.value, root_cause_package: root.value }),
  });
}
