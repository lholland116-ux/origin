import type {
  CapaInvestigationPlanningAdoptionItemIntent,
} from "@/lib/capa/ai/capa-investigation-planning-adoption-contract";
import type {
  PersistedCapaInvestigationPlanningAdoption,
} from "@/lib/database/repositories/capa-investigation-planning-adoption-repository";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const HASH_PATTERN = /^[0-9a-f]{64}$/i;

export interface InvestigationPlanningAdoptionAttempt {
  readonly caseId: string;
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly outputId: string;
  readonly selectedItems: readonly CapaInvestigationPlanningAdoptionItemIntent[];
  readonly idempotencyKey: string;
  readonly requestId: string;
  readonly correlationId: string;
  readonly currentUserId?: string;
  readonly requestBody: string;
}

export type InvestigationPlanningAdoptionResult =
  | { readonly status: "adopted" | "already_adopted"; readonly records: readonly PersistedCapaInvestigationPlanningAdoption[]; readonly correlationId: string | null }
  | { readonly status: "failed"; readonly code: string | null; readonly message: string; readonly retryableExact: boolean; readonly requiresRefresh: boolean };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) =>
    Object.prototype.hasOwnProperty.call(value, key),
  );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && value.trim() === value && UUID_PATTERN.test(value);
}

function isoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value)) && value === new Date(value).toISOString();
}

function sameItem(left: unknown, right: CapaInvestigationPlanningAdoptionItemIntent): boolean {
  if (!record(left) || !exact(left, [
    "proposal_key", "investigation_question", "evidence_target", "investigation_method",
    "scope_relationship", "owner_user_id", "due_date", "dependency_proposal_keys",
  ]) || !Array.isArray(left.dependency_proposal_keys)) return false;
  return left.proposal_key === right.proposal_key &&
    left.investigation_question === right.investigation_question &&
    left.evidence_target === right.evidence_target &&
    left.investigation_method === right.investigation_method &&
    left.scope_relationship === right.scope_relationship &&
    left.owner_user_id === right.owner_user_id &&
    left.due_date === right.due_date &&
    left.dependency_proposal_keys.length === right.dependency_proposal_keys.length &&
    left.dependency_proposal_keys.every((value, index) => value === right.dependency_proposal_keys[index]);
}

function parseRecord(
  value: unknown,
  attempt: InvestigationPlanningAdoptionAttempt,
  expected: CapaInvestigationPlanningAdoptionItemIntent,
): PersistedCapaInvestigationPlanningAdoption | null {
  if (!record(value) || !exact(value, ["adoption", "request_fingerprint", "record_fingerprint", "audit_event_id"]) ||
    !HASH_PATTERN.test(String(value.request_fingerprint)) || !HASH_PATTERN.test(String(value.record_fingerprint)) ||
    !uuid(value.audit_event_id) || !record(value.adoption)) return null;
  const adoption = value.adoption;
  if (!exact(adoption, [
    "adoption_id", "organization_id", "capa_case_id", "case_version_id", "record_version", "output_id",
    "proposal_key", "adopted_item", "adopted_at", "adopted_by", "adoption_policy_version", "request_id",
    "correlation_id", "idempotency_key", "workflow_mutated", "controlled_record_mutated", "gate_approved",
  ]) || !uuid(adoption.adoption_id) || !uuid(adoption.organization_id) ||
    adoption.capa_case_id !== attempt.caseId || adoption.case_version_id !== attempt.currentVersionId ||
    adoption.record_version !== attempt.recordVersion || adoption.output_id !== attempt.outputId ||
    adoption.proposal_key !== expected.proposal_key || !sameItem(adoption.adopted_item, expected) ||
    !isoTimestamp(adoption.adopted_at) || !record(adoption.adopted_by) ||
    !exact(adoption.adopted_by, ["actor_type", "actor_id"]) || adoption.adopted_by.actor_type !== "human" ||
    !uuid(adoption.adopted_by.actor_id) || !uuid(adoption.request_id) || !uuid(adoption.correlation_id) ||
    adoption.idempotency_key !== attempt.idempotencyKey || typeof adoption.adoption_policy_version !== "string" ||
    adoption.adoption_policy_version.length === 0 || adoption.workflow_mutated !== false ||
    adoption.controlled_record_mutated !== false || adoption.gate_approved !== false) return null;
  return value as unknown as PersistedCapaInvestigationPlanningAdoption;
}

