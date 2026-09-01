import type { CapaInvestigationPlanItemStatus } from "../../lib/capa/domain/capa-investigation-plan";

export interface InvestigationProgressAttempt {
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly requestBody: string;
}

export interface InvestigationProgressSuccess {
  readonly capaCaseId: string;
  readonly caseNumber: string;
  readonly status: "S40";
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly investigationPlanSectionVersionId: string;
  readonly updatedItemId: string;
  readonly previousItemStatus: CapaInvestigationPlanItemStatus;
  readonly newItemStatus: CapaInvestigationPlanItemStatus;
  readonly updatedAt: string;
  readonly auditEventId: string;
  readonly replayed: boolean;
  readonly correlationId: string | null;
}

export type InvestigationProgressResult =
  | { readonly status: "updated"; readonly value: InvestigationProgressSuccess }
  | { readonly status: "failed"; readonly code: string | null; readonly message: string;
      readonly reasons: readonly string[]; readonly correlationId: string | null;
      readonly retryableExact: boolean; readonly requiresRefresh: boolean };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const statuses = new Set(["planned", "in_progress", "completed", "dispositioned", "cancelled"]);
const string = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const isoDateTime = (value: unknown): value is string => typeof value === "string" &&
  ISO_DATE_TIME.test(value) && !Number.isNaN(Date.parse(value));

export const emptyInvestigationProgressForm = () => Object.freeze({
  activeItemId: null as string | null,
  action: null as "dispositioned" | "cancelled" | null,
  disposition: "",
  rationale: "",
});

export function createInvestigationProgressAttempt(input: {
  readonly caseId: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly itemId: string;
  readonly newStatus: CapaInvestigationPlanItemStatus;
  readonly disposition: string | null;
  readonly dispositionRationale: string | null;
  readonly idempotencyKey: string;
}): InvestigationProgressAttempt | null {
  if (!string(input.caseId) || !UUID.test(input.caseId) || !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 ||
    !string(input.currentVersionId) || !UUID.test(input.currentVersionId) || !string(input.itemId) || !string(input.idempotencyKey) ||
    input.idempotencyKey.trim() !== input.idempotencyKey) return null;
  const needsDisposition = input.newStatus === "dispositioned" || input.newStatus === "cancelled";
  if (needsDisposition !== (string(input.disposition) && string(input.dispositionRationale))) return null;
  if (!needsDisposition && (input.disposition !== null || input.dispositionRationale !== null)) return null;
  return Object.freeze({
    caseId: input.caseId,
    idempotencyKey: input.idempotencyKey,
    requestBody: JSON.stringify({
      expected_record_version: input.recordVersion,
      expected_current_version_id: input.currentVersionId,
      item_id: input.itemId,
      new_status: input.newStatus,
      disposition: input.disposition,
      disposition_rationale: input.dispositionRationale,
    }),
  });
}

function success(body: unknown, attempt: InvestigationProgressAttempt): InvestigationProgressSuccess | null {
  if (!record(body) || !record(body.capa) || typeof body.replayed !== "boolean") return null;
  const capa = body.capa;
  const command: unknown = (() => { try { return JSON.parse(attempt.requestBody); } catch { return null; } })();
  if (!record(command) || typeof command.item_id !== "string" || typeof command.new_status !== "string" ||
    capa.capa_case_id !== attempt.caseId || !UUID.test(attempt.caseId) || !string(capa.case_number) || capa.status !== "S40" ||
    !Number.isSafeInteger(capa.record_version) || (capa.record_version as number) < 1 ||
    typeof capa.current_version_id !== "string" || !UUID.test(capa.current_version_id) ||
    typeof capa.investigation_plan_section_version_id !== "string" || !UUID.test(capa.investigation_plan_section_version_id) ||
    typeof capa.updated_item_id !== "string" || capa.updated_item_id !== command.item_id || !statuses.has(String(capa.previous_item_status)) ||
    capa.new_item_status !== command.new_status || !statuses.has(String(capa.new_item_status)) ||
    !isoDateTime(capa.updated_at) || typeof capa.audit_event_id !== "string" || !UUID.test(capa.audit_event_id) ||
    !(body.correlation_id === null || (typeof body.correlation_id === "string" && UUID.test(body.correlation_id)))) return null;
  return Object.freeze({
    capaCaseId: capa.capa_case_id, caseNumber: capa.case_number, status: "S40",
    recordVersion: capa.record_version as number, currentVersionId: capa.current_version_id,
    investigationPlanSectionVersionId: capa.investigation_plan_section_version_id,
    updatedItemId: capa.updated_item_id,
    previousItemStatus: capa.previous_item_status as CapaInvestigationPlanItemStatus,
    newItemStatus: capa.new_item_status as CapaInvestigationPlanItemStatus,
    updatedAt: capa.updated_at, auditEventId: capa.audit_event_id,
    replayed: body.replayed, correlationId: body.correlation_id ?? null,
  });
}

export async function submitInvestigationProgressAttempt(
  attempt: InvestigationProgressAttempt,
  fetcher: typeof fetch = fetch,
): Promise<InvestigationProgressResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/investigation-progress`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": attempt.idempotencyKey },
      body: attempt.requestBody,
    });
    const body: unknown = await response.json().catch(() => null);
    const parsed = response.ok ? success(body, attempt) : null;
    if (parsed !== null) return { status: "updated", value: parsed };
    const error = record(body) && record(body.error) ? body.error : null;
    const code = error && typeof error.code === "string" ? error.code : null;
    const reasons = error && Array.isArray(error.issues)
      ? error.issues.flatMap((issue) => record(issue) && typeof issue.message === "string" ? [issue.message] : [])
      : [];
    return { status: "failed", code,
      message: error && typeof error.message === "string" ? error.message : "Investigation progress could not be updated.",
      reasons: Object.freeze(reasons),
      correlationId: record(body) && typeof body.correlation_id === "string" ? body.correlation_id : null,
      retryableExact: response.status >= 500 || response.ok,
      requiresRefresh: code === "CAPA_CONCURRENCY_CONFLICT" || code === "CAPA_WORKFLOW_CONFLICT" };
  } catch {
    return { status: "failed", code: null, message: "The investigation-progress response was not received.",
      reasons: Object.freeze([]), correlationId: null, retryableExact: true, requiresRefresh: false };
  }
}
