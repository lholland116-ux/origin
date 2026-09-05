import type { CapaEvidenceAssumptionLedgerContent } from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import type { CapaRootCausePackageContent } from "../../lib/capa/domain/capa-root-cause-package";
import { validateCapaEvidenceAssumptionLedger } from "../../lib/capa/domain/capa-evidence-assumption-ledger";
import { validateCapaRootCausePackage } from "../../lib/capa/domain/capa-root-cause-package";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && value.trim() === value && UUID.test(value);
const positiveSafeInteger = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
const nullableCorrelationId = (value: unknown): string | null => value === null ? null : uuid(value) ? value : null;
const isoDateTime = (value: unknown): value is string => typeof value === "string" && ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));
const CONTROLLED_FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  CAPA_WORKSPACE_CASE_NOT_FOUND: "The CAPA case was not found.",
  CAPA_WORKSPACE_CASE_STATE_CONFLICT: "The CAPA case is not in the required state for the S40 workspace.",
  WORKFLOW_MUTATION_DETECTED: "The CAPA case changed before this workspace save could be completed.",
  CAPA_WORKSPACE_ACCESS_DENIED: "The S40 workspace operation is not authorized.",
  INVALID_CAPA_INVESTIGATION_ACTIVE_WORKSPACE_REQUEST: "The S40 workspace request is invalid.",
  WORKSPACE_DRAFT_CONCURRENCY_CONFLICT: "The workspace changed before this save could be completed.",
  CAPA_INTERNAL_ERROR: "The S40 workspace request could not be completed.",
};

export interface CapaInvestigationActiveWorkspaceProjection {
  readonly draft_revision: number;
  readonly case_version_id: string;
  readonly record_version: number;
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
  readonly updated_at: string;
}

export interface CapaInvestigationActiveWorkspaceLoadSuccess {
  readonly status: "loaded";
  readonly workspace: CapaInvestigationActiveWorkspaceProjection | null;
  readonly correlation_id: string | null;
}

export interface CapaInvestigationActiveWorkspaceFailure {
  readonly status: "failed";
  readonly code: string | null;
  readonly message: string;
  readonly correlation_id: string | null;
}

export type CapaInvestigationActiveWorkspaceLoadResult = CapaInvestigationActiveWorkspaceLoadSuccess | CapaInvestigationActiveWorkspaceFailure;
export type CapaInvestigationActiveWorkspaceSaveResult =
  | { readonly status: "saved"; readonly workspace: CapaInvestigationActiveWorkspaceProjection; readonly correlation_id: string | null }
  | CapaInvestigationActiveWorkspaceFailure;

export interface CapaInvestigationActiveWorkspaceSaveInput {
  readonly expected_draft_revision: number | null;
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
}

function parseProjection(value: unknown): CapaInvestigationActiveWorkspaceProjection | null {
  if (!record(value) || !exact(value, ["draft_revision", "case_version_id", "record_version", "evidence_assumption_ledger", "root_cause_package", "updated_at"]) ||
    !positiveSafeInteger(value.draft_revision) || !uuid(value.case_version_id) || !positiveSafeInteger(value.record_version) || !isoDateTime(value.updated_at)) return null;
  const ledger = validateCapaEvidenceAssumptionLedger(value.evidence_assumption_ledger);
  if (ledger.status !== "valid") return null;
  const rootPackage = validateCapaRootCausePackage(value.root_cause_package, ledger.value);
  if (rootPackage.status !== "valid") return null;
  return Object.freeze({ draft_revision: value.draft_revision, case_version_id: value.case_version_id, record_version: value.record_version, evidence_assumption_ledger: ledger.value, root_cause_package: rootPackage.value, updated_at: value.updated_at });
}

function parseFailure(value: unknown): CapaInvestigationActiveWorkspaceFailure {
  const error = record(value) && record(value.error) ? value.error : null;
  const candidateCode = error && typeof error.code === "string" ? error.code : null;
  const code = candidateCode !== null && Object.prototype.hasOwnProperty.call(CONTROLLED_FAILURE_MESSAGES, candidateCode) ? candidateCode : null;
  return Object.freeze({ status: "failed" as const, code, message: code === null ? "The S40 workspace could not be persisted." : CONTROLLED_FAILURE_MESSAGES[code]!, correlation_id: error ? nullableCorrelationId(error.correlation_id) : null });
}

function parseCorrelation(value: unknown): string | null {
  return record(value) ? nullableCorrelationId(value.correlation_id) : null;
}

export function parseCapaInvestigationActiveWorkspaceLoad(value: unknown): CapaInvestigationActiveWorkspaceLoadResult {
  if (!record(value) || !exact(value, ["workspace", "correlation_id"]) || !uuid(value.correlation_id) || (value.workspace !== null && parseProjection(value.workspace) === null)) return { status: "failed", code: "INVALID_WORKSPACE_RESPONSE", message: "The S40 workspace response could not be verified.", correlation_id: parseCorrelation(value) };
  return Object.freeze({ status: "loaded", workspace: value.workspace === null ? null : parseProjection(value.workspace)!, correlation_id: nullableCorrelationId(value.correlation_id) });
}

export function parseCapaInvestigationActiveWorkspaceSave(value: unknown): CapaInvestigationActiveWorkspaceSaveResult {
  if (!record(value) || !exact(value, ["workspace", "correlation_id"]) || !uuid(value.correlation_id) || parseProjection(value.workspace) === null) return { status: "failed", code: "INVALID_WORKSPACE_RESPONSE", message: "The S40 workspace response could not be verified.", correlation_id: parseCorrelation(value) };
  return Object.freeze({ status: "saved", workspace: parseProjection(value.workspace)!, correlation_id: nullableCorrelationId(value.correlation_id) });
}

