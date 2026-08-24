import type postgres from "postgres";

import type {
  ActorReference,
  ActorType,
  ControlledCode,
  IsoDateTime,
  OrganizationId,
} from "../../capa/domain/capa-types";

import type {
  CapaKnowledgeArtifactId,
  CapaKnowledgeCollectionVersion,
  CapaKnowledgeDerivative,
  CapaKnowledgeFingerprintRecord,
  CapaKnowledgeOriginalArtifact,
  CapaKnowledgePassage,
  CapaKnowledgePassageId,
  CapaKnowledgeSource,
  CapaKnowledgeSourceId,
  CapaKnowledgeSourceVersion,
} from "../../capa/knowledge/capa-knowledge-contract";

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

import {
  CapaKnowledgeRepositoryError,
} from "../repositories/capa-knowledge-repository";

import type {
  TransactionContext,
} from "../transactions";

import {
  requireSupabaseTransaction,
} from "./supabase-transactions";

/** Durable, explicitly scoped persistence for governed CAPA knowledge. */

type KnowledgeRow = postgres.Row &
  Readonly<Record<string, unknown>>;

const MAXIMUM_PASSAGE_LIMIT = 100;

function iso(value: unknown): IsoDateTime {
  const parsed =
    value instanceof Date
      ? value
      : new Date(value as string);

  if (Number.isNaN(parsed.getTime())) {
    throw new CapaKnowledgeRepositoryError(
      "The governed CAPA knowledge database returned an invalid timestamp.",
    );
  }

  return parsed.toISOString() as IsoDateTime;
}

function integer(value: unknown, label: string): number {
  const parsed =
    typeof value === "number"
      ? value
      : Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new CapaKnowledgeRepositoryError(
      `The governed CAPA knowledge database returned an invalid ${label}.`,
    );
  }

  return parsed;
}

function jsonObject(
  value: unknown,
  label: string,
): Readonly<Record<string, unknown>> {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new CapaKnowledgeRepositoryError(
      `The governed CAPA knowledge database returned invalid ${label}.`,
    );
  }

  return value as Readonly<Record<string, unknown>>;
}

function jsonArray<Value>(
  value: unknown,
  label: string,
): readonly Value[] {
  if (!Array.isArray(value)) {
    throw new CapaKnowledgeRepositoryError(
      `The governed CAPA knowledge database returned invalid ${label}.`,
    );
  }

  return value as readonly Value[];
}

function actor(
  type: unknown,
  id: unknown,
  version: unknown,
): ActorReference {
  if (
    !["human", "service", "agent", "system"].includes(
      type as string,
    ) ||
    typeof id !== "string" ||
    id.length === 0 ||
    !(
      version === null ||
      version === undefined ||
      typeof version === "string"
    )
  ) {
    throw new CapaKnowledgeRepositoryError(
      "The governed CAPA knowledge database returned an invalid actor.",
    );
  }

  return {
    actor_type: type as ActorType,
    actor_id: id,
    ...(version === null || version === undefined
      ? {}
      : { actor_version: version }),
  };
}

function fingerprint(row: KnowledgeRow): CapaKnowledgeFingerprintRecord {
  return {
    algorithm: row.fingerprint_algorithm as "sha256",
    value: row.content_fingerprint as
      CapaKnowledgeFingerprintRecord["value"],
  };
}

function optionalOrganization(
  value: unknown,
): Readonly<Record<string, OrganizationId>> {
  return value === null || value === undefined
    ? {}
    : { organization_id: value as OrganizationId };
}

function optionalValue<Key extends string>(
  key: Key,
  value: unknown,
): Readonly<Record<Key, unknown>> {
  return value === null || value === undefined
    ? {} as Readonly<Record<Key, unknown>>
    : { [key]: value } as Readonly<Record<Key, unknown>>;
}

