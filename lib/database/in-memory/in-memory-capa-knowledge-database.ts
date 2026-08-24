import { isDeepStrictEqual } from "node:util";

import type {
  IsoDateTime,
  RequestTrace,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeCollectionVersion,
  CapaKnowledgeDerivative,
  CapaKnowledgeOriginalArtifact,
  CapaKnowledgePassage,
  CapaKnowledgeSource,
  CapaKnowledgeSourceVersion,
} from "../../capa/knowledge/capa-knowledge-contract";

import type {
  CapaKnowledgeIngestionAuditInput,
  CapaKnowledgeIngestionAuditRecorder,
} from "../../capa/knowledge/capa-knowledge-ingestion-service";

import type {
  AdvanceCapaKnowledgeLifecycleInput,
  AdvanceCapaKnowledgeLifecycleResult,
  CapaKnowledgeCollectionVersionLookup,
  CapaKnowledgeFingerprintLookup,
  CapaKnowledgePassageListPage,
  CapaKnowledgePassageListQuery,
  CapaKnowledgeRepository,
  CapaKnowledgeScope,
  CapaKnowledgeSourceVersionLookup,
} from "../repositories/capa-knowledge-repository";

import type {
  TransactionContext,
  TransactionId,
  TransactionManager,
  TransactionWork,
} from "../transactions";

/** Development-only governed knowledge persistence with atomic snapshots. */

interface KnowledgeState {
  readonly revision: number;
  readonly sources:
    Map<string, CapaKnowledgeSource>;
  readonly source_versions:
    Map<string, CapaKnowledgeSourceVersion>;
  readonly source_version_record_versions:
    Map<string, number>;
  readonly artifacts:
    Map<string, CapaKnowledgeOriginalArtifact>;
  readonly derivatives:
    Map<string, CapaKnowledgeDerivative>;
  readonly passages:
    Map<string, CapaKnowledgePassage>;
  readonly collection_versions:
    Map<string, CapaKnowledgeCollectionVersion>;
  readonly ingestion_audits:
    Map<string, CapaKnowledgeIngestionAuditInput>;
}

interface ActiveTransaction {
  readonly context: TransactionContext;
  readonly state: KnowledgeState;
}

export interface InMemoryCapaKnowledgeDatabaseOptions {
  readonly generate_transaction_id:
    () => TransactionId;
  readonly now: () => Date;
}

export class InMemoryCapaKnowledgeIntegrityError
  extends Error {
  constructor(
    message =
      "The in-memory CAPA knowledge state is invalid.",
  ) {
    super(message);
    this.name =
      "InMemoryCapaKnowledgeIntegrityError";
  }
}

export class InMemoryCapaKnowledgeTransactionError
  extends Error {
  constructor(
    message =
      "The CAPA knowledge transaction is not active.",
  ) {
    super(message);
    this.name =
      "InMemoryCapaKnowledgeTransactionError";
  }
}

export class InMemoryCapaKnowledgeConflictError
  extends Error {
  constructor() {
    super(
      "The in-memory CAPA knowledge database changed before commit.",
    );
    this.name =
      "InMemoryCapaKnowledgeConflictError";
  }
}

function emptyState(): KnowledgeState {
  return {
    revision: 0,
    sources: new Map(),
    source_versions: new Map(),
    source_version_record_versions:
      new Map(),
    artifacts: new Map(),
    derivatives: new Map(),
    passages: new Map(),
    collection_versions: new Map(),
    ingestion_audits: new Map(),
  };
}

function cloneValue<Value>(value: Value): Value {
  return structuredClone(value);
}

function cloneMap<Value>(
  source: ReadonlyMap<string, Value>,
): Map<string, Value> {
  return new Map(
    [...source].map(([key, value]) => [
      key,
      cloneValue(value),
    ]),
  );
}

function cloneState(
  state: KnowledgeState,
): KnowledgeState {
  return {
    revision: state.revision,
    sources: cloneMap(state.sources),
    source_versions:
      cloneMap(state.source_versions),
    source_version_record_versions:
      new Map(
        state.source_version_record_versions,
      ),
    artifacts: cloneMap(state.artifacts),
    derivatives: cloneMap(state.derivatives),
    passages: cloneMap(state.passages),
    collection_versions:
      cloneMap(state.collection_versions),
    ingestion_audits:
      cloneMap(state.ingestion_audits),
  };
}

function scopeMatches(
  scope: CapaKnowledgeScope,
  organizationId: unknown,
): boolean {
  return scope.visibility === "organization"
    ? organizationId === scope.organization_id
    : organizationId === undefined;
}