function trace(): { readonly requestId: string; readonly correlationId: string } {
  return { requestId: crypto.randomUUID(), correlationId: crypto.randomUUID() };
}

export async function loadCapaInvestigationActiveWorkspace(caseId: string, fetcher: typeof fetch = fetch): Promise<CapaInvestigationActiveWorkspaceLoadResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/investigation-active-workspace`, { method: "GET", cache: "no-store" });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseFailure(body);
    return parseCapaInvestigationActiveWorkspaceLoad(body);
  } catch {
    return { status: "failed", code: null, message: "The S40 workspace could not be loaded.", correlation_id: null };
  }
}

export async function saveCapaInvestigationActiveWorkspace(caseId: string, input: CapaInvestigationActiveWorkspaceSaveInput, fetcher: typeof fetch = fetch): Promise<CapaInvestigationActiveWorkspaceSaveResult> {
  const requestTrace = trace();
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(caseId)}/investigation-active-workspace`, { method: "PUT", cache: "no-store", headers: { "content-type": "application/json", "x-request-id": requestTrace.requestId, "x-correlation-id": requestTrace.correlationId }, body: JSON.stringify(input) });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) return parseFailure(body);
    return parseCapaInvestigationActiveWorkspaceSave(body);
  } catch {
    return { status: "failed", code: null, message: "The S40 workspace could not be saved.", correlation_id: null };
  }
}

export interface WorkspaceAutosaveSnapshot {
  readonly evidence_assumption_ledger: CapaEvidenceAssumptionLedgerContent;
  readonly root_cause_package: CapaRootCausePackageContent;
}

export type WorkspaceAutosaveStatus = "saved" | "unsaved" | "saving" | "conflict" | "failed" | "blocked";

export function createCapaInvestigationActiveWorkspaceAutosaveCoordinator(input: {
  readonly save: (value: CapaInvestigationActiveWorkspaceSaveInput) => Promise<CapaInvestigationActiveWorkspaceSaveResult>;
  readonly debounceMs?: number;
  readonly onStatus?: (status: WorkspaceAutosaveStatus) => void;
  readonly onSaved?: (workspace: CapaInvestigationActiveWorkspaceProjection) => void;
}) {
  let draftRevision: number | null = null;
  let pending: WorkspaceAutosaveSnapshot | null = null;
  let pendingGeneration: number | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let mutationGeneration = 0;
  let conflict = false;
  let blocked = false;
  let disposed = false;
  const debounceMs = input.debounceMs ?? 700;
  const status = (value: WorkspaceAutosaveStatus) => { if (!disposed) input.onStatus?.(value); };
  const schedule = (delay = debounceMs) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; void flush(); }, delay);
  };
  const flush = async (): Promise<void> => {
    if (disposed || inFlight || conflict || pending === null) return;
    const candidate = pending;
    const candidateGeneration = pendingGeneration!;
    pending = null;
    pendingGeneration = null;
    inFlight = true;
    status("saving");
    let result: CapaInvestigationActiveWorkspaceSaveResult;
    try {
      result = await input.save({ expected_draft_revision: draftRevision, evidence_assumption_ledger: candidate.evidence_assumption_ledger, root_cause_package: candidate.root_cause_package });
    } catch {
      result = { status: "failed", code: null, message: "The S40 workspace could not be saved.", correlation_id: null };
    }
    if (disposed) return;
    inFlight = false;
    if (result.status === "saved") {
      draftRevision = result.workspace.draft_revision;
      input.onSaved?.(result.workspace);
      if (pending !== null) schedule(0);
      else if (mutationGeneration === candidateGeneration) status("saved");
      return;
    }
    if (mutationGeneration === candidateGeneration && pending === null && !blocked && !conflict) {
      pending = candidate;
      pendingGeneration = candidateGeneration;
    }
    if (result.code === "WORKSPACE_DRAFT_CONCURRENCY_CONFLICT" || result.code === "WORKFLOW_MUTATION_DETECTED") {
      conflict = true;
      status("conflict");
    } else if (pending !== null || mutationGeneration === candidateGeneration) {
      status("failed");
    }
  };
  return {
    setRevision(value: number | null) { draftRevision = value; },
    resetFromServer(value: number | null) { if (!disposed) { draftRevision = value; blocked = false; conflict = false; mutationGeneration += 1; pending = null; pendingGeneration = null; if (timer !== null) clearTimeout(timer); timer = null; } },
    queue(value: WorkspaceAutosaveSnapshot) { if (!disposed && !conflict && !blocked) { mutationGeneration += 1; pending = value; pendingGeneration = mutationGeneration; status("unsaved"); schedule(); } },
    markInvalid() { if (!disposed) { mutationGeneration += 1; pending = null; pendingGeneration = null; if (timer !== null) clearTimeout(timer); timer = null; status(conflict ? "conflict" : blocked ? "blocked" : "unsaved"); } },
    markBlocked() { if (!disposed) { mutationGeneration += 1; blocked = true; pending = null; pendingGeneration = null; if (timer !== null) clearTimeout(timer); timer = null; status(conflict ? "conflict" : "blocked"); } },
    retry() { if (!disposed && !conflict && !blocked && pending !== null) schedule(0); },
    isBusy() { return inFlight || pending !== null; },
    dispose() { disposed = true; if (timer !== null) clearTimeout(timer); timer = null; pending = null; pendingGeneration = null; },
  };
}
