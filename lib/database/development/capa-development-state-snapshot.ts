import type {
  AuditEvent,
  CapaCaseId,
  CapaCaseVersionId,
  CapaCase,
  CapaCaseVersion,
  CapaSectionVersion,
  IsoDateTime,
  OrganizationId,
  RequestTrace,
} from "../../capa/domain/capa-types";
import type { CapaCreationIdempotencyRecord } from "../repositories/capa-creation-idempotency-repository";
import type { CapaWorkflowIdempotencyRecord } from "../repositories/capa-workflow-idempotency-repository";
import type { CapaIntakeAdvisoryResponse } from "../../capa/ai/capa-intake-advisory-contract";
import type { CapaContainmentRiskAdvisoryResponse } from "../../capa/ai/capa-containment-risk-advisory-contract";
import type { CapaInvestigationPlanAdvisoryResponse } from "../../capa/ai/capa-investigation-planning-advisory-contract";
import type { CapaInvestigationActiveAdvisoryResponse } from "../../capa/ai/capa-investigation-active-advisory-contract";
import type { CapaRootCauseReviewAdvisoryResponse } from "../../capa/ai/capa-root-cause-review-advisory-contract";
import type { CapaInvestigationActiveAdvisoryGenerationTraceCapture, CapaContainmentRiskAdvisoryGenerationTraceCapture, CapaInvestigationPlanningAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { CapaRootCauseReviewAdvisoryGenerationTraceCapture } from "../../capa/ai/capa-ai-generation-trace";
import type { CapaInvestigationActiveAdvisoryReferenceManifestDocument } from "../../capa/ai/capa-investigation-active-advisory-reference-manifest";
import type { CapaRootCauseReviewAdvisoryReferenceManifest } from "../repositories/capa-root-cause-review-advisory-output-repository";
import type { PersistedCapaInvestigationPlanningAdoption } from "../repositories/capa-investigation-planning-adoption-repository";
import type { PersistedCapaInvestigationActiveAdoption } from "../repositories/capa-investigation-active-adoption-repository";
import type { CapaInvestigationActiveWorkspaceDraft } from "../../capa/application/capa-investigation-active-workspace-draft-contract";
import { validateCapaInvestigationActiveWorkspaceDraft } from "../../capa/application/capa-investigation-active-workspace-draft-validator";

export const CAPA_DEVELOPMENT_STATE_SNAPSHOT_SCHEMA_VERSION =
  "capa-development-state-1.0.0" as const;

export type CapaDevelopmentStateMapEntry<Value> = readonly [string, Value];

export interface CapaDevelopmentIntakeAdvisoryOutputSnapshotRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace: RequestTrace;
  readonly response: CapaIntakeAdvisoryResponse;
  readonly created_at: IsoDateTime;
}

export interface CapaDevelopmentContainmentRiskAdvisoryOutputSnapshotRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace: RequestTrace;
  readonly response: CapaContainmentRiskAdvisoryResponse;
  readonly generation_trace: CapaContainmentRiskAdvisoryGenerationTraceCapture;
  readonly created_at: IsoDateTime;
}

export interface CapaDevelopmentInvestigationPlanningAdvisoryOutputSnapshotRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace: RequestTrace;
  readonly response: CapaInvestigationPlanAdvisoryResponse;
  readonly generation_trace: CapaInvestigationPlanningAdvisoryGenerationTraceCapture;
  readonly created_at: IsoDateTime;
}

export interface CapaDevelopmentInvestigationActiveAdvisoryOutputSnapshotRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace: RequestTrace;
  readonly response: CapaInvestigationActiveAdvisoryResponse;
  readonly generation_trace: CapaInvestigationActiveAdvisoryGenerationTraceCapture;
  readonly reference_manifest: Readonly<{
    readonly document: CapaInvestigationActiveAdvisoryReferenceManifestDocument;
    readonly fingerprint_algorithm: "sha256-canonical-json-v1";
    readonly reference_manifest_sha256: string;
  }>;
  readonly created_at: IsoDateTime;
}

export interface CapaDevelopmentRootCauseReviewAdvisoryOutputSnapshotRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace: RequestTrace;
  readonly response: CapaRootCauseReviewAdvisoryResponse;
  readonly generation_trace: CapaRootCauseReviewAdvisoryGenerationTraceCapture;
  readonly reference_manifest: CapaRootCauseReviewAdvisoryReferenceManifest;
  readonly created_at: IsoDateTime;
}

