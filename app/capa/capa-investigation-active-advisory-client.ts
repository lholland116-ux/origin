import type { RootCauseLedgerDraft, RootCausePackageDraft } from "./capa-root-cause-draft";
import {
  CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION,
  type CapaInvestigationActiveAdvisoryProposal,
  type CapaInvestigationActiveAdvisoryUncertainty,
} from "../../lib/capa/ai/capa-investigation-active-advisory-contract";
import { validateCapaInvestigationActiveAdvisoryModelOutput } from "../../lib/capa/ai/capa-investigation-active-advisory-output-validator";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && value.trim() === value && UUID.test(value);
const positiveInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const warnings = (value: unknown): readonly string[] | null => Array.isArray(value) && value.every((item) => typeof item === "string" && item.length > 0 && item.trim() === item) ? Object.freeze([...value]) : null;

export interface CapaInvestigationActiveAdvisoryRequest {
  readonly expected_case_version_id: string;
  readonly expected_record_version: number;
  readonly untrusted_human_draft: {
    readonly trust: "untrusted_human_draft";
    readonly evidence_assumption_ledger: RootCauseLedgerDraft;
    readonly root_cause_package: RootCausePackageDraft;
  };
}
export interface CapaInvestigationActiveAdvisorySuccess {
  readonly advisory: {
    readonly runId: string;
    readonly outputId: string;
    readonly status: "completed_draft";
    readonly proposal: CapaInvestigationActiveAdvisoryProposal;
    readonly uncertaintyAndLimitations: readonly CapaInvestigationActiveAdvisoryUncertainty[];
    readonly warnings: readonly string[];
  };
  readonly snapshot: { readonly capaCaseId: string; readonly caseVersionId: string; readonly recordVersion: number };
  readonly correlationId: string;
}
export interface CapaInvestigationActiveAdvisoryFailure {
  readonly code: string | null;
  readonly message: string;
  readonly correlationId: string | null;
}

function parseAdvisory(value: unknown): CapaInvestigationActiveAdvisorySuccess["advisory"] | null {
  if (!record(value) || !exact(value, ["run_id", "output_id", "output_schema_version", "status", "proposal", "uncertainty_and_limitations", "citations", "warnings", "advisory_only", "workflow_mutated", "human_acceptance_required"]) ||
    !uuid(value.run_id) || !uuid(value.output_id) || value.output_schema_version !== CAPA_INVESTIGATION_ACTIVE_ADVISORY_OUTPUT_SCHEMA_VERSION || value.status !== "completed_draft" || value.advisory_only !== true || value.workflow_mutated !== false || value.human_acceptance_required !== true || !Array.isArray(value.citations) || value.citations.length !== 0 || !Array.isArray(value.uncertainty_and_limitations)) return null;
  const warningList = warnings(value.warnings);
  if (warningList === null) return null;
  let parsed: ReturnType<typeof validateCapaInvestigationActiveAdvisoryModelOutput>;
  try {
    parsed = validateCapaInvestigationActiveAdvisoryModelOutput(JSON.stringify({ proposal: value.proposal, uncertainty_and_limitations: value.uncertainty_and_limitations, citations: [], advisory_only: true, workflow_mutated: false, human_acceptance_required: true }));
  } catch { return null; }
  return Object.freeze({ runId: value.run_id, outputId: value.output_id, status: "completed_draft" as const, proposal: parsed.proposal, uncertaintyAndLimitations: parsed.uncertainty_and_limitations, warnings: warningList });
}

export function buildCapaInvestigationActiveAdvisoryRequest(input: {
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly ledger: RootCauseLedgerDraft;
  readonly rootCausePackage: RootCausePackageDraft;
}): CapaInvestigationActiveAdvisoryRequest {
  return Object.freeze({ expected_case_version_id: input.currentVersionId, expected_record_version: input.recordVersion, untrusted_human_draft: Object.freeze({ trust: "untrusted_human_draft" as const, evidence_assumption_ledger: input.ledger, root_cause_package: input.rootCausePackage }) });
}

export function parseCapaInvestigationActiveAdvisorySuccess(value: unknown, expected?: { readonly caseId: string; readonly currentVersionId: string; readonly recordVersion: number }): CapaInvestigationActiveAdvisorySuccess | null {
  if (!record(value) || !exact(value, ["advisory", "snapshot", "correlation_id"]) || !record(value.snapshot) || !exact(value.snapshot, ["capa_case_id", "case_version_id", "record_version"]) || !uuid(value.snapshot.capa_case_id) || !uuid(value.snapshot.case_version_id) || !positiveInteger(value.snapshot.record_version) || !uuid(value.correlation_id)) return null;
  if (expected !== undefined && (value.snapshot.capa_case_id !== expected.caseId || value.snapshot.case_version_id !== expected.currentVersionId || value.snapshot.record_version !== expected.recordVersion)) return null;
  const advisory = parseAdvisory(value.advisory);
  if (advisory === null) return null;
  return Object.freeze({ advisory, snapshot: Object.freeze({ capaCaseId: value.snapshot.capa_case_id, caseVersionId: value.snapshot.case_version_id, recordVersion: value.snapshot.record_version }), correlationId: value.correlation_id });
}

export function parseCapaInvestigationActiveAdvisoryFailure(value: unknown): CapaInvestigationActiveAdvisoryFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  return Object.freeze({ code: error && typeof error.code === "string" ? error.code : null, message: error && typeof error.message === "string" ? error.message : "The governed S40 advisory could not be completed.", correlationId: error && uuid(error.correlation_id) ? error.correlation_id : null });
}

export async function fetchCapaInvestigationActiveAdvisory(caseId: string, request: CapaInvestigationActiveAdvisoryRequest, fetcher: typeof fetch = fetch, trace: { readonly requestId: string; readonly correlationId: string } = { requestId: crypto.randomUUID(), correlationId: crypto.randomUUID() }): Promise<CapaInvestigationActiveAdvisorySuccess | CapaInvestigationActiveAdvisoryFailure> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/investigation-active-advisory`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-request-id": trace.requestId, "x-correlation-id": trace.correlationId }, body: JSON.stringify(request) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseCapaInvestigationActiveAdvisoryFailure(body);
    return parseCapaInvestigationActiveAdvisorySuccess(body, { caseId, currentVersionId: request.expected_case_version_id, recordVersion: request.expected_record_version }) ?? { code: "INVALID_ADVISORY_RESPONSE", message: "The advisory response could not be verified.", correlationId: trace.correlationId };
  } catch { return { code: null, message: "The governed S40 advisory could not be completed.", correlationId: trace.correlationId }; }
}
