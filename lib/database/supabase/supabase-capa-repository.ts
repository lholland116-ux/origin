import type postgres from "postgres";

import type {
  ActorReference,
  ActorType,
  CapaCase,
  CapaCaseId,
  CapaCaseStatus,
  CapaCaseVersion,
  CapaCaseVersionId,
  CapaSectionVersion,
  CapaSectionVersionId,
  ConfidentialityClassification,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
  UserId,
} from "../../capa/domain/capa-types";

import type {
  AdvanceCapaVersionInput,
  AdvanceCapaVersionResult,
  CapaRepository,
} from "../repositories/capa-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

/**
 * Durable, tenant-scoped PostgreSQL CAPA repository.
 *
 * All material writes require an active transaction context issued by
 * SupabaseTransactionManager. Read operations remain explicitly scoped by
 * organization_id even though the server connection is privileged.
 */

interface CapaCaseRow extends postgres.Row {
  readonly organization_id: string;
  readonly capa_case_id: string;
  readonly case_number: string;
  readonly current_version_id: string;
  readonly status: string;
  readonly owner_user_id: string;
  readonly confidentiality: string;
  readonly record_version: number | string;
  readonly effective_at: Date | string;
  readonly superseded_at: Date | string | null;
  readonly cancelled_at: Date | string | null;
  readonly closed_at: Date | string | null;
  readonly created_at: Date | string;
  readonly created_by_actor_type: string;
  readonly created_by_actor_id: string;
  readonly created_by_actor_version: string | null;
  readonly updated_at: Date | string;
  readonly updated_by_actor_type: string;
  readonly updated_by_actor_id: string;
  readonly updated_by_actor_version: string | null;
}

interface CapaCaseVersionRow extends postgres.Row {
  readonly organization_id: string;
  readonly case_version_id: string;
  readonly capa_case_id: string;
  readonly version_number: number | string;
  readonly parent_version_id: string | null;
  readonly change_reason: string;
  readonly status: string;
  readonly effective_at: Date | string;
  readonly superseded_at: Date | string | null;
  readonly created_at: Date | string;
  readonly created_by_actor_type: string;
  readonly created_by_actor_id: string;
  readonly created_by_actor_version: string | null;
}

interface CapaSectionVersionRow extends postgres.Row {
  readonly organization_id: string;
  readonly section_version_id: string;
  readonly capa_case_id: string;
  readonly section_type: string;
  readonly version_number: number | string;
  readonly parent_version_id: string | null;
  readonly schema_version: string;
  readonly content: unknown;
  readonly change_reason: string;
  readonly effective_at: Date | string;
  readonly superseded_at: Date | string | null;
  readonly created_at: Date | string;
  readonly created_by_actor_type: string;
  readonly created_by_actor_id: string;
  readonly created_by_actor_version: string | null;
}

interface SectionReferenceRow extends postgres.Row {
  readonly section_version_id: string;
}

interface CaseConcurrencyRow extends postgres.Row {
  readonly record_version: number | string;
  readonly current_version_id: string;
}

interface ExistingVersionRow extends postgres.Row {
  readonly case_version_id: string;
}

interface ExistsRow extends postgres.Row {
  readonly exists: boolean;
}

function iso(value: Date | string): IsoDateTime {
  const serialized =
    value instanceof Date
      ? value.toISOString()
      : new Date(value).toISOString();

  return serialized as IsoDateTime;
}

function safeVersion(
  value: number | string,
  fieldName: string,
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
      `Invalid ${fieldName} returned by the CAPA database.`,
    );
  }

  return parsed;
}

