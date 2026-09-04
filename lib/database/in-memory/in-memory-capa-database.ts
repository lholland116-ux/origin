import {
  isDeepStrictEqual,
} from "node:util";

import type {
  AuditEvent,
  AuditEventId,
  CapaCase,
  CapaCaseId,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestTrace,
} from "../../capa/domain/capa-types";

import type {
  AdvanceCapaVersionInput,
  AdvanceCapaVersionResult,
  CapaCaseListPage,
  CapaCaseListQuery,
  CapaRepository,
} from "../repositories/capa-repository";

import type {
  AppendAuditEventResult,
  AuditCursor,
  AuditEventPage,
  AuditEventQuery,
  AuditRepository,
} from "../repositories/audit-repository";

import type {
  CapaCaseNumberAllocator,
} from "../repositories/capa-case-number-allocator";

import type {
  CapaCreationIdempotencyRecord,
  CapaCreationIdempotencyRepository,
  ClaimCapaCreationResult,
} from "../repositories/capa-creation-idempotency-repository";

import type {
  CapaWorkflowIdempotencyRecord,
  CapaWorkflowIdempotencyRepository,
  ClaimCapaWorkflowOperationResult,
} from "../repositories/capa-workflow-idempotency-repository";

import type {
  TransactionContext,
  TransactionId,
  TransactionManager,
  TransactionWork,
} from "../transactions";

import type {
  CapaIntakeAdvisoryOutputRepository,
  CapaIntakeAdvisoryOutputSaveResult,
} from "../../capa/ai/capa-intake-advisory-service";

import type {
  CapaIntakeAdvisoryResponse,
} from "../../capa/ai/capa-intake-advisory-contract";

import type {
  CapaContainmentRiskAdvisoryResponse,
} from "../../capa/ai/capa-containment-risk-advisory-contract";

import type {
  CapaContainmentRiskAdvisoryGenerationTraceCapture,
} from "../../capa/ai/capa-ai-generation-trace";

import type {
  CapaInvestigationPlanningAdvisoryGenerationTraceCapture,
} from "../../capa/ai/capa-ai-generation-trace";

import type {
  AuthoritativeS20ContainmentRiskContext,
} from "../../capa/ai/capa-containment-risk-advisory-context";

import {
  CAPA_CONTAINMENT_RISK_ADVISORY_AGENT,
} from "../../capa/ai/capa-containment-risk-advisory-service";

import type {
  CapaContainmentRiskAdvisoryOutputRepository,
  CapaContainmentRiskAdvisoryOutputSaveResult,
} from "../repositories/capa-containment-risk-advisory-output-repository";

import type {
  CapaInvestigationPlanningAdvisoryOutputRepository,
  CapaInvestigationPlanningAdvisoryOutputSaveResult,
} from "../repositories/capa-investigation-planning-advisory-output-repository";

import type {
  CapaInvestigationPlanAdvisoryResponse,
} from "../../capa/ai/capa-investigation-planning-advisory-contract";

import {
  constructCapaInvestigationPlanningAdoption,
} from "../../capa/ai/capa-investigation-planning-adoption-validator";

import type {
  CapaInvestigationPlanningAdoptionId,
} from "../../capa/ai/capa-investigation-planning-adoption-contract";

import type {
  AppendCapaInvestigationPlanningAdoptionResult,
  CapaInvestigationPlanningAdoptionPersistenceInput,
  CapaInvestigationPlanningAdoptionRepository,
  PersistedCapaInvestigationPlanningAdoption,
} from "../repositories/capa-investigation-planning-adoption-repository";

import {
  CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM,
  CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_EVIDENCE_MANIFEST_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_POLICY_MANIFEST_SCHEMA_VERSION,
  CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION,
} from "../../capa/ai/capa-ai-generation-trace";

import {
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT,
  CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION,
} from "../../capa/ai/capa-investigation-planning-advisory-contract";
import {
  CAPA_DEVELOPMENT_STATE_SNAPSHOT_SCHEMA_VERSION,
  CapaDevelopmentStateSnapshotError,
  validateCapaDevelopmentStateSnapshot,
  type CapaDevelopmentStateSnapshot,
} from "../development/capa-development-state-snapshot";

export type InMemoryCapaDatabaseSnapshot = CapaDevelopmentStateSnapshot;

/**
 * Development and integration-test CAPA persistence adapter.
 *
 * This adapter is intentionally memory-backed and is not approved for
 * production data storage.
 *
 * Supported behavior:
 *
 * - atomic transaction commit and rollback;
 * - organization-scoped CAPA case-number allocation;
 * - tenant-scoped reads and identifiers;
 * - immutable case and section versions;
 * - optimistic aggregate concurrency;
 * - append-only audit events;
 * - idempotent audit retries;
 * - transaction snapshot conflict detection;
 * - commit-time referential-integrity validation;
 * - defensive cloning at persistence boundaries.
 */

const DEFAULT_MAXIMUM_CASE_NUMBER =
  999_999;

const CASE_NUMBER_PREFIX =
  "CAPA-";

const CASE_NUMBER_WIDTH =
  6;

const MAXIMUM_CASE_LIST_LIMIT =
  100;

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface InMemoryCapaIntakeAdvisoryOutputRecord {
  readonly organization_id:
    OrganizationId;
  readonly capa_case_id:
    CapaCaseId;
  readonly case_version_id:
    CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace:
    RequestTrace;
  readonly response:
    CapaIntakeAdvisoryResponse;
  readonly created_at:
    IsoDateTime;
}

interface InMemoryCapaContainmentRiskAdvisoryOutputRecord {
  readonly organization_id:
    OrganizationId;
  readonly capa_case_id:
    CapaCaseId;
  readonly case_version_id:
    CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace:
    RequestTrace;
  readonly response:
    CapaContainmentRiskAdvisoryResponse;
  readonly generation_trace:
    CapaContainmentRiskAdvisoryGenerationTraceCapture;
  readonly created_at:
    IsoDateTime;
}

interface InMemoryCapaInvestigationPlanningAdvisoryOutputRecord {
  readonly organization_id: OrganizationId;
  readonly capa_case_id: CapaCaseId;
  readonly case_version_id: CapaCaseVersionId;
  readonly record_version: number;
  readonly request_trace: RequestTrace;
  readonly response: CapaInvestigationPlanAdvisoryResponse;
  readonly generation_trace:
    CapaInvestigationPlanningAdvisoryGenerationTraceCapture;
  readonly created_at: IsoDateTime;
}

type InMemoryCapaInvestigationPlanningAdoptionRecord =
  PersistedCapaInvestigationPlanningAdoption;

type InMemoryCapaAdvisoryOutputRecord =
  | InMemoryCapaIntakeAdvisoryOutputRecord
  | InMemoryCapaContainmentRiskAdvisoryOutputRecord
  | InMemoryCapaInvestigationPlanningAdvisoryOutputRecord;

interface InMemoryState {
  readonly revision: number;

  readonly cases:
    Map<string, CapaCase>;

  readonly case_numbers:
    Map<string, CapaCaseId>;

  /**
   * Transaction-owned organization-local numeric sequence state.
   *
   * Keeping this map inside InMemoryState gives allocation the same
   * commit and rollback behavior as the aggregate records.
   */
  readonly case_number_counters:
    Map<string, number>;

  readonly case_versions:
    Map<string, CapaCaseVersion>;

  readonly section_versions:
    Map<string, CapaSectionVersion>;

  readonly audit_events:
    Map<string, AuditEvent>;

  /**
   * Transaction-owned organization-local creation reservations.
   * Failed transactions roll back their reservations with all writes.
   */
  readonly creation_idempotency:
    Map<
      string,
      CapaCreationIdempotencyRecord
    >;

  /**
   * Transaction-owned organization-local workflow-operation reservations.
   * Failed transitions roll back their reservations with all writes.
   */
  readonly workflow_idempotency:
    Map<
      string,
      CapaWorkflowIdempotencyRecord
    >;

  /**
   * Transaction-owned governed AI advisory outputs.
   *
   * Outputs commit and roll back with the same snapshot as the CAPA case.
   */
  readonly advisory_outputs:
    Map<
      string,
      InMemoryCapaAdvisoryOutputRecord
    >;

