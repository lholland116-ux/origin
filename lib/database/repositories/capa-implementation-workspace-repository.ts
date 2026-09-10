import type {
  CapaCaseId,
  CapaCaseVersionId,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../../capa/domain/capa-types";
import type {
  CapaImplementationWorkspaceDraft,
  CapaImplementationApprovedS70BaselineReference,
} from "../../capa/implementation/capa-implementation-contract";
import {
  validateCapaImplementationApprovedS70BaselineReference,
  validateCapaImplementationWorkspaceDraft,
} from "../../capa/implementation/capa-implementation-validator";
import type { TransactionContext } from "../transactions";

export const CAPA_IMPLEMENTATION_WORKSPACE_WORKFLOW_STATE =
  "S80" as const;

export interface CapaImplementationWorkspaceRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  /** Current authoritative S80 case-version boundary for this workspace. */
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly workflow_state:
    typeof CAPA_IMPLEMENTATION_WORKSPACE_WORKFLOW_STATE;
  /** Immutable reference to the approved S70 authority. */
  readonly approved_s70_baseline:
    CapaImplementationApprovedS70BaselineReference;
  readonly draft_revision: number;
  readonly draft: CapaImplementationWorkspaceDraft;
  readonly created_by_user_id: UserId;
  readonly created_at: IsoDateTime;
  readonly updated_by_user_id: UserId;
  readonly updated_at: IsoDateTime;
}

export interface SaveCapaImplementationWorkspaceInput {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly draft: CapaImplementationWorkspaceDraft;
  /** Candidate persisted workspace revision, not part of the client draft. */
  readonly draft_revision: number;
  /** null creates revision 1; an integer updates that exact revision. */
  readonly expected_draft_revision: number | null;
  /** Resolved by the trusted server/application boundary. */
  readonly actor_user_id: UserId;
  /** Required for initialization; ignored as a mutable value on update. */
  readonly approved_s70_baseline?:
    CapaImplementationApprovedS70BaselineReference;
}

export type SaveCapaImplementationWorkspaceResult =
  | {
      readonly status: "saved";
      readonly workspace: CapaImplementationWorkspaceRecord;
    }
  | { readonly status: "concurrency_conflict" }
  | { readonly status: "case_changed" }
  | { readonly status: "baseline_conflict" };

export interface CapaImplementationWorkspaceRepository {
  findWorkspace(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaImplementationWorkspaceRecord | null>;

  findWorkspaceForUpdate(
    transaction: TransactionContext,
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaImplementationWorkspaceRecord | null>;

  initializeWorkspace(
    transaction: TransactionContext,
    input: SaveCapaImplementationWorkspaceInput,
  ): Promise<SaveCapaImplementationWorkspaceResult>;

  saveWorkspace(
    transaction: TransactionContext,
    input: SaveCapaImplementationWorkspaceInput,
  ): Promise<SaveCapaImplementationWorkspaceResult>;
}

export class CapaImplementationWorkspaceRepositoryError
  extends Error {
  constructor(
    message =
      "The CAPA implementation workspace repository operation failed.",
  ) {
    super(message);
    this.name = "CapaImplementationWorkspaceRepositoryError";
  }
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO_DATE_TIME =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

const RECORD_FIELDS = [
  "organization_id",
  "capa_case_id",
  "case_version_id",
  "record_version",
  "workflow_state",
  "approved_s70_baseline",
  "draft_revision",
  "draft",
  "created_by_user_id",
  "created_at",
  "updated_by_user_id",
  "updated_at",
] as const;

const SAVE_FIELDS = [
  "organization_id",
  "capa_case_id",
  "case_version_id",
  "record_version",
  "draft",
  "draft_revision",
  "expected_draft_revision",
  "actor_user_id",
] as const;

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactFields(
  value: Record<string, unknown>,
  fields: readonly string[],
): boolean {
  return Object.keys(value).length === fields.length &&
    fields.every((field) =>
      Object.prototype.hasOwnProperty.call(value, field),
    );
}

function uuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

function isoDateTime(value: unknown): value is IsoDateTime {
  return typeof value === "string" &&
    ISO_DATE_TIME.test(value) &&
    !Number.isNaN(Date.parse(value));
}

function validRevision(value: unknown): value is number {
  return typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 1;
}

function invalid(message: string): never {
  throw new CapaImplementationWorkspaceRepositoryError(message);
}

function baselineEquals(
  left: CapaImplementationApprovedS70BaselineReference,
  right: CapaImplementationApprovedS70BaselineReference,
): boolean {
  return left.source_case_version_id === right.source_case_version_id &&
    left.approved_action_plan_section_id ===
      right.approved_action_plan_section_id &&
    left.approval_decision_reference === right.approval_decision_reference;
}

export function normalizeCapaImplementationWorkspaceRecord(
  value: unknown,
): CapaImplementationWorkspaceRecord {
  if (!objectRecord(value) || !hasExactFields(value, RECORD_FIELDS)) {
    return invalid("The persisted S80 implementation workspace shape is invalid.");
  }
  if (
    !uuid(value.organization_id) ||
    !uuid(value.capa_case_id) ||
    !uuid(value.case_version_id) ||
    !uuid(value.created_by_user_id) ||
    !uuid(value.updated_by_user_id)
  ) {
    return invalid("The persisted S80 implementation workspace identity is invalid.");
  }
  if (
    value.workflow_state !== CAPA_IMPLEMENTATION_WORKSPACE_WORKFLOW_STATE ||
    !validRevision(value.record_version) ||
    !validRevision(value.draft_revision) ||
    !isoDateTime(value.created_at) ||
    !isoDateTime(value.updated_at) ||
    Date.parse(value.updated_at) < Date.parse(value.created_at)
  ) {
    return invalid("The persisted S80 implementation workspace metadata is invalid.");
  }

  const baseline = validateCapaImplementationApprovedS70BaselineReference(
    value.approved_s70_baseline,
  );
  const draft = validateCapaImplementationWorkspaceDraft(value.draft);
  if (baseline.status !== "valid" || draft.status !== "valid") {
    return invalid("The persisted S80 implementation workspace content is invalid.");
  }

  return Object.freeze({
    organization_id: value.organization_id as OrganizationId,
    capa_case_id: value.capa_case_id as CapaCaseId,
    case_version_id: value.case_version_id as CapaCaseVersionId,
    record_version: value.record_version,
    workflow_state: CAPA_IMPLEMENTATION_WORKSPACE_WORKFLOW_STATE,
    approved_s70_baseline: baseline.value,
    draft_revision: value.draft_revision,
    draft: draft.value,
    created_by_user_id: value.created_by_user_id as UserId,
    created_at: value.created_at as IsoDateTime,
    updated_by_user_id: value.updated_by_user_id as UserId,
    updated_at: value.updated_at as IsoDateTime,
  });
}

/** Normalizes trusted server input before either adapter attempts a write. */
export function normalizeCapaImplementationWorkspaceSaveInput(
  value: unknown,
  requireBaseline: boolean,
): SaveCapaImplementationWorkspaceInput {
  if (!objectRecord(value)) {
    return invalid("The S80 implementation workspace save input is invalid.");
  }
  const hasBaseline = Object.prototype.hasOwnProperty.call(
    value,
    "approved_s70_baseline",
  );
  const fields = hasBaseline ? [...SAVE_FIELDS, "approved_s70_baseline"] : SAVE_FIELDS;
  if (!hasExactFields(value, fields)) {
    return invalid("The S80 implementation workspace save fields are invalid.");
  }
  if (
    !uuid(value.organization_id) ||
    !uuid(value.capa_case_id) ||
    !uuid(value.case_version_id) ||
    !uuid(value.actor_user_id) ||
    !validRevision(value.record_version) ||
    !validRevision(value.draft_revision) ||
    (value.expected_draft_revision !== null &&
      !validRevision(value.expected_draft_revision))
  ) {
    return invalid("The S80 implementation workspace save metadata is invalid.");
  }
  const draft = validateCapaImplementationWorkspaceDraft(value.draft);
  if (draft.status !== "valid") {
    return invalid("The S80 implementation workspace draft is invalid.");
  }

  let baseline: CapaImplementationApprovedS70BaselineReference | undefined;
  if (hasBaseline) {
    const parsed = validateCapaImplementationApprovedS70BaselineReference(
      value.approved_s70_baseline,
    );
    if (parsed.status !== "valid") {
      return invalid("The S80 implementation workspace baseline is invalid.");
    }
    baseline = parsed.value;
  }
  if (requireBaseline && (value.expected_draft_revision !== null || baseline === undefined)) {
    return invalid("S80 workspace initialization requires a baseline reference.");
  }
  if (
    value.expected_draft_revision === null &&
    value.draft_revision !== 1
  ) {
    return invalid("S80 workspace initialization requires revision 1.");
  }
  return {
    organization_id: value.organization_id as OrganizationId,
    capa_case_id: value.capa_case_id as CapaCaseId,
    case_version_id: value.case_version_id as CapaCaseVersionId,
    record_version: value.record_version,
    draft: draft.value,
    draft_revision: value.draft_revision,
    expected_draft_revision: value.expected_draft_revision,
    actor_user_id: value.actor_user_id as UserId,
    ...(baseline === undefined ? {} : { approved_s70_baseline: baseline }),
  };
}

export function sameCapaImplementationBaseline(
  left: CapaImplementationApprovedS70BaselineReference,
  right: CapaImplementationApprovedS70BaselineReference,
): boolean {
  return baselineEquals(left, right);
}
