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
      InMemoryCapaIntakeAdvisoryOutputRecord
    >;

  /**
   * Organization-scoped run identity index mirroring the durable
   * organization/run uniqueness constraint.
   */
  readonly advisory_runs:
    Map<string, string>;
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

export class InMemoryCapaDatabase
  implements
    TransactionManager,
    CapaRepository,
    AuditRepository,
    CapaCaseNumberAllocator,
    CapaCreationIdempotencyRepository,
    CapaWorkflowIdempotencyRepository,
    CapaIntakeAdvisoryOutputRepository
{
  private committed_state:
    InMemoryState =
      emptyState();

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

      this.committed_state = {
        ...workingState,

        revision:
          workingState.revision + 1,
      };

      return result;
    } finally {
      this.active_transactions.delete(
        transactionId,
      );
    }
  }

  /**
   * Persists one governed intake advisory inside an active CAPA transaction.
   *
   * The transaction-owned case snapshot is rechecked immediately before the
   * output is stored. A stale workflow/version returns "case_changed" rather
   * than persisting an advisory against a superseded CAPA state.
   */
  async save(
    transaction: TransactionContext,
    input: Parameters<
      CapaIntakeAdvisoryOutputRepository["save"]
    >[1],
  ): Promise<CapaIntakeAdvisoryOutputSaveResult> {
    const state =
      this.transactionState(
        transaction,
      );

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
  }
}