  /**
   * Organization-scoped run identity index mirroring the durable
   * organization/run uniqueness constraint.
   */
  readonly advisory_runs:
    Map<string, string>;

  /** Transaction-owned immutable S30 proposal-adoption evidence. */
  readonly investigation_planning_adoptions:
    Map<string, InMemoryCapaInvestigationPlanningAdoptionRecord>;
}

interface ActiveTransaction {
  readonly context:
    TransactionContext;

  readonly state:
    InMemoryState;
}

export interface InMemoryCapaDatabaseOptions {
  /**
   * Must generate a unique identity for every concurrently active
   * transaction.
   */
  readonly generate_transaction_id:
    () => TransactionId;

  /**
   * Returns trusted time used for transaction metadata.
   */
  readonly now:
    () => Date;

  /**
   * Optional controlled test seam for exercising sequence exhaustion
   * without allocating 999,999 records.
   *
   * Ordinary development runtimes must omit this option.
   */
  readonly maximum_case_number?:
    number;

  /** Optional hydrated state for a development process restart. */
  readonly initial_snapshot?: InMemoryCapaDatabaseSnapshot;

  /** Runs after candidate validation and before the candidate is published. */
  readonly before_commit?: (
    snapshot: InMemoryCapaDatabaseSnapshot,
  ) => Promise<void>;
}

export class InMemoryTransactionConflictError
  extends Error {
  constructor() {
    super(
      "The in-memory database changed before the transaction could commit.",
    );

    this.name =
      "InMemoryTransactionConflictError";
  }
}

export class InMemoryTransactionNotActiveError
  extends Error {
  constructor() {
    super(
      "The transaction is not active.",
    );

    this.name =
      "InMemoryTransactionNotActiveError";
  }
}

export class InMemoryDuplicateRecordError
  extends Error {
  constructor(
    recordType: string,
  ) {
    super(
      `A ${recordType} record with the same identity already exists.`,
    );

    this.name =
      "InMemoryDuplicateRecordError";
  }
}

export class InMemoryIntegrityError
  extends Error {
  constructor(
    message: string,
  ) {
    super(message);

    this.name =
      "InMemoryIntegrityError";
  }
}

export class InMemoryCapaContainmentRiskAdvisoryPersistenceError
  extends Error {
  constructor() {
    super(
      "The governed CAPA containment/risk advisory output could not be persisted.",
    );

    this.name =
      "InMemoryCapaContainmentRiskAdvisoryPersistenceError";
  }
}

export class InMemoryCapaInvestigationPlanningAdvisoryPersistenceError
  extends Error {
  constructor() {
    super(
      "The governed CAPA investigation-planning advisory output could not be persisted.",
    );
    this.name =
      "InMemoryCapaInvestigationPlanningAdvisoryPersistenceError";
  }
}

export class InMemoryAuditQueryError
  extends Error {
  constructor() {
    super(
      "The audit query page parameters are invalid.",
    );

    this.name =
      "InMemoryAuditQueryError";
  }
}

export class InMemoryCapaCaseListQueryError
  extends Error {
  constructor() {
    super(
      "The in-memory CAPA case-list query parameters are invalid.",
    );

    this.name =
      "InMemoryCapaCaseListQueryError";
  }
}

export class InMemoryCapaDatabaseConfigurationError
  extends Error {
  constructor() {
    super(
      "The in-memory CAPA case-number maximum must be a positive safe integer no greater than 999999.",
    );

    this.name =
      "InMemoryCapaDatabaseConfigurationError";
  }
}

export class InMemoryCapaCaseNumberExhaustedError
  extends Error {
  constructor() {
    super(
      "The organization has exhausted its available CAPA case numbers.",
    );

    this.name =
      "InMemoryCapaCaseNumberExhaustedError";
  }
}

function iso(
  value: Date,
): IsoDateTime {
  return value.toISOString() as
    IsoDateTime;
}

function requireCaseListQuery(
  query: CapaCaseListQuery,
): void {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > MAXIMUM_CASE_LIST_LIMIT
  ) {
    throw new InMemoryCapaCaseListQueryError();
  }

  if (query.cursor === undefined) {
    return;
  }

  const cursorTime =
    new Date(query.cursor.created_at);

  if (
    !Number.isFinite(cursorTime.getTime()) ||
    cursorTime.toISOString() !==
      query.cursor.created_at ||
    !UUID_PATTERN.test(
      query.cursor.capa_case_id,
    )
  ) {
    throw new InMemoryCapaCaseListQueryError();
  }
}

function recordKey(
  organizationId:
    OrganizationId,

  recordId:
    string,
): string {
  return `${organizationId}:${recordId}`;
}

function caseNumberKey(
  organizationId:
    OrganizationId,

  caseNumber:
    string,
): string {
  return `${organizationId}:${caseNumber}`;
}

function caseNumberCounterKey(
  organizationId:
    OrganizationId,
): string {
  return String(
    organizationId,
  );
}

function creationIdempotencyKey(
  organizationId:
    OrganizationId,
  idempotencyKey:
    IdempotencyKey,
): string {
  return `${organizationId}:${idempotencyKey}`;
}

function workflowIdempotencyKey(
  organizationId:
    OrganizationId,
  idempotencyKey:
    IdempotencyKey,
): string {
  return `${organizationId}:${idempotencyKey}`;
}

function adoptionIdempotencyKey(
  organizationId: OrganizationId,
  idempotencyKey: string,
  proposalKey: string,
): string {
  return `${organizationId}:${idempotencyKey}:${proposalKey}`;
}

function formatCaseNumber(
  value: number,
): string {
  return `${CASE_NUMBER_PREFIX}${String(
    value,
  ).padStart(
    CASE_NUMBER_WIDTH,
    "0",
  )}`;
}

function cloneValue<Value>(
  value: Value,
): Value {
  return structuredClone(value);
}

function cloneMap<Value>(
  source:
    ReadonlyMap<string, Value>,
): Map<string, Value> {
  return new Map(
    [...source.entries()].map(
      ([key, value]) => [
        key,
        cloneValue(value),
      ],
    ),
  );
}

function cloneState(
  state: InMemoryState,
): InMemoryState {
  return {
    revision:
      state.revision,

    cases:
      cloneMap(state.cases),

    case_numbers:
      new Map(
        state.case_numbers,
      ),

    case_number_counters:
      new Map(
        state.case_number_counters,
      ),

    case_versions:
      cloneMap(
        state.case_versions,
      ),

    section_versions:
      cloneMap(
        state.section_versions,
      ),

    audit_events:
      cloneMap(
        state.audit_events,
      ),

    creation_idempotency:
      cloneMap(
        state.creation_idempotency,
      ),

    workflow_idempotency:
      cloneMap(
        state.workflow_idempotency,
      ),

    advisory_outputs:
      cloneMap(
        state.advisory_outputs,
      ),

    advisory_runs:
      new Map(
        state.advisory_runs,
      ),

    investigation_planning_adoptions:
      cloneMap(
        state.investigation_planning_adoptions,
      ),
  };
}

function emptyState():
  InMemoryState {
  return {
    revision: 0,

    cases:
      new Map(),

    case_numbers:
      new Map(),

    case_number_counters:
      new Map(),

    case_versions:
      new Map(),

    section_versions:
      new Map(),

    audit_events:
      new Map(),

    creation_idempotency:
      new Map(),

    workflow_idempotency:
      new Map(),

    advisory_outputs:
      new Map(),

    advisory_runs:
      new Map(),

    investigation_planning_adoptions:
      new Map(),
  };
}

