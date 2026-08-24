begin;

create table public.capa_knowledge_retrieval_index_entries (
  passage_id uuid not null,
  source_id uuid not null,
  source_version_id uuid not null,
  organization_id uuid,
  approved_global boolean not null default false,
  collection_ids uuid[] not null,
  collection_version_ids uuid[] not null,
  source_type text not null,
  source_status text not null,
  quality_status text not null,
  effective_at timestamptz,
  retirement_at timestamptz,
  permitted_role_ids text[] not null default '{}',
  permitted_site_ids text[] not null default '{}',
  permitted_product_ids text[] not null default '{}',
  jurisdictions text[] not null default '{}',
  applicability_tags text[] not null default '{}',
  machine_interpretable boolean not null,
  normalized_text text not null,
  normalized_text_fingerprint_algorithm text not null,
  normalized_text_fingerprint text not null,
  lexical_document jsonb,
  semantic_embedding double precision[],
  structured_metadata jsonb,
  index_version text not null,
  status text not null,
  indexed_at timestamptz not null,
  lexical_search tsvector generated always as (
    to_tsvector('simple', normalized_text)
  ) stored,

  constraint capa_knowledge_retrieval_index_entries_pk
    primary key (source_version_id, passage_id, index_version),
  constraint capa_knowledge_retrieval_index_entries_passage_fk
    foreign key (passage_id)
    references public.capa_knowledge_passages (passage_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_retrieval_index_entries_source_fk
    foreign key (source_id)
    references public.capa_knowledge_sources (source_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_retrieval_index_entries_version_fk
    foreign key (source_version_id)
    references public.capa_knowledge_source_versions (source_version_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_retrieval_index_entries_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  constraint capa_knowledge_retrieval_index_entries_scope
    check (
      (organization_id is not null and approved_global = false)
      or (organization_id is null and approved_global = true)
    ),
  constraint capa_knowledge_retrieval_index_entries_content
    check (
      cardinality(collection_ids) > 0
      and cardinality(collection_version_ids) > 0
      and char_length(normalized_text) > 0
      and normalized_text_fingerprint_algorithm = 'sha256'
      and normalized_text_fingerprint ~ '^[0-9a-f]{64}$'
      and char_length(btrim(index_version)) between 1 and 128
      and status in ('pending', 'ready', 'partial', 'blocked', 'retired')
      and source_status in (
        'draft', 'current_effective', 'future', 'superseded',
        'withdrawn', 'archived', 'unverified', 'blocked'
      )
      and quality_status in (
        'pass', 'pass_with_limitations', 'manual_review', 'failed', 'blocked'
      )
      and (lexical_document is null or jsonb_typeof(lexical_document) = 'object')
      and (structured_metadata is null or jsonb_typeof(structured_metadata) = 'object')
      and (retirement_at is null or effective_at is null or retirement_at > effective_at)
    )
);

create index capa_knowledge_retrieval_index_scope_idx
  on public.capa_knowledge_retrieval_index_entries (
    organization_id, status, source_status, quality_status, indexed_at
  );

create index capa_knowledge_retrieval_index_collections_gin
  on public.capa_knowledge_retrieval_index_entries
  using gin (collection_version_ids);

create index capa_knowledge_retrieval_index_lexical_gin
  on public.capa_knowledge_retrieval_index_entries
  using gin (lexical_search);

create or replace function private.capa_array_cosine_similarity(
  left_values double precision[],
  right_values double precision[]
)
returns double precision
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select case
    when cardinality(left_values) = 0
      or cardinality(left_values) <> cardinality(right_values)
      or sqrt(sum(l.value * l.value)) = 0
      or sqrt(sum(r.value * r.value)) = 0
    then null
    else greatest(
      0::double precision,
      least(
        1::double precision,
        (
          sum(l.value * r.value)
          / (sqrt(sum(l.value * l.value)) * sqrt(sum(r.value * r.value)))
          + 1
        ) / 2
      )
    )
  end
  from unnest(left_values) with ordinality as l(value, position)
  join unnest(right_values) with ordinality as r(value, position)
    using (position)
$$;

create or replace function private.search_capa_knowledge_retrieval_index(
  requested_retrieval_run_id uuid,
  requested_organization_id uuid,
  requested_collection_id uuid,
  requested_collection_version_id uuid,
  requested_approved_global boolean,
  requested_role_ids text[],
  requested_site_ids text[],
  requested_product_ids text[],
  requested_source_types text[],
  requested_jurisdictions text[],
  requested_applicability_tags text[],
  requested_effective_at timestamptz,
  requested_historical boolean,
  requested_method text,
  requested_query text,
  requested_query_embedding double precision[],
  requested_limit integer
)
returns table (
  candidate_id uuid,
  source_id uuid,
  source_version_id uuid,
  passage_id uuid,
  source_type text,
  source_status text,
  quality_status text,
  raw_rank bigint,
  lexical_score double precision,
  semantic_score double precision,
  metadata_score double precision,
  index_version text,
  index_status text
)
language sql
stable
security definer
set search_path = pg_catalog, public, private
as $$
  with eligible as (
    select
      entry.*,
      ts_rank_cd(
        entry.lexical_search,
        plainto_tsquery('simple', requested_query)
      )::double precision as lexical_value,
      private.capa_array_cosine_similarity(
        entry.semantic_embedding,
        requested_query_embedding
      ) as semantic_value,
      ts_rank_cd(
        to_tsvector('simple', coalesce(entry.structured_metadata::text, '')),
        plainto_tsquery('simple', requested_query)
      )::double precision as metadata_value
    from public.capa_knowledge_retrieval_index_entries entry
    where (
      entry.organization_id = requested_organization_id
      or (entry.approved_global and requested_approved_global)
    )
      and requested_collection_id = any(entry.collection_ids)
      and requested_collection_version_id = any(entry.collection_version_ids)
      and entry.status in ('ready', 'partial')
      and entry.machine_interpretable
      and entry.quality_status in ('pass', 'pass_with_limitations')
      and (
        entry.source_status = 'current_effective'
        or (
          requested_historical
          and entry.source_status in ('superseded', 'archived')
        )
      )
      and (entry.effective_at is null or entry.effective_at <= requested_effective_at)
      and (entry.retirement_at is null or entry.retirement_at > requested_effective_at)
      and (
        cardinality(entry.permitted_role_ids) = 0
        or entry.permitted_role_ids && requested_role_ids
      )
      and (
        cardinality(entry.permitted_site_ids) = 0
        or entry.permitted_site_ids && requested_site_ids
      )
      and (
        cardinality(entry.permitted_product_ids) = 0
        or entry.permitted_product_ids && requested_product_ids
      )
      and (
        requested_source_types is null
        or entry.source_type = any(requested_source_types)
      )
      and (
        requested_jurisdictions is null
        or entry.jurisdictions && requested_jurisdictions
      )
      and (
        requested_applicability_tags is null
        or entry.applicability_tags && requested_applicability_tags
      )
      and (
        requested_method not in ('vector', 'hybrid')
        or (
          requested_query_embedding is not null
          and entry.semantic_embedding is not null
          and cardinality(entry.semantic_embedding) = cardinality(requested_query_embedding)
        )
      )
  ), scored as (
    select eligible.*,
      case requested_method
        when 'lexical' then lexical_value
        when 'vector' then semantic_value
        when 'structured' then metadata_value
        when 'hybrid' then (lexical_value + semantic_value + metadata_value) / 3
      end as provider_score
    from eligible
  ), ranked as (
    select scored.*,
      row_number() over (
        order by provider_score desc, source_version_id, passage_id
      ) as position
    from scored
  )
  select
    (
      substr(md5(requested_retrieval_run_id::text || ':' || passage_id::text), 1, 8)
      || '-' || substr(md5(requested_retrieval_run_id::text || ':' || passage_id::text), 9, 4)
      || '-4' || substr(md5(requested_retrieval_run_id::text || ':' || passage_id::text), 14, 3)
      || '-8' || substr(md5(requested_retrieval_run_id::text || ':' || passage_id::text), 18, 3)
      || '-' || substr(md5(requested_retrieval_run_id::text || ':' || passage_id::text), 21, 12)
    )::uuid,
    source_id,
    source_version_id,
    passage_id,
    source_type,
    source_status,
    quality_status,
    position,
    case when requested_method in ('lexical', 'hybrid') then lexical_value end,
    case when requested_method in ('vector', 'hybrid') then semantic_value end,
    case when requested_method in ('structured', 'hybrid') then metadata_value end,
    index_version,
    status
  from ranked
  order by position
  limit least(greatest(requested_limit, 0), 1000)
$$;

revoke all on function private.search_capa_knowledge_retrieval_index(
  uuid, uuid, uuid, uuid, boolean, text[], text[], text[], text[], text[],
  text[], timestamptz, boolean, text, text, double precision[], integer
) from public, anon, authenticated;

grant execute on function private.search_capa_knowledge_retrieval_index(
  uuid, uuid, uuid, uuid, boolean, text[], text[], text[], text[], text[],
  text[], timestamptz, boolean, text, text, double precision[], integer
) to service_role;

alter table public.capa_knowledge_retrieval_index_entries enable row level security;
alter table public.capa_knowledge_retrieval_index_entries force row level security;

revoke all on table public.capa_knowledge_retrieval_index_entries
from public, anon, authenticated, service_role;

grant select, insert, update
on table public.capa_knowledge_retrieval_index_entries
to service_role;

comment on table public.capa_knowledge_retrieval_index_entries is
  'Derived governed CAPA retrieval index material with explicit tenant/global, collection, access, lifecycle, quality and provenance controls.';

commit;