function databaseJson(
  value: unknown,
): postgres.JSONValue {
  const serialized = JSON.stringify(value);

  if (serialized === undefined) {
    throw new Error(
      "CAPA content cannot be serialized as JSON.",
    );
  }

  return JSON.parse(
    serialized,
  ) as postgres.JSONValue;
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

function toCapaCase(row: CapaCaseRow): CapaCase {
  return {
    organization_id:
      row.organization_id as OrganizationId,
    capa_case_id:
      row.capa_case_id as CapaCaseId,
    case_number: row.case_number,
    current_version_id:
      row.current_version_id as CapaCaseVersionId,
    status: row.status as CapaCaseStatus,
    owner_user_id:
      row.owner_user_id as UserId,
    confidentiality:
      row.confidentiality as ConfidentialityClassification,
    record_version: safeVersion(
      row.record_version,
      "CAPA record version",
    ),
    effective_at: iso(row.effective_at),
    ...(
      row.superseded_at === null
        ? {}
        : {
            superseded_at: iso(
              row.superseded_at,
            ),
          }
    ),
    ...(
      row.cancelled_at === null
        ? {}
        : {
            cancelled_at: iso(
              row.cancelled_at,
            ),
          }
    ),
    ...(
      row.closed_at === null
        ? {}
        : {
            closed_at: iso(row.closed_at),
          }
    ),
    created_at: iso(row.created_at),
    created_by: actor(
      row.created_by_actor_type,
      row.created_by_actor_id,
      row.created_by_actor_version,
    ),
    updated_at: iso(row.updated_at),
    updated_by: actor(
      row.updated_by_actor_type,
      row.updated_by_actor_id,
      row.updated_by_actor_version,
    ),
  };
}

function toCaseVersion(
  row: CapaCaseVersionRow,
  sectionVersionIds:
    readonly CapaSectionVersionId[],
): CapaCaseVersion {
  return {
    organization_id:
      row.organization_id as OrganizationId,
    case_version_id:
      row.case_version_id as CapaCaseVersionId,
    capa_case_id:
      row.capa_case_id as CapaCaseId,
    version_number: safeVersion(
      row.version_number,
      "CAPA case version number",
    ),
    ...(row.parent_version_id === null
      ? {}
      : {
          parent_version_id:
            row.parent_version_id as CapaCaseVersionId,
        }),
    change_reason: row.change_reason,
    status: row.status as CapaCaseStatus,
    section_version_ids: sectionVersionIds,
    effective_at: iso(row.effective_at),
    ...(row.superseded_at === null
      ? {}
      : {
          superseded_at: iso(
            row.superseded_at,
          ),
        }),
    created_at: iso(row.created_at),
    created_by: actor(
      row.created_by_actor_type,
      row.created_by_actor_id,
      row.created_by_actor_version,
    ),
  };
}

function toSectionVersion(
  row: CapaSectionVersionRow,
): CapaSectionVersion {
  if (
    typeof row.content !== "object" ||
    row.content === null ||
    Array.isArray(row.content)
  ) {
    throw new Error(
      "Invalid CAPA section content returned by the database.",
    );
  }

  return {
    organization_id:
      row.organization_id as OrganizationId,
    section_version_id:
      row.section_version_id as CapaSectionVersionId,
    capa_case_id:
      row.capa_case_id as CapaCaseId,
    section_type:
      row.section_type as ControlledCode,
    version_number: safeVersion(
      row.version_number,
      "CAPA section version number",
    ),
    ...(row.parent_version_id === null
      ? {}
      : {
          parent_version_id:
            row.parent_version_id as CapaSectionVersionId,
        }),
    schema_version: row.schema_version,
    content: row.content as Readonly<
      Record<string, unknown>
    >,
    change_reason: row.change_reason,
    effective_at: iso(row.effective_at),
    ...(row.superseded_at === null
      ? {}
      : {
          superseded_at: iso(
            row.superseded_at,
          ),
        }),
    created_at: iso(row.created_at),
    created_by: actor(
      row.created_by_actor_type,
      row.created_by_actor_id,
      row.created_by_actor_version,
    ),
  };
}

export class SupabaseCapaRepository
  implements CapaRepository
{
  constructor(
    private readonly sql: postgres.Sql,
  ) {}

  async findCaseById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
  ): Promise<CapaCase | null> {
    const rows = await this.sql<CapaCaseRow[]>`
      select *
      from public.capa_cases
      where organization_id = ${organizationId}
        and capa_case_id = ${capaCaseId}
      limit 1
    `;

    return rows[0] === undefined
      ? null
      : toCapaCase(rows[0]);
  }

  async findCaseVersionById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    caseVersionId: CapaCaseVersionId,
  ): Promise<CapaCaseVersion | null> {
    const versionRows =
      await this.sql<CapaCaseVersionRow[]>`
        select *
        from public.capa_case_versions
        where organization_id = ${organizationId}
          and capa_case_id = ${capaCaseId}
          and case_version_id = ${caseVersionId}
        limit 1
      `;

    const version = versionRows[0];

    if (version === undefined) {
      return null;
    }

    const sectionRows =
      await this.sql<SectionReferenceRow[]>`
        select section_version_id
        from public.capa_case_version_sections
        where organization_id = ${organizationId}
          and capa_case_id = ${capaCaseId}
          and case_version_id = ${caseVersionId}
        order by display_order asc
      `;

    return toCaseVersion(
      version,
      sectionRows.map(
        (row) =>
          row.section_version_id as CapaSectionVersionId,
      ),
    );
  }

  async findSectionVersionById(
    organizationId: OrganizationId,
    capaCaseId: CapaCaseId,
    sectionVersionId: CapaSectionVersionId,
  ): Promise<CapaSectionVersion | null> {
    const rows =
      await this.sql<CapaSectionVersionRow[]>`
        select *
        from public.capa_section_versions
        where organization_id = ${organizationId}
          and capa_case_id = ${capaCaseId}
          and section_version_id = ${sectionVersionId}
        limit 1
      `;

    return rows[0] === undefined
      ? null
      : toSectionVersion(rows[0]);
  }

  async caseNumberExists(
    organizationId: OrganizationId,
    caseNumber: string,
  ): Promise<boolean> {
    const rows = await this.sql<ExistsRow[]>`
      select exists (
        select 1
        from public.capa_cases
        where organization_id = ${organizationId}
          and case_number = ${caseNumber}
      ) as exists
    `;

    return rows[0]?.exists === true;
  }

  async insertCase(
    transaction: TransactionContext,
    capaCase: CapaCase,
  ): Promise<void> {
    const sql =
      requireSupabaseTransaction(transaction);

    await sql`
      insert into public.capa_cases (
        organization_id,
        capa_case_id,
        case_number,
        current_version_id,
        status,
        owner_user_id,
        confidentiality,
        record_version,
        effective_at,
        superseded_at,
        cancelled_at,
        closed_at,
        created_at,
        created_by_actor_type,
        created_by_actor_id,
        created_by_actor_version,
        updated_at,
        updated_by_actor_type,
        updated_by_actor_id,
        updated_by_actor_version
      )
      values (
        ${capaCase.organization_id},
        ${capaCase.capa_case_id},
        ${capaCase.case_number},
        ${capaCase.current_version_id},
        ${capaCase.status},
        ${capaCase.owner_user_id},
        ${capaCase.confidentiality},
        ${capaCase.record_version},
        ${capaCase.effective_at},
        ${capaCase.superseded_at ?? null},
        ${capaCase.cancelled_at ?? null},
        ${capaCase.closed_at ?? null},
        ${capaCase.created_at},
        ${capaCase.created_by.actor_type},
        ${capaCase.created_by.actor_id},
        ${capaCase.created_by.actor_version ?? null},
        ${capaCase.updated_at},
        ${capaCase.updated_by.actor_type},
        ${capaCase.updated_by.actor_id},
        ${capaCase.updated_by.actor_version ?? null}
      )
    `;
  }

  async insertSectionVersion(
    transaction: TransactionContext,
    sectionVersion: CapaSectionVersion,
  ): Promise<void> {
    const sql =
      requireSupabaseTransaction(transaction);

    await sql`
      insert into public.capa_section_versions (
        organization_id,
        section_version_id,
        capa_case_id,
        section_type,
        version_number,
        parent_version_id,
        schema_version,
        content,
        change_reason,
        effective_at,
        superseded_at,
        created_at,
        created_by_actor_type,
        created_by_actor_id,
        created_by_actor_version
      )
      values (
        ${sectionVersion.organization_id},
        ${sectionVersion.section_version_id},
        ${sectionVersion.capa_case_id},
        ${sectionVersion.section_type},
        ${sectionVersion.version_number},
        ${sectionVersion.parent_version_id ?? null},
        ${sectionVersion.schema_version},
        ${sql.json(databaseJson(sectionVersion.content))},
        ${sectionVersion.change_reason},
        ${sectionVersion.effective_at},
        ${sectionVersion.superseded_at ?? null},
        ${sectionVersion.created_at},
        ${sectionVersion.created_by.actor_type},
        ${sectionVersion.created_by.actor_id},
        ${sectionVersion.created_by.actor_version ?? null}
      )
    `;
  }

  async insertCaseVersion(
    transaction: TransactionContext,
    caseVersion: CapaCaseVersion,
  ): Promise<void> {
    const sql =
      requireSupabaseTransaction(transaction);

    await sql`
      insert into public.capa_case_versions (
        organization_id,
        case_version_id,
        capa_case_id,
        version_number,
        parent_version_id,
        change_reason,
        status,
        effective_at,
        superseded_at,
        created_at,
        created_by_actor_type,
        created_by_actor_id,
        created_by_actor_version
      )
      values (
        ${caseVersion.organization_id},
        ${caseVersion.case_version_id},
        ${caseVersion.capa_case_id},
        ${caseVersion.version_number},
        ${caseVersion.parent_version_id ?? null},
        ${caseVersion.change_reason},
        ${caseVersion.status},
        ${caseVersion.effective_at},
        ${caseVersion.superseded_at ?? null},
        ${caseVersion.created_at},
        ${caseVersion.created_by.actor_type},
        ${caseVersion.created_by.actor_id},
        ${caseVersion.created_by.actor_version ?? null}
      )
    `;

    for (
      let displayOrder = 0;
      displayOrder <
      caseVersion.section_version_ids.length;
      displayOrder += 1
    ) {
      const sectionVersionId =
        caseVersion.section_version_ids[
          displayOrder
        ];

      if (sectionVersionId === undefined) {
        throw new Error(
          "Missing CAPA section version identity.",
        );
      }

      await sql`
        insert into public.capa_case_version_sections (
          organization_id,
          capa_case_id,
          case_version_id,
          section_version_id,
          display_order,
          created_at,
          created_by_actor_type,
          created_by_actor_id,
          created_by_actor_version
        )
        values (
          ${caseVersion.organization_id},
          ${caseVersion.capa_case_id},
          ${caseVersion.case_version_id},
          ${sectionVersionId},
          ${displayOrder},
          ${caseVersion.created_at},
          ${caseVersion.created_by.actor_type},
          ${caseVersion.created_by.actor_id},
          ${caseVersion.created_by.actor_version ?? null}
        )
      `;
    }
  }

  async advanceCurrentVersion(
    transaction: TransactionContext,
    input: AdvanceCapaVersionInput,
  ): Promise<AdvanceCapaVersionResult> {
    const sql =
      requireSupabaseTransaction(transaction);

    const nextVersionRows =
      await sql<ExistingVersionRow[]>`
        select case_version_id
        from public.capa_case_versions
        where organization_id =
            ${input.organization_id}
          and capa_case_id =
            ${input.capa_case_id}
          and case_version_id =
            ${input.next_current_version_id}
          and status = ${input.next_status}
        limit 1
      `;

    if (nextVersionRows[0] === undefined) {
      return {
        status: "conflict",
        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    const updatedRows = await sql<CapaCaseRow[]>`
      update public.capa_cases
      set
        current_version_id =
          ${input.next_current_version_id},
        status = ${input.next_status},
        record_version = record_version + 1,
        updated_at = ${input.updated_at},
        updated_by_actor_type =
          ${input.updated_by.actor_type},
        updated_by_actor_id =
          ${input.updated_by.actor_id},
        updated_by_actor_version =
          ${input.updated_by.actor_version ?? null}
      where organization_id =
          ${input.organization_id}
        and capa_case_id =
          ${input.capa_case_id}
        and record_version =
          ${input.expected_record_version}
        and current_version_id =
          ${input.expected_current_version_id}
      returning *
    `;

    if (updatedRows[0] !== undefined) {
      return {
        status: "updated",
        capa_case: toCapaCase(updatedRows[0]),
      };
    }

    const currentRows =
      await sql<CaseConcurrencyRow[]>`
        select
          record_version,
          current_version_id
        from public.capa_cases
        where organization_id =
            ${input.organization_id}
          and capa_case_id =
            ${input.capa_case_id}
        limit 1
      `;

    const current = currentRows[0];

    if (current === undefined) {
      return {
        status: "conflict",
        reason_code:
          "CASE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }

    if (
      safeVersion(
        current.record_version,
        "CAPA record version",
      ) !== input.expected_record_version
    ) {
      return {
        status: "conflict",
        reason_code:
          "RECORD_VERSION_CONFLICT",
      };
    }

    return {
      status: "conflict",
      reason_code:
        "CURRENT_VERSION_CONFLICT",
    };
  }
}