function stateFromSnapshot(
  source: InMemoryCapaDatabaseSnapshot,
): InMemoryState {
  const snapshot = validateCapaDevelopmentStateSnapshot(source);
  return {
    revision: snapshot.revision,
    cases: new Map(snapshot.cases.map(([key, value]) => [key, cloneValue(value)])),
    case_numbers: new Map(snapshot.case_numbers),
    case_number_counters: new Map(snapshot.case_number_counters),
    case_versions: new Map(snapshot.case_versions.map(([key, value]) => [key, cloneValue(value)])),
    section_versions: new Map(snapshot.section_versions.map(([key, value]) => [key, cloneValue(value)])),
    audit_events: new Map(snapshot.audit_events.map(([key, value]) => [key, cloneValue(value)])),
    creation_idempotency: new Map(snapshot.creation_idempotency.map(([key, value]) => [key, cloneValue(value)])),
    workflow_idempotency: new Map(snapshot.workflow_idempotency.map(([key, value]) => [key, cloneValue(value)])),
    advisory_outputs: new Map(snapshot.advisory_outputs.map(([key, value]) => [key, cloneValue(value)])),
    advisory_runs: new Map(snapshot.advisory_runs),
    investigation_planning_adoptions: new Map(snapshot.investigation_planning_adoptions.map(([key, value]) => [key, cloneValue(value)])),
  };
}

function snapshotFromState(state: InMemoryState): InMemoryCapaDatabaseSnapshot {
  const entries = <Value>(source: ReadonlyMap<string, Value>) =>
    [...source.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, cloneValue(value)] as const);
  return {
    schema_version: CAPA_DEVELOPMENT_STATE_SNAPSHOT_SCHEMA_VERSION,
    revision: state.revision,
    cases: entries(state.cases),
    case_numbers: entries(state.case_numbers),
    case_number_counters: entries(state.case_number_counters),
    case_versions: entries(state.case_versions),
    section_versions: entries(state.section_versions),
    audit_events: entries(state.audit_events),
    creation_idempotency: entries(state.creation_idempotency),
    workflow_idempotency: entries(state.workflow_idempotency),
    advisory_outputs: entries(state.advisory_outputs),
    advisory_runs: entries(state.advisory_runs),
    investigation_planning_adoptions: entries(state.investigation_planning_adoptions),
  };
}

function requireMaximumCaseNumber(
  value: number | undefined,
): number {
  const resolved =
    value ??
    DEFAULT_MAXIMUM_CASE_NUMBER;

  if (
    !Number.isSafeInteger(
      resolved,
    ) ||
    resolved < 1 ||
    resolved >
      DEFAULT_MAXIMUM_CASE_NUMBER
  ) {
    throw new InMemoryCapaDatabaseConfigurationError();
  }

  return resolved;
}

type InMemoryCapaIntakeAdvisorySaveInput =
  Parameters<
    CapaIntakeAdvisoryOutputRepository["save"]
  >[1];

type InMemoryCapaContainmentRiskAdvisorySaveInput =
  Parameters<
    CapaContainmentRiskAdvisoryOutputRepository["save"]
  >[1];

type InMemoryCapaInvestigationPlanningAdvisorySaveInput =
  Parameters<
    CapaInvestigationPlanningAdvisoryOutputRepository["save"]
  >[1];

type InMemoryCapaAdvisorySaveInput =
  | InMemoryCapaIntakeAdvisorySaveInput
  | InMemoryCapaContainmentRiskAdvisorySaveInput
  | InMemoryCapaInvestigationPlanningAdvisorySaveInput;

function isS20AdvisorySaveInput(
  input:
    InMemoryCapaAdvisorySaveInput,
): input is InMemoryCapaContainmentRiskAdvisorySaveInput {
  return input.context.workflow_state === "S20";
}

function isS30AdvisorySaveInput(
  input: InMemoryCapaAdvisorySaveInput,
): input is InMemoryCapaInvestigationPlanningAdvisorySaveInput {
  return input.context.workflow_state === "S30";
}

function isS30AdvisoryOutputRecord(
  record: unknown,
): record is InMemoryCapaInvestigationPlanningAdvisoryOutputRecord {
  return isObjectRecord(record) &&
    "generation_trace" in record &&
    isObjectRecord(record.response) &&
    record.response.output_schema_version ===
      CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION;
}

function isNonEmptyString(
  value: unknown,
): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

function isValidIsoDateTime(
  value: unknown,
): value is IsoDateTime {
  if (!isNonEmptyString(value)) {
    return false;
  }

  const date = new Date(value);

  return (
    Number.isFinite(date.getTime()) &&
    date.toISOString() === value
  );
}

function isObjectRecord(
  value: unknown,
): value is Readonly<Record<string, unknown>> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function rejectInvalidS20AdvisoryInput(): never {
  throw new InMemoryCapaContainmentRiskAdvisoryPersistenceError();
}

function validateS20AdvisoryInput(
  input:
    InMemoryCapaContainmentRiskAdvisorySaveInput,
): void {
  try {
    const context = input.context;
    const response = input.response;
    const promptPackage =
      input.generation_trace.package;
    const traceIdentity =
      promptPackage.trace;
    const traceScope =
      promptPackage.scope;

    if (
      context.trust !== "authoritative_server_context" ||
      !isNonEmptyString(
        context.organization_id,
      ) ||
      !isNonEmptyString(
        context.capa_case_id,
      ) ||
      !isNonEmptyString(
        context.case_version_id,
      ) ||
      !Number.isSafeInteger(
        context.record_version,
      ) ||
      context.record_version <= 0 ||
      context.workflow_state !== "S20" ||
      !isNonEmptyString(input.request_id) ||
      !isNonEmptyString(input.correlation_id)
    ) {
      rejectInvalidS20AdvisoryInput();
    }

    if (
      !isNonEmptyString(response.run_id) ||
      !isNonEmptyString(response.output_id) ||
      response.output_schema_version !==
        "capa-containment-risk-advisory-1.0.0" ||
      response.status !== "completed_draft" ||
      !isObjectRecord(response.proposal) ||
      !Array.isArray(response.containment_summary) ||
      !Array.isArray(response.citations) ||
      !Array.isArray(response.warnings) ||
      response.advisory_only !== true ||
      response.workflow_mutated !== false ||
      response.human_acceptance_required !== true
    ) {
      rejectInvalidS20AdvisoryInput();
    }

    if (
      !isNonEmptyString(traceIdentity.run_id) ||
      !isNonEmptyString(
        traceIdentity.prompt_package_id,
      ) ||
      !isNonEmptyString(traceIdentity.request_id) ||
      !isNonEmptyString(
        traceIdentity.correlation_id,
      ) ||
      !isValidIsoDateTime(
        traceIdentity.assembled_at,
      ) ||
      !isNonEmptyString(
        traceScope.organization_id,
      ) ||
      !isNonEmptyString(traceScope.capa_case_id) ||
      !isNonEmptyString(
        traceScope.case_version_id,
      ) ||
      !Number.isSafeInteger(
        traceScope.record_version,
      ) ||
      traceScope.record_version <= 0 ||
      traceScope.workflow_state !== "S20" ||
      promptPackage.agent.agent_id !==
        CAPA_CONTAINMENT_RISK_ADVISORY_AGENT.agent_id ||
      promptPackage.agent.agent_version !==
        CAPA_CONTAINMENT_RISK_ADVISORY_AGENT.agent_version
    ) {
      rejectInvalidS20AdvisoryInput();
    }

    if (
      response.run_id !== traceIdentity.run_id ||
      traceIdentity.request_id !== input.request_id ||
      traceIdentity.correlation_id !==
        input.correlation_id ||
      traceScope.organization_id !==
        context.organization_id ||
      traceScope.capa_case_id !==
        context.capa_case_id ||
      traceScope.case_version_id !==
        context.case_version_id ||
      traceScope.record_version !==
        context.record_version
    ) {
      rejectInvalidS20AdvisoryInput();
    }
  } catch (error) {
    if (
      error instanceof
      InMemoryCapaContainmentRiskAdvisoryPersistenceError
    ) {
      throw error;
    }

    rejectInvalidS20AdvisoryInput();
  }
}

function rejectInvalidS30AdvisoryInput(): never {
  throw new InMemoryCapaInvestigationPlanningAdvisoryPersistenceError();
}

