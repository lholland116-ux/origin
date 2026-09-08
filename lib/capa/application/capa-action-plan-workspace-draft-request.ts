import {
  validateCapaActionPlan,
  type CapaActionPlanContent,
} from "../domain/capa-action-plan";

export interface CapaActionPlanWorkspaceDraftSaveRequest {
  readonly expected_draft_revision: number | null;
  readonly action_plan: CapaActionPlanContent;
}

export type CapaActionPlanWorkspaceDraftRequestValidationResult =
  | { readonly status: "valid"; readonly value: CapaActionPlanWorkspaceDraftSaveRequest }
  | { readonly status: "invalid"; readonly reason_code: "INVALID_WORKSPACE_REQUEST_OBJECT" | "INVALID_WORKSPACE_REQUEST_FIELDS" | "INVALID_WORKSPACE_REQUEST_REVISION" | "INVALID_WORKSPACE_REQUEST_ACTION_PLAN"; readonly detail_reason_code?: string };

const FIELDS = ["expected_draft_revision", "action_plan"] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateCapaActionPlanWorkspaceDraftSaveRequest(
  value: unknown,
): CapaActionPlanWorkspaceDraftRequestValidationResult {
  if (!object(value)) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_OBJECT" };
  if (Object.keys(value).length !== FIELDS.length || !FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_FIELDS" };
  if (value.expected_draft_revision !== null && (typeof value.expected_draft_revision !== "number" || !Number.isSafeInteger(value.expected_draft_revision) || value.expected_draft_revision < 1 || value.expected_draft_revision >= Number.MAX_SAFE_INTEGER)) return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_REVISION" };
  const actionPlan = validateCapaActionPlan(value.action_plan);
  if (actionPlan.status !== "valid") return { status: "invalid", reason_code: "INVALID_WORKSPACE_REQUEST_ACTION_PLAN", detail_reason_code: actionPlan.reason_code };
  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      expected_draft_revision: value.expected_draft_revision,
      action_plan: actionPlan.value,
    }),
  });
}
