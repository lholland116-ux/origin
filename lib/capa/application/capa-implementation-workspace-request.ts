import {
  CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
  type CapaImplementationActionProgress,
} from "../implementation/capa-implementation-contract";
import type {
  CapaImplementationReviewReturnResponseDraft,
} from "../implementation/capa-implementation-return-response-contract";
import {
  validateCapaImplementationWorkspaceDraft,
} from "../implementation/capa-implementation-validator";

export interface CapaImplementationWorkspaceSaveRequest {
  readonly expected_draft_revision: number | null;
  readonly action_progress: readonly CapaImplementationActionProgress[];
  readonly implementation_review_return_response?: CapaImplementationReviewReturnResponseDraft | null;
}

export type CapaImplementationWorkspaceSaveRequestValidationResult =
  | {
      readonly status: "valid";
      readonly value: CapaImplementationWorkspaceSaveRequest;
    }
  | {
      readonly status: "invalid";
      readonly reason_code:
        | "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_OBJECT"
        | "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_FIELDS"
        | "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_REVISION"
        | "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_DRAFT";
      readonly detail_reason_code?: string;
    };

const REQUIRED_FIELDS = [
  "expected_draft_revision",
  "action_progress",
] as const;
const OPTIONAL_FIELDS = [
  "implementation_review_return_response",
] as const;

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validExpectedRevision(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value < Number.MAX_SAFE_INTEGER
  );
}

export function validateCapaImplementationWorkspaceSaveRequest(
  value: unknown,
): CapaImplementationWorkspaceSaveRequestValidationResult {
  if (!objectRecord(value)) {
    return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_OBJECT" };
  }
  const hasReturnResponse = Object.prototype.hasOwnProperty.call(
    value,
    OPTIONAL_FIELDS[0],
  );
  const fields = hasReturnResponse
    ? [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS]
    : REQUIRED_FIELDS;
  if (
    Object.keys(value).length !== fields.length ||
    !fields.every((field) => Object.prototype.hasOwnProperty.call(value, field))
  ) {
    return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_FIELDS" };
  }
  if (!validExpectedRevision(value.expected_draft_revision)) {
    return { status: "invalid", reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_REVISION" };
  }

  const candidate = {
    schema_version: CAPA_IMPLEMENTATION_WORKSPACE_DRAFT_SCHEMA_VERSION,
    action_progress: value.action_progress,
    implementation_review_return_response: hasReturnResponse
      ? value.implementation_review_return_response
      : null,
  };
  const draft = validateCapaImplementationWorkspaceDraft(candidate);
  if (draft.status !== "valid") {
    return {
      status: "invalid",
      reason_code: "INVALID_IMPLEMENTATION_WORKSPACE_REQUEST_DRAFT",
      detail_reason_code: draft.reason_code,
    };
  }

  return Object.freeze({
    status: "valid",
    value: Object.freeze({
      expected_draft_revision: value.expected_draft_revision,
      action_progress: draft.value.action_progress,
      ...(hasReturnResponse
        ? {
            implementation_review_return_response:
              draft.value.implementation_review_return_response,
          }
        : {}),
    }),
  });
}