export function createInvestigationPlanningAdoptionAttempt(input: {
  readonly caseId: string;
  readonly currentVersionId: string;
  readonly recordVersion: number;
  readonly outputId: string;
  readonly selectedItems: readonly CapaInvestigationPlanningAdoptionItemIntent[];
  readonly idempotencyKey: string;
  readonly requestId?: string;
  readonly correlationId?: string;
  readonly currentUserId?: string;
}): InvestigationPlanningAdoptionAttempt | null {
  if (!input.caseId || !input.currentVersionId || !input.outputId ||
    !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 ||
    !input.idempotencyKey.trim() || input.selectedItems.length === 0) return null;
  const selectedItems = Object.freeze(input.selectedItems.map((item) => Object.freeze({
    proposal_key: item.proposal_key,
    investigation_question: item.investigation_question,
    evidence_target: item.evidence_target,
    investigation_method: item.investigation_method,
    scope_relationship: item.scope_relationship,
    owner_user_id: item.owner_user_id,
    due_date: item.due_date,
    dependency_proposal_keys: Object.freeze([...item.dependency_proposal_keys]),
  })));
  const requestId = input.requestId ?? crypto.randomUUID();
  const correlationId = input.correlationId ?? crypto.randomUUID();
  if (!uuid(requestId) || !uuid(correlationId)) return null;
  const requestBody = JSON.stringify({
    expected_case_version_id: input.currentVersionId,
    expected_record_version: input.recordVersion,
    output_id: input.outputId,
    selected_items: selectedItems,
  });
  return Object.freeze({
    caseId: input.caseId,
    currentVersionId: input.currentVersionId,
    recordVersion: input.recordVersion,
    outputId: input.outputId,
    selectedItems,
    idempotencyKey: input.idempotencyKey,
    requestId,
    correlationId,
    ...(input.currentUserId === undefined ? {} : { currentUserId: input.currentUserId }),
    requestBody,
  });
}

export function parseInvestigationPlanningAdoptionSuccess(
  value: unknown,
  attempt: InvestigationPlanningAdoptionAttempt,
): InvestigationPlanningAdoptionResult {
  if (!record(value) || !exact(value, ["status", "records", "correlation_id"]) ||
    (value.status !== "adopted" && value.status !== "already_adopted") ||
    !Array.isArray(value.records) || value.records.length !== attempt.selectedItems.length ||
    (value.correlation_id !== null && !uuid(value.correlation_id))) {
    return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false };
  }
  const expectedByKey = new Map<string, CapaInvestigationPlanningAdoptionItemIntent>(
    attempt.selectedItems.map((item) => [item.proposal_key, item]),
  );
  const parsed: PersistedCapaInvestigationPlanningAdoption[] = [];
  const adoptionIds = new Set<string>();
  for (const valueRecord of value.records) {
    if (!record(valueRecord) || !record(valueRecord.adoption) || typeof valueRecord.adoption.proposal_key !== "string") {
      return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false };
    }
    const expected = expectedByKey.get(valueRecord.adoption.proposal_key);
    if (expected === undefined) {
      return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false };
    }
    const parsedRecord = parseRecord(valueRecord, attempt, expected);
    if (parsedRecord === null || adoptionIds.has(parsedRecord.adoption.adoption_id) ||
      (attempt.currentUserId !== undefined &&
        parsedRecord.adoption.adopted_by.actor_id !== attempt.currentUserId)) {
      return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false };
    }
    adoptionIds.add(parsedRecord.adoption.adoption_id);
    parsed.push(parsedRecord);
  }
  if (parsed.length !== expectedByKey.size) {
    return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false };
  }
  const first = parsed[0];
  if (first !== undefined && parsed.some((item) =>
    item.adoption.adopted_by.actor_type !== first.adoption.adopted_by.actor_type ||
    item.adoption.adopted_by.actor_id !== first.adoption.adopted_by.actor_id ||
    item.adoption.adopted_at !== first.adoption.adopted_at ||
    item.adoption.idempotency_key !== first.adoption.idempotency_key ||
    item.adoption.adoption_policy_version !== first.adoption.adoption_policy_version ||
    item.request_fingerprint !== first.request_fingerprint,
  )) {
    return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false };
  }
  return { status: value.status, records: Object.freeze(parsed), correlationId: value.correlation_id };
}

export function parseInvestigationPlanningAdoptionFailure(value: unknown): {
  readonly code: string | null; readonly message: string; readonly correlationId: string | null;
} {
  const error = record(value) && record(value.error) ? value.error : null;
  return {
    code: error && typeof error.code === "string" ? error.code : null,
    message: error && typeof error.message === "string" ? error.message : "The proposal adoption could not be completed.",
    correlationId: error && uuid(error.correlation_id) ? error.correlation_id : null,
  };
}

export async function submitInvestigationPlanningAdoptionAttempt(
  attempt: InvestigationPlanningAdoptionAttempt,
  fetcher: typeof fetch = fetch,
): Promise<InvestigationPlanningAdoptionResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/investigation-planning-advisory/${encodeURIComponent(attempt.outputId)}/adoptions`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        "x-request-id": attempt.requestId,
        "x-correlation-id": attempt.correlationId,
        "Idempotency-Key": attempt.idempotencyKey,
      },
      body: attempt.requestBody,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 201 || response.status === 200) {
      return parseInvestigationPlanningAdoptionSuccess(body, attempt);
    }
    const failure = parseInvestigationPlanningAdoptionFailure(body);
    return {
      status: "failed",
      code: failure.code,
      message: failure.message,
      retryableExact: response.status >= 500,
      requiresRefresh: failure.code === "CAPA_ADOPTION_CASE_CHANGED",
    };
  } catch {
    return { status: "failed", code: null, message: "The adoption response was not received.", retryableExact: true, requiresRefresh: false };
  }
}