function toSource(row: KnowledgeRow): CapaKnowledgeSource {
  return {
    source_id: row.source_id,
    visibility: row.visibility,
    ...optionalOrganization(row.organization_id),
    ...optionalValue(
      "current_source_version_id",
      row.current_source_version_id,
    ),
    owner: actor(
      row.owner_actor_type,
      row.owner_actor_id,
      row.owner_actor_version,
    ),
    record_version: integer(row.record_version, "source record version"),
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
  } as CapaKnowledgeSource;
}

function toSourceVersion(row: KnowledgeRow): CapaKnowledgeSourceVersion {
  const approved =
    row.approved_at === null || row.approved_at === undefined
      ? {}
      : {
          approved_at: iso(row.approved_at),
          approved_by: actor(
            row.approved_by_actor_type,
            row.approved_by_actor_id,
            row.approved_by_actor_version,
          ),
        };

  return {
    source_version_id: row.source_version_id,
    source_id: row.source_id,
    ...optionalOrganization(row.organization_id),
    version_number: integer(row.version_number, "source version number"),
    source_type: row.source_type,
    authority_class: row.authority_class,
    title: row.title,
    issuer: row.issuer,
    ...optionalValue("publisher", row.publisher),
    jurisdiction: row.jurisdiction,
    ...optionalValue("region", row.region),
    ...optionalValue("document_number", row.document_number),
    ...optionalValue("edition", row.edition),
    language: row.language,
    translation_status: row.translation_status,
    status: row.status,
    ...optionalValue("publication_date", row.publication_date),
    ...(row.effective_at === null || row.effective_at === undefined
      ? {}
      : { effective_at: iso(row.effective_at) }),
    ...(row.retirement_at === null || row.retirement_at === undefined
      ? {}
      : { retirement_at: iso(row.retirement_at) }),
    ...optionalValue(
      "supersedes_source_version_id",
      row.supersedes_source_version_id,
    ),
    ...optionalValue(
      "superseded_by_source_version_id",
      row.superseded_by_source_version_id,
    ),
    applicability_tags: jsonArray<ControlledCode>(
      row.applicability_tags,
      "applicability tags",
    ),
    origin: row.origin,
    canonical_locator: row.canonical_locator,
    content_fingerprint: fingerprint(row),
    rights: jsonObject(row.rights, "rights policy"),
    access_policy: jsonObject(row.access_policy, "access policy"),
    onboarding_stage: row.onboarding_stage,
    processing_status: row.processing_status,
    processing_version: row.processing_version,
    quality_status: row.quality_status,
    quality_notes: jsonArray<string>(row.quality_notes, "quality notes"),
    ...(row.next_review_at === null || row.next_review_at === undefined
      ? {}
      : { next_review_at: iso(row.next_review_at) }),
    ...approved,
    ...(row.activated_at === null || row.activated_at === undefined
      ? {}
      : { activated_at: iso(row.activated_at) }),
    created_at: iso(row.created_at),
    created_by: actor(
      row.created_by_actor_type,
      row.created_by_actor_id,
      row.created_by_actor_version,
    ),
  } as unknown as CapaKnowledgeSourceVersion;
}

function toArtifact(row: KnowledgeRow): CapaKnowledgeOriginalArtifact {
  return {
    artifact_id: row.artifact_id,
    source_version_id: row.source_version_id,
    ...optionalOrganization(row.organization_id),
    media_type: row.media_type,
    byte_length: integer(row.byte_length, "artifact byte length"),
    storage_reference: row.storage_reference,
    fingerprint: fingerprint(row),
    quarantined: row.quarantined,
    malware_scan_status: row.malware_scan_status,
    created_at: iso(row.created_at),
  } as CapaKnowledgeOriginalArtifact;
}

function toDerivative(row: KnowledgeRow): CapaKnowledgeDerivative {
  return {
    derivative_id: row.derivative_id,
    source_version_id: row.source_version_id,
    source_artifact_id: row.source_artifact_id,
    ...optionalOrganization(row.organization_id),
    kind: row.derivative_kind,
    engine: row.engine,
    engine_version: row.engine_version,
    content: row.content,
    fingerprint: fingerprint(row),
    status: row.processing_status,
    limitations: jsonArray<string>(row.limitations, "derivative limitations"),
    created_at: iso(row.created_at),
  } as CapaKnowledgeDerivative;
}

