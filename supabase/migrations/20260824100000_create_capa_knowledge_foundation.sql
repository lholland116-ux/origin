begin;

-- ---------------------------------------------------------------------------
-- Governed CAPA knowledge source identities
-- ---------------------------------------------------------------------------

create table public.capa_knowledge_sources (
  source_id uuid primary key,
  visibility text not null,
  organization_id uuid,
  current_source_version_id uuid,
  owner_actor_type text not null,
  owner_actor_id text not null,
  owner_actor_version text,
  record_version integer not null default 1,
  created_at timestamptz not null,
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  updated_at timestamptz not null,
  updated_by_actor_type text not null,
  updated_by_actor_id text not null,
  updated_by_actor_version text,

  constraint capa_knowledge_sources_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict
    on delete restrict,

  constraint capa_knowledge_sources_visibility
    check (
      (visibility = 'organization' and organization_id is not null)
      or
      (visibility = 'approved_global' and organization_id is null)
    ),

  constraint capa_knowledge_sources_actor_types
    check (
      owner_actor_type in ('human', 'service', 'agent', 'system')
      and created_by_actor_type in ('human', 'service', 'agent', 'system')
      and updated_by_actor_type in ('human', 'service', 'agent', 'system')
    ),

  constraint capa_knowledge_sources_actor_ids
    check (
      char_length(btrim(owner_actor_id)) between 1 and 256
      and char_length(btrim(created_by_actor_id)) between 1 and 256
      and char_length(btrim(updated_by_actor_id)) between 1 and 256
    ),

  constraint capa_knowledge_sources_record_version
    check (record_version > 0),

  constraint capa_knowledge_sources_times
    check (updated_at >= created_at)
);

-- ---------------------------------------------------------------------------
-- Exact controlled source versions
-- ---------------------------------------------------------------------------

