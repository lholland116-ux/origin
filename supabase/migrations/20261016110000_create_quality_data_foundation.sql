begin;

-- Shared quality-data foundation. Organization scope is established from
-- CAPA membership; personal chat documents are intentionally not referenced.

do $$
begin
  if not exists (
    select 1 from public.capa_roles
    where role_id = 'CAPA_ORG_ADMIN'
      and status = 'active'
      and human_authority
  ) then
    raise exception 'QUALITY_DATA_ADMIN_ROLE_MISSING';
  end if;

  if exists (
    select 1 from public.capa_roles
    where role_id <> 'CAPA_ORG_ADMIN'
      and (
        'quality_data.source.ingest' = any(permissions)
        or 'quality_data.source.read' = any(permissions)
      )
  ) then
    raise exception 'QUALITY_DATA_PERMISSION_ROLE_CONFLICT';
  end if;
end
$$;

update public.capa_roles
set permissions = case
      when 'quality_data.source.read' = any(permissions)
        then permissions
      else array_append(permissions, 'quality_data.source.read')
    end,
    role_version = '1.2.0'
where role_id = 'CAPA_ORG_ADMIN';

update public.capa_roles
set permissions = case
      when 'quality_data.source.ingest' = any(permissions)
        then permissions
      else array_append(permissions, 'quality_data.source.ingest')
    end,
    role_version = '1.2.0'
where role_id = 'CAPA_ORG_ADMIN';

create table public.quality_data_sources (
  source_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_key text not null,
  source_name text not null,
  source_type text not null,
  uploaded_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, source_id),
  unique (organization_id, source_key),
  foreign key (organization_id, uploaded_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict,
  constraint quality_data_sources_key_length
    check (char_length(btrim(source_key)) between 1 and 128),
  constraint quality_data_sources_name_length
    check (char_length(btrim(source_name)) between 1 and 200),
  constraint quality_data_sources_type
    check (source_type in ('xlsx', 'csv', 'docx', 'pdf', 'txt', 'other'))
);

create table public.quality_data_source_versions (
  source_version_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_id uuid not null,
  version_number integer not null,
  original_source_version text not null,
  fingerprint_algorithm text not null default 'sha256',
  source_sha256 text not null,
  byte_length bigint not null,
  media_type text not null,
  storage_reference text not null,
  parser_version text not null,
  schema_version text not null,
  uploaded_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, source_version_id),
  unique (organization_id, source_id, version_number),
  unique (organization_id, source_id, original_source_version),
  unique (organization_id, source_id, source_sha256),
  foreign key (organization_id, source_id)
    references public.quality_data_sources (organization_id, source_id)
    on update restrict on delete restrict,
  foreign key (organization_id, uploaded_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict,
  constraint quality_data_source_versions_number
    check (version_number > 0),
  constraint quality_data_source_versions_fingerprint
    check (fingerprint_algorithm = 'sha256' and source_sha256 ~ '^[0-9a-f]{64}$'),
  constraint quality_data_source_versions_size
    check (byte_length between 1 and 10485760),
  constraint quality_data_source_versions_metadata
    check (
      char_length(btrim(original_source_version)) between 1 and 128
      and char_length(btrim(media_type)) between 1 and 256
      and char_length(btrim(storage_reference)) between 1 and 1024
      and char_length(btrim(parser_version)) between 1 and 100
      and char_length(btrim(schema_version)) between 1 and 100
    )
);

create table public.quality_data_datasets (
  dataset_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  dataset_key text not null,
  dataset_name text not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, dataset_id),
  unique (organization_id, dataset_key),
  foreign key (organization_id, created_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict,
  constraint quality_data_datasets_key_length
    check (char_length(btrim(dataset_key)) between 1 and 128),
  constraint quality_data_datasets_name_length
    check (char_length(btrim(dataset_name)) between 1 and 200)
);

create table public.quality_data_dataset_versions (
  dataset_version_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_id uuid not null,
  version_number integer not null,
  schema_version text not null,
  review_state text not null default 'review_required',
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, dataset_version_id),
  unique (organization_id, dataset_id, version_number),
  foreign key (organization_id, dataset_id)
    references public.quality_data_datasets (organization_id, dataset_id)
    on update restrict on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict,
  constraint quality_data_dataset_versions_number
    check (version_number > 0),
  constraint quality_data_dataset_versions_review
    check (review_state = 'review_required'),
  constraint quality_data_dataset_versions_schema
    check (char_length(btrim(schema_version)) between 1 and 100)
);