function toPassage(row: KnowledgeRow): CapaKnowledgePassage {
  return {
    passage_id: row.passage_id,
    source_version_id: row.source_version_id,
    derivative_id: row.derivative_id,
    ...optionalOrganization(row.organization_id),
    sequence_number: integer(row.sequence_number, "passage sequence number"),
    segmentation_version: row.segmentation_version,
    content: row.content,
    ...optionalValue("contextual_heading", row.contextual_heading),
    locators: jsonArray(row.locators, "passage locators"),
    overlap_passage_ids: jsonArray<CapaKnowledgePassageId>(
      row.overlap_passage_ids,
      "overlap passage identities",
    ),
    fingerprint: fingerprint(row),
    quality_status: row.quality_status,
    machine_interpretable: row.machine_interpretable,
    created_at: iso(row.created_at),
  } as CapaKnowledgePassage;
}

function toCollectionVersion(
  row: KnowledgeRow,
  sourceVersionIds: readonly unknown[],
): CapaKnowledgeCollectionVersion {
  return {
    collection_id: row.collection_id,
    collection_version_id: row.collection_version_id,
    ...optionalOrganization(row.organization_id),
    version_number: integer(row.version_number, "collection version number"),
    purpose: row.purpose,
    audience: jsonArray<ControlledCode>(row.audience, "collection audience"),
    access_policy: jsonObject(row.access_policy, "collection access policy"),
    source_version_ids: sourceVersionIds,
    effective_at: iso(row.effective_at),
    ...(row.retired_at === null || row.retired_at === undefined
      ? {}
      : { retired_at: iso(row.retired_at) }),
    approved_by: jsonArray<ActorReference>(
      row.approved_by,
      "collection approvers",
    ),
    created_at: iso(row.created_at),
  } as unknown as CapaKnowledgeCollectionVersion;
}

function requirePassageQuery(query: CapaKnowledgePassageListQuery): void {
  if (
    !Number.isSafeInteger(query.limit) ||
    query.limit < 1 ||
    query.limit > MAXIMUM_PASSAGE_LIMIT ||
    (query.after_sequence_number !== undefined &&
      (!Number.isSafeInteger(query.after_sequence_number) ||
        query.after_sequence_number < 0))
  ) {
    throw new CapaKnowledgeRepositoryError(
      "The governed CAPA knowledge passage query is invalid.",
    );
  }
}

