import { isDeepStrictEqual } from "node:util";

import type postgres from "postgres";

import type {
  ActorReference,
  ActorType,
  AuditEvent,
  AuditEventId,
  AuditEventOutcome,
  ControlledCode,
  CorrelationId,
  IdempotencyKey,
  IsoDateTime,
  OrganizationId,
  RequestId,
  VersionedObjectReference,
} from "../../capa/domain/capa-types";

import type {
  AppendAuditEventResult,
  AuditCursor,
  AuditEventPage,
  AuditEventQuery,
  AuditRepository,
} from "../repositories/audit-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

/**
 * Durable append-only PostgreSQL audit repository.
 *
 * All appends require an active transaction issued by
 * SupabaseTransactionManager. Reads remain explicitly tenant-scoped even
 * though the server database connection is privileged.
 */

interface AuditEventRow extends postgres.Row {
  readonly event_id: string;
  readonly organization_id: string;
  readonly event_type: string;
  readonly schema_version: string;
  readonly aggregate_type: string;
  readonly aggregate_id: string;
  readonly aggregate_version: number | string | null;
  readonly actor_type: string;
  readonly actor_id: string;
  readonly actor_version: string | null;
  readonly occurred_at: Date | string;
  readonly request_id: string;
  readonly correlation_id: string;
  readonly idempotency_key: string | null;
  readonly action: string;
  readonly target_object_type: string;
  readonly target_object_id: string;
  readonly target_object_version_id: string | null;
  readonly outcome: string;
  readonly reason: string | null;
  readonly before_object_type: string | null;
  readonly before_object_id: string | null;
  readonly before_object_version_id: string | null;
  readonly after_object_type: string | null;
  readonly after_object_id: string | null;
  readonly after_object_version_id: string | null;
  readonly change_set: unknown;
  readonly configuration_versions: unknown;
  readonly metadata: unknown;
}

interface InsertedAuditRow extends postgres.Row {
  readonly event_id: string;
}

export class SupabaseAuditQueryError extends Error {
  constructor(
    message =
      "The CAPA audit query limit or cursor is invalid.",
  ) {
    super(message);
    this.name = "SupabaseAuditQueryError";
  }
}

function iso(value: Date | string): IsoDateTime {
  const serialized =
    value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

  return serialized as IsoDateTime;
}

function positiveVersion(
  value: number | string,
): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed <= 0
  ) {
    throw new Error(
      "Invalid aggregate version returned by the CAPA audit database.",
    );
  }

  return parsed;
}

function actor(
  actorType: string,
  actorId: string,
  actorVersion: string | null,
): ActorReference {
  return {
    actor_type: actorType as ActorType,
    actor_id: actorId,
    ...(actorVersion === null
      ? {}
      : {
          actor_version: actorVersion,
        }),
  };
}

function databaseJson(
  value: unknown,
): postgres.JSONValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error(
      "CAPA audit content cannot be serialized as JSON.",
    );
  }

  return JSON.parse(
    serialized,
  ) as postgres.JSONValue;
}

function objectMap(
  value: unknown,
  fieldName: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new Error(
      `Invalid ${fieldName} returned by the CAPA audit database.`,
    );
  }

  return value as Readonly<
    Record<string, unknown>
  >;
}

function configurationMap(
  value: unknown,
): Readonly<Record<string, string>> {
  const map = objectMap(
    value,
    "configuration versions",
  );

  if (
    Object.values(map).some(
      (entry) => typeof entry !== "string",
    )
  ) {
    throw new Error(
      "Invalid configuration versions returned by the CAPA audit database.",
    );
  }

  return map as Readonly<
    Record<string, string>
  >;
}

function optionalReference(
  objectType: string | null,
  objectId: string | null,
  objectVersionId: string | null,
  fieldName: string,
): VersionedObjectReference | undefined {
  if (
    objectType === null &&
    objectId === null &&
    objectVersionId === null
  ) {
    return undefined;
  }

  if (
    objectType === null ||
    objectId === null
  ) {
    throw new Error(
      `Invalid ${fieldName} reference returned by the CAPA audit database.`,
    );
  }

  return {
    object_type:
      objectType as ControlledCode,
    object_id: objectId,
    ...(objectVersionId === null
      ? {}
      : {
          object_version_id:
            objectVersionId,
        }),
  };
}

function toAuditEvent(
  row: AuditEventRow,
): AuditEvent {
  const beforeReference =
    optionalReference(
      row.before_object_type,
      row.before_object_id,
      row.before_object_version_id,
      "before-object",
    );

  const afterReference =
    optionalReference(
      row.after_object_type,
      row.after_object_id,
      row.after_object_version_id,
      "after-object",
    );

  const changeSet =
    row.change_set === null
      ? undefined
      : objectMap(row.change_set, "change set");

  const hasChange =
    beforeReference !== undefined ||
    afterReference !== undefined ||
    changeSet !== undefined;

  return {
    organization_id:
      row.organization_id as OrganizationId,
    event_id:
      row.event_id as AuditEventId,
    event_type:
      row.event_type as ControlledCode,
    schema_version: row.schema_version,
    aggregate_type:
      row.aggregate_type as ControlledCode,
    aggregate_id: row.aggregate_id,
    ...(row.aggregate_version === null
      ? {}
      : {
          aggregate_version:
            positiveVersion(
              row.aggregate_version,
            ),
        }),
    actor: actor(
      row.actor_type,
      row.actor_id,
      row.actor_version,
    ),
    occurred_at: iso(row.occurred_at),
    request_id:
      row.request_id as RequestId,
    correlation_id:
      row.correlation_id as CorrelationId,
    ...(row.idempotency_key === null
      ? {}
      : {
          idempotency_key:
            row.idempotency_key as IdempotencyKey,
        }),
    action: row.action as ControlledCode,
    target: {
      object_type:
        row.target_object_type as ControlledCode,
      object_id: row.target_object_id,
      ...(row.target_object_version_id === null
        ? {}
        : {
            object_version_id:
              row.target_object_version_id,
          }),
    },
    outcome:
      row.outcome as AuditEventOutcome,
    ...(row.reason === null
      ? {}
      : {
          reason: row.reason,
        }),
    ...(hasChange
      ? {
          change: {
            ...(beforeReference === undefined
              ? {}
              : {
                  before_ref:
                    beforeReference,
                }),
            ...(afterReference === undefined
              ? {}
              : {
                  after_ref:
                    afterReference,
                }),
            ...(changeSet === undefined
              ? {}
              : {
                  change_set:
                    changeSet,
                }),
          },
        }
      : {}),
    configuration_versions:
      configurationMap(
        row.configuration_versions,
      ),
    metadata: objectMap(
      row.metadata,
      "metadata",
    ),
  };
}