create table public.quality_data_dataset_version_sources (
  organization_id uuid not null,
  dataset_version_id uuid not null,
  source_version_id uuid not null,
  primary key (organization_id, dataset_version_id, source_version_id),
  foreign key (organization_id, dataset_version_id)
    references public.quality_data_dataset_versions (organization_id, dataset_version_id)
    on update restrict on delete restrict,
  foreign key (organization_id, source_version_id)
    references public.quality_data_source_versions (organization_id, source_version_id)
    on update restrict on delete restrict
);

create table public.quality_data_ingestion_jobs (
  ingestion_job_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_id uuid not null,
  source_version_id uuid not null,
  dataset_id uuid not null,
  dataset_version_id uuid not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'accepted',
  record_count integer not null,
  field_count integer not null,
  record_version integer not null default 1,
  request_id uuid not null,
  correlation_id uuid not null,
  created_by_user_id uuid not null,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  unique (organization_id, ingestion_job_id),
  unique (organization_id, idempotency_key),
  foreign key (organization_id, source_id)
    references public.quality_data_sources (organization_id, source_id)
    on update restrict on delete restrict,
  foreign key (organization_id, source_version_id)
    references public.quality_data_source_versions (organization_id, source_version_id)
    on update restrict on delete restrict,
  foreign key (organization_id, dataset_id)
    references public.quality_data_datasets (organization_id, dataset_id)
    on update restrict on delete restrict,
  foreign key (organization_id, dataset_version_id)
    references public.quality_data_dataset_versions (organization_id, dataset_version_id)
    on update restrict on delete restrict,
  foreign key (organization_id, created_by_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict,
  constraint quality_data_ingestion_jobs_fingerprint
    check (request_fingerprint ~ '^[0-9a-f]{64}$'),
  constraint quality_data_ingestion_jobs_key_length
    check (char_length(btrim(idempotency_key)) between 1 and 200),
  constraint quality_data_ingestion_jobs_status
    check (status in ('accepted', 'processing', 'completed', 'failed')),
  constraint quality_data_ingestion_jobs_version
    check (record_version > 0),
  constraint quality_data_ingestion_jobs_counts
    check (record_count between 1 and 10000 and field_count between 1 and 50000)
);

create table public.quality_data_inspection_records (
  record_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_version_id uuid not null,
  record_ordinal integer not null,
  source_worksheet text not null,
  source_row_number integer not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, record_id),
  unique (organization_id, dataset_version_id, record_id),
  unique (organization_id, dataset_version_id, record_ordinal),
  unique (organization_id, dataset_version_id, source_worksheet, source_row_number),
  foreign key (organization_id, dataset_version_id)
    references public.quality_data_dataset_versions (organization_id, dataset_version_id)
    on update restrict on delete restrict,
  constraint quality_data_inspection_records_position
    check (record_ordinal > 0 and source_row_number > 0),
  constraint quality_data_inspection_records_sheet
    check (char_length(btrim(source_worksheet)) between 1 and 128)
);

create table public.quality_data_inspection_fields (
  field_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_version_id uuid not null,
  record_id uuid not null,
  field_key text not null,
  field_ordinal integer not null,
  value_type text not null,
  original_value jsonb not null,
  normalized_value jsonb,
  normalized_unit text,
  source_worksheet text not null,
  source_row_number integer not null,
  source_cell_reference text not null,
  created_at timestamptz not null default statement_timestamp(),
  unique (organization_id, field_id),
  unique (organization_id, dataset_version_id, record_id, field_id),
  unique (organization_id, record_id, field_key),
  unique (organization_id, dataset_version_id, record_id, field_ordinal),
  unique (organization_id, dataset_version_id, source_worksheet, source_row_number, source_cell_reference),
  foreign key (organization_id, dataset_version_id, record_id)
    references public.quality_data_inspection_records (organization_id, dataset_version_id, record_id)
    on update restrict on delete restrict,
  constraint quality_data_inspection_fields_type
    check (value_type in ('text', 'number', 'date', 'boolean', 'blank')),
  constraint quality_data_inspection_fields_key
    check (char_length(btrim(field_key)) between 1 and 128),
  constraint quality_data_inspection_fields_ordinal
    check (field_ordinal > 0),
  constraint quality_data_inspection_fields_source
    check (
      source_row_number > 0
      and char_length(btrim(source_worksheet)) between 1 and 128
      and char_length(btrim(source_cell_reference)) between 1 and 32
    ),
  constraint quality_data_inspection_fields_value_size
    check (octet_length(original_value::text) <= 16384
      and (normalized_value is null or octet_length(normalized_value::text) <= 16384)),
  constraint quality_data_inspection_fields_typed_value
    check (
      (value_type = 'text' and jsonb_typeof(original_value) = 'string'
        and (normalized_value is null or jsonb_typeof(normalized_value) = 'string'))
      or (value_type = 'number' and jsonb_typeof(original_value) = 'number'
        and (normalized_value is null or jsonb_typeof(normalized_value) = 'number'))
      or (value_type = 'date' and jsonb_typeof(original_value) = 'string'
        and (normalized_value is null or jsonb_typeof(normalized_value) = 'string'))
      or (value_type = 'boolean' and jsonb_typeof(original_value) = 'boolean'
        and (normalized_value is null or jsonb_typeof(normalized_value) = 'boolean'))
      or (value_type = 'blank' and original_value = 'null'::jsonb
        and (normalized_value is null or normalized_value = 'null'::jsonb))
    )
);

