export const ROOT_CAUSE_GATE_APPROVAL_CONFIRMATION =
  "G04_ROOT_CAUSE_APPROVAL_CONFIRMED" as const;

export type RootCauseGateDecision = "approve" | "return_for_investigation";

export interface RootCauseGateAttempt {
  readonly caseId: string;
  readonly expectedCurrentVersionId: string;
  readonly expectedRecordVersion: number;
  readonly decision: RootCauseGateDecision;
  readonly idempotencyKey: string;
  readonly requestBody: string;
}

export type RootCauseGateResult =
  | {
      readonly status: "decided";
      readonly decision: RootCauseGateDecision;
      readonly workflowState: "S60" | "S40";
      readonly currentCaseVersionId: string;
      readonly recordVersion: number;
      readonly replayed: boolean;
      readonly correlationId: string;
    }
  | {
      readonly status: "failed";
      readonly code: string | null;
      readonly message: string;
      readonly reasons: readonly string[];
      readonly correlationId: string | null;
      readonly retryableExact: boolean;
      readonly requiresRefresh: boolean;
    };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createCapaRootCauseGateAttempt(input: {
  readonly caseId: string;
  readonly recordVersion: number;
  readonly currentVersionId: string;
  readonly decision: RootCauseGateDecision;
  readonly rationale: string;
  readonly idempotencyKey: string;
}): RootCauseGateAttempt | null {
  if (!UUID.test(input.caseId) || !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 ||
    !UUID.test(input.currentVersionId) || !input.rationale || input.rationale.trim() !== input.rationale ||
    input.rationale.length > 4000 || !input.idempotencyKey || input.idempotencyKey.trim() !== input.idempotencyKey ||
    (input.decision !== "approve" && input.decision !== "return_for_investigation")) return null;
  const base = {
    expected_record_version: input.recordVersion,
    expected_current_version_id: input.currentVersionId,
    decision: input.decision,
    rationale: input.rationale,
  };
  const body = input.decision === "approve"
    ? { ...base, confirmation: ROOT_CAUSE_GATE_APPROVAL_CONFIRMATION }
    : base;
  return Object.freeze({
    caseId: input.caseId,
    expectedCurrentVersionId: input.currentVersionId,
    expectedRecordVersion: input.recordVersion,
    decision: input.decision,
    idempotencyKey: input.idempotencyKey,
    requestBody: JSON.stringify(body),
  });
}

function failure(
  response: Response | null,
  body: unknown,
  message: string,
): RootCauseGateResult {
  const envelope = record(body) && record(body.error) ? body.error : null;
  const code = envelope && typeof envelope.code === "string" ? envelope.code : null;
  const reasons = envelope && Array.isArray(envelope.issues)
    ? envelope.issues.flatMap((issue) => record(issue) && typeof issue.message === "string" ? [issue.message] : [])
    : [];
  return {
    status: "failed",
    code,
    message: envelope && typeof envelope.message === "string" ? envelope.message : message,
    reasons: Object.freeze(reasons),
    correlationId: envelope && typeof envelope.correlation_id === "string" ? envelope.correlation_id : null,
    retryableExact: response === null || response.status >= 500,
    requiresRefresh: code === "CAPA_CONCURRENCY_CONFLICT" || code === "CAPA_WORKFLOW_CONFLICT",
  };
}

export async function submitCapaRootCauseGateAttempt(
  attempt: RootCauseGateAttempt,
  fetcher: typeof fetch = fetch,
): Promise<RootCauseGateResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/root-cause-gate`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "cache-control": "no-store",
        "idempotency-key": attempt.idempotencyKey,
      },
      body: attempt.requestBody,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && record(body) && body.status === "decided" && body.decision === attempt.decision &&
      body.capa_case_id === attempt.caseId && body.previous_case_version_id === attempt.expectedCurrentVersionId && typeof body.previous_case_version_id === "string" &&
      UUID.test(body.previous_case_version_id) && typeof body.current_case_version_id === "string" &&
      UUID.test(body.current_case_version_id) && body.previous_case_version_id !== body.current_case_version_id &&
      Number.isSafeInteger(body.record_version) && body.record_version === attempt.expectedRecordVersion + 1 &&
      ((attempt.decision === "approve" && body.workflow_state === "S60") ||
        (attempt.decision === "return_for_investigation" && body.workflow_state === "S40")) &&
      typeof body.replayed === "boolean" && typeof body.correlation_id === "string" && UUID.test(body.correlation_id)) {
      return {
        status: "decided",
        decision: attempt.decision,
        workflowState: body.workflow_state,
        currentCaseVersionId: body.current_case_version_id,
        recordVersion: body.record_version as number,
        replayed: body.replayed,
        correlationId: body.correlation_id,
      };
    }
    return failure(response, body, "The root-cause gate could not be completed.");
  } catch {
    return failure(null, null, "The root-cause gate response was not received.");
  }
}
