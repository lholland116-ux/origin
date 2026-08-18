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
  IsoDateTime,
  OrganizationId,
  RequestTrace,
} from "../../capa/domain/capa-types";

import type {
  AdvanceCapaVersionInput,
  AdvanceCapaVersionResult,
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
  TransactionContext,
  TransactionId,
  TransactionManager,
  TransactionWork,
} from "../transactions";

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
    CapaCaseNumberAllocator
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