export class SupabaseCapaKnowledgeRepository
  implements CapaKnowledgeRepository
{
  constructor(private readonly sql: postgres.Sql) {}

  async findSourceById(
    scope: CapaKnowledgeScope,
    sourceId: CapaKnowledgeSourceId,
  ): Promise<CapaKnowledgeSource | null> {
    const rows = scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_sources
          where visibility = 'organization'
            and organization_id = ${scope.organization_id}
            and source_id = ${sourceId}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_sources
          where visibility = 'approved_global'
            and organization_id is null
            and source_id = ${sourceId}
          limit 1
        `;

    return rows[0] === undefined ? null : toSource(rows[0]);
  }

  async findSourceVersionById(
    lookup: CapaKnowledgeSourceVersionLookup,
  ): Promise<CapaKnowledgeSourceVersion | null> {
    const rows = lookup.scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_source_versions
          where organization_id = ${lookup.scope.organization_id}
            and source_id = ${lookup.source_id}
            and source_version_id = ${lookup.source_version_id}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_source_versions
          where organization_id is null
            and source_id = ${lookup.source_id}
            and source_version_id = ${lookup.source_version_id}
          limit 1
        `;

    return rows[0] === undefined ? null : toSourceVersion(rows[0]);
  }

  async findSourceVersionByOriginalFingerprint(
    lookup: CapaKnowledgeFingerprintLookup,
  ): Promise<CapaKnowledgeSourceVersion | null> {
    const rows = lookup.scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_source_versions
          where organization_id = ${lookup.scope.organization_id}
            and fingerprint_algorithm = ${lookup.fingerprint.algorithm}
            and content_fingerprint = ${lookup.fingerprint.value}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_source_versions
          where organization_id is null
            and fingerprint_algorithm = ${lookup.fingerprint.algorithm}
            and content_fingerprint = ${lookup.fingerprint.value}
          limit 1
        `;

    return rows[0] === undefined ? null : toSourceVersion(rows[0]);
  }

  async findOriginalArtifactById(
    lookup: CapaKnowledgeSourceVersionLookup & {
      readonly artifact_id: CapaKnowledgeArtifactId;
    },
  ): Promise<CapaKnowledgeOriginalArtifact | null> {
    const rows = lookup.scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select a.*
          from public.capa_knowledge_original_artifacts a
          join public.capa_knowledge_source_versions v
            on v.source_version_id = a.source_version_id
          where a.organization_id = ${lookup.scope.organization_id}
            and v.source_id = ${lookup.source_id}
            and a.source_version_id = ${lookup.source_version_id}
            and a.artifact_id = ${lookup.artifact_id}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select a.*
          from public.capa_knowledge_original_artifacts a
          join public.capa_knowledge_source_versions v
            on v.source_version_id = a.source_version_id
          where a.organization_id is null
            and v.organization_id is null
            and v.source_id = ${lookup.source_id}
            and a.source_version_id = ${lookup.source_version_id}
            and a.artifact_id = ${lookup.artifact_id}
          limit 1
        `;

    return rows[0] === undefined ? null : toArtifact(rows[0]);
  }

  async findDerivativeById(
    lookup: CapaKnowledgeSourceVersionLookup & {
      readonly derivative_id: CapaKnowledgeDerivative["derivative_id"];
    },
  ): Promise<CapaKnowledgeDerivative | null> {
    const rows = lookup.scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select d.*
          from public.capa_knowledge_derivatives d
          join public.capa_knowledge_source_versions v
            on v.source_version_id = d.source_version_id
          where d.organization_id = ${lookup.scope.organization_id}
            and v.source_id = ${lookup.source_id}
            and d.source_version_id = ${lookup.source_version_id}
            and d.derivative_id = ${lookup.derivative_id}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select d.*
          from public.capa_knowledge_derivatives d
          join public.capa_knowledge_source_versions v
            on v.source_version_id = d.source_version_id
          where d.organization_id is null
            and v.organization_id is null
            and v.source_id = ${lookup.source_id}
            and d.source_version_id = ${lookup.source_version_id}
            and d.derivative_id = ${lookup.derivative_id}
          limit 1
        `;

    return rows[0] === undefined ? null : toDerivative(rows[0]);
  }

  async listPassages(
    query: CapaKnowledgePassageListQuery,
  ): Promise<CapaKnowledgePassageListPage> {
    requirePassageQuery(query);
    const after = query.after_sequence_number ?? 0;
    const rowLimit = query.limit + 1;
    const rows = query.scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_passages
          where organization_id = ${query.scope.organization_id}
            and source_version_id = ${query.source_version_id}
            and derivative_id = ${query.derivative_id}
            and sequence_number > ${after}
          order by sequence_number asc
          limit ${rowLimit}
        `
      : await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_passages
          where organization_id is null
            and source_version_id = ${query.source_version_id}
            and derivative_id = ${query.derivative_id}
            and sequence_number > ${after}
          order by sequence_number asc
          limit ${rowLimit}
        `;

    const selected = rows.slice(0, query.limit).map(toPassage);
    const last = selected[selected.length - 1];
    return {
      passages: selected,
      ...(rows.length > query.limit && last !== undefined
        ? { next_sequence_number: last.sequence_number }
        : {}),
    };
  }

  async findPassageById(
    scope: CapaKnowledgeScope,
    passageId: CapaKnowledgePassageId,
  ): Promise<CapaKnowledgePassage | null> {
    const rows = scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_passages
          where organization_id = ${scope.organization_id}
            and passage_id = ${passageId}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_passages
          where organization_id is null
            and passage_id = ${passageId}
          limit 1
        `;
    return rows[0] === undefined ? null : toPassage(rows[0]);
  }

  async findCollectionVersionById(
    lookup: CapaKnowledgeCollectionVersionLookup,
  ): Promise<CapaKnowledgeCollectionVersion | null> {
    const rows = lookup.scope.visibility === "organization"
      ? await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_collection_versions
          where organization_id = ${lookup.scope.organization_id}
            and collection_id = ${lookup.collection_id}
            and collection_version_id = ${lookup.collection_version_id}
          limit 1
        `
      : await this.sql<KnowledgeRow[]>`
          select * from public.capa_knowledge_collection_versions
          where organization_id is null
            and collection_id = ${lookup.collection_id}
            and collection_version_id = ${lookup.collection_version_id}
          limit 1
        `;

    /* v8 ignore next -- Both null and successful collection outcomes are tested; V8 creates an uncountable synthetic implicit-else branch for this guard. */
    if (rows[0] === undefined) return null;

    const sourceRows = await this.sql<KnowledgeRow[]>`
      select source_version_id
      from public.capa_knowledge_collection_version_sources
      where collection_version_id = ${lookup.collection_version_id}
      order by source_version_id asc
    `;

    return toCollectionVersion(
      rows[0],
      sourceRows.map((row) => row.source_version_id),
    );
  }

  async insertSource(
    transaction: TransactionContext,
    source: CapaKnowledgeSource,
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`
      insert into public.capa_knowledge_sources (
        source_id, visibility, organization_id, current_source_version_id,
        owner_actor_type, owner_actor_id, owner_actor_version, record_version,
        created_at, created_by_actor_type, created_by_actor_id,
        created_by_actor_version, updated_at, updated_by_actor_type,
        updated_by_actor_id, updated_by_actor_version
      ) values (
        ${source.source_id}, ${source.visibility},
        ${source.organization_id ?? null},
        ${source.current_source_version_id ?? null},
        ${source.owner.actor_type}, ${source.owner.actor_id},
        ${source.owner.actor_version ?? null}, ${1},
        ${source.created_at}, ${source.created_by.actor_type},
        ${source.created_by.actor_id}, ${source.created_by.actor_version ?? null},
        ${source.created_at}, ${source.created_by.actor_type},
        ${source.created_by.actor_id}, ${source.created_by.actor_version ?? null}
      )
    `;
  }

  async insertSourceVersion(
    transaction: TransactionContext,
    value: CapaKnowledgeSourceVersion,
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`
      insert into public.capa_knowledge_source_versions (
        source_version_id, source_id, organization_id, version_number,
        source_type, authority_class, title, issuer, publisher, jurisdiction,
        region, document_number, edition, language, translation_status, status,
        publication_date, effective_at, retirement_at,
        supersedes_source_version_id, superseded_by_source_version_id,
        applicability_tags, origin, canonical_locator, fingerprint_algorithm,
        content_fingerprint, rights, access_policy, onboarding_stage,
        processing_status, processing_version, quality_status, quality_notes,
        next_review_at, approved_at, approved_by_actor_type,
        approved_by_actor_id, approved_by_actor_version, activated_at,
        record_version, created_at, created_by_actor_type, created_by_actor_id,
        created_by_actor_version, updated_at, updated_by_actor_type,
        updated_by_actor_id, updated_by_actor_version
      ) values (
        ${value.source_version_id}, ${value.source_id},
        ${value.organization_id ?? null}, ${value.version_number},
        ${value.source_type}, ${value.authority_class}, ${value.title},
        ${value.issuer}, ${value.publisher ?? null}, ${value.jurisdiction},
        ${value.region ?? null}, ${value.document_number ?? null},
        ${value.edition ?? null}, ${value.language}, ${value.translation_status},
        ${value.status}, ${value.publication_date ?? null},
        ${value.effective_at ?? null}, ${value.retirement_at ?? null},
        ${value.supersedes_source_version_id ?? null},
        ${value.superseded_by_source_version_id ?? null},
        ${sql.json(value.applicability_tags)}, ${value.origin},
        ${value.canonical_locator}, ${value.content_fingerprint.algorithm},
        ${value.content_fingerprint.value}, ${sql.json(value.rights as never)},
        ${sql.json(value.access_policy as never)}, ${value.onboarding_stage},
        ${value.processing_status}, ${value.processing_version},
        ${value.quality_status}, ${sql.json(value.quality_notes)},
        ${value.next_review_at ?? null}, ${value.approved_at ?? null},
        ${value.approved_by?.actor_type ?? null},
        ${value.approved_by?.actor_id ?? null},
        ${value.approved_by?.actor_version ?? null},
        ${value.activated_at ?? null}, ${1},
        ${value.created_at}, ${value.created_by.actor_type},
        ${value.created_by.actor_id}, ${value.created_by.actor_version ?? null},
        ${value.created_at}, ${value.created_by.actor_type},
        ${value.created_by.actor_id}, ${value.created_by.actor_version ?? null}
      )
    `;
  }

  async insertOriginalArtifact(
    transaction: TransactionContext,
    value: CapaKnowledgeOriginalArtifact,
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`
      insert into public.capa_knowledge_original_artifacts (
        artifact_id, source_version_id, organization_id, media_type,
        byte_length, storage_reference, fingerprint_algorithm,
        content_fingerprint, quarantined, malware_scan_status, created_at
      ) values (
        ${value.artifact_id}, ${value.source_version_id},
        ${value.organization_id ?? null}, ${value.media_type},
        ${value.byte_length}, ${value.storage_reference},
        ${value.fingerprint.algorithm}, ${value.fingerprint.value},
        ${value.quarantined}, ${value.malware_scan_status}, ${value.created_at}
      )
    `;
  }

  async insertDerivative(
    transaction: TransactionContext,
    value: CapaKnowledgeDerivative,
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`
      insert into public.capa_knowledge_derivatives (
        derivative_id, source_version_id, source_artifact_id, organization_id,
        derivative_kind, engine, engine_version, content,
        fingerprint_algorithm, content_fingerprint, processing_status,
        limitations, created_at
      ) values (
        ${value.derivative_id}, ${value.source_version_id},
        ${value.source_artifact_id}, ${value.organization_id ?? null},
        ${value.kind}, ${value.engine}, ${value.engine_version}, ${value.content},
        ${value.fingerprint.algorithm}, ${value.fingerprint.value},
        ${value.status}, ${sql.json(value.limitations)}, ${value.created_at}
      )
    `;
  }

  async insertPassages(
    transaction: TransactionContext,
    passages: readonly CapaKnowledgePassage[],
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    for (const value of passages) {
      await sql`
        insert into public.capa_knowledge_passages (
          passage_id, source_version_id, derivative_id, organization_id,
          sequence_number, segmentation_version, content, contextual_heading,
          locators, overlap_passage_ids, fingerprint_algorithm,
          content_fingerprint, quality_status, machine_interpretable, created_at
        ) values (
          ${value.passage_id}, ${value.source_version_id}, ${value.derivative_id},
          ${value.organization_id ?? null}, ${value.sequence_number},
          ${value.segmentation_version}, ${value.content},
          ${value.contextual_heading ?? null}, ${sql.json(value.locators as never)},
          ${value.overlap_passage_ids}, ${value.fingerprint.algorithm},
          ${value.fingerprint.value}, ${value.quality_status},
          ${value.machine_interpretable}, ${value.created_at}
        )
      `;
    }
  }

  async insertCollectionVersion(
    transaction: TransactionContext,
    value: CapaKnowledgeCollectionVersion,
  ): Promise<void> {
    const sql = requireSupabaseTransaction(transaction);
    await sql`
      insert into public.capa_knowledge_collection_versions (
        collection_version_id, collection_id, organization_id, version_number,
        purpose, audience, access_policy, effective_at, retired_at,
        approved_by, created_at
      ) values (
        ${value.collection_version_id}, ${value.collection_id},
        ${value.organization_id ?? null}, ${value.version_number},
        ${value.purpose}, ${sql.json(value.audience)},
        ${sql.json(value.access_policy as never)}, ${value.effective_at},
        ${value.retired_at ?? null}, ${sql.json(value.approved_by as never)},
        ${value.created_at}
      )
    `;

    for (const sourceVersionId of value.source_version_ids) {
      await sql`
        insert into public.capa_knowledge_collection_version_sources (
          collection_version_id, source_version_id, organization_id, added_at
        ) values (
          ${value.collection_version_id}, ${sourceVersionId},
          ${value.organization_id ?? null}, ${value.created_at}
        )
      `;
    }
  }

  async advanceSourceVersionLifecycle(
    transaction: TransactionContext,
    input: AdvanceCapaKnowledgeLifecycleInput,
  ): Promise<AdvanceCapaKnowledgeLifecycleResult> {
    const sql = requireSupabaseTransaction(transaction);
    const rows = input.scope.visibility === "organization"
      ? await sql<KnowledgeRow[]>`
          update public.capa_knowledge_source_versions
          set status = ${input.next_status},
              record_version = record_version + 1,
              updated_at = ${input.updated_at},
              updated_by_actor_type = ${input.updated_by_actor_type},
              updated_by_actor_id = ${input.updated_by_actor_id},
              updated_by_actor_version = ${input.updated_by_actor_version ?? null}
          where organization_id = ${input.scope.organization_id}
            and source_id = ${input.source_id}
            and source_version_id = ${input.source_version_id}
            and record_version = ${input.expected_record_version}
            and status = ${input.expected_status}
          returning *
        `
      : await sql<KnowledgeRow[]>`
          update public.capa_knowledge_source_versions
          set status = ${input.next_status},
              record_version = record_version + 1,
              updated_at = ${input.updated_at},
              updated_by_actor_type = ${input.updated_by_actor_type},
              updated_by_actor_id = ${input.updated_by_actor_id},
              updated_by_actor_version = ${input.updated_by_actor_version ?? null}
          where organization_id is null
            and source_id = ${input.source_id}
            and source_version_id = ${input.source_version_id}
            and record_version = ${input.expected_record_version}
            and status = ${input.expected_status}
          returning *
        `;

    if (rows[0] !== undefined) {
      if (rows.length !== 1) {
        throw new CapaKnowledgeRepositoryError(
          "The lifecycle update returned an unexpected result.",
        );
      }
      return { status: "updated", source_version: toSourceVersion(rows[0]) };
    }

    const current = input.scope.visibility === "organization"
      ? await sql<KnowledgeRow[]>`
          select record_version, status
          from public.capa_knowledge_source_versions
          where organization_id = ${input.scope.organization_id}
            and source_id = ${input.source_id}
            and source_version_id = ${input.source_version_id}
          limit 1
        `
      : await sql<KnowledgeRow[]>`
          select record_version, status
          from public.capa_knowledge_source_versions
          where organization_id is null
            and source_id = ${input.source_id}
            and source_version_id = ${input.source_version_id}
          limit 1
        `;

    if (current[0] === undefined) {
      return {
        status: "conflict",
        reason_code: "SOURCE_NOT_FOUND_OR_NOT_AUTHORIZED",
      };
    }
    if (
      integer(current[0].record_version, "source-version record version") !==
      input.expected_record_version
    ) {
      return { status: "conflict", reason_code: "RECORD_VERSION_CONFLICT" };
    }
    return { status: "conflict", reason_code: "SOURCE_STATUS_CONFLICT" };
  }
}