create table public.capa_knowledge_source_versions (
  source_version_id uuid primary key,
  source_id uuid not null,
  organization_id uuid,
  version_number integer not null,
  source_type text not null,
  authority_class text not null,
  title text not null,
  issuer text not null,
  publisher text,
  jurisdiction text not null,
  region text,
  document_number text,
  edition text,
  language text not null,
  translation_status text not null,
  status text not null,
  publication_date date,
  effective_at timestamptz,
  retirement_at timestamptz,
  supersedes_source_version_id uuid,
  superseded_by_source_version_id uuid,
  applicability_tags jsonb not null default '[]'::jsonb,
  origin text not null,
  canonical_locator text not null,
  fingerprint_algorithm text not null,
  content_fingerprint text not null,
  rights jsonb not null,
  access_policy jsonb not null,
  onboarding_stage text not null,
  processing_status text not null,
  processing_version text not null,
  quality_status text not null,
  quality_notes jsonb not null default '[]'::jsonb,
  next_review_at timestamptz,
  approved_at timestamptz,
  approved_by_actor_type text,
  approved_by_actor_id text,
  approved_by_actor_version text,
  activated_at timestamptz,
  record_version integer not null default 1,
  created_at timestamptz not null,
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  updated_at timestamptz not null,
  updated_by_actor_type text not null,
  updated_by_actor_id text not null,
  updated_by_actor_version text,

  constraint capa_knowledge_source_versions_source_fk
    foreign key (source_id)
    references public.capa_knowledge_sources (source_id)
    on update restrict
    on delete restrict,

  constraint capa_knowledge_source_versions_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict
    on delete restrict,

  constraint capa_knowledge_source_versions_version_unique
    unique (source_id, version_number),

  constraint capa_knowledge_source_versions_source_type
    check (source_type in (
      'SRC-01', 'SRC-02', 'SRC-03', 'SRC-04', 'SRC-05',
      'SRC-06', 'SRC-07', 'SRC-08', 'SRC-09', 'SRC-10'
    )),

  constraint capa_knowledge_source_versions_status
    check (status in (
      'draft', 'current_effective', 'future', 'superseded',
      'withdrawn', 'archived', 'unverified', 'blocked'
    )),

  constraint capa_knowledge_source_versions_onboarding_stage
    check (onboarding_stage in (
      'registered', 'quarantined', 'identified', 'verified', 'assessed',
      'processed', 'validated', 'approved', 'active'
    )),

  constraint capa_knowledge_source_versions_processing_status
    check (processing_status in (
      'pending', 'running', 'pass', 'pass_with_limitations',
      'manual_review', 'failed', 'blocked'
    )),

  constraint capa_knowledge_source_versions_quality_status
    check (quality_status in (
      'pass', 'pass_with_limitations', 'manual_review', 'failed', 'blocked'
    )),

  constraint capa_knowledge_source_versions_fingerprint
    check (
      fingerprint_algorithm = 'sha256'
      and content_fingerprint ~ '^[0-9a-f]{64}$'
    ),

  constraint capa_knowledge_source_versions_metadata
    check (
      version_number > 0
      and char_length(btrim(authority_class)) between 1 and 128
      and char_length(btrim(title)) between 1 and 2000
      and char_length(btrim(issuer)) between 1 and 2000
      and char_length(btrim(jurisdiction)) between 1 and 256
      and char_length(btrim(language)) between 1 and 64
      and char_length(btrim(translation_status)) between 1 and 128
      and char_length(btrim(origin)) between 1 and 128
      and char_length(btrim(canonical_locator)) between 1 and 4000
      and char_length(btrim(processing_version)) between 1 and 128
      and jsonb_typeof(applicability_tags) = 'array'
      and jsonb_typeof(quality_notes) = 'array'
      and jsonb_typeof(rights) = 'object'
      and jsonb_typeof(access_policy) = 'object'
    ),

  constraint capa_knowledge_source_versions_actor_types
    check (
      created_by_actor_type in ('human', 'service', 'agent', 'system')
      and updated_by_actor_type in ('human', 'service', 'agent', 'system')
      and (
        approved_by_actor_type is null
        or approved_by_actor_type in ('human', 'service', 'system')
      )
    ),

  constraint capa_knowledge_source_versions_approval
    check (
      (approved_at is null and approved_by_actor_type is null and approved_by_actor_id is null)
      or
      (approved_at is not null and approved_by_actor_type is not null
        and char_length(btrim(approved_by_actor_id)) between 1 and 256)
    ),

  constraint capa_knowledge_source_versions_effectivity
    check (
      (retirement_at is null or effective_at is null or retirement_at > effective_at)
      and updated_at >= created_at
      and record_version > 0
    ),

  constraint capa_knowledge_source_versions_supersession
    check (
      supersedes_source_version_id is null
      or superseded_by_source_version_id is null
      or supersedes_source_version_id <> superseded_by_source_version_id
    ),

  constraint capa_knowledge_source_versions_active
    check (
      status <> 'current_effective'
      or (
        onboarding_stage = 'active'
        and processing_status in ('pass', 'pass_with_limitations')
        and quality_status in ('pass', 'pass_with_limitations')
        and effective_at is not null
        and approved_at is not null
        and activated_at is not null
      )
    ),

  constraint capa_knowledge_source_versions_superseded
    check (
      status <> 'superseded'
      or superseded_by_source_version_id is not null
    )
);

create unique index capa_knowledge_source_versions_tenant_fingerprint_uidx
  on public.capa_knowledge_source_versions (
    organization_id,
    content_fingerprint
  )
  where organization_id is not null;

create unique index capa_knowledge_source_versions_global_fingerprint_uidx
  on public.capa_knowledge_source_versions (content_fingerprint)
  where organization_id is null;

create index capa_knowledge_source_versions_status_idx
  on public.capa_knowledge_source_versions (
    organization_id,
    status,
    effective_at,
    source_version_id
  );

alter table public.capa_knowledge_sources
  add constraint capa_knowledge_sources_current_version_fk
  foreign key (current_source_version_id)
  references public.capa_knowledge_source_versions (source_version_id)
  on update restrict
  on delete restrict
  deferrable initially deferred;

