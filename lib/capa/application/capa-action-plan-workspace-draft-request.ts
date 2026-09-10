import {
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../domain/capa-action-plan";
import {
  validateCapaActionPlanReviewReturnResponseEditableContent,
  type CapaActionPlanReviewReturnResponseEditableContent,
} from "../domain/capa-action-plan-review-return-response";

export interface CapaActionPlanWorkspaceDraftSaveRequest {
  readonly expected_draft_revision: number | null;
  readonly action_plan: CapaActionPlanContent;
  readonly action_plan_return_response?: CapaActionPlanReviewReturnResponseEditableContent | null;
}

export type CapaActionPlanWorkspaceDraftRequestValidationResult =
  | { readonly status: "valid"; readonly value: CapaActionPlanWorkspaceDraftSaveRequest }
  | { readonly status: "invalid"; readonly reason_code: "INVALID_WORKSPACE_REQUEST_OBJECT" | "INVALID_WORKSPACE_REQUEST_FIELDS" | "INVALID_WORKSPACE_REQUEST_REVISION" | "INVALID_WORKSPACE_REQUEST_ACTION_PLAN" | "INVALID_WORKSPACE_REQUEST_RETURN_RESPONSE"; readonly detail_reason_code?: string };

const FIELDS = ["expected_draft_revision", "action_plan"] as const;
const OPTIONAL_FIELDS = ["action_plan_return_response"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCapaActionPlanWorkspaceDraftSaveRequest(
  value: unknown,
): CapaActionPlanWorkspaceDraftRequestValidationResult {
  if (!object(value)) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_OBJECT" };
  const hasReturnResponse = Object.prototype.hasOwnProperty.call(value, OPTIONAL_FIELDS[0]);
  const fields = hasReturnResponse ? [...FIELDS, ...OPTIONAL_FIELDS] : FIELDS;
  if (Object.keys(value).length !== fields.length || !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" };
  if (value.expected_draft_revision !== null && (typeof value.expected_draft_revision !== "number" || !Number.isSafeInteger(value.expected_draft_revision) || value.expected_draft_revision < 1 || value.expected_draft_revision >= Number.MAX_SAFE_INTEGER)) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_REVISION" };
  const actionPlan = validateCapaActionPlan(value.action_plan);
  if (actionPlan.status !== "valid") return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_ACTION_PLAN", detail_reason_code: actionPlan.reason_code };
  let returnResponse: CapaActionPlanReviewReturnResponseEditableContent | null | undefined;
  if (hasReturnResponse) {
    if (value.action_plan_return_response === null) {
      returnResponse = null;
    } else {
      const response = validateCapaActionPlanReviewReturnResponseEditableContent(value.action_plan_return_response);
      if (response.status !== "valid") return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_RETURN_RESPONSE", detail_reason_code: response.reason_code };
      returnResponse = response.value;
    }
  }
  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      expected_draft_revision: value.expected_draft_revision,
      action_plan: actionPlan.value,
      ...(returnResponse === undefined ? {} : { action_plan_return_response: returnResponse }),
    }),
  });
}
