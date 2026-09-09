export interface ActionPlanSubmissionAttempt {
  readonly caseId: string;
  readonly idempotencyKey: string;
  readonly requestBody: string;
}

export type ActionPlanSubmissionResult =
  | { readonly status: "submitted"; readonly replayed: boolean; readonly correlationId: string | null }
  | { readonly status: "failed"; readonly code: string | null; readonly message: string; readonly reasons: readonly string[]; readonly correlationId: string | null; readonly retryableExact: boolean; readonly requiresRefresh: boolean };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function createActionPlanSubmissionAttempt(input: {
  readonly caseId: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly idempotencyKey: string;
}): ActionPlanSubmissionAttempt | null {
  if (!UUID.test(input.caseId) || !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 || !UUID.test(input.currentVersionId) || input.idempotencyKey.length === 0 || input.idempotencyKey.length > 128 || input.idempotencyKey.trim() !== input.idempotencyKey) return null;
  return Object.freeze({
    caseId: input.caseId,
    idempotencyKey: input.idempotencyKey,
    requestBody: JSON.stringify({ expected_record_version: input.recordVersion, expected_current_version_id: input.currentVersionId }),
  });
}

function correlation(value: unknown): string | null {
  return typeof value === "string" && UUID.test(value) ? value : null;
}

export async function submitActionPlanSubmissionAttempt(
  attempt: ActionPlanSubmissionAttempt,
  fetcher: typeof fetch = fetch,
): Promise<ActionPlanSubmissionResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/submit-action-plan`, {
      method: "POST",
      headers: { "content-type": "application/json", "idempotency-key": attempt.idempotencyKey },
      body: attempt.requestBody,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && record(body) && record(body.capa) && body.capa.capa_case_id === attempt.caseId && typeof body.capa.case_number === "string" && body.capa.case_number.length > 0 && body.capa.status === "S70" && Number.isSafeInteger(body.capa.record_version) && (body.capa.record_version as number) > 0 && typeof body.capa.current_version_id === "string" && UUID.test(body.capa.current_version_id) && typeof body.capa.submitted_version_id === "string" && UUID.test(body.capa.submitted_version_id) && typeof body.capa.action_plan_section_version_id === "string" && UUID.test(body.capa.action_plan_section_version_id) && typeof body.capa.submitted_at === "string" && ISO_DATE_TIME.test(body.capa.submitted_at) && !Number.isNaN(Date.parse(body.capa.submitted_at)) && typeof body.capa.transition_audit_event_id === "string" && UUID.test(body.capa.transition_audit_event_id) && typeof body.replayed === "boolean") {
      return { status: "submitted", replayed: body.replayed, correlationId: correlation(body.correlation_id) };
    }
    const error = record(body) && record(body.error) ? body.error : null;
    const code = error && typeof error.code === "string" ? error.code : null;
    const reasons = error && Array.isArray(error.issues) ? error.issues.flatMap((issue) => record(issue) && typeof issue.message === "string" ? [issue.message] : []) : [];
    return { status: "failed", code, message: error && typeof error.message === "string" ? error.message : "The action plan could not be submitted for review.", reasons: Object.freeze(reasons), correlationId: correlation(error?.correlation_id ?? (record(body) ? body.correlation_id : null)), retryableExact: response.status >= 500 || response.ok, requiresRefresh: code === "CAPA_CONCURRENCY_CONFLICT" || code === "CAPA_WORKFLOW_CONFLICT" };
  } catch {
    return { status: "failed", code: null, message: "The action-plan submission response was not received.", reasons: Object.freeze([]), correlationId: null, retryableExact: true, requiresRefresh: false };
  }
}