alter table public.capa_knowledge_source_versions
  add constraint capa_knowledge_source_versions_supersedes_fk
  foreign key (supersedes_source_version_id)
  references public.capa_knowledge_source_versions (source_version_id)
  on update restrict
  on delete restrict;

alter table public.capa_knowledge_source_versions
  add constraint capa_knowledge_source_versions_superseded_by_fk
  foreign key (superseded_by_source_version_id)
  references public.capa_knowledge_source_versions (source_version_id)
  on update restrict
  on delete restrict
  deferrable initially deferred;

create or replace function private.capa_validate_knowledge_current_source_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  version_source_id uuid;
  version_organization_id uuid;
begin
  if new.current_source_version_id is null then
    return new;
  end if;

  select source_id, organization_id
  into version_source_id, version_organization_id
  from public.capa_knowledge_source_versions
  where source_version_id = new.current_source_version_id;

  if found and (
    version_source_id <> new.source_id
    or version_organization_id is distinct from new.organization_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Knowledge current version does not belong to its source scope.';
  end if;

  return new;
end;
$$;

create constraint trigger capa_knowledge_sources_validate_current_version
after insert or update
on public.capa_knowledge_sources
deferrable initially deferred
for each row
execute function private.capa_validate_knowledge_current_source_version();

-- ---------------------------------------------------------------------------
-- Immutable original artifacts, derivatives and passages
-- ---------------------------------------------------------------------------

create table public.capa_knowledge_original_artifacts (
  artifact_id uuid primary key,
  source_version_id uuid not null,
  organization_id uuid,
  media_type text not null,
  byte_length bigint not null,
  storage_reference text not null,
  fingerprint_algorithm text not null,
  content_fingerprint text not null,
  quarantined boolean not null,
  malware_scan_status text not null,
  created_at timestamptz not null,

  constraint capa_knowledge_original_artifacts_version_fk
    foreign key (source_version_id)
    references public.capa_knowledge_source_versions (source_version_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_original_artifacts_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_original_artifacts_version_unique
    unique (source_version_id),
  constraint capa_knowledge_original_artifacts_content
    check (
      char_length(btrim(media_type)) between 1 and 256
      and byte_length > 0
      and char_length(btrim(storage_reference)) between 1 and 4000
      and fingerprint_algorithm = 'sha256'
      and content_fingerprint ~ '^[0-9a-f]{64}$'
      and quarantined
      and char_length(btrim(malware_scan_status)) between 1 and 128
    )
);

create table public.capa_knowledge_derivatives (
  derivative_id uuid primary key,
  source_version_id uuid not null,
  source_artifact_id uuid not null,
  organization_id uuid,
  derivative_kind text not null,
  engine text not null,
  engine_version text not null,
  content text not null,
  fingerprint_algorithm text not null,
  content_fingerprint text not null,
  processing_status text not null,
  limitations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null,

  constraint capa_knowledge_derivatives_version_fk
    foreign key (source_version_id)
    references public.capa_knowledge_source_versions (source_version_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_derivatives_artifact_fk
    foreign key (source_artifact_id)
    references public.capa_knowledge_original_artifacts (artifact_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_derivatives_identity_unique
    unique (source_version_id, derivative_kind, engine_version),
  constraint capa_knowledge_derivatives_kind
    check (derivative_kind in ('extracted_text', 'ocr_text', 'normalized_text')),
  constraint capa_knowledge_derivatives_content
    check (
      char_length(content) > 0
      and char_length(btrim(engine)) between 1 and 128
      and char_length(btrim(engine_version)) between 1 and 128
      and fingerprint_algorithm = 'sha256'
      and content_fingerprint ~ '^[0-9a-f]{64}$'
      and processing_status in (
        'pending', 'running', 'pass', 'pass_with_limitations',
        'manual_review', 'failed', 'blocked'
      )
      and jsonb_typeof(limitations) = 'array'
    )
);

create table public.capa_knowledge_passages (
  passage_id uuid primary key,
  source_version_id uuid not null,
  derivative_id uuid not null,
  organization_id uuid,
  sequence_number integer not null,
  segmentation_version text not null,
  content text not null,
  contextual_heading text,
  locators jsonb not null,
  overlap_passage_ids uuid[] not null default '{}',
  fingerprint_algorithm text not null,
  content_fingerprint text not null,
  quality_status text not null,
  machine_interpretable boolean not null,
  created_at timestamptz not null,

  constraint capa_knowledge_passages_version_fk
    foreign key (source_version_id)
    references public.capa_knowledge_source_versions (source_version_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_passages_derivative_fk
    foreign key (derivative_id)
    references public.capa_knowledge_derivatives (derivative_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_passages_sequence_unique
    unique (derivative_id, sequence_number),
  constraint capa_knowledge_passages_fingerprint_unique
    unique (derivative_id, content_fingerprint),
  constraint capa_knowledge_passages_content
    check (
      sequence_number > 0
      and char_length(btrim(segmentation_version)) between 1 and 128
      and char_length(content) > 0
      and jsonb_typeof(locators) = 'array'
      and jsonb_array_length(locators) > 0
      and fingerprint_algorithm = 'sha256'
      and content_fingerprint ~ '^[0-9a-f]{64}$'
      and quality_status in (
        'pass', 'pass_with_limitations', 'manual_review', 'failed', 'blocked'
      )
    )
);

create index capa_knowledge_passages_version_sequence_idx
  on public.capa_knowledge_passages (
    organization_id,
    source_version_id,
    derivative_id,
    sequence_number
  );

-- ---------------------------------------------------------------------------
-- Immutable governed collection versions
-- ---------------------------------------------------------------------------

create table public.capa_knowledge_collections (
  collection_id uuid primary key,
  visibility text not null,
  organization_id uuid,
  owner_actor_type text not null,
  owner_actor_id text not null,
  owner_actor_version text,
  current_collection_version_id uuid,
  record_version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  constraint capa_knowledge_collections_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_collections_visibility
    check (
      (visibility = 'organization' and organization_id is not null)
      or
      (visibility = 'approved_global' and organization_id is null)
    ),
  constraint capa_knowledge_collections_owner
    check (
      owner_actor_type in ('human', 'service', 'agent', 'system')
      and char_length(btrim(owner_actor_id)) between 1 and 256
      and record_version > 0
      and updated_at >= created_at
    )
);

create table public.capa_knowledge_collection_versions (
  collection_version_id uuid primary key,
  collection_id uuid not null,
  organization_id uuid,
  version_number integer not null,
  purpose text not null,
  audience jsonb not null,
  access_policy jsonb not null,
  effective_at timestamptz not null,
  retired_at timestamptz,
  approved_by jsonb not null,
  created_at timestamptz not null,
  constraint capa_knowledge_collection_versions_collection_fk
    foreign key (collection_id)
    references public.capa_knowledge_collections (collection_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_collection_versions_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_collection_versions_number_unique
    unique (collection_id, version_number),
  constraint capa_knowledge_collection_versions_content
    check (
      version_number > 0
      and char_length(btrim(purpose)) between 1 and 2000
      and jsonb_typeof(audience) = 'array'
      and jsonb_typeof(access_policy) = 'object'
      and jsonb_typeof(approved_by) = 'array'
      and jsonb_array_length(approved_by) > 0
      and (retired_at is null or retired_at > effective_at)
    )
);

alter table public.capa_knowledge_collections
  add constraint capa_knowledge_collections_current_version_fk
  foreign key (current_collection_version_id)
  references public.capa_knowledge_collection_versions (collection_version_id)
  on update restrict
  on delete restrict
  deferrable initially deferred;

create or replace function private.capa_validate_knowledge_current_collection_version()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  version_collection_id uuid;
  version_organization_id uuid;
begin
  if new.current_collection_version_id is null then
    return new;
  end if;

  select collection_id, organization_id
  into version_collection_id, version_organization_id
  from public.capa_knowledge_collection_versions
  where collection_version_id = new.current_collection_version_id;

  if found and (
    version_collection_id <> new.collection_id
    or version_organization_id is distinct from new.organization_id
  ) then
    raise exception using
      errcode = '23514',
      message = 'Knowledge current collection version does not belong to its collection scope.';
  end if;

  return new;
end;
$$;

create constraint trigger capa_knowledge_collections_validate_current_version
after insert or update
on public.capa_knowledge_collections
deferrable initially deferred
for each row
execute function private.capa_validate_knowledge_current_collection_version();

create table public.capa_knowledge_collection_version_sources (
  collection_version_id uuid not null,
  source_version_id uuid not null,
  organization_id uuid,
  added_at timestamptz not null,
  primary key (collection_version_id, source_version_id),
  constraint capa_knowledge_collection_sources_collection_fk
    foreign key (collection_version_id)
    references public.capa_knowledge_collection_versions (collection_version_id)
    on update restrict
    on delete restrict,
  constraint capa_knowledge_collection_sources_source_fk
    foreign key (source_version_id)
    references public.capa_knowledge_source_versions (source_version_id)
    on update restrict
    on delete restrict
);

-- ---------------------------------------------------------------------------
-- Cross-table scope and parent-consistency enforcement
-- ---------------------------------------------------------------------------

create or replace function private.capa_validate_knowledge_source_version_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_visibility text;
  parent_organization_id uuid;
begin
  select visibility, organization_id
  into parent_visibility, parent_organization_id
  from public.capa_knowledge_sources
  where source_id = new.source_id;

  if not found
    or new.organization_id is distinct from parent_organization_id
  then
    raise exception using
      errcode = '23514',
      message = 'Knowledge source-version scope does not match its source.';
  end if;

  return new;
end;
$$;

create trigger capa_knowledge_source_versions_validate_scope
before insert or update
on public.capa_knowledge_source_versions
for each row
execute function private.capa_validate_knowledge_source_version_scope();

create or replace function private.capa_validate_knowledge_child_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_organization_id uuid;
begin
  select organization_id
  into parent_organization_id
  from public.capa_knowledge_source_versions
  where source_version_id = new.source_version_id;

  if not found
    or new.organization_id is distinct from parent_organization_id
  then
    raise exception using
      errcode = '23514',
      message = 'Knowledge child scope does not match its source version.';
  end if;

  return new;
end;
$$;

create trigger capa_knowledge_artifacts_validate_scope
before insert
on public.capa_knowledge_original_artifacts
for each row
execute function private.capa_validate_knowledge_child_scope();

create trigger capa_knowledge_derivatives_validate_scope
before insert
on public.capa_knowledge_derivatives
for each row
execute function private.capa_validate_knowledge_child_scope();

create trigger capa_knowledge_passages_validate_scope
before insert
on public.capa_knowledge_passages
for each row
execute function private.capa_validate_knowledge_child_scope();

create or replace function private.capa_validate_knowledge_collection_version_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  parent_organization_id uuid;
begin
  select organization_id
  into parent_organization_id
  from public.capa_knowledge_collections
  where collection_id = new.collection_id;

  if not found
    or new.organization_id is distinct from parent_organization_id
  then
    raise exception using
      errcode = '23514',
      message = 'Knowledge collection-version scope does not match its collection.';
  end if;

  return new;
end;
$$;

create trigger capa_knowledge_collection_versions_validate_scope
before insert
on public.capa_knowledge_collection_versions
for each row
execute function private.capa_validate_knowledge_collection_version_scope();

create or replace function private.capa_validate_knowledge_collection_scope()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
declare
  collection_organization_id uuid;
  source_organization_id uuid;
  collection_found boolean;
  source_found boolean;
begin
  select organization_id
  into collection_organization_id
  from public.capa_knowledge_collection_versions
  where collection_version_id = new.collection_version_id;
  collection_found := found;

  select organization_id
  into source_organization_id
  from public.capa_knowledge_source_versions
  where source_version_id = new.source_version_id;
  source_found := found;

  if not collection_found
    or not source_found
    or collection_organization_id is distinct from source_organization_id
  then
    raise exception using
      errcode = '23514',
      message = 'Knowledge collection and source scopes do not match.';
  end if;

  new.organization_id := collection_organization_id;
  return new;
end;
$$;

create trigger capa_knowledge_collection_sources_validate_scope
before insert
on public.capa_knowledge_collection_version_sources
for each row
execute function private.capa_validate_knowledge_collection_scope();

-- ---------------------------------------------------------------------------
-- Immutability and controlled lifecycle mutation
-- ---------------------------------------------------------------------------

create or replace function private.capa_guard_knowledge_source_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.source_id <> old.source_id
    or new.visibility <> old.visibility
    or new.organization_id is distinct from old.organization_id
    or new.owner_actor_type <> old.owner_actor_type
    or new.owner_actor_id <> old.owner_actor_id
    or new.owner_actor_version is distinct from old.owner_actor_version
    or new.created_at <> old.created_at
    or new.created_by_actor_type <> old.created_by_actor_type
    or new.created_by_actor_id <> old.created_by_actor_id
    or new.created_by_actor_version is distinct from old.created_by_actor_version
  then
    raise exception using
      errcode = '55000',
      message = 'Immutable knowledge source identity cannot be changed.';
  end if;

  if new.record_version <> old.record_version + 1
    or new.updated_at <= old.updated_at
  then
    raise exception using
      errcode = '55000',
      message = 'Knowledge source update requires the next record version and later timestamp.';
  end if;

  return new;
end;
$$;

create trigger capa_knowledge_sources_guard_update
before update on public.capa_knowledge_sources
for each row
execute function private.capa_guard_knowledge_source_update();

create or replace function private.capa_guard_knowledge_collection_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.collection_id <> old.collection_id
    or new.visibility <> old.visibility
    or new.organization_id is distinct from old.organization_id
    or new.owner_actor_type <> old.owner_actor_type
    or new.owner_actor_id <> old.owner_actor_id
    or new.owner_actor_version is distinct from old.owner_actor_version
    or new.created_at <> old.created_at
  then
    raise exception using
      errcode = '55000',
      message = 'Immutable knowledge collection identity cannot be changed.';
  end if;

  if new.record_version <> old.record_version + 1
    or new.updated_at <= old.updated_at
  then
    raise exception using
      errcode = '55000',
      message = 'Knowledge collection update requires the next record version and later timestamp.';
  end if;

  return new;
end;
$$;

create trigger capa_knowledge_collections_guard_update
before update on public.capa_knowledge_collections
for each row
execute function private.capa_guard_knowledge_collection_update();

create trigger capa_knowledge_artifacts_reject_mutation
before update or delete on public.capa_knowledge_original_artifacts
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_knowledge_derivatives_reject_mutation
before update or delete on public.capa_knowledge_derivatives
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_knowledge_passages_reject_mutation
before update or delete on public.capa_knowledge_passages
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_knowledge_collection_versions_reject_mutation
before update or delete on public.capa_knowledge_collection_versions
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_knowledge_collection_sources_reject_mutation
before update or delete on public.capa_knowledge_collection_version_sources
for each row execute function private.capa_reject_immutable_mutation();

create or replace function private.capa_guard_knowledge_source_version_update()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, private
as $$
begin
  if new.source_version_id <> old.source_version_id
    or new.source_id <> old.source_id
    or new.organization_id is distinct from old.organization_id
    or new.version_number <> old.version_number
    or new.source_type <> old.source_type
    or new.authority_class <> old.authority_class
    or new.title <> old.title
    or new.issuer <> old.issuer
    or new.publisher is distinct from old.publisher
    or new.jurisdiction <> old.jurisdiction
    or new.region is distinct from old.region
    or new.document_number is distinct from old.document_number
    or new.edition is distinct from old.edition
    or new.language <> old.language
    or new.translation_status <> old.translation_status
    or new.publication_date is distinct from old.publication_date
    or new.applicability_tags <> old.applicability_tags
    or new.origin <> old.origin
    or new.canonical_locator <> old.canonical_locator
    or new.fingerprint_algorithm <> old.fingerprint_algorithm
    or new.content_fingerprint <> old.content_fingerprint
    or new.rights <> old.rights
    or new.access_policy <> old.access_policy
    or new.processing_version <> old.processing_version
    or new.created_at <> old.created_at
    or new.created_by_actor_type <> old.created_by_actor_type
    or new.created_by_actor_id <> old.created_by_actor_id
    or new.created_by_actor_version is distinct from old.created_by_actor_version
  then
    raise exception using
      errcode = '55000',
      message = 'Immutable knowledge source-version material cannot be changed.';
  end if;

  if new.record_version <> old.record_version + 1
    or new.updated_at <= old.updated_at
  then
    raise exception using
      errcode = '55000',
      message = 'Knowledge source lifecycle update requires the next record version and later timestamp.';
  end if;

  return new;
end;
$$;

create trigger capa_knowledge_source_versions_guard_update
before update on public.capa_knowledge_source_versions
for each row
execute function private.capa_guard_knowledge_source_version_update();

-- ---------------------------------------------------------------------------
-- Row-level security and least privilege
-- ---------------------------------------------------------------------------

alter table public.capa_knowledge_sources enable row level security;
alter table public.capa_knowledge_sources force row level security;
alter table public.capa_knowledge_source_versions enable row level security;
alter table public.capa_knowledge_source_versions force row level security;
alter table public.capa_knowledge_original_artifacts enable row level security;
alter table public.capa_knowledge_original_artifacts force row level security;
alter table public.capa_knowledge_derivatives enable row level security;
alter table public.capa_knowledge_derivatives force row level security;
alter table public.capa_knowledge_passages enable row level security;
alter table public.capa_knowledge_passages force row level security;
alter table public.capa_knowledge_collections enable row level security;
alter table public.capa_knowledge_collections force row level security;
alter table public.capa_knowledge_collection_versions enable row level security;
alter table public.capa_knowledge_collection_versions force row level security;
alter table public.capa_knowledge_collection_version_sources enable row level security;
alter table public.capa_knowledge_collection_version_sources force row level security;

revoke all on table
  public.capa_knowledge_sources,
  public.capa_knowledge_source_versions,
  public.capa_knowledge_original_artifacts,
  public.capa_knowledge_derivatives,
  public.capa_knowledge_passages,
  public.capa_knowledge_collections,
  public.capa_knowledge_collection_versions,
  public.capa_knowledge_collection_version_sources
from public, anon, authenticated, service_role;

grant select, insert, update
on table
  public.capa_knowledge_sources,
  public.capa_knowledge_source_versions,
  public.capa_knowledge_collections
to service_role;

grant select, insert
on table
  public.capa_knowledge_original_artifacts,
  public.capa_knowledge_derivatives,
  public.capa_knowledge_passages,
  public.capa_knowledge_collection_versions,
  public.capa_knowledge_collection_version_sources
to service_role;

comment on table public.capa_knowledge_sources is
  'Stable governed CAPA knowledge source identities with explicit organization or approved-global scope.';
comment on table public.capa_knowledge_source_versions is
  'Exact content-addressed source versions; material fields are immutable and lifecycle changes are guarded.';
comment on table public.capa_knowledge_original_artifacts is
  'Immutable quarantined original artifact metadata; original bytes remain in controlled object storage.';
comment on table public.capa_knowledge_derivatives is
  'Immutable versioned extraction, OCR and normalized text derivatives.';
comment on table public.capa_knowledge_passages is
  'Immutable controlled passages with exact source, derivative, locator, segmentation and fingerprint provenance.';
comment on table public.capa_knowledge_collection_versions is
  'Immutable approved collection snapshots used to resolve exact historical retrieval context.';

commit;
