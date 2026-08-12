import { randomUUID } from "node:crypto";

import postgres from "postgres";

import type {
  IsoDateTime,
  RequestTrace,
} from "../../capa/domain/capa-types";

import type {
  TransactionContext,
  TransactionId,
  TransactionManager,
  TransactionWork,
} from "../transactions";

/**
 * Server-only PostgreSQL transaction adapter for CAPA persistence.
 *
 * The supplied SQL client must use Supabase's transaction-mode pooler in
 * deployed serverless environments, with prepared statements disabled.
 */

interface ActiveTransactionBinding {
  readonly sql: postgres.TransactionSql;
  active: boolean;
}

/**
 * Module-private identity registry.
 *
 * A WeakMap prevents callers from manufacturing a usable transaction
 * context by copying its public fields. Repository writes accept only the
 * exact context object issued while runInTransaction is active.
 */
const ACTIVE_TRANSACTIONS =
  new WeakMap<TransactionContext, ActiveTransactionBinding>();

export class SupabaseTransactionContextError extends Error {
  constructor(
    message =
      "The CAPA database transaction is missing, invalid, or no longer active.",
  ) {
    super(message);
    this.name = "SupabaseTransactionContextError";
  }
}

function transactionId(): TransactionId {
  return randomUUID() as TransactionId;
}

function isoNow(): IsoDateTime {
  return new Date().toISOString() as IsoDateTime;
}

function freezeRequestTrace(
  requestTrace: RequestTrace,
): RequestTrace {
  return Object.freeze({
    request_id: requestTrace.request_id,
    correlation_id: requestTrace.correlation_id,
    ...(requestTrace.idempotency_key === undefined
      ? {}
      : {
          idempotency_key:
            requestTrace.idempotency_key,
        }),
  });
}

/**
 * Resolves the physical SQL transaction associated with an opaque
 * provider-neutral transaction context.
 *
 * Repository adapters must call this function for every material write.
 * It fails closed for forged, copied, reused, or completed contexts.
 */
export function requireSupabaseTransaction(
  transaction: TransactionContext,
): postgres.TransactionSql {
  const binding = ACTIVE_TRANSACTIONS.get(transaction);

  if (!binding?.active) {
    throw new SupabaseTransactionContextError();
  }

  return binding.sql;
}

export interface SupabaseDatabaseOptions {
  /**
   * Defaults to CAPA_DATABASE_URL.
   *
   * Never use a NEXT_PUBLIC variable for a PostgreSQL connection string.
   */
  readonly connection_string?: string;
  readonly maximum_connections?: number;
  readonly idle_timeout_seconds?: number;
  readonly connect_timeout_seconds?: number;
}

/**
 * Creates the server-only PostgreSQL client used by the CAPA adapters.
 *
 * prepare:false is required for Supabase transaction-mode pooling.
 * The small connection limit is appropriate for horizontally scaled
 * serverless functions and can be increased only after monitoring.
 */
export function createSupabaseDatabaseSql(
  options: SupabaseDatabaseOptions = {},
): postgres.Sql {
  const connectionString =
    options.connection_string ??
    process.env.CAPA_DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "Missing CAPA_DATABASE_URL server environment variable.",
    );
  }

  let parsed: URL;

  try {
    parsed = new URL(connectionString);
  } catch {
    throw new Error(
      "CAPA_DATABASE_URL is not a valid PostgreSQL connection URL.",
    );
  }

  if (
    parsed.protocol !== "postgres:" &&
    parsed.protocol !== "postgresql:"
  ) {
    throw new Error(
      "CAPA_DATABASE_URL must use the postgres or postgresql protocol.",
    );
  }

  const maximumConnections =
    options.maximum_connections ?? 1;

  const idleTimeoutSeconds =
    options.idle_timeout_seconds ?? 20;

  const connectTimeoutSeconds =
    options.connect_timeout_seconds ?? 10;

  if (
    !Number.isInteger(maximumConnections) ||
    maximumConnections < 1
  ) {
    throw new Error(
      "maximum_connections must be a positive integer.",
    );
  }

  if (
    !Number.isFinite(idleTimeoutSeconds) ||
    idleTimeoutSeconds < 0
  ) {
    throw new Error(
      "idle_timeout_seconds must be a non-negative number.",
    );
  }

  if (
    !Number.isFinite(connectTimeoutSeconds) ||
    connectTimeoutSeconds <= 0
  ) {
    throw new Error(
      "connect_timeout_seconds must be greater than zero.",
    );
  }

    return postgres(connectionString, {
    prepare: false,
    max: maximumConnections,
    idle_timeout: idleTimeoutSeconds,
    connect_timeout: connectTimeoutSeconds,
    max_lifetime: 60 * 30,
    connection: {
      application_name: "lvtchat-capa",
    },
  });
}

export class SupabaseTransactionManager
  implements TransactionManager
{
  constructor(
    private readonly sql: postgres.Sql,
  ) {}

  async runInTransaction<Result>(
    requestTrace: RequestTrace,
    work: TransactionWork<Result>,
  ): Promise<Result> {
    if (typeof work !== "function") {
      throw new TypeError(
        "Transaction work must be a function.",
      );
    }

    const result = await this.sql.begin<Result>(
      "isolation level read committed",
      async (transactionSql) => {
        const context: TransactionContext =
          Object.freeze({
            transaction_id: transactionId(),
            started_at: isoNow(),
            request_trace:
              freezeRequestTrace(requestTrace),
          });

        const binding: ActiveTransactionBinding = {
          sql: transactionSql,
          active: true,
        };

        ACTIVE_TRANSACTIONS.set(context, binding);

        try {
          return await work(context);
        } finally {
          binding.active = false;
          ACTIVE_TRANSACTIONS.delete(context);
        }
      },
    );

    return result as Result;
  }
}