export type CapaDevelopmentAdvisoryOutputSnapshotRecord =
  | CapaDevelopmentIntakeAdvisoryOutputSnapshotRecord
  | CapaDevelopmentContainmentRiskAdvisoryOutputSnapshotRecord
  | CapaDevelopmentInvestigationPlanningAdvisoryOutputSnapshotRecord
  | CapaDevelopmentInvestigationActiveAdvisoryOutputSnapshotRecord
  | CapaDevelopmentRootCauseReviewAdvisoryOutputSnapshotRecord;

export interface CapaDevelopmentStateSnapshot {
  readonly schema_version: typeof CAPA_DEVELOPMENT_STATE_SNAPSHOT_SCHEMA_VERSION;
  readonly revision: number;
  readonly cases: readonly CapaDevelopmentStateMapEntry<CapaCase>[];
  readonly case_numbers: readonly CapaDevelopmentStateMapEntry<CapaCaseId>[];
  readonly case_number_counters: readonly CapaDevelopmentStateMapEntry<number>[];
  readonly case_versions: readonly CapaDevelopmentStateMapEntry<CapaCaseVersion>[];
  readonly section_versions: readonly CapaDevelopmentStateMapEntry<CapaSectionVersion>[];
  readonly audit_events: readonly CapaDevelopmentStateMapEntry<AuditEvent>[];
  readonly creation_idempotency: readonly CapaDevelopmentStateMapEntry<CapaCreationIdempotencyRecord>[];
  readonly workflow_idempotency: readonly CapaDevelopmentStateMapEntry<CapaWorkflowIdempotencyRecord>[];
  readonly advisory_outputs: readonly CapaDevelopmentStateMapEntry<CapaDevelopmentAdvisoryOutputSnapshotRecord>[];
  readonly advisory_runs: readonly CapaDevelopmentStateMapEntry<string>[];
  readonly investigation_planning_adoptions: readonly CapaDevelopmentStateMapEntry<PersistedCapaInvestigationPlanningAdoption>[];
  readonly investigation_active_adoptions: readonly CapaDevelopmentStateMapEntry<PersistedCapaInvestigationActiveAdoption>[];
  readonly investigation_active_workspace_drafts: readonly CapaDevelopmentStateMapEntry<CapaInvestigationActiveWorkspaceDraft>[];
}

export class CapaDevelopmentStateSnapshotError extends Error {
  readonly reason_code: "INVALID_SNAPSHOT" | "UNSUPPORTED_SCHEMA_VERSION" | "INVALID_REVISION";

  constructor(reasonCode: CapaDevelopmentStateSnapshotError["reason_code"], message: string) {
    super(message);
    this.name = "CapaDevelopmentStateSnapshotError";
    this.reason_code = reasonCode;
  }
}

const TOP_LEVEL_FIELDS = [
  "schema_version", "revision", "cases", "case_numbers", "case_number_counters",
  "case_versions", "section_versions", "audit_events", "creation_idempotency",
  "workflow_idempotency", "advisory_outputs", "advisory_runs",
  "investigation_planning_adoptions",
  "investigation_active_adoptions",
  "investigation_active_workspace_drafts",
] as const;
const LEGACY_TOP_LEVEL_FIELDS = TOP_LEVEL_FIELDS.filter((field) => field !== "investigation_active_adoptions" && field !== "investigation_active_workspace_drafts");
const PRE_WORKSPACE_TOP_LEVEL_FIELDS = TOP_LEVEL_FIELDS.filter((field) => field !== "investigation_active_workspace_drafts");

function objectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapEntries<Value>(value: unknown, name: string, primitive: "object" | "string" | "number"): readonly CapaDevelopmentStateMapEntry<Value>[] {
  if (!Array.isArray(value)) throw new CapaDevelopmentStateSnapshotError("INVALID_SNAPSHOT", `${name} must be an array of map entries.`);
  const keys = new Set<string>();
  const entries: CapaDevelopmentStateMapEntry<Value>[] = [];
  for (const entry of value) {
    if (!Array.isArray(entry) || entry.length !== 2 || typeof entry[0] !== "string" || keys.has(entry[0]) ||
      (primitive === "object" && !objectRecord(entry[1])) ||
      (primitive === "string" && typeof entry[1] !== "string") ||
      (primitive === "number" && (typeof entry[1] !== "number" || !Number.isSafeInteger(entry[1]))) ) {
      throw new CapaDevelopmentStateSnapshotError("INVALID_SNAPSHOT", `${name} contains an invalid map entry.`);
    }
    keys.add(entry[0]);
    entries.push([entry[0], entry[1] as Value]);
  }
  return Object.freeze(entries.map(([key, entryValue]) => Object.freeze([key, entryValue] as const)));
}

