import type { CapaStateId } from "./capa-state";

/**
 * LVT CAPA core domain types.
 *
 * Primary source:
 * Document #8 — LVT CAPA Data Model and Audit-Trail Specification
 *
 * Supporting sources:
 * Document #3 — LVT CAPA User Requirements Specification
 * Document #4 — LVT CAPA Workflow and State Specification
 *
 * Traceability:
 * DM-COM-001 through DM-COM-009
 * VER-001 through VER-007
 * AUD-001 through AUD-011
 * URS-CASE-001 through URS-CASE-012
 *
 * Workflow states and transition rules are maintained separately in
 * capa-state.ts.
 */

/**
 * Branded identifiers reduce accidental substitution of one identifier
 * type for another. They remain strings at runtime.
 *
 * Runtime validation must still verify that identifier values use the
 * approved UUID or equivalent opaque identifier format.
 */
type BrandedId<Name extends string> = string & {
  readonly __brand: Name;
};

export type OrganizationId = BrandedId<"OrganizationId">;
export type UserId = BrandedId<"UserId">;
export type RoleId = BrandedId<"RoleId">;
export type CapaCaseId = BrandedId<"CapaCaseId">;
export type CapaCaseVersionId = BrandedId<"CapaCaseVersionId">;
export type CapaSectionVersionId =
  BrandedId<"CapaSectionVersionId">;
export type AuditEventId = BrandedId<"AuditEventId">;
export type RequestId = BrandedId<"RequestId">;
export type CorrelationId = BrandedId<"CorrelationId">;
export type IdempotencyKey = BrandedId<"IdempotencyKey">;

/**
 * UTC timestamp serialized in ISO 8601 format.
 *
 * Example: 2026-08-11T14:30:00.000Z
 *
 * Runtime validation must verify the timestamp format. The brand alone
 * does not validate an arbitrary string.
 */
export type IsoDateTime = string & {
  readonly __brand: "IsoDateTime";
};

/**
 * Value obtained from an approved, versioned controlled-code registry.
 *
 * Runtime validation must confirm that the code exists in the applicable
 * registry version.
 */
export type ControlledCode = string & {
  readonly __brand: "ControlledCode";
};

/**
 * Identifies the category of actor responsible for an action.
 */
export type ActorType =
  | "human"
  | "service"
  | "agent"
  | "system";

/**
 * Resolvable reference to the actor responsible for an action.
 *
 * actor_version is required when the responsible actor is a versioned
 * service, agent, or system configuration.
 */
export interface ActorReference {
  readonly actor_type: ActorType;
  readonly actor_id: string;
  readonly actor_version?: string;
}

/**
 * Common organization-isolation field.
 *
 * All tenant-bound persistence queries and relationships must enforce
 * organization_id on the server.
 *
 * Trace: DM-COM-001
 */
export interface OrganizationScopedRecord {
  readonly organization_id: OrganizationId;
}

/**
 * Common creation attribution.
 *
 * Trace: DM-COM-003
 */
export interface CreationMetadata {
  readonly created_at: IsoDateTime;
  readonly created_by: ActorReference;
}

/**
 * Metadata for a controlled record that may receive updates.
 *
 * updated_at and updated_by support attribution and presentation but do
 * not replace the append-only audit trail.
 *
 * record_version supports optimistic concurrency and must increase after
 * every successfully committed controlled update.
 *
 * Trace: DM-COM-002, DM-COM-003
 */
export interface MutableRecordMetadata
  extends CreationMetadata {
  readonly record_version: number;
  readonly updated_at: IsoDateTime;
  readonly updated_by: ActorReference;
}

/**
 * Request-level trace information propagated through material writes.
 *
 * Trace: DM-COM-009
 */
export interface RequestTrace {
  readonly request_id: RequestId;
  readonly correlation_id: CorrelationId;
  readonly idempotency_key?: IdempotencyKey;
}

/**
 * CAPA lifecycle status is restricted to the approved state identifiers
 * defined in Document #4 and capa-state.ts.
 */
export type CapaCaseStatus = CapaStateId;

/**
 * Section types and confidentiality classifications will be resolved
 * through approved controlled-code registries.
 */
export type CapaSectionType = ControlledCode;
export type ConfidentialityClassification =
  ControlledCode;

/**
 * Stable CAPA case identity and current-version pointer.
 *
 * This aggregate identifies the case and its current controlled state.
 * Material case content is stored in immutable CapaCaseVersion and
 * CapaSectionVersion records.
 */
