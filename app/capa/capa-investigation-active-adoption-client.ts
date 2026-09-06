import {
  CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION,
  type CapaInvestigationActiveAdoptionCategory,
  type CapaInvestigationActiveAdoptedContent,
  type CapaInvestigationActiveAdoptionItemIntent,
  type CapaInvestigationActiveHumanCausalRole,
} from "../../lib/capa/ai/capa-investigation-active-adoption-contract";
import { validateCapaInvestigationActiveAdoptedContent } from "../../lib/capa/ai/capa-investigation-active-adoption-validator";
import { parseCapaInvestigationActiveWorkspaceSave, type CapaInvestigationActiveWorkspaceProjection } from "./capa-investigation-active-workspace-client";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PROPOSAL_KEY = /^P[1-9][0-9]{0,2}$/;
const CATEGORIES = ["evidence_gap", "conflicting_information", "assumption", "causal_hypothesis", "alternative_hypothesis", "investigation_recommendation"] as const;
const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const exact = (value: Record<string, unknown>, keys: readonly string[]) => Object.keys(value).length === keys.length && keys.every((key) => Object.prototype.hasOwnProperty.call(value, key));
const uuid = (value: unknown): value is string => typeof value === "string" && value.trim() === value && UUID.test(value);
const iso = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)) && value === new Date(value).toISOString();
const category = (value: unknown): value is CapaInvestigationActiveAdoptionCategory => typeof value === "string" && (CATEGORIES as readonly string[]).includes(value);

export interface CapaInvestigationActiveAdoptionSafeRecord {
  readonly adoption_id: string;
  readonly proposal_key: string;
  readonly proposal_category: CapaInvestigationActiveAdoptionCategory;
  readonly adopted_item: { readonly proposal_key: string; readonly adopted_content: CapaInvestigationActiveAdoptedContent; readonly human_causal_role?: CapaInvestigationActiveHumanCausalRole };
  readonly adopted_at: string;
  readonly adopted_by_user_id: string;
}
export interface InvestigationActiveAdoptionAttempt {
  readonly caseId: string; readonly currentVersionId: string; readonly recordVersion: number; readonly outputId: string;
  readonly selectedItems: readonly CapaInvestigationActiveAdoptionItemIntent[]; readonly selectedCategories?: Readonly<Record<string, CapaInvestigationActiveAdoptionCategory>>; readonly idempotencyKey: string;
  readonly requestId: string; readonly correlationId: string; readonly currentUserId?: string; readonly requestBody: string;
}
export type InvestigationActiveAdoptionResult =
  | { readonly status: "adopted" | "already_adopted"; readonly records: readonly CapaInvestigationActiveAdoptionSafeRecord[]; readonly workspace: CapaInvestigationActiveWorkspaceProjection; readonly correlationId: string }
  | { readonly status: "failed"; readonly code: string | null; readonly message: string; readonly retryableExact: boolean; readonly requiresRefresh: boolean };