function validateS30AdvisoryInput(
  input: InMemoryCapaInvestigationPlanningAdvisorySaveInput,
): void {
  try {
    const context = input.context;
    const response = input.response;
    const trace = input.generation_trace;
    const promptPackage = trace.package;
    const traceIdentity = promptPackage.trace;
    const scope = promptPackage.scope;
    const generation = promptPackage.generation_contract;
    const evidence = trace.evidence_manifest;
    const policy = trace.policy_manifest;
    const responseFields = [
      "run_id",
      "output_id",
      "output_schema_version",
      "status",
      "proposal",
      "assumptions",
      "uncertainty_and_limitations",
      "citations",
      "warnings",
      "advisory_only",
      "workflow_mutated",
      "human_acceptance_required",
    ];

    if (
      context.trust !== "authoritative_server_context" ||
      !UUID_PATTERN.test(context.organization_id) ||
      !UUID_PATTERN.test(context.capa_case_id) ||
      !UUID_PATTERN.test(context.case_version_id) ||
      !Number.isSafeInteger(context.record_version) ||
      context.record_version <= 0 ||
      context.workflow_state !== "S30" ||
      !UUID_PATTERN.test(input.request_id) ||
      !UUID_PATTERN.test(input.correlation_id)
    ) {
      rejectInvalidS30AdvisoryInput();
    }

    if (
      !isObjectRecord(response) ||
      Object.keys(response).length !== responseFields.length ||
      responseFields.some((field) => !Object.hasOwn(response, field)) ||
      !UUID_PATTERN.test(response.run_id) ||
      !UUID_PATTERN.test(response.output_id) ||
      response.output_schema_version !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
      response.status !== "completed_draft" ||
      !isObjectRecord(response.proposal) ||
      !Array.isArray(response.assumptions) ||
      !Array.isArray(response.uncertainty_and_limitations) ||
      !Array.isArray(response.citations) ||
      response.citations.length !== 0 ||
      !Array.isArray(response.warnings) ||
      response.warnings.length !== 0 ||
      response.advisory_only !== true ||
      response.workflow_mutated !== false ||
      response.human_acceptance_required !== true
    ) {
      rejectInvalidS30AdvisoryInput();
    }

    if (
      trace.trace_schema_version !== CAPA_AI_GENERATION_TRACE_SCHEMA_VERSION ||
      !UUID_PATTERN.test(traceIdentity.run_id) ||
      !UUID_PATTERN.test(traceIdentity.prompt_package_id) ||
      !UUID_PATTERN.test(traceIdentity.request_id) ||
      !UUID_PATTERN.test(traceIdentity.correlation_id) ||
      !isNonEmptyString(traceIdentity.assembled_at) ||
      promptPackage.package_schema_version !==
        CAPA_INVESTIGATION_PLANNING_PROMPT_PACKAGE_SCHEMA_VERSION ||
      !UUID_PATTERN.test(scope.organization_id) ||
      !UUID_PATTERN.test(scope.capa_case_id) ||
      !UUID_PATTERN.test(scope.case_version_id) ||
      !Number.isSafeInteger(scope.record_version) ||
      scope.record_version <= 0 ||
      scope.workflow_state !== "S30" ||
      promptPackage.agent.agent_id !== "AG-PLAN" ||
      promptPackage.agent.agent_version !== "ag-plan-1.0.0" ||
      generation.operation !== "draft_investigation_plan" ||
      generation.requested_output !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT ||
      generation.output_schema_version !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
      generation.store !== false ||
      trace.store !== false ||
      evidence.evidence_manifest_schema_version !==
        CAPA_INVESTIGATION_PLANNING_EVIDENCE_MANIFEST_SCHEMA_VERSION ||
      evidence.retrieval_performed !== false ||
      evidence.item_count !== 0 ||
      !Array.isArray(evidence.items) ||
      evidence.items.length !== 0 ||
      policy.policy_manifest_schema_version !==
        CAPA_INVESTIGATION_PLANNING_POLICY_MANIFEST_SCHEMA_VERSION ||
      policy.agent.agent_id !== "AG-PLAN" ||
      policy.agent.agent_version !== "ag-plan-1.0.0" ||
      policy.workflow_state !== "S30" ||
      policy.operation !== "draft_investigation_plan" ||
      policy.requested_output !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT ||
      policy.output_schema_version !==
        CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
      policy.authority.advisory_only !== true ||
      policy.authority.workflow_mutated !== false ||
      policy.authority.human_acceptance_required !== true ||
      trace.fingerprints.algorithm !== CAPA_AI_GENERATION_FINGERPRINT_ALGORITHM
    ) {
      rejectInvalidS30AdvisoryInput();
    }

    if (
      traceIdentity.run_id !== response.run_id ||
      traceIdentity.request_id !== input.request_id ||
      traceIdentity.correlation_id !== input.correlation_id ||
      scope.organization_id !== context.organization_id ||
      scope.capa_case_id !== context.capa_case_id ||
      scope.case_version_id !== context.case_version_id ||
      scope.record_version !== context.record_version ||
      scope.workflow_state !== context.workflow_state
    ) {
      rejectInvalidS30AdvisoryInput();
    }
  } catch (error) {
    if (error instanceof InMemoryCapaInvestigationPlanningAdvisoryPersistenceError) {
      throw error;
    }
    rejectInvalidS30AdvisoryInput();
  }
}