function cursorOffset(
  cursor: AuditCursor | undefined,
): number {
  if (cursor === undefined) {
    return 0;
  }

  const parsed = Number(cursor);

  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 0
  ) {
    throw new SupabaseAuditQueryError();
  }

  return parsed;
}

export class SupabaseAuditRepository
  implements AuditRepository
{
  constructor(
    private readonly sql: postgres.Sql,
  ) {}

  async appendEvent(
    transaction: TransactionContext,
    event: AuditEvent,
  ): Promise<AppendAuditEventResult> {
    const sql =
      requireSupabaseTransaction(transaction);

    const beforeReference =
      event.change?.before_ref;

    const afterReference =
      event.change?.after_ref;

    const insertedRows =
      await sql<InsertedAuditRow[]>`
        insert into public.capa_audit_events (
          event_id,
          organization_id,
          event_type,
          schema_version,
          aggregate_type,
          aggregate_id,
          aggregate_version,
          actor_type,
          actor_id,
          actor_version,
          occurred_at,
          request_id,
          correlation_id,
          idempotency_key,
          action,
          target_object_type,
          target_object_id,
          target_object_version_id,
          outcome,
          reason,
          before_object_type,
          before_object_id,
          before_object_version_id,
          after_object_type,
          after_object_id,
          after_object_version_id,
          change_set,
          configuration_versions,
          metadata
        )
        values (
          ${event.event_id},
          ${event.organization_id},
          ${event.event_type},
          ${event.schema_version},
          ${event.aggregate_type},
          ${event.aggregate_id},
          ${event.aggregate_version ?? null},
          ${event.actor.actor_type},
          ${event.actor.actor_id},
          ${event.actor.actor_version ?? null},
          ${event.occurred_at},
          ${event.request_id},
          ${event.correlation_id},
          ${event.idempotency_key ?? null},
          ${event.action},
          ${event.target.object_type},
          ${event.target.object_id},
          ${event.target.object_version_id ?? null},
          ${event.outcome},
          ${event.reason ?? null},
          ${beforeReference?.object_type ?? null},
          ${beforeReference?.object_id ?? null},
          ${beforeReference?.object_version_id ?? null},
          ${afterReference?.object_type ?? null},
          ${afterReference?.object_id ?? null},
          ${afterReference?.object_version_id ?? null},
          ${
            event.change?.change_set === undefined
              ? null
              : sql.json(
                  databaseJson(
                    event.change.change_set,
                  ),
                )
          },
          ${sql.json(
            databaseJson(
              event.configuration_versions,
            ),
          )},
          ${sql.json(
            databaseJson(event.metadata),
          )}
        )
        on conflict (event_id) do nothing
        returning event_id
      `;

    if (insertedRows[0] !== undefined) {
      return {
        status: "appended",
        event_id: event.event_id,
      };
    }

    const existingRows =
      await sql<AuditEventRow[]>`
        select *
        from public.capa_audit_events
        where organization_id =
            ${event.organization_id}
          and event_id = ${event.event_id}
        limit 1
      `;

    const existing = existingRows[0];

    if (
      existing !== undefined &&
      isDeepStrictEqual(
        toAuditEvent(existing),
        event,
      )
    ) {
      return {
        status: "already_recorded",
        event_id: event.event_id,
      };
    }

    return {
      status: "conflict",
      event_id: event.event_id,
      reason_code:
        "EVENT_ID_REUSED_WITH_DIFFERENT_CONTENT",
    };
  }

  async findEventById(
    organizationId: OrganizationId,
    eventId: AuditEventId,
  ): Promise<AuditEvent | null> {
    const rows = await this.sql<AuditEventRow[]>`
      select *
      from public.capa_audit_events
      where organization_id = ${organizationId}
        and event_id = ${eventId}
      limit 1
    `;

    return rows[0] === undefined
      ? null
      : toAuditEvent(rows[0]);
  }

  async listEventsForAggregate(
    query: AuditEventQuery,
  ): Promise<AuditEventPage> {
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new SupabaseAuditQueryError();
    }

    const offset = cursorOffset(
      query.cursor,
    );

    const rows = await this.sql<AuditEventRow[]>`
      select *
      from public.capa_audit_events
      where organization_id =
          ${query.organization_id}
        and aggregate_type =
          ${query.aggregate_type}
        and aggregate_id =
          ${query.aggregate_id}
      order by occurred_at asc, event_id asc
      limit ${query.limit + 1}
      offset ${offset}
    `;

    const hasNextPage =
      rows.length > query.limit;

    const events = rows
      .slice(0, query.limit)
      .map(toAuditEvent);

    return {
      events,
      ...(hasNextPage
        ? {
            next_cursor: String(
              offset + events.length,
            ) as AuditCursor,
          }
        : {}),
    };
  }
}