function clone<Value>(value: Value): Value {
  return structuredClone(value);
}

/** Validates and defensively clones the JSON-parsed snapshot envelope. */
export function validateCapaDevelopmentStateSnapshot(value: unknown): CapaDevelopmentStateSnapshot {
  if (!objectRecord(value) ||
    !(
      (Object.keys(value).length === TOP_LEVEL_FIELDS.length && TOP_LEVEL_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))) ||
      (Object.keys(value).length === PRE_WORKSPACE_TOP_LEVEL_FIELDS.length && PRE_WORKSPACE_TOP_LEVEL_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field))) ||
      (Object.keys(value).length === LEGACY_TOP_LEVEL_FIELDS.length && LEGACY_TOP_LEVEL_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(value, field)))
    )) {
    throw new CapaDevelopmentStateSnapshotError("INVALID_SNAPSHOT", "The CAPA development state snapshot shape is invalid.");
  }
  if (value.schema_version !== CAPA_DEVELOPMENT_STATE_SNAPSHOT_SCHEMA_VERSION) {
    throw new CapaDevelopmentStateSnapshotError("UNSUPPORTED_SCHEMA_VERSION", "The CAPA development state snapshot schema version is unsupported.");
  }
  if (typeof value.revision !== "number" || !Number.isSafeInteger(value.revision) || value.revision < 0) {
    throw new CapaDevelopmentStateSnapshotError("INVALID_REVISION", "The CAPA development state snapshot revision is invalid.");
  }
  const workspaceDrafts = mapEntries<CapaInvestigationActiveWorkspaceDraft>(value.investigation_active_workspace_drafts ?? [], "investigation_active_workspace_drafts", "object");
  if (workspaceDrafts.some(([, draft]) => validateCapaInvestigationActiveWorkspaceDraft(draft).status !== "valid")) {
    throw new CapaDevelopmentStateSnapshotError("INVALID_SNAPSHOT", "investigation_active_workspace_drafts contains an invalid workspace draft.");
  }
  const snapshot = {
    schema_version: CAPA_DEVELOPMENT_STATE_SNAPSHOT_SCHEMA_VERSION,
    revision: value.revision,
    cases: mapEntries<CapaCase>(value.cases, "cases", "object"),
    case_numbers: mapEntries<CapaCaseId>(value.case_numbers, "case_numbers", "string"),
    case_number_counters: mapEntries<number>(value.case_number_counters, "case_number_counters", "number"),
    case_versions: mapEntries<CapaCaseVersion>(value.case_versions, "case_versions", "object"),
    section_versions: mapEntries<CapaSectionVersion>(value.section_versions, "section_versions", "object"),
    audit_events: mapEntries<AuditEvent>(value.audit_events, "audit_events", "object"),
    creation_idempotency: mapEntries<CapaCreationIdempotencyRecord>(value.creation_idempotency, "creation_idempotency", "object"),
    workflow_idempotency: mapEntries<CapaWorkflowIdempotencyRecord>(value.workflow_idempotency, "workflow_idempotency", "object"),
    advisory_outputs: mapEntries<CapaDevelopmentAdvisoryOutputSnapshotRecord>(value.advisory_outputs, "advisory_outputs", "object"),
    advisory_runs: mapEntries<string>(value.advisory_runs, "advisory_runs", "string"),
    investigation_planning_adoptions: mapEntries<PersistedCapaInvestigationPlanningAdoption>(value.investigation_planning_adoptions, "investigation_planning_adoptions", "object"),
    investigation_active_adoptions: mapEntries<PersistedCapaInvestigationActiveAdoption>(value.investigation_active_adoptions ?? [], "investigation_active_adoptions", "object"),
    investigation_active_workspace_drafts: workspaceDrafts,
  } satisfies CapaDevelopmentStateSnapshot;
  return clone(snapshot);
}