function rejectInvalidInvestigationPlanningAdoptionInput(): never {
  throw new InMemoryIntegrityError(
    "The S30 investigation-planning adoption persistence input is invalid.",
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

function validateInvestigationPlanningAdoptionInput(
  transaction: TransactionContext,
  input: CapaInvestigationPlanningAdoptionPersistenceInput,
): void {
  try {
    if (
      !isSha256(input.request_fingerprint) ||
      !isSha256(input.record_fingerprint) ||
      !UUID_PATTERN.test(input.audit_event_id)
    ) {
      rejectInvalidInvestigationPlanningAdoptionInput();
    }

    const adoption = input.adoption;
    const canonical = constructCapaInvestigationPlanningAdoption({
      adoption_id: adoption.adoption_id,
      organization_id: adoption.organization_id,
      capa_case_id: adoption.capa_case_id,
      case_version_id: adoption.case_version_id,
      record_version: adoption.record_version,
      output_id: adoption.output_id,
      adopted_item: adoption.adopted_item,
      adopted_at: adoption.adopted_at,
      adopted_by: adoption.adopted_by,
      request_id: adoption.request_id,
      correlation_id: adoption.correlation_id,
      idempotency_key: adoption.idempotency_key,
      adoption_policy_version: adoption.adoption_policy_version,
    });
    if (!isDeepStrictEqual(canonical, adoption)) {
      rejectInvalidInvestigationPlanningAdoptionInput();
    }
  } catch (error) {
    if (error instanceof InMemoryIntegrityError) throw error;
    rejectInvalidInvestigationPlanningAdoptionInput();
  }
}

function hasS30ProposalKey(
  response: CapaInvestigationPlanAdvisoryResponse,
  proposalKey: string,
): boolean {
  const proposal = response.proposal;
  if (!isObjectRecord(proposal)) return false;
  return [
    proposal.investigation_questions,
    proposal.evidence_requests,
    proposal.method_suggestions,
    proposal.dependencies,
    proposal.proposed_owner_role,
  ].some((items) =>
    Array.isArray(items) && items.some((item) =>
      isObjectRecord(item) && item.proposal_key === proposalKey,
    ),
  );
}

export class InMemoryCapaDatabase
  implements
    TransactionManager,
    CapaRepository,
    AuditRepository,
    CapaCaseNumberAllocator,
    CapaCreationIdempotencyRepository,
    CapaWorkflowIdempotencyRepository,
    CapaIntakeAdvisoryOutputRepository,
    CapaInvestigationPlanningAdvisoryOutputRepository,
    CapaInvestigationPlanningAdoptionRepository
{
  private committed_state:
    InMemoryState;

  private readonly active_transactions =
    new Map<
      TransactionId,
      ActiveTransaction
    >();

  private readonly maximum_case_number:
    number;

  constructor(
    private readonly options:
      InMemoryCapaDatabaseOptions,
  ) {
    this.maximum_case_number =
      requireMaximumCaseNumber(
        options.maximum_case_number,
      );
    const initialState = options.initial_snapshot === undefined
      ? emptyState()
      : stateFromSnapshot(options.initial_snapshot);
    try {
      this.validateState(initialState);
    } catch (error) {
      if (options.initial_snapshot !== undefined) {
        throw new CapaDevelopmentStateSnapshotError(
          "INVALID_SNAPSHOT",
          "The CAPA development state snapshot is internally inconsistent.",
        );
      }
      throw error;
    }
    this.committed_state = initialState;
  }

  /** Returns a defensive, deterministic JSON-safe snapshot of committed state. */
  exportSnapshot(): InMemoryCapaDatabaseSnapshot {
    return snapshotFromState(this.committed_state);
  }

  async runInTransaction<Result>(
    requestTrace:
      RequestTrace,

    work:
      TransactionWork<Result>,
  ): Promise<Result> {
    const transactionId =
      this.options
        .generate_transaction_id();

    if (
      this.active_transactions
        .has(transactionId)
    ) {
      throw new InMemoryDuplicateRecordError(
        "transaction",
      );
    }

    /*
     * A transaction operates on an isolated snapshot. Its revision is the
     * committed database revision observed when the transaction began.
     */
    const workingState =
      cloneState(
        this.committed_state,
      );

    const transaction:
      TransactionContext = {
      transaction_id:
        transactionId,

      started_at:
        iso(
          this.options.now(),
        ),

      request_trace:
        cloneValue(
          requestTrace,
        ),
    };

    this.active_transactions.set(
      transactionId,
      {
        context:
          transaction,

        state:
          workingState,
      },
    );

    try {
      const result =
        await work(
          transaction,
        );

      /*
       * No state becomes visible until all controlled relationships pass
       * validation.
       */
      this.validateState(
        workingState,
      );

      /*
       * Reject a stale snapshot if another transaction committed after
       * this transaction began.
       */
      if (
        this.committed_state
          .revision !==
        workingState.revision
      ) {
        throw new InMemoryTransactionConflictError();
      }

      const candidateState: InMemoryState = {
        ...workingState,

        revision:
          workingState.revision + 1,
      };

      await this.options.before_commit?.(
        snapshotFromState(candidateState),
      );

      this.committed_state = candidateState;

      return result;
    } finally {
      this.active_transactions.delete(
        transactionId,
      );
    }
  }

  /** Persist a governed S10 or S20 advisory in the active transaction. */
  async save(
    transaction: TransactionContext,
    input: InMemoryCapaIntakeAdvisorySaveInput,
  ): Promise<CapaIntakeAdvisoryOutputSaveResult>;

  async save(
    transaction: TransactionContext,
    input: InMemoryCapaContainmentRiskAdvisorySaveInput,
  ): Promise<CapaContainmentRiskAdvisoryOutputSaveResult>;

  async save(
    transaction: TransactionContext,
    input: InMemoryCapaInvestigationPlanningAdvisorySaveInput,
  ): Promise<CapaInvestigationPlanningAdvisoryOutputSaveResult>;

  async save(
    transaction: TransactionContext,
    input: InMemoryCapaAdvisorySaveInput,
  ): Promise<CapaIntakeAdvisoryOutputSaveResult | CapaContainmentRiskAdvisoryOutputSaveResult | CapaInvestigationPlanningAdvisoryOutputSaveResult> {
    const state = this.transactionState(transaction);

    if (isS30AdvisorySaveInput(input)) {
      return this.saveS30Advisory(transaction, state, input);
    }

    if (isS20AdvisorySaveInput(input)) {
      return this.saveS20Advisory(
        transaction,
        state,
        input,
      );
    }

    return this.saveS10Advisory(
      transaction,
      state,
      input,
    );
  }

  private async saveS10Advisory(
    transaction: TransactionContext,
    state: InMemoryState,
    input: InMemoryCapaIntakeAdvisorySaveInput,
  ): Promise<CapaIntakeAdvisoryOutputSaveResult> {
    if (
      transaction.request_trace
        .request_id !==
        input.request_id ||
      transaction.request_trace
        .correlation_id !==
        input.correlation_id
    ) {
      throw new Error(
        "IN_MEMORY_CAPA_ADVISORY_REQUEST_TRACE_MISMATCH",
      );
    }

    const response =
      input.response;

    /*
     * AI output authority is deliberately narrower than workflow authority.
     * Development persistence must enforce the same immutable authority
     * boundary as the durable repository.
     */
    if (
      response.advisory_only !== true ||
      response.workflow_mutated !== false ||
      response.human_acceptance_required !==
        true
    ) {
      throw new Error(
        "IN_MEMORY_CAPA_ADVISORY_AUTHORITY_INVALID",
      );
    }

    const capaCase =
      state.cases.get(
        recordKey(
          input.context.organization_id,
          input.context.capa_case_id,
        ),
      );

    if (
      capaCase === undefined ||
      capaCase.current_version_id !==
        input.context.case_version_id ||
      capaCase.record_version !==
        input.context.record_version ||
      capaCase.status !==
        input.context.workflow_state
    ) {
      return "case_changed";
    }

    const outputKey =
      recordKey(
        input.context.organization_id,
        response.output_id,
      );

    const runKey =
      recordKey(
        input.context.organization_id,
        response.run_id,
      );

    if (
      state.advisory_outputs.has(
        outputKey,
      ) ||
      state.advisory_runs.has(
        runKey,
      )
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA AI advisory output",
      );
    }

    const record:
      InMemoryCapaIntakeAdvisoryOutputRecord = {
      organization_id:
        input.context.organization_id,
      capa_case_id:
        input.context.capa_case_id,
      case_version_id:
        input.context.case_version_id,
      record_version:
        input.context.record_version,
      request_trace: {
        request_id:
          input.request_id,
        correlation_id:
          input.correlation_id,
      },
      response:
        cloneValue(response),
      created_at:
        transaction.started_at,
    };

    state.advisory_outputs.set(
      outputKey,
      cloneValue(record),
    );

    state.advisory_runs.set(
      runKey,
      response.output_id,
    );

    return "saved";
  }

  private async saveS20Advisory(
    transaction: TransactionContext,
    state: InMemoryState,
    input: InMemoryCapaContainmentRiskAdvisorySaveInput,
  ): Promise<CapaContainmentRiskAdvisoryOutputSaveResult> {
    if (
      transaction.request_trace.request_id !==
        input.request_id ||
      transaction.request_trace.correlation_id !==
        input.correlation_id
    ) {
      throw new InMemoryCapaContainmentRiskAdvisoryPersistenceError();
    }

    validateS20AdvisoryInput(input);

    const capaCase = state.cases.get(
      recordKey(
        input.context.organization_id,
        input.context.capa_case_id,
      ),
    );

    if (
      capaCase === undefined ||
      capaCase.current_version_id !==
        input.context.case_version_id ||
      capaCase.record_version !==
        input.context.record_version ||
      capaCase.status !== "S20"
    ) {
      return "case_changed";
    }

    const outputKey = recordKey(
      input.context.organization_id,
      input.response.output_id,
    );
    const runKey = recordKey(
      input.context.organization_id,
      input.response.run_id,
    );

    if (
      state.advisory_outputs.has(outputKey) ||
      state.advisory_runs.has(runKey)
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA AI advisory output",
      );
    }

    const record:
      InMemoryCapaContainmentRiskAdvisoryOutputRecord = {
      organization_id:
        input.context.organization_id,
      capa_case_id:
        input.context.capa_case_id,
      case_version_id:
        input.context.case_version_id,
      record_version:
        input.context.record_version,
      request_trace: {
        request_id: input.request_id,
        correlation_id: input.correlation_id,
      },
      response: cloneValue(input.response),
      generation_trace: cloneValue(
        input.generation_trace,
      ),
      created_at: transaction.started_at,
    };

    state.advisory_outputs.set(
      outputKey,
      cloneValue(record),
    );

    state.advisory_runs.set(
      runKey,
      input.response.output_id,
    );

    return "saved";
  }

  private async saveS30Advisory(
    transaction: TransactionContext,
    state: InMemoryState,
    input: InMemoryCapaInvestigationPlanningAdvisorySaveInput,
  ): Promise<CapaInvestigationPlanningAdvisoryOutputSaveResult> {
    if (
      transaction.request_trace.request_id !== input.request_id ||
      transaction.request_trace.correlation_id !== input.correlation_id
    ) {
      throw new InMemoryCapaInvestigationPlanningAdvisoryPersistenceError();
    }

    validateS30AdvisoryInput(input);

    const capaCase = state.cases.get(
      recordKey(input.context.organization_id, input.context.capa_case_id),
    );

    if (
      capaCase === undefined ||
      capaCase.current_version_id !== input.context.case_version_id ||
      capaCase.record_version !== input.context.record_version ||
      capaCase.status !== "S30"
    ) {
      return "case_changed";
    }

    const outputKey = recordKey(
      input.context.organization_id,
      input.response.output_id,
    );
    const runKey = recordKey(
      input.context.organization_id,
      input.response.run_id,
    );

    if (
      state.advisory_outputs.has(outputKey) ||
      state.advisory_runs.has(runKey)
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA AI advisory output",
      );
    }

    const record: InMemoryCapaInvestigationPlanningAdvisoryOutputRecord = {
      organization_id: input.context.organization_id,
      capa_case_id: input.context.capa_case_id,
      case_version_id: input.context.case_version_id,
      record_version: input.context.record_version,
      request_trace: {
        request_id: input.request_id,
        correlation_id: input.correlation_id,
      },
      response: cloneValue(input.response),
      generation_trace: cloneValue(input.generation_trace),
      created_at: transaction.started_at,
    };

    state.advisory_outputs.set(outputKey, cloneValue(record));
    state.advisory_runs.set(runKey, input.response.output_id);

    return "saved";
  }

  async appendAdoption(
    transaction: TransactionContext,
    input: CapaInvestigationPlanningAdoptionPersistenceInput,
  ): Promise<AppendCapaInvestigationPlanningAdoptionResult> {
    const state = this.transactionState(transaction);
    validateInvestigationPlanningAdoptionInput(transaction, input);

    const adoption = input.adoption;
    const adoptionKey = recordKey(
      adoption.organization_id,
      adoption.adoption_id,
    );
    const idempotencyKey = adoptionIdempotencyKey(
      adoption.organization_id,
      adoption.idempotency_key,
      adoption.proposal_key,
    );

    const existingByIdempotency = [...state.investigation_planning_adoptions.values()]
      .find((record) =>
        adoptionIdempotencyKey(
          record.adoption.organization_id,
          record.adoption.idempotency_key,
          record.adoption.proposal_key,
        ) === idempotencyKey,
      );

    if (existingByIdempotency !== undefined) {
      if (existingByIdempotency.request_fingerprint === input.request_fingerprint) {
        return {
          status: "already_recorded",
          record: cloneValue(existingByIdempotency),
        };
      }
      return {
        status: "conflict",
        reason_code: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
        record: cloneValue(existingByIdempotency),
      };
    }

    const existingByAdoptionId = state.investigation_planning_adoptions.get(adoptionKey);
    if (existingByAdoptionId !== undefined) {
      return {
        status: "conflict",
        reason_code: "ADOPTION_ID_REUSED_WITH_DIFFERENT_CONTENT",
        record: cloneValue(existingByAdoptionId),
      };
    }

    const existingByAudit = [...state.investigation_planning_adoptions.values()]
      .find((record) =>
        record.audit_event_id === input.audit_event_id &&
        record.adoption.organization_id === adoption.organization_id,
      );
    if (existingByAudit !== undefined) {
      return {
        status: "conflict",
        reason_code: "AUDIT_EVENT_ID_REUSED_WITH_DIFFERENT_ADOPTION",
        record: cloneValue(existingByAudit),
      };
    }

    if (
      transaction.request_trace.request_id !== adoption.request_id ||
      transaction.request_trace.correlation_id !== adoption.correlation_id
    ) {
      rejectInvalidInvestigationPlanningAdoptionInput();
    }

    const output = state.advisory_outputs.get(
      recordKey(adoption.organization_id, adoption.output_id),
    );
    if (output === undefined) {
      return { status: "output_not_found_or_not_authorized" };
    }

    if (
      !isS30AdvisoryOutputRecord(output) ||
      output.capa_case_id !== adoption.capa_case_id ||
      output.case_version_id !== adoption.case_version_id ||
      output.record_version !== adoption.record_version ||
      output.response.status !== "completed_draft" ||
      output.response.output_schema_version !== CAPA_INVESTIGATION_PLAN_ADVISORY_OUTPUT_SCHEMA_VERSION ||
      output.response.advisory_only !== true ||
      output.response.workflow_mutated !== false ||
      output.response.human_acceptance_required !== true ||
      output.generation_trace.package.agent.agent_id !== "AG-PLAN" ||
      output.generation_trace.package.agent.agent_version !== "ag-plan-1.0.0"
    ) {
      return { status: "output_not_adoptable" };
    }

    if (!hasS30ProposalKey(output.response, adoption.proposal_key)) {
      return { status: "output_not_adoptable" };
    }

    const capaCase = state.cases.get(
      recordKey(adoption.organization_id, adoption.capa_case_id),
    );
    if (
      capaCase === undefined ||
      capaCase.current_version_id !== adoption.case_version_id ||
      capaCase.record_version !== adoption.record_version ||
      capaCase.status !== "S30"
    ) {
      return { status: "case_changed" };
    }

    const persisted: PersistedCapaInvestigationPlanningAdoption = cloneValue({
      adoption,
      request_fingerprint: input.request_fingerprint,
      record_fingerprint: input.record_fingerprint,
      audit_event_id: input.audit_event_id,
    });
    state.investigation_planning_adoptions.set(adoptionKey, persisted);
    return { status: "saved", record: cloneValue(persisted) };
  }

  async findAdoptionById(
    organizationId: OrganizationId,
    adoptionId: CapaInvestigationPlanningAdoptionId,
  ): Promise<PersistedCapaInvestigationPlanningAdoption | null> {
    const record = this.committed_state.investigation_planning_adoptions.get(
      recordKey(organizationId, adoptionId),
    );
    return record === undefined ? null : cloneValue(record);
  }

  async listAdoptionsForOutput(
    organizationId: OrganizationId,
    outputId: string,
  ): Promise<readonly PersistedCapaInvestigationPlanningAdoption[]> {
    return Object.freeze(
      [...this.committed_state.investigation_planning_adoptions.values()]
        .filter((record) =>
          record.adoption.organization_id === organizationId &&
          record.adoption.output_id === outputId,
        )
        .sort((left, right) =>
          left.adoption.adopted_at.localeCompare(right.adoption.adopted_at) ||
          left.adoption.adoption_id.localeCompare(right.adoption.adoption_id),
        )
        .map((record) => cloneValue(record)),
    );
  }

  async listCases(
    query:
      CapaCaseListQuery,
  ): Promise<CapaCaseListPage> {
    requireCaseListQuery(query);

    const matchingCases = [
      ...this.committed_state
        .cases.values(),
    ]
      .filter(
        (capaCase) =>
          capaCase.organization_id ===
          query.organization_id,
      )
      .filter((capaCase) => {
        if (query.cursor === undefined) {
          return true;
        }

        return (
          capaCase.created_at <
            query.cursor.created_at ||
          (
            capaCase.created_at ===
              query.cursor.created_at &&
            capaCase.capa_case_id <
              query.cursor.capa_case_id
          )
        );
      })
      .sort((left, right) => {
        const createdAtOrder =
          right.created_at.localeCompare(
            left.created_at,
          );

        if (createdAtOrder !== 0) {
          return createdAtOrder;
        }

        return right.capa_case_id
          .localeCompare(
            left.capa_case_id,
          );
      });

    const selectedCases =
      matchingCases.slice(
        0,
        query.limit + 1,
      );

    const hasAnotherPage =
      selectedCases.length >
      query.limit;

    const cases = selectedCases
      .slice(0, query.limit)
      .map(cloneValue);

    const lastCase =
      cases[cases.length - 1];

    return {
      cases,

      ...(hasAnotherPage &&
      lastCase !== undefined
        ? {
            next_cursor: {
              created_at:
                lastCase.created_at,

              capa_case_id:
                lastCase.capa_case_id,
            },
          }
        : {}),
    };
  }

  async findCaseById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,
  ): Promise<CapaCase | null> {
    const value =
      this.committed_state
        .cases
        .get(
          recordKey(
            organizationId,
            capaCaseId,
          ),
        );

    return value === undefined
      ? null
      : cloneValue(value);
  }

  async findCaseVersionById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,

    caseVersionId:
      CapaCaseVersionId,
  ): Promise<CapaCaseVersion | null> {
    const value =
      this.committed_state
        .case_versions
        .get(
          recordKey(
            organizationId,
            caseVersionId,
          ),
        );

    if (
      value === undefined ||
      value.capa_case_id !==
        capaCaseId
    ) {
      return null;
    }

    return cloneValue(value);
  }

  async findSectionVersionById(
    organizationId:
      OrganizationId,

    capaCaseId:
      CapaCaseId,

    sectionVersionId:
      CapaSectionVersionId,
  ): Promise<CapaSectionVersion | null> {
    const value =
      this.committed_state
        .section_versions
        .get(
          recordKey(
            organizationId,
            sectionVersionId,
          ),
        );

    if (
      value === undefined ||
      value.capa_case_id !==
        capaCaseId
    ) {
      return null;
    }

    return cloneValue(value);
  }

  async claimCreation(
    transaction:
      TransactionContext,
    record:
      CapaCreationIdempotencyRecord,
  ): Promise<ClaimCapaCreationResult> {
    const state =
      this.transactionState(
        transaction,
      );

    const key =
      creationIdempotencyKey(
        record.organization_id,
        record.idempotency_key,
      );

    const existing =
      state.creation_idempotency
        .get(key);

    if (existing === undefined) {
      const claimedRecord =
        cloneValue(record);

      state.creation_idempotency.set(
        key,
        claimedRecord,
      );

      return {
        status: "claimed",
        record:
          cloneValue(claimedRecord),
      };
    }

    if (
      existing.request_fingerprint ===
      record.request_fingerprint
    ) {
      return {
        status: "already_claimed",
        record:
          cloneValue(existing),
      };
    }

    return {
      status: "conflict",
      record:
        cloneValue(existing),
      reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    };
  }

  async claimWorkflowOperation(
    transaction:
      TransactionContext,
    record:
      CapaWorkflowIdempotencyRecord,
  ): Promise<ClaimCapaWorkflowOperationResult> {
    const state =
      this.transactionState(
        transaction,
      );

    const key =
      workflowIdempotencyKey(
        record.organization_id,
        record.idempotency_key,
      );

    const existing =
      state.workflow_idempotency
        .get(key);

    if (existing === undefined) {
      const claimedRecord =
        cloneValue(record);

      state.workflow_idempotency.set(
        key,
        claimedRecord,
      );

      return {
        status: "claimed",
        record:
          cloneValue(claimedRecord),
      };
    }

    if (
      existing.operation_code ===
        record.operation_code &&
      existing.request_fingerprint ===
        record.request_fingerprint
    ) {
      return {
        status: "already_claimed",
        record:
          cloneValue(existing),
      };
    }

    return {
      status: "conflict",
      record:
        cloneValue(existing),
      reason_code:
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_REQUEST",
    };
  }

  /**
   * Allocates the next organization-local CAPA number through the active
   * transaction snapshot.
   *
   * The counter is committed only if the transaction completes. A thrown
   * error therefore makes the number available to the next transaction.
   */
  async allocateNextCaseNumber(
    transaction:
      TransactionContext,

    organizationId:
      OrganizationId,
  ): Promise<string> {
    const state =
      this.transactionState(
        transaction,
      );

    const counterKey =
      caseNumberCounterKey(
        organizationId,
      );

    const current =
      state.case_number_counters
        .get(counterKey) ?? 0;

    if (
      current >=
      this.maximum_case_number
    ) {
      throw new InMemoryCapaCaseNumberExhaustedError();
    }

    const next =
      current + 1;

    state.case_number_counters.set(
      counterKey,
      next,
    );

    return formatCaseNumber(
      next,
    );
  }

  async caseNumberExists(
    organizationId:
      OrganizationId,

    caseNumber:
      string,
  ): Promise<boolean> {
    return this.committed_state
      .case_numbers
      .has(
        caseNumberKey(
          organizationId,
          caseNumber,
        ),
      );
  }

  async insertCase(
    transaction:
      TransactionContext,

    capaCase:
      CapaCase,
  ): Promise<void> {
    const state =
      this.transactionState(
        transaction,
      );

    const identityKey =
      recordKey(
        capaCase.organization_id,
        capaCase.capa_case_id,
      );

    if (
      state.cases.has(
        identityKey,
      )
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA case",
      );
    }

    const numberKey =
      caseNumberKey(
        capaCase.organization_id,
        capaCase.case_number,
      );

    if (
      state.case_numbers.has(
        numberKey,
      )
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA case number",
      );
    }

    state.cases.set(
      identityKey,
      cloneValue(
        capaCase,
      ),
    );

    state.case_numbers.set(
      numberKey,
      capaCase.capa_case_id,
    );
  }

  async insertSectionVersion(
    transaction:
      TransactionContext,

    sectionVersion:
      CapaSectionVersion,
  ): Promise<void> {
    const state =
      this.transactionState(
        transaction,
      );

    const key =
      recordKey(
        sectionVersion.organization_id,
        sectionVersion.section_version_id,
      );

    if (
      state.section_versions
        .has(key)
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA section version",
      );
    }

    state.section_versions.set(
      key,
      cloneValue(
        sectionVersion,
      ),
    );
  }

  async insertCaseVersion(
    transaction:
      TransactionContext,

    caseVersion:
      CapaCaseVersion,
  ): Promise<void> {
    const state =
      this.transactionState(
        transaction,
      );

    const key =
      recordKey(
        caseVersion.organization_id,
        caseVersion.case_version_id,
      );

    if (
      state.case_versions
        .has(key)
    ) {
      throw new InMemoryDuplicateRecordError(
        "CAPA case version",
      );
    }

    state.case_versions.set(
      key,
      cloneValue(
        caseVersion,
      ),
    );
  }

  async advanceCurrentVersion(
    transaction:
      TransactionContext,

    input:
      AdvanceCapaVersionInput,
  ): Promise<AdvanceCapaVersionResult> {
    const state =
      this.transactionState(
        transaction,
      );

    const caseKey =
      recordKey(
        input.organization_id,
        input.capa_case_id,
      );

    const current =
      state.cases.get(
        caseKey,
      );

    if (
      current === undefined
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    if (
      current.record_version !==
      input.expected_record_version
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "RECORD_VERSION_CONFLICT",
      };
    }

    if (
      current.current_version_id !==
      input.expected_current_version_id
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "CURRENT_VERSION_CONFLICT",
      };
    }

    const nextVersion =
      state.case_versions.get(
        recordKey(
          input.organization_id,
          input.next_current_version_id,
        ),
      );

    if (
      nextVersion === undefined ||
      nextVersion.capa_case_id !==
        input.capa_case_id
    ) {
      return {
        status:
          "conflict",

        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    const updated:
      CapaCase = {
      ...current,

      current_version_id:
        input.next_current_version_id,

      status:
        input.next_status,

      record_version:
        current.record_version + 1,

      updated_at:
        input.updated_at,

      updated_by:
        input.updated_by,
    };

    state.cases.set(
      caseKey,
      cloneValue(
        updated,
      ),
    );

    return {
      status:
        "updated",

      capa_case:
        cloneValue(
          updated,
        ),
    };
  }

  async appendEvent(
    transaction:
      TransactionContext,

    event:
      AuditEvent,
  ): Promise<AppendAuditEventResult> {
    const state =
      this.transactionState(
        transaction,
      );

    const key =
      recordKey(
        event.organization_id,
        event.event_id,
      );

    const existing =
      state.audit_events.get(
        key,
      );

    if (
      existing !== undefined
    ) {
      if (
        isDeepStrictEqual(
          existing,
          event,
        )
      ) {
        return {
          status:
            "already_recorded",

          event_id:
            event.event_id,
        };
      }

      return {
        status:
          "conflict",

        event_id:
          event.event_id,

        reason_code:
          "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
      };
    }

    state.audit_events.set(
      key,
      cloneValue(
        event,
      ),
    );

    return {
      status:
        "appended",

      event_id:
        event.event_id,
    };
  }

  async findEventById(
    organizationId:
      OrganizationId,

    eventId:
      AuditEventId,
  ): Promise<AuditEvent | null> {
    const value =
      this.committed_state
        .audit_events
        .get(
          recordKey(
            organizationId,
            eventId,
          ),
        );

    return value === undefined
      ? null
      : cloneValue(value);
  }

  async listEventsForAggregate(
    query:
      AuditEventQuery,
  ): Promise<AuditEventPage> {
    if (
      !Number.isInteger(
        query.limit,
      ) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new InMemoryAuditQueryError();
    }

    const offset =
      query.cursor === undefined
        ? 0
        : Number(
            query.cursor,
          );

    if (
      !Number.isInteger(
        offset,
      ) ||
      offset < 0
    ) {
      throw new InMemoryAuditQueryError();
    }

    const matching = [
      ...this.committed_state
        .audit_events
        .values(),
    ]
      .filter(
        (event) =>
          event.organization_id ===
            query.organization_id &&
          event.aggregate_type ===
            query.aggregate_type &&
          event.aggregate_id ===
            query.aggregate_id,
      )
      .sort(
        (left, right) => {
          const timeComparison =
            left.occurred_at
              .localeCompare(
                right.occurred_at,
              );

          if (
            timeComparison !== 0
          ) {
            return timeComparison;
          }

          return left.event_id
            .localeCompare(
              right.event_id,
            );
        },
      );

    const events =
      matching
        .slice(
          offset,
          offset + query.limit,
        )
        .map(
          (event) =>
            cloneValue(event),
        );

    const nextOffset =
      offset + events.length;

    return {
      events,

      next_cursor:
        nextOffset <
        matching.length
          ? String(
              nextOffset,
            ) as AuditCursor
          : undefined,
    };
  }

  /**
   * Resolves a transaction-owned working state.
   *
   * Comparing the context object by identity prevents a caller from
   * manufacturing another context containing an active transaction ID.
   */
  private transactionState(
    transaction:
      TransactionContext,
  ): InMemoryState {
    const active =
      this.active_transactions.get(
        transaction.transaction_id,
      );

    if (
      active === undefined ||
      active.context !==
        transaction
    ) {
      throw new InMemoryTransactionNotActiveError();
    }

    return active.state;
  }

  /**
   * Enforces relationships that a physical production database would
   * ordinarily protect with composite keys and foreign-key constraints.
   */
  private validateState(
    state:
      InMemoryState,
  ): void {
    for (
      const claim
      of state.creation_idempotency
        .values()
    ) {
      const capaCase =
        state.cases.get(
          recordKey(
            claim.organization_id,
            claim.capa_case_id,
          ),
        );

      const caseVersion =
        state.case_versions.get(
          recordKey(
            claim.organization_id,
            claim.case_version_id,
          ),
        );

      const sectionVersion =
        state.section_versions.get(
          recordKey(
            claim.organization_id,
            claim.section_version_id,
          ),
        );

      const auditEvent =
        state.audit_events.get(
          recordKey(
            claim.organization_id,
            claim.audit_event_id,
          ),
        );

      if (
        capaCase === undefined ||
        caseVersion === undefined ||
        sectionVersion === undefined ||
        auditEvent === undefined ||
        caseVersion.capa_case_id !==
          claim.capa_case_id ||
        !caseVersion.section_version_ids
          .includes(
            claim.section_version_id,
          ) ||
        sectionVersion.capa_case_id !==
          claim.capa_case_id ||
        auditEvent.aggregate_id !==
          claim.capa_case_id
      ) {
        throw new InMemoryIntegrityError(
          "A CAPA creation-idempotency record references an incomplete aggregate.",
        );
      }
    }

    for (
      const claim
      of state.workflow_idempotency
        .values()
    ) {
      const capaCase =
        state.cases.get(
          recordKey(
            claim.organization_id,
            claim.capa_case_id,
          ),
        );

      const sourceVersion =
        state.case_versions.get(
          recordKey(
            claim.organization_id,
            claim.source_case_version_id,
          ),
        );

      const resultingVersion =
        state.case_versions.get(
          recordKey(
            claim.organization_id,
            claim.resulting_case_version_id,
          ),
        );

      const auditEvent =
        state.audit_events.get(
          recordKey(
            claim.organization_id,
            claim.audit_event_id,
          ),
        );

      if (
        capaCase === undefined ||
        sourceVersion === undefined ||
        resultingVersion === undefined ||
        auditEvent === undefined ||
        sourceVersion.capa_case_id !==
          claim.capa_case_id ||
        resultingVersion.capa_case_id !==
          claim.capa_case_id ||
        auditEvent.aggregate_id !==
          claim.capa_case_id
      ) {
        throw new InMemoryIntegrityError(
          "A CAPA workflow-idempotency record references an incomplete transition.",
        );
      }
    }

    for (
      const capaCase
      of state.cases.values()
    ) {
      const currentVersion =
        state.case_versions.get(
          recordKey(
            capaCase.organization_id,
            capaCase.current_version_id,
          ),
        );

      if (
        currentVersion === undefined ||
        currentVersion.capa_case_id !==
          capaCase.capa_case_id
      ) {
        throw new InMemoryIntegrityError(
          "A CAPA case references an invalid current version.",
        );
      }
    }

    for (
      const sectionVersion
      of state.section_versions.values()
    ) {
      const parentCase =
        state.cases.get(
          recordKey(
            sectionVersion.organization_id,
            sectionVersion.capa_case_id,
          ),
        );

      if (
        parentCase === undefined
      ) {
        throw new InMemoryIntegrityError(
          "A CAPA section version references an invalid case.",
        );
      }
    }

    for (
      const caseVersion
      of state.case_versions.values()
    ) {
      const parentCase =
        state.cases.get(
          recordKey(
            caseVersion.organization_id,
            caseVersion.capa_case_id,
          ),
        );

      if (
        parentCase === undefined
      ) {
        throw new InMemoryIntegrityError(
          "A CAPA case version references an invalid case.",
        );
      }

      for (
        const sectionVersionId
        of caseVersion.section_version_ids
      ) {
        const referencedSection =
          state.section_versions.get(
            recordKey(
              caseVersion.organization_id,
              sectionVersionId,
            ),
          );

        if (
          referencedSection ===
            undefined ||
          referencedSection
            .capa_case_id !==
            caseVersion.capa_case_id
        ) {
          throw new InMemoryIntegrityError(
            "A CAPA case version references an invalid section version.",
          );
        }
      }
    }

    for (
      const persisted
      of state.investigation_planning_adoptions.values()
    ) {
      const adoption = persisted.adoption;
      const capaCase = state.cases.get(
        recordKey(adoption.organization_id, adoption.capa_case_id),
      );
      const output = state.advisory_outputs.get(
        recordKey(adoption.organization_id, adoption.output_id),
      );
      const auditEvent = state.audit_events.get(
        recordKey(adoption.organization_id, persisted.audit_event_id),
      );

      if (
        capaCase === undefined ||
        auditEvent === undefined ||
        !isS30AdvisoryOutputRecord(output) ||
        output.capa_case_id !== adoption.capa_case_id ||
        output.case_version_id !== adoption.case_version_id ||
        output.record_version !== adoption.record_version ||
        output.response.status !== "completed_draft" ||
        !hasS30ProposalKey(output.response, adoption.proposal_key) ||
        adoption.adopted_by.actor_type !== "human" ||
        adoption.workflow_mutated !== false ||
        adoption.controlled_record_mutated !== false ||
        adoption.gate_approved !== false ||
        !isSha256(persisted.request_fingerprint) ||
        !isSha256(persisted.record_fingerprint)
      ) {
        throw new InMemoryIntegrityError(
          "A S30 investigation-planning adoption references an invalid immutable record.",
        );
      }
    }
  }
}