export interface CapaCase
  extends OrganizationScopedRecord,
    MutableRecordMetadata {
  readonly capa_case_id: CapaCaseId;

  /**
   * Organization-readable identifier.
   *
   * This value does not replace the opaque capa_case_id and must be
   * unique within the applicable organization.
   */
  readonly case_number: string;

  readonly current_version_id: CapaCaseVersionId;
  readonly status: CapaCaseStatus;
  readonly owner_user_id: UserId;
  readonly confidentiality:
    ConfidentialityClassification;

  readonly effective_at: IsoDateTime;
  readonly superseded_at?: IsoDateTime;
  readonly cancelled_at?: IsoDateTime;
  readonly closed_at?: IsoDateTime;
}

/**
 * Immutable snapshot of material CAPA case content.
 *
 * A material change creates a new version instead of overwriting this
 * record.
 *
 * Trace: VER-001
 */
export interface CapaCaseVersion
  extends OrganizationScopedRecord,
    CreationMetadata {
  readonly case_version_id: CapaCaseVersionId;
  readonly capa_case_id: CapaCaseId;
  readonly version_number: number;
  readonly parent_version_id?: CapaCaseVersionId;
  readonly change_reason: string;
  readonly status: CapaCaseStatus;
  readonly section_version_ids:
    readonly CapaSectionVersionId[];
  readonly effective_at: IsoDateTime;
  readonly superseded_at?: IsoDateTime;
}

/**
 * Immutable version of a controlled CAPA section.
 *
 * content must be validated against the identified schema_version before
 * persistence. Unknown values remain unknown until runtime validation.
 */
export interface CapaSectionVersion
  extends OrganizationScopedRecord,
    CreationMetadata {
  readonly section_version_id:
    CapaSectionVersionId;
  readonly capa_case_id: CapaCaseId;
  readonly section_type: CapaSectionType;
  readonly version_number: number;
  readonly parent_version_id?:
    CapaSectionVersionId;
  readonly schema_version: string;
  readonly content: Readonly<
    Record<string, unknown>
  >;
  readonly change_reason: string;
  readonly effective_at: IsoDateTime;
  readonly superseded_at?: IsoDateTime;
}

/**
 * Reference to an exact controlled object identity and, when applicable,
 * the exact version used by an action or decision.
 *
 * Trace: DM-COM-007
 */
export interface VersionedObjectReference {
  readonly object_type: ControlledCode;
  readonly object_id: string;
  readonly object_version_id?: string;
}

/**
 * Outcome of an attempted audited action.
 */
export type AuditEventOutcome =
  | "succeeded"
  | "denied"
  | "blocked"
  | "failed"
  | "attempted";

/**
 * Immutable before-and-after references or a minimized field-level
 * change description.
 *
 * Sensitive values, credentials, secrets, and unnecessary prompt
 * content must never be stored in change_set.
 */
export interface AuditChange {
  readonly before_ref?: VersionedObjectReference;
  readonly after_ref?: VersionedObjectReference;
  readonly change_set?: Readonly<
    Record<string, unknown>
  >;
}

/**
 * Append-only business audit event.
 *
 * Ordinary application roles and APIs must not expose update or delete
 * operations for audit events.
 *
 * Successful material business changes and their required audit events
 * must commit atomically.
 *
 * Trace: AUD-001 through AUD-011
 */
export interface AuditEvent
  extends OrganizationScopedRecord,
    RequestTrace {
  readonly event_id: AuditEventId;
  readonly event_type: ControlledCode;
  readonly schema_version: string;

  readonly aggregate_type: ControlledCode;
  readonly aggregate_id: string;
  readonly aggregate_version?: number;

  readonly actor: ActorReference;
  readonly occurred_at: IsoDateTime;

  readonly action: ControlledCode;
  readonly target: VersionedObjectReference;
  readonly outcome: AuditEventOutcome;
  readonly reason?: string;

  readonly change?: AuditChange;

  /**
   * Exact versions of workflow, rule, agent, model, tool, source, and
   * schema configurations that influenced the event.
   */
  readonly configuration_versions: Readonly<
    Record<string, string>
  >;

  /**
   * Non-sensitive supplemental event metadata.
   */
  readonly metadata: Readonly<
    Record<string, unknown>
  >;
}
