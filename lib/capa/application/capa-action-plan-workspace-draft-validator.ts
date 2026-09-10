import {
  validateCapaActionPlan,
} from "../domain/capa-action-plan";
import {
  validateCapaActionPlanReviewReturnResponseDraft,
} from "../domain/capa-action-plan-review-return-response";
import type {
  CapaActionPlanWorkspaceDraft,
} from "./capa-action-plan-workspace-draft-contract";
import {
  CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION,
} from "./capa-action-plan-workspace-draft-contract";

export const CAPA_ACTION_PLAN_WORKSPACE_DRAFT_VALIDATION_REASON_CODES = [
  "INVALID_WORKSPACE_DRAFT_OBJECT",
  "INVALID_WORKSPACE_DRAFT_FIELDS",
  "INVALID_WORKSPACE_DRAFT_SCHEMA_VERSION",
  "INVALID_WORKSPACE_DRAFT_TRUST",
  "INVALID_WORKSPACE_DRAFT_WORKFLOW_STATE",
  "INVALID_WORKSPACE_DRAFT_IDENTITY",
  "INVALID_WORKSPACE_DRAFT_UPDATED_AT",
  "INVALID_WORKSPACE_DRAFT_RECORD_VERSION",
  "INVALID_WORKSPACE_DRAFT_REVISION",
  "INVALID_WORKSPACE_DRAFT_ACTION_PLAN",
  "INVALID_WORKSPACE_DRAFT_RETURN_RESPONSE",
] as const;

export type CapaActionPlanWorkspaceDraftValidationReasonCode =
  (typeof CAPA_ACTION_PLAN_WORKSPACE_DRAFT_VALIDATION_REASON_CODES)[number];

export type CapaActionPlanWorkspaceDraftValidationResult =
  | { readonly status: "valid"; readonly value: CapaActionPlanWorkspaceDraft }
  | { readonly status: "invalid"; readonly reason_code: CapaActionPlanWorkspaceDraftValidationReasonCode; readonly detail_reason_code?: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FIELDS = [
  "schema_version",
  "trust",
  "workflow_state",
  "organization_id",
  "capa_case_id",
  "case_version_id",
  "record_version",
  "draft_revision",
  "action_plan",
  "updated_by_user_id",
  "updated_at",
] as const;
const RETURN_RESPONSE_FIELD = "action_plan_return_response" as const;

function invalid(
  reason_code: CapaActionPlanWorkspaceDraftValidationReasonCode,
  detail_reason_code?: string,
): CapaActionPlanWorkspaceDraftValidationResult {
  return Object.freeze({
    status: "invalid",
    reason_code,
    ...(detail_reason_code === undefined ? {} : { detail_reason_code }),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function exactFields(value: Record<string, unknown>): boolean {
  const hasResponse = Object.prototype.hasOwnProperty.call(value, RETURN_RESPONSE_FIELD);
  const fields = hasResponse ? [...FIELDS, RETURN_RESPONSE_FIELD] : FIELDS;
  return Object.keys(value).length === fields.length &&
    fields.every((field) => Object.prototype.hasOwnProperty.call(value, field));
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDateTime(value: unknown): value is string {
  return typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value) &&
    !Number.isNaN(Date.parse(value));
}

export function validateCapaActionPlanWorkspaceDraft(
  value: unknown,
): CapaActionPlanWorkspaceDraftValidationResult {
  if (!record(value)) return invalid("INVALID_WORKSPACE_DRAFT_OBJECT");
  if (!exactFields(value)) return invalid("INVALID_WORKSPACE_DRAFT_FIELDS");
  if (value.schema_version !== CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION) return invalid("INVALID_WORKSPACE_DRAFT_SCHEMA_VERSION");
  if (value.trust !== "untrusted_human_draft") return invalid("INVALID_WORKSPACE_DRAFT_TRUST");
  if (value.workflow_state !== "S60") return invalid("INVALID_WORKSPACE_DRAFT_WORKFLOW_STATE");
  if (!uuid(value.organization_id) || !uuid(value.capa_case_id) || !uuid(value.case_version_id) || !uuid(value.updated_by_user_id)) return invalid("INVALID_WORKSPACE_DRAFT_IDENTITY");
  if (!isoDateTime(value.updated_at)) return invalid("INVALID_WORKSPACE_DRAFT_UPDATED_AT");
  if (typeof value.record_version !== "number" || !Number.isSafeInteger(value.record_version) || value.record_version < 1) return invalid("INVALID_WORKSPACE_DRAFT_RECORD_VERSION");
  if (typeof value.draft_revision !== "number" || !Number.isSafeInteger(value.draft_revision) || value.draft_revision < 1) return invalid("INVALID_WORKSPACE_DRAFT_REVISION");

  const actionPlan = validateCapaActionPlan(value.action_plan);
  if (actionPlan.status !== "valid") return invalid("INVALID_WORKSPACE_DRAFT_ACTION_PLAN", actionPlan.reason_code);

  let returnResponse = undefined;
  if (Object.prototype.hasOwnProperty.call(value, RETURN_RESPONSE_FIELD)) {
    if (value.action_plan_return_response !== null) {
      const response = validateCapaActionPlanReviewReturnResponseDraft(
        value.action_plan_return_response,
      );
      if (response.status !== "valid") return invalid("INVALID_WORKSPACE_DRAFT_RETURN_RESPONSE");
      returnResponse = response.value;
    } else {
      returnResponse = null;
    }
  }

  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      schema_version: CAPA_ACTION_PLAN_WORKSPACE_DRAFT_SCHEMA_VERSION,
      trust: "untrusted_human_draft" as const,
      workflow_state: "S60" as const,
      organization_id: value.organization_id as never,
      capa_case_id: value.capa_case_id as never,
      case_version_id: value.case_version_id as never,
      record_version: value.record_version,
      draft_revision: value.draft_revision,
      action_plan: actionPlan.value,
      ...(returnResponse === undefined ? {} : { action_plan_return_response: returnResponse }),
      updated_by_user_id: value.updated_by_user_id as never,
      updated_at: value.updated_at as never,
    }),
  });
}
