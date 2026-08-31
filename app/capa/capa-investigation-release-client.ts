import type { CapaInvestigationPlanContent } from "@/lib/capa/domain/capa-investigation-plan";

export const G03_CONFIRMATION = "G03_INVESTIGATION_RELEASE_CONFIRMED" as const;
export interface InvestigationReleaseAttempt { readonly caseId: string; readonly idempotencyKey: string; readonly requestBody: string }

export function createInvestigationReleaseAttempt(input: {
  readonly caseId: string; readonly recordVersion: number; readonly currentVersionId: string;
  readonly investigationPlan: CapaInvestigationPlanContent; readonly comment: string | null;
  readonly idempotencyKey: string;
}): InvestigationReleaseAttempt | null {
  if (!input.caseId || !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 ||
    !input.currentVersionId || !input.idempotencyKey.trim()) return null;
  const requestBody = JSON.stringify({ expected_record_version: input.recordVersion,
    expected_current_version_id: input.currentVersionId, investigation_plan: input.investigationPlan,
    release: { confirmation: G03_CONFIRMATION, comment: input.comment } });
  return Object.freeze({ caseId: input.caseId, idempotencyKey: input.idempotencyKey, requestBody });
}

export type InvestigationReleaseResult =
  | { readonly status: "released"; readonly correlationId: string | null }
  | { readonly status: "failed"; readonly code: string | null; readonly message: string;
      readonly reasons: readonly string[]; readonly retryableExact: boolean; readonly requiresRefresh: boolean };

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export async function submitInvestigationReleaseAttempt(
  attempt: InvestigationReleaseAttempt, fetcher: typeof fetch = fetch,
): Promise<InvestigationReleaseResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/release-investigation`, {
      method: "POST", headers: { "content-type": "application/json", "idempotency-key": attempt.idempotencyKey },
      body: attempt.requestBody,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && record(body) && record(body.capa) && body.capa.capa_case_id === attempt.caseId &&
      body.capa.status === "S40") return { status: "released",
      correlationId: typeof body.correlation_id === "string" ? body.correlation_id : null };
    const envelope = record(body) && record(body.error) ? body.error : null;
    const code = envelope && typeof envelope.code === "string" ? envelope.code : null;
    const issues = envelope && Array.isArray(envelope.issues) ? envelope.issues : [];
    const reasons = issues.flatMap((issue) => record(issue) && typeof issue.message === "string" ? [issue.message] : []);
    return { status: "failed", code,
      message: envelope && typeof envelope.message === "string" ? envelope.message : "Release could not be completed.",
      reasons: Object.freeze(reasons), retryableExact: response.status >= 500,
      requiresRefresh: code === "CAPA_CONCURRENCY_CONFLICT" || code === "CAPA_WORKFLOW_CONFLICT" };
  } catch {
    return { status: "failed", code: null, message: "The release response was not received.",
      reasons: Object.freeze([]), retryableExact: true, requiresRefresh: false };
  }
}