function contentEquals(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
function invalid(): InvestigationActiveAdoptionResult { return { status: "failed", code: "INVALID_ADOPTION_RESPONSE", message: "The adoption response could not be verified.", retryableExact: false, requiresRefresh: false }; }
function parseRecord(value: unknown, expected: Map<string, CapaInvestigationActiveAdoptionItemIntent>, attempt: InvestigationActiveAdoptionAttempt): CapaInvestigationActiveAdoptionSafeRecord | null {
  if (!record(value) || !exact(value, ["adoption_id", "proposal_key", "proposal_category", "adopted_item", "adopted_at", "adopted_by_user_id"]) || !uuid(value.adoption_id) || typeof value.proposal_key !== "string" || !category(value.proposal_category) || !iso(value.adopted_at) || !uuid(value.adopted_by_user_id) || !record(value.adopted_item) || Object.keys(value.adopted_item).some((key) => !["proposal_key", "adopted_content", "human_causal_role"].includes(key)) || !Object.hasOwn(value.adopted_item, "proposal_key") || !Object.hasOwn(value.adopted_item, "adopted_content") || Object.keys(value.adopted_item).length < 2 || Object.keys(value.adopted_item).length > 3 || value.adopted_item.proposal_key !== value.proposal_key) return null;
  const selected = expected.get(value.proposal_key);
  if (selected === undefined) return null;
  if (attempt.selectedCategories !== undefined && attempt.selectedCategories[value.proposal_key] !== value.proposal_category) return null;
  const role = value.adopted_item.human_causal_role;
  if (value.proposal_category === "causal_hypothesis"
    ? role !== "proposed_root_cause" && role !== "contributing_factor"
    : role !== undefined) return null;
  if ((value.adopted_item.human_causal_role !== undefined) !== (selected.human_causal_role !== undefined) || (value.adopted_item.human_causal_role !== undefined && value.adopted_item.human_causal_role !== selected.human_causal_role)) return null;
  let adopted: CapaInvestigationActiveAdoptedContent;
  try { adopted = validateCapaInvestigationActiveAdoptedContent(value.proposal_category, value.adopted_item.adopted_content); } catch { return null; }
  let expectedContent: CapaInvestigationActiveAdoptedContent;
  try { expectedContent = validateCapaInvestigationActiveAdoptedContent(value.proposal_category, selected.adopted_content); } catch { return null; }
  if (!contentEquals(adopted, expectedContent)) return null;
  if (attempt.currentUserId !== undefined && value.adopted_by_user_id !== attempt.currentUserId) return null;
  return Object.freeze({ adoption_id: value.adoption_id, proposal_key: value.proposal_key, proposal_category: value.proposal_category, adopted_item: Object.freeze({ proposal_key: value.proposal_key, adopted_content: adopted, ...(value.adopted_item.human_causal_role === undefined ? {} : { human_causal_role: value.adopted_item.human_causal_role as CapaInvestigationActiveHumanCausalRole }) }), adopted_at: value.adopted_at, adopted_by_user_id: value.adopted_by_user_id });
}

export function createInvestigationActiveAdoptionAttempt(input: { readonly caseId: string; readonly currentVersionId: string; readonly recordVersion: number; readonly outputId: string; readonly selectedItems: readonly CapaInvestigationActiveAdoptionItemIntent[]; readonly selectedCategories?: Readonly<Record<string, CapaInvestigationActiveAdoptionCategory>>; readonly idempotencyKey: string; readonly requestId?: string; readonly correlationId?: string; readonly currentUserId?: string }): InvestigationActiveAdoptionAttempt | null {
  if (!uuid(input.caseId) || !uuid(input.currentVersionId) || !uuid(input.outputId) || !Number.isSafeInteger(input.recordVersion) || input.recordVersion < 1 || input.selectedItems.length === 0 || input.selectedItems.length > 20 || input.idempotencyKey.trim() !== input.idempotencyKey || input.idempotencyKey.length === 0 || input.idempotencyKey.length > 128 || new Set(input.selectedItems.map((item) => item.proposal_key)).size !== input.selectedItems.length || input.selectedItems.some((item) => !PROPOSAL_KEY.test(item.proposal_key))) return null;
  const selectedItems = Object.freeze(input.selectedItems.map((item) => Object.freeze({ proposal_key: item.proposal_key, adopted_content: item.adopted_content, ...(item.human_causal_role === undefined ? {} : { human_causal_role: item.human_causal_role }) })));
  const requestId = input.requestId ?? crypto.randomUUID(); const correlationId = input.correlationId ?? crypto.randomUUID();
  if (!uuid(requestId) || !uuid(correlationId)) return null;
  return Object.freeze({ caseId: input.caseId, currentVersionId: input.currentVersionId, recordVersion: input.recordVersion, outputId: input.outputId, selectedItems, ...(input.selectedCategories === undefined ? {} : { selectedCategories: Object.freeze({ ...input.selectedCategories }) }), idempotencyKey: input.idempotencyKey, requestId, correlationId, ...(input.currentUserId === undefined ? {} : { currentUserId: input.currentUserId }), requestBody: JSON.stringify({ expected_case_version_id: input.currentVersionId, expected_record_version: input.recordVersion, output_id: input.outputId, selected_items: selectedItems }) });
}

export function parseInvestigationActiveAdoptionSuccess(value: unknown, attempt: InvestigationActiveAdoptionAttempt): InvestigationActiveAdoptionResult {
  if (!record(value) || !exact(value, ["status", "records", "workspace", "correlation_id"]) || (value.status !== "adopted" && value.status !== "already_adopted") || !Array.isArray(value.records) || value.records.length !== attempt.selectedItems.length || !uuid(value.correlation_id)) return invalid();
  const workspace = parseCapaInvestigationActiveWorkspaceSave({ workspace: value.workspace, correlation_id: value.correlation_id });
  if (workspace.status !== "saved") return invalid();
  const expected = new Map(attempt.selectedItems.map((item) => [item.proposal_key, item])); const keys = new Set<string>(); const ids = new Set<string>(); const records: CapaInvestigationActiveAdoptionSafeRecord[] = [];
  for (const item of value.records) { const parsed = parseRecord(item, expected, attempt); if (parsed === null || keys.has(parsed.proposal_key) || ids.has(parsed.adoption_id)) return invalid(); keys.add(parsed.proposal_key); ids.add(parsed.adoption_id); records.push(parsed); }
  if (keys.size !== expected.size) return invalid();
  return Object.freeze({ status: value.status, records: Object.freeze(records), workspace: workspace.workspace, correlationId: value.correlation_id });
}
export function parseInvestigationActiveAdoptionFailure(value: unknown): { readonly code: string | null; readonly message: string; readonly correlationId: string | null } {
  const error = record(value) && record(value.error) ? value.error : null;
  return { code: error && typeof error.code === "string" ? error.code : null, message: error && typeof error.message === "string" ? error.message : "The S40 proposal adoption could not be completed.", correlationId: error && uuid(error.correlation_id) ? error.correlation_id : null };
}
export async function submitInvestigationActiveAdoptionAttempt(attempt: InvestigationActiveAdoptionAttempt, fetcher: typeof fetch = fetch): Promise<InvestigationActiveAdoptionResult> {
  try {
    const response = await fetcher(`/api/capa/${encodeURIComponent(attempt.caseId)}/investigation-active-advisory/${encodeURIComponent(attempt.outputId)}/adoptions`, { method: "POST", cache: "no-store", headers: { "content-type": "application/json", "x-request-id": attempt.requestId, "x-correlation-id": attempt.correlationId, "Idempotency-Key": attempt.idempotencyKey }, body: attempt.requestBody });
    const body: unknown = await response.json().catch(() => null);
    if (response.status === 200 || response.status === 201) return parseInvestigationActiveAdoptionSuccess(body, attempt);
    const failure = parseInvestigationActiveAdoptionFailure(body);
    return { status: "failed", code: failure.code, message: failure.message, retryableExact: response.status >= 500, requiresRefresh: failure.code === "CAPA_ADOPTION_CASE_CHANGED" || failure.code === "CAPA_ADOPTION_WORKSPACE_CONFLICT" };
  } catch { return { status: "failed", code: null, message: "The adoption response was not received.", retryableExact: true, requiresRefresh: false }; }
}

export { CAPA_INVESTIGATION_ACTIVE_ADOPTION_POLICY_VERSION };