function fingerprintKey(
  scope: CapaKnowledgeScope,
  value: string,
): string {
  return scope.visibility === "organization"
    ? `organization:${scope.organization_id}:${value}`
    : `approved_global:${value}`;
}

export class InMemoryCapaKnowledgeDatabase
  implements
    CapaKnowledgeRepository,
    CapaKnowledgeIngestionAuditRecorder,
    TransactionManager {
  private state = emptyState();
  private readonly active =
    new Map<string, ActiveTransaction>();

  constructor(
    private readonly options:
      InMemoryCapaKnowledgeDatabaseOptions,
  ) {}

  async runInTransaction<Result>(
    requestTrace: RequestTrace,
    work: TransactionWork<Result>,
  ): Promise<Result> {
    const transactionId =
      this.options.generate_transaction_id();

    if (this.active.has(transactionId)) {
      throw new InMemoryCapaKnowledgeTransactionError(
        "The generated transaction identity is already active.",
      );
    }

    const startedAt = this.options.now();

    if (Number.isNaN(startedAt.getTime())) {
      throw new InMemoryCapaKnowledgeTransactionError(
        "The transaction clock returned an invalid time.",
      );
    }

    const context = Object.freeze({
      transaction_id: transactionId,
      started_at:
        startedAt.toISOString() as IsoDateTime,
      request_trace: requestTrace,
    });
    const snapshot = cloneState(this.state);

    this.active.set(transactionId, {
      context,
      state: snapshot,
    });

    try {
      const result = await work(context);

      if (
        this.state.revision !== snapshot.revision
      ) {
        throw new InMemoryCapaKnowledgeConflictError();
      }

      this.validateState(snapshot);
      this.state = {
        ...snapshot,
        revision: snapshot.revision + 1,
      };

      return result;
    } finally {
      this.active.delete(transactionId);
    }
  }

  async findSourceById(
    scope: CapaKnowledgeScope,
    sourceId: CapaKnowledgeSource["source_id"],
  ): Promise<CapaKnowledgeSource | null> {
    const value = this.state.sources.get(sourceId);

    return value !== undefined &&
      scopeMatches(scope, value.organization_id)
      ? cloneValue(value)
      : null;
  }

  async findSourceVersionById(
    lookup: CapaKnowledgeSourceVersionLookup,
  ): Promise<CapaKnowledgeSourceVersion | null> {
    const value = this.state.source_versions.get(
      lookup.source_version_id,
    );

    return value !== undefined &&
      value.source_id === lookup.source_id &&
      scopeMatches(
        lookup.scope,
        value.organization_id,
      )
      ? cloneValue(value)
      : null;
  }

  async findSourceVersionByOriginalFingerprint(
    lookup: CapaKnowledgeFingerprintLookup,
  ): Promise<CapaKnowledgeSourceVersion | null> {
    const wanted = fingerprintKey(
      lookup.scope,
      lookup.fingerprint.value,
    );

    for (const value of this.state
      .source_versions.values()) {
      if (
        value.content_fingerprint.algorithm ===
          lookup.fingerprint.algorithm &&
        fingerprintKey(
          lookup.scope,
          value.content_fingerprint.value,
        ) === wanted &&
        scopeMatches(
          lookup.scope,
          value.organization_id,
        )
      ) {
        return cloneValue(value);
      }
    }

    return null;
  }

  async findOriginalArtifactById(
    lookup: CapaKnowledgeSourceVersionLookup & {
      readonly artifact_id:
        CapaKnowledgeOriginalArtifact["artifact_id"];
    },
  ): Promise<CapaKnowledgeOriginalArtifact | null> {
    const value = this.state.artifacts.get(
      lookup.artifact_id,
    );

    return value !== undefined &&
      value.source_version_id ===
        lookup.source_version_id &&
      scopeMatches(
        lookup.scope,
        value.organization_id,
      )
      ? cloneValue(value)
      : null;
  }

  async findDerivativeById(
    lookup: CapaKnowledgeSourceVersionLookup & {
      readonly derivative_id:
        CapaKnowledgeDerivative["derivative_id"];
    },
  ): Promise<CapaKnowledgeDerivative | null> {
    const value = this.state.derivatives.get(
      lookup.derivative_id,
    );

    return value !== undefined &&
      value.source_version_id ===
        lookup.source_version_id &&
      scopeMatches(
        lookup.scope,
        value.organization_id,
      )
      ? cloneValue(value)
      : null;
  }

  async listPassages(
    query: CapaKnowledgePassageListQuery,
  ): Promise<CapaKnowledgePassageListPage> {
    if (
      !Number.isSafeInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100 ||
      (
        query.after_sequence_number !==
          undefined &&
        (
          !Number.isSafeInteger(
            query.after_sequence_number,
          ) ||
          query.after_sequence_number < 0
        )
      )
    ) {
      throw new InMemoryCapaKnowledgeIntegrityError(
        "The passage query is invalid.",
      );
    }

    const all = [...this.state.passages.values()]
      .filter((passage) =>
        passage.source_version_id ===
          query.source_version_id &&
        passage.derivative_id ===
          query.derivative_id &&
        scopeMatches(
          query.scope,
          passage.organization_id,
        ) &&
        passage.sequence_number >
          (query.after_sequence_number ?? 0),
      )
      .sort(
        (left, right) =>
          left.sequence_number -
          right.sequence_number,
      );
    const selected = all.slice(0, query.limit);

    return {
      passages: cloneValue(selected),
      ...(all.length > selected.length
        ? {
            next_sequence_number:
              selected[
                selected.length - 1
              ]!.sequence_number,
          }
        : {}),
    };
  }

  async findPassageById(
    scope: CapaKnowledgeScope,
    passageId: CapaKnowledgePassage["passage_id"],
  ): Promise<CapaKnowledgePassage | null> {
    const value = this.state.passages.get(passageId);

    return value !== undefined &&
      scopeMatches(scope, value.organization_id)
      ? cloneValue(value)
      : null;
  }

  async findCollectionVersionById(
    lookup: CapaKnowledgeCollectionVersionLookup,
  ): Promise<CapaKnowledgeCollectionVersion | null> {
    const value = this.state.collection_versions.get(
      lookup.collection_version_id,
    );

    return value !== undefined &&
      value.collection_id === lookup.collection_id &&
      scopeMatches(
        lookup.scope,
        value.organization_id,
      )
      ? cloneValue(value)
      : null;
  }

  async insertSource(
    transaction: TransactionContext,
    source: CapaKnowledgeSource,
  ): Promise<void> {
    const state = this.transactionState(transaction);

    this.insertUnique(
      state.sources,
      source.source_id,
      source,
      "source",
    );
  }

  async insertSourceVersion(
    transaction: TransactionContext,
    sourceVersion: CapaKnowledgeSourceVersion,
  ): Promise<void> {
    const state = this.transactionState(transaction);

    this.insertUnique(
      state.source_versions,
      sourceVersion.source_version_id,
      sourceVersion,
      "source version",
    );
    state.source_version_record_versions.set(
      sourceVersion.source_version_id,
      1,
    );
  }

  async insertOriginalArtifact(
    transaction: TransactionContext,
    artifact: CapaKnowledgeOriginalArtifact,
  ): Promise<void> {
    this.insertUnique(
      this.transactionState(transaction).artifacts,
      artifact.artifact_id,
      artifact,
      "original artifact",
    );
  }

  async insertDerivative(
    transaction: TransactionContext,
    derivative: CapaKnowledgeDerivative,
  ): Promise<void> {
    this.insertUnique(
      this.transactionState(transaction).derivatives,
      derivative.derivative_id,
      derivative,
      "derivative",
    );
  }

  async insertPassages(
    transaction: TransactionContext,
    passages: readonly CapaKnowledgePassage[],
  ): Promise<void> {
    const state = this.transactionState(transaction);

    for (const passage of passages) {
      this.insertUnique(
        state.passages,
        passage.passage_id,
        passage,
        "passage",
      );
    }
  }

  async insertCollectionVersion(
    transaction: TransactionContext,
    value: CapaKnowledgeCollectionVersion,
  ): Promise<void> {
    this.insertUnique(
      this.transactionState(transaction)
        .collection_versions,
      value.collection_version_id,
      value,
      "collection version",
    );
  }

  async advanceSourceVersionLifecycle(
    transaction: TransactionContext,
    input: AdvanceCapaKnowledgeLifecycleInput,
  ): Promise<AdvanceCapaKnowledgeLifecycleResult> {
    const state = this.transactionState(transaction);
    const current = state.source_versions.get(
      input.source_version_id,
    );

    if (
      current === undefined ||
      current.source_id !== input.source_id ||
      !scopeMatches(
        input.scope,
        current.organization_id,
      )
    ) {
      return {
        status: "conflict",
        reason_code:
          "SOURCE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    if (
      state.source_version_record_versions.get(
        input.source_version_id,
      ) !== input.expected_record_version
    ) {
      return {
        status: "conflict",
        reason_code: "RECORD_VERSION_CONFLICT",
      };
    }

    if (current.status !== input.expected_status) {
      return {
        status: "conflict",
        reason_code: "SOURCE_STATUS_CONFLICT",
      };
    }

    const updated = cloneValue({
      ...current,
      status: input.next_status,
    });
    state.source_versions.set(
      input.source_version_id,
      updated,
    );
    state.source_version_record_versions.set(
      input.source_version_id,
      input.expected_record_version + 1,
    );

    return {
      status: "updated",
      source_version: cloneValue(updated),
    };
  }

  async recordAcceptedIngestion(
    transaction: TransactionContext,
    input: CapaKnowledgeIngestionAuditInput,
  ): Promise<void> {
    this.insertUnique(
      this.transactionState(transaction)
        .ingestion_audits,
      input.ingestion_id,
      input,
      "ingestion audit",
    );
  }

  inspectCounts(): Readonly<{
    sources: number;
    source_versions: number;
    artifacts: number;
    derivatives: number;
    passages: number;
    ingestion_audits: number;
  }> {
    return Object.freeze({
      sources: this.state.sources.size,
      source_versions:
        this.state.source_versions.size,
      artifacts: this.state.artifacts.size,
      derivatives: this.state.derivatives.size,
      passages: this.state.passages.size,
      ingestion_audits:
        this.state.ingestion_audits.size,
    });
  }

  private transactionState(
    transaction: TransactionContext,
  ): KnowledgeState {
    const active = this.active.get(
      transaction.transaction_id,
    );

    if (
      active === undefined ||
      active.context !== transaction
    ) {
      throw new InMemoryCapaKnowledgeTransactionError();
    }

    return active.state;
  }

  private insertUnique<Value>(
    map: Map<string, Value>,
    key: string,
    value: Value,
    label: string,
  ): void {
    const existing = map.get(key);

    if (existing !== undefined) {
      if (isDeepStrictEqual(existing, value)) {
        return;
      }

      throw new InMemoryCapaKnowledgeIntegrityError(
        `A conflicting ${label} identity already exists.`,
      );
    }

    map.set(key, cloneValue(value));
  }

  private validateState(state: KnowledgeState): void {
    const fingerprintKeys = new Set<string>();

    for (const source of state.sources.values()) {
      if (
        source.current_source_version_id !==
          undefined
      ) {
        const version = state.source_versions.get(
          source.current_source_version_id,
        );

        if (
          version === undefined ||
          version.source_id !== source.source_id ||
          version.organization_id !==
            source.organization_id
        ) {
          throw new InMemoryCapaKnowledgeIntegrityError(
            "A source references an invalid current version.",
          );
        }
      }
    }

    for (const version of state.source_versions.values()) {
      const source = state.sources.get(version.source_id);

      if (
        source === undefined ||
        source.organization_id !==
          version.organization_id
      ) {
        throw new InMemoryCapaKnowledgeIntegrityError(
          "A source version references an invalid source.",
        );
      }

      const scope: CapaKnowledgeScope =
        version.organization_id === undefined
          ? { visibility: "approved_global" }
          : {
              visibility: "organization",
              organization_id:
                version.organization_id,
            };
      const key = fingerprintKey(
        scope,
        version.content_fingerprint.value,
      );

      if (fingerprintKeys.has(key)) {
        throw new InMemoryCapaKnowledgeIntegrityError(
          "A duplicate scoped source fingerprint exists.",
        );
      }
      fingerprintKeys.add(key);
    }

    for (const artifact of state.artifacts.values()) {
      if (!state.source_versions.has(
        artifact.source_version_id,
      )) {
        throw new InMemoryCapaKnowledgeIntegrityError(
          "An artifact references a missing source version.",
        );
      }
    }

    for (const derivative of state.derivatives.values()) {
      if (
        !state.source_versions.has(
          derivative.source_version_id,
        ) ||
        !state.artifacts.has(
          derivative.source_artifact_id,
        )
      ) {
        throw new InMemoryCapaKnowledgeIntegrityError(
          "A derivative references incomplete source material.",
        );
      }
    }

    const sequenceKeys = new Set<string>();
    const passageFingerprints = new Set<string>();

    for (const passage of state.passages.values()) {
      if (
        !state.source_versions.has(
          passage.source_version_id,
        ) ||
        !state.derivatives.has(
          passage.derivative_id,
        )
      ) {
        throw new InMemoryCapaKnowledgeIntegrityError(
          "A passage references incomplete source material.",
        );
      }

      const sequenceKey =
        `${passage.derivative_id}:${passage.sequence_number}`;
      const fingerprintKeyValue =
        `${passage.derivative_id}:${passage.fingerprint.value}`;

      if (
        sequenceKeys.has(sequenceKey) ||
        passageFingerprints.has(
          fingerprintKeyValue,
        )
      ) {
        throw new InMemoryCapaKnowledgeIntegrityError(
          "A duplicate passage position or fingerprint exists.",
        );
      }

      sequenceKeys.add(sequenceKey);
      passageFingerprints.add(
        fingerprintKeyValue,
      );
    }
  }
}