create table public.quality_data_validation_outcomes (
  validation_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  dataset_version_id uuid not null,
  record_id uuid,
  field_id uuid,
  rule_code text not null,
  rule_version text not null,
  outcome text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default statement_timestamp(),
  foreign key (organization_id, dataset_version_id)
    references public.quality_data_dataset_versions (organization_id, dataset_version_id)
    on update restrict on delete restrict,
  foreign key (organization_id, dataset_version_id, record_id)
    references public.quality_data_inspection_records (organization_id, dataset_version_id, record_id)
    on update restrict on delete restrict,
  foreign key (organization_id, dataset_version_id, record_id, field_id)
    references public.quality_data_inspection_fields (organization_id, dataset_version_id, record_id, field_id)
    on update restrict on delete restrict,
  constraint quality_data_validation_target
    check ((field_id is null) or (record_id is not null)),
  constraint quality_data_validation_rule
    check (char_length(btrim(rule_code)) between 1 and 128
      and char_length(btrim(rule_version)) between 1 and 100),
  constraint quality_data_validation_outcome
    check (outcome in ('pass', 'fail', 'review_required')),
  constraint quality_data_validation_details
    check (jsonb_typeof(details) = 'object' and octet_length(details::text) <= 2048)
);

create index quality_data_source_versions_org_created_idx
  on public.quality_data_source_versions (organization_id, created_at desc);
create index quality_data_dataset_versions_org_created_idx
  on public.quality_data_dataset_versions (organization_id, dataset_id, version_number desc);
create index quality_data_ingestion_jobs_org_status_idx
  on public.quality_data_ingestion_jobs (organization_id, status, created_at desc);
create index quality_data_records_org_dataset_idx
  on public.quality_data_inspection_records (organization_id, dataset_version_id, record_ordinal);
create index quality_data_fields_org_record_idx
  on public.quality_data_inspection_fields (organization_id, record_id);

create function private.quality_data_reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using errcode = '55000', message = 'QUALITY_DATA_RECORD_IMMUTABLE';
end;
$$;

revoke all on function private.quality_data_reject_immutable_mutation() from public, anon, authenticated;

create trigger quality_data_sources_immutable
before update or delete on public.quality_data_sources
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_source_versions_immutable
before update or delete on public.quality_data_source_versions
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_datasets_immutable
before update or delete on public.quality_data_datasets
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_dataset_versions_immutable
before update or delete on public.quality_data_dataset_versions
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_dataset_version_sources_immutable
before update or delete on public.quality_data_dataset_version_sources
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_records_immutable
before update or delete on public.quality_data_inspection_records
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_fields_immutable
before update or delete on public.quality_data_inspection_fields
for each row execute function private.quality_data_reject_immutable_mutation();
create trigger quality_data_validation_immutable
before update or delete on public.quality_data_validation_outcomes
for each row execute function private.quality_data_reject_immutable_mutation();

create function private.quality_data_guard_job_transition()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id is distinct from old.organization_id
    or new.ingestion_job_id is distinct from old.ingestion_job_id
    or new.source_id is distinct from old.source_id
    or new.source_version_id is distinct from old.source_version_id
    or new.dataset_id is distinct from old.dataset_id
    or new.dataset_version_id is distinct from old.dataset_version_id
    or new.idempotency_key is distinct from old.idempotency_key
    or new.request_fingerprint is distinct from old.request_fingerprint
    or new.request_id is distinct from old.request_id
    or new.correlation_id is distinct from old.correlation_id
    or new.created_by_user_id is distinct from old.created_by_user_id
    or new.record_count is distinct from old.record_count
    or new.field_count is distinct from old.field_count
    or new.created_at is distinct from old.created_at
    or new.record_version <> old.record_version + 1
    or new.updated_at < old.updated_at
    or not (
      (old.status = 'accepted' and new.status in ('processing', 'failed'))
      or (old.status = 'processing' and new.status in ('completed', 'failed'))
    ) then
    raise exception using errcode = '55000', message = 'QUALITY_DATA_JOB_TRANSITION_INVALID';
  end if;
  return new;
end;
$$;

revoke all on function private.quality_data_guard_job_transition() from public, anon, authenticated;
create trigger quality_data_ingestion_job_transition
before update on public.quality_data_ingestion_jobs
for each row execute function private.quality_data_guard_job_transition();
create trigger quality_data_ingestion_job_no_delete
before delete on public.quality_data_ingestion_jobs
for each row execute function private.quality_data_reject_immutable_mutation();

alter table public.quality_data_sources enable row level security;
alter table public.quality_data_source_versions enable row level security;
alter table public.quality_data_datasets enable row level security;
alter table public.quality_data_dataset_versions enable row level security;
alter table public.quality_data_dataset_version_sources enable row level security;
alter table public.quality_data_ingestion_jobs enable row level security;
alter table public.quality_data_inspection_records enable row level security;
alter table public.quality_data_inspection_fields enable row level security;
alter table public.quality_data_validation_outcomes enable row level security;

alter table public.quality_data_sources force row level security;
alter table public.quality_data_source_versions force row level security;
alter table public.quality_data_datasets force row level security;
alter table public.quality_data_dataset_versions force row level security;
alter table public.quality_data_dataset_version_sources force row level security;
alter table public.quality_data_ingestion_jobs force row level security;
alter table public.quality_data_inspection_records force row level security;
alter table public.quality_data_inspection_fields force row level security;
alter table public.quality_data_validation_outcomes force row level security;

create or replace function private.quality_data_can_read(
  target_organization_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.capa_organization_memberships as membership
    join public.capa_organizations as organization
      on organization.organization_id = membership.organization_id
    join public.capa_role_assignments as assignment
      on assignment.organization_id = membership.organization_id
      and assignment.membership_id = membership.membership_id
      and assignment.user_id = membership.user_id
    join public.capa_roles as role
      on role.role_id = assignment.role_id
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
      and organization.status = 'active'
      and organization.effective_at <= statement_timestamp()
      and (organization.superseded_at is null or organization.superseded_at > statement_timestamp())
      and assignment.role_id = 'CAPA_ORG_ADMIN'
      and assignment.scope_code = 'ORGANIZATION'
      and assignment.scope_resource_type is null
      and assignment.scope_resource_id is null
      and assignment.status = 'active'
      and assignment.effective_at <= statement_timestamp()
      and (assignment.expires_at is null or assignment.expires_at > statement_timestamp())
      and role.status = 'active'
      and role.human_authority
      and 'quality_data.source.read' = any(role.permissions)
  );
$$;

revoke all on function private.quality_data_can_read(uuid)
  from public, anon, authenticated, service_role;
grant execute on function private.quality_data_can_read(uuid)
  to authenticated;

do $$
declare table_name text;
begin
  foreach table_name in array array[
    'quality_data_sources', 'quality_data_source_versions', 'quality_data_datasets',
    'quality_data_dataset_versions', 'quality_data_dataset_version_sources',
    'quality_data_ingestion_jobs', 'quality_data_inspection_records',
    'quality_data_inspection_fields', 'quality_data_validation_outcomes'
  ] loop
    execute format(
      'create policy %I on public.%I for select to authenticated using (private.quality_data_can_read(organization_id))',
      table_name || '_quality_data_admin_read', table_name
    );
    execute format('revoke all on public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant select, insert on public.%I to service_role', table_name);
  end loop;
end
$$;

grant update on public.quality_data_ingestion_jobs to service_role;

comment on table public.quality_data_sources is
  'Organization-owned quality source identity; uploader attribution is stored separately. No personal chat document association is supported.';
comment on table public.quality_data_source_versions is
  'Immutable content-addressed original source versions and parser/schema provenance.';
comment on table public.quality_data_dataset_versions is
  'Immutable dataset snapshots. V1 starts in review_required and grants no evidence-verification authority.';
comment on table public.quality_data_inspection_fields is
  'Typed original and normalized values with worksheet, row and cell provenance.';
comment on table public.quality_data_ingestion_jobs is
  'Durable, idempotent organization source-ingestion state with guarded transitions.';

commit;
