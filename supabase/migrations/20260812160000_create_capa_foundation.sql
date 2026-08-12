-- LVT CAPA durable data foundation.
--
-- Primary sources:
--   Document #8 - LVT CAPA Data Model and Audit-Trail Specification
--   Document #9 - LVT CAPA Security, Privacy, and Access-Control Specification
--
-- Traceability:
--   DM-COM-001 through DM-COM-010
--   VER-001 through VER-008
--   AUD-001 through AUD-012
--   TEN-001 through TEN-010
--   AUTH-001 through AUTH-008

begin;

create extension if not exists pgcrypto with schema extensions;

create schema if not exists private;
revoke all on schema private from public;
revoke all on schema private from anon;
revoke all on schema private from authenticated;

-- ---------------------------------------------------------------------------
-- Controlled validation helpers
-- ---------------------------------------------------------------------------

create or replace function private.capa_is_controlled_code(value text)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    char_length(value) between 1 and 64
    and value ~ '^[A-Za-z][A-Za-z0-9._:-]*$';
$$;

create or replace function private.capa_is_string_map(value jsonb)
returns boolean
language sql
immutable
strict
set search_path = ''
as $$
  select
    jsonb_typeof(value) = 'object'
    and not exists (
      select 1
      from jsonb_each(value) as entry
      where jsonb_typeof(entry.value) <> 'string'
    );
$$;

create or replace function private.capa_reject_immutable_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception using
    errcode = '55000',
    message = format('%I is append-only and cannot be updated or deleted', tg_table_name);
end;
$$;

-- ---------------------------------------------------------------------------
-- Tenant, membership, and authorization configuration
-- ---------------------------------------------------------------------------

create table public.capa_organizations (
  organization_id uuid primary key default gen_random_uuid(),
  organization_name text not null,
  status text not null default 'active',
  authorization_policy_version text not null,
  region_code text,
  sensitivity_class text not null default 'CUSTOMER_CONFIDENTIAL',
  record_version bigint not null default 1,
  effective_at timestamptz not null default statement_timestamp(),
  superseded_at timestamptz,
  created_at timestamptz not null default statement_timestamp(),
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by_actor_type text not null,
  updated_by_actor_id text not null,
  updated_by_actor_version text,
  constraint capa_organizations_name_length
    check (char_length(btrim(organization_name)) between 1 and 200),
  constraint capa_organizations_status
    check (status in ('active', 'suspended', 'inactive', 'closed')),
  constraint capa_organizations_policy_version_length
    check (char_length(btrim(authorization_policy_version)) between 1 and 100),
  constraint capa_organizations_sensitivity_code
    check (private.capa_is_controlled_code(sensitivity_class)),
  constraint capa_organizations_actor_types
    check (
      created_by_actor_type in ('human', 'service', 'agent', 'system')
      and updated_by_actor_type in ('human', 'service', 'agent', 'system')
    ),
  constraint capa_organizations_record_version
    check (record_version > 0),
  constraint capa_organizations_lifecycle_times
    check (
      updated_at >= created_at
      and effective_at >= created_at
      and (superseded_at is null or superseded_at >= effective_at)
    )
);

create table public.capa_organization_memberships (
  membership_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  status text not null default 'active',
  effective_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  record_version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  updated_at timestamptz not null default statement_timestamp(),
  updated_by_actor_type text not null,
  updated_by_actor_id text not null,
  updated_by_actor_version text,
  constraint capa_memberships_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  -- user_id intentionally preserves the external Supabase identity UUID
  -- without an auth.users FK so account deletion cannot erase or block
  -- required historical CAPA attribution.
  constraint capa_memberships_org_user_unique
    unique (organization_id, user_id),
  constraint capa_memberships_org_user_membership_unique
    unique (organization_id, user_id, membership_id),
  constraint capa_memberships_status
    check (status in ('invited', 'active', 'suspended', 'revoked', 'expired')),
  constraint capa_memberships_actor_types
    check (
      created_by_actor_type in ('human', 'service', 'agent', 'system')
      and updated_by_actor_type in ('human', 'service', 'agent', 'system')
    ),
  constraint capa_memberships_record_version
    check (record_version > 0),
  constraint capa_memberships_times
    check (
      updated_at >= created_at
      and (expires_at is null or expires_at > effective_at)
    )
);

create table public.capa_roles (
  role_id text primary key,
  role_name text not null,
  role_version text not null,
  permissions text[] not null default '{}',
  status text not null default 'active',
  human_authority boolean not null default true,
  created_at timestamptz not null default statement_timestamp(),
  constraint capa_roles_id_code
    check (private.capa_is_controlled_code(role_id)),
  constraint capa_roles_name_length
    check (char_length(btrim(role_name)) between 1 and 120),
  constraint capa_roles_version_length
    check (char_length(btrim(role_version)) between 1 and 100),
  constraint capa_roles_status
    check (status in ('active', 'inactive', 'superseded')),
  constraint capa_roles_permissions_no_nulls
    check (array_position(permissions, null) is null)
);

create table public.capa_role_assignments (
  role_assignment_id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  membership_id uuid not null,
  user_id uuid not null,
  role_id text not null,
  scope_code text not null default 'ORGANIZATION',
  scope_resource_type text,
  scope_resource_id text,
  status text not null default 'active',
  effective_at timestamptz not null default statement_timestamp(),
  expires_at timestamptz,
  granted_by_actor_type text not null,
  granted_by_actor_id text not null,
  granted_by_actor_version text,
  grant_reason text not null,
  record_version bigint not null default 1,
  created_at timestamptz not null default statement_timestamp(),
  updated_at timestamptz not null default statement_timestamp(),
  constraint capa_role_assignments_membership_fk
    foreign key (organization_id, user_id, membership_id)
    references public.capa_organization_memberships
      (organization_id, user_id, membership_id)
    on update restrict on delete restrict,
  constraint capa_role_assignments_role_fk
    foreign key (role_id)
    references public.capa_roles (role_id)
    on update restrict on delete restrict,
  constraint capa_role_assignments_unique
    unique nulls not distinct (
      organization_id,
      membership_id,
      role_id,
      scope_code,
      scope_resource_type,
      scope_resource_id,
      effective_at
    ),
  constraint capa_role_assignments_scope_code
    check (private.capa_is_controlled_code(scope_code)),
  constraint capa_role_assignments_scope_shape
    check (
      (scope_code = 'ORGANIZATION'
        and scope_resource_type is null
        and scope_resource_id is null)
      or
      (scope_code <> 'ORGANIZATION'
        and scope_resource_type is not null
        and scope_resource_id is not null
        and private.capa_is_controlled_code(scope_resource_type))
    ),
  constraint capa_role_assignments_status
    check (status in ('active', 'suspended', 'revoked', 'expired')),
  constraint capa_role_assignments_actor_type
    check (granted_by_actor_type in ('human', 'service', 'agent', 'system')),
  constraint capa_role_assignments_reason_length
    check (char_length(btrim(grant_reason)) between 1 and 2000),
  constraint capa_role_assignments_record_version
    check (record_version > 0),
  constraint capa_role_assignments_times
    check (
      updated_at >= created_at
      and (expires_at is null or expires_at > effective_at)
    )
);

insert into public.capa_roles
  (role_id, role_name, role_version, permissions, human_authority)
values
  (
    'CAPA_OWNER',
    'CAPA Owner or Coordinator',
    '1.0.0',
    array[
      'capa.case.create', 'capa.case.view', 'capa.case.edit',
      'capa.case.submit', 'capa.evidence.link'
    ],
    true
  ),
  (
    'CAPA_CONTRIBUTOR',
    'CAPA Contributor or Investigator',
    '1.0.0',
    array['capa.case.view', 'capa.case.edit', 'capa.evidence.link'],
    true
  ),
  (
    'CAPA_REVIEWER',
    'CAPA Reviewer or Approver',
    '1.0.0',
    array['capa.case.view', 'capa.review.disposition', 'capa.gate.approve'],
    true
  ),
  (
    'CAPA_AUDITOR',
    'CAPA Read-Only Auditor',
    '1.0.0',
    array['capa.case.view', 'capa.audit.view', 'capa.case.export'],
    true
  ),
  (
    'CAPA_ORG_ADMIN',
    'CAPA Organization Administrator',
    '1.0.0',
    array['capa.tenant.users.manage', 'capa.tenant.roles.manage'],
    true
  )
on conflict (role_id) do nothing;

-- ---------------------------------------------------------------------------
-- CAPA aggregate and immutable material versions
-- ---------------------------------------------------------------------------

create table public.capa_cases (
  capa_case_id uuid primary key,
  organization_id uuid not null,
  case_number text not null,
  current_version_id uuid not null,
  status text not null,
  owner_user_id uuid not null,
  confidentiality text not null,
  record_version bigint not null,
  effective_at timestamptz not null,
  superseded_at timestamptz,
  cancelled_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null,
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  updated_at timestamptz not null,
  updated_by_actor_type text not null,
  updated_by_actor_id text not null,
  updated_by_actor_version text,
  constraint capa_cases_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  constraint capa_cases_owner_membership_fk
    foreign key (organization_id, owner_user_id)
    references public.capa_organization_memberships (organization_id, user_id)
    on update restrict on delete restrict,
  constraint capa_cases_org_case_unique
    unique (organization_id, capa_case_id),
  constraint capa_cases_org_number_unique
    unique (organization_id, case_number),
  constraint capa_cases_number_length
    check (char_length(btrim(case_number)) between 1 and 100),
  constraint capa_cases_state
    check (status in (
      'S00', 'S10', 'S20', 'S30', 'S40', 'S50', 'S60', 'S70',
      'S80', 'S90', 'S100', 'S110', 'S120', 'S130', 'S140', 'S150'
    )),
  constraint capa_cases_confidentiality_code
    check (private.capa_is_controlled_code(confidentiality)),
  constraint capa_cases_record_version
    check (record_version > 0),
  constraint capa_cases_actor_types
    check (
      created_by_actor_type in ('human', 'service', 'agent', 'system')
      and updated_by_actor_type in ('human', 'service', 'agent', 'system')
    ),
  constraint capa_cases_times
    check (
      updated_at >= created_at
      and effective_at >= created_at
      and (superseded_at is null or superseded_at >= effective_at)
      and (cancelled_at is null or cancelled_at >= effective_at)
      and (closed_at is null or closed_at >= effective_at)
    ),
  constraint capa_cases_terminal_times
    check (
      (status <> 'S130' or closed_at is not null)
      and (status <> 'S140' or cancelled_at is not null)
      and not (closed_at is not null and cancelled_at is not null)
    )
);

create table public.capa_section_versions (
  section_version_id uuid primary key,
  organization_id uuid not null,
  capa_case_id uuid not null,
  section_type text not null,
  version_number bigint not null,
  parent_version_id uuid,
  schema_version text not null,
  content jsonb not null,
  change_reason text not null,
  effective_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null,
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  constraint capa_section_versions_case_fk
    foreign key (organization_id, capa_case_id)
    references public.capa_cases (organization_id, capa_case_id)
    on update restrict on delete restrict,
  constraint capa_section_versions_org_case_id_unique
    unique (organization_id, capa_case_id, section_version_id),
  constraint capa_section_versions_parent_key_unique
    unique (organization_id, capa_case_id, section_type, section_version_id),
  constraint capa_section_versions_parent_fk
    foreign key (organization_id, capa_case_id, section_type, parent_version_id)
    references public.capa_section_versions
      (organization_id, capa_case_id, section_type, section_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_section_versions_number_unique
    unique (organization_id, capa_case_id, section_type, version_number),
  constraint capa_section_versions_type_code
    check (private.capa_is_controlled_code(section_type)),
  constraint capa_section_versions_number
    check (version_number > 0),
  constraint capa_section_versions_schema_length
    check (char_length(btrim(schema_version)) between 1 and 100),
  constraint capa_section_versions_content_object
    check (jsonb_typeof(content) = 'object'),
  constraint capa_section_versions_content_size
    check (pg_column_size(content) <= 1048576),
  constraint capa_section_versions_reason_length
    check (char_length(btrim(change_reason)) between 1 and 4000),
  constraint capa_section_versions_actor_type
    check (created_by_actor_type in ('human', 'service', 'agent', 'system')),
  constraint capa_section_versions_times
    check (
      effective_at >= created_at
      and (superseded_at is null or superseded_at >= effective_at)
    )
);

create table public.capa_case_versions (
  case_version_id uuid primary key,
  organization_id uuid not null,
  capa_case_id uuid not null,
  version_number bigint not null,
  parent_version_id uuid,
  change_reason text not null,
  status text not null,
  effective_at timestamptz not null,
  superseded_at timestamptz,
  created_at timestamptz not null,
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  constraint capa_case_versions_case_fk
    foreign key (organization_id, capa_case_id)
    references public.capa_cases (organization_id, capa_case_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_case_versions_org_case_id_unique
    unique (organization_id, capa_case_id, case_version_id),
  constraint capa_case_versions_current_state_unique
    unique (organization_id, capa_case_id, case_version_id, status),
  constraint capa_case_versions_parent_fk
    foreign key (organization_id, capa_case_id, parent_version_id)
    references public.capa_case_versions
      (organization_id, capa_case_id, case_version_id)
    on update restrict on delete restrict
    deferrable initially deferred,
  constraint capa_case_versions_number_unique
    unique (organization_id, capa_case_id, version_number),
  constraint capa_case_versions_number
    check (version_number > 0),
  constraint capa_case_versions_reason_length
    check (char_length(btrim(change_reason)) between 1 and 4000),
  constraint capa_case_versions_state
    check (status in (
      'S00', 'S10', 'S20', 'S30', 'S40', 'S50', 'S60', 'S70',
      'S80', 'S90', 'S100', 'S110', 'S120', 'S130', 'S140', 'S150'
    )),
  constraint capa_case_versions_actor_type
    check (created_by_actor_type in ('human', 'service', 'agent', 'system')),
  constraint capa_case_versions_times
    check (
      effective_at >= created_at
      and (superseded_at is null or superseded_at >= effective_at)
    )
);

alter table public.capa_cases
  add constraint capa_cases_current_version_fk
  foreign key (organization_id, capa_case_id, current_version_id, status)
  references public.capa_case_versions
    (organization_id, capa_case_id, case_version_id, status)
  on update restrict on delete restrict
  deferrable initially deferred;

create table public.capa_case_version_sections (
  organization_id uuid not null,
  capa_case_id uuid not null,
  case_version_id uuid not null,
  section_version_id uuid not null,
  display_order integer not null,
  created_at timestamptz not null,
  created_by_actor_type text not null,
  created_by_actor_id text not null,
  created_by_actor_version text,
  primary key (organization_id, case_version_id, section_version_id),
  constraint capa_case_version_sections_case_version_fk
    foreign key (organization_id, capa_case_id, case_version_id)
    references public.capa_case_versions
      (organization_id, capa_case_id, case_version_id)
    on update restrict on delete restrict,
  constraint capa_case_version_sections_section_version_fk
    foreign key (organization_id, capa_case_id, section_version_id)
    references public.capa_section_versions
      (organization_id, capa_case_id, section_version_id)
    on update restrict on delete restrict,
  constraint capa_case_version_sections_order_unique
    unique (organization_id, case_version_id, display_order),
  constraint capa_case_version_sections_order
    check (display_order >= 0),
  constraint capa_case_version_sections_actor_type
    check (created_by_actor_type in ('human', 'service', 'agent', 'system'))
);

-- ---------------------------------------------------------------------------
-- Append-only business audit trail
-- ---------------------------------------------------------------------------

create table public.capa_audit_events (
  event_id uuid primary key,
  organization_id uuid not null,
  event_type text not null,
  schema_version text not null,
  aggregate_type text not null,
  aggregate_id text not null,
  aggregate_version bigint,
  actor_type text not null,
  actor_id text not null,
  actor_version text,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default statement_timestamp(),
  request_id uuid not null,
  correlation_id uuid not null,
  idempotency_key text,
  action text not null,
  target_object_type text not null,
  target_object_id text not null,
  target_object_version_id text,
  outcome text not null,
  reason text,
  before_object_type text,
  before_object_id text,
  before_object_version_id text,
  after_object_type text,
  after_object_id text,
  after_object_version_id text,
  change_set jsonb,
  configuration_versions jsonb not null,
  metadata jsonb not null default '{}'::jsonb,
  integrity_proof jsonb,
  constraint capa_audit_events_organization_fk
    foreign key (organization_id)
    references public.capa_organizations (organization_id)
    on update restrict on delete restrict,
  constraint capa_audit_events_event_type_code
    check (private.capa_is_controlled_code(event_type)),
  constraint capa_audit_events_schema_length
    check (char_length(btrim(schema_version)) between 1 and 100),
  constraint capa_audit_events_aggregate_type_code
    check (private.capa_is_controlled_code(aggregate_type)),
  constraint capa_audit_events_aggregate_version
    check (aggregate_version is null or aggregate_version > 0),
  constraint capa_audit_events_actor_type
    check (actor_type in ('human', 'service', 'agent', 'system')),
  constraint capa_audit_events_idempotency_length
    check (idempotency_key is null or char_length(idempotency_key) between 1 and 200),
  constraint capa_audit_events_action_code
    check (private.capa_is_controlled_code(action)),
  constraint capa_audit_events_target_type_code
    check (private.capa_is_controlled_code(target_object_type)),
  constraint capa_audit_events_outcome
    check (outcome in ('succeeded', 'denied', 'blocked', 'failed', 'attempted')),
  constraint capa_audit_events_reason_length
    check (reason is null or char_length(reason) <= 4000),
  constraint capa_audit_events_before_reference
    check (
      (before_object_type is null and before_object_id is null and before_object_version_id is null)
      or
      (before_object_type is not null and before_object_id is not null
        and private.capa_is_controlled_code(before_object_type))
    ),
  constraint capa_audit_events_after_reference
    check (
      (after_object_type is null and after_object_id is null and after_object_version_id is null)
      or
      (after_object_type is not null and after_object_id is not null
        and private.capa_is_controlled_code(after_object_type))
    ),
  constraint capa_audit_events_change_set_object
    check (change_set is null or jsonb_typeof(change_set) = 'object'),
  constraint capa_audit_events_configuration_map
    check (private.capa_is_string_map(configuration_versions)),
  constraint capa_audit_events_metadata_object
    check (jsonb_typeof(metadata) = 'object'),
  constraint capa_audit_events_integrity_object
    check (integrity_proof is null or jsonb_typeof(integrity_proof) = 'object'),
  constraint capa_audit_events_recording_time
    check (recorded_at >= occurred_at - interval '5 minutes')
);

create index capa_audit_events_idempotency_idx
  on public.capa_audit_events
    (organization_id, idempotency_key, event_type)
  where idempotency_key is not null;

-- ---------------------------------------------------------------------------
-- Indexes supporting tenant-scoped repository access
-- ---------------------------------------------------------------------------

create index capa_memberships_user_active_idx
  on public.capa_organization_memberships (user_id, organization_id)
  where status = 'active';

create index capa_role_assignments_user_active_idx
  on public.capa_role_assignments (user_id, organization_id, role_id)
  where status = 'active';

create index capa_cases_org_updated_idx
  on public.capa_cases (organization_id, updated_at desc, capa_case_id);

create index capa_cases_org_owner_idx
  on public.capa_cases (organization_id, owner_user_id, status);

create index capa_case_versions_lookup_idx
  on public.capa_case_versions
    (organization_id, capa_case_id, version_number desc);

create index capa_section_versions_lookup_idx
  on public.capa_section_versions
    (organization_id, capa_case_id, section_type, version_number desc);

create index capa_audit_events_aggregate_cursor_idx
  on public.capa_audit_events
    (organization_id, aggregate_type, aggregate_id, occurred_at desc, event_id desc);

create index capa_audit_events_correlation_idx
  on public.capa_audit_events (organization_id, correlation_id);

create index capa_audit_events_request_idx
  on public.capa_audit_events (organization_id, request_id);

-- ---------------------------------------------------------------------------
-- Immutable-record and optimistic-concurrency enforcement
-- ---------------------------------------------------------------------------

create trigger capa_section_versions_reject_mutation
before update or delete on public.capa_section_versions
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_case_versions_reject_mutation
before update or delete on public.capa_case_versions
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_case_version_sections_reject_mutation
before update or delete on public.capa_case_version_sections
for each row execute function private.capa_reject_immutable_mutation();

create trigger capa_audit_events_reject_mutation
before update or delete on public.capa_audit_events
for each row execute function private.capa_reject_immutable_mutation();

create or replace function private.capa_enforce_aggregate_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.organization_id <> old.organization_id
    or new.capa_case_id <> old.capa_case_id
    or new.case_number <> old.case_number
    or new.created_at <> old.created_at
    or new.created_by_actor_type <> old.created_by_actor_type
    or new.created_by_actor_id <> old.created_by_actor_id
    or new.created_by_actor_version is distinct from old.created_by_actor_version
    or new.effective_at <> old.effective_at
  then
    raise exception using
      errcode = '55000',
      message = 'Immutable CAPA aggregate identity or attribution cannot be changed';
  end if;

  if new.record_version <> old.record_version + 1 then
    raise exception using
      errcode = '40001',
      message = 'CAPA record_version must increase by exactly one';
  end if;

  if new.updated_at < old.updated_at then
    raise exception using
      errcode = '22007',
      message = 'CAPA updated_at cannot move backward';
  end if;

  return new;
end;
$$;

create trigger capa_cases_enforce_update
before update on public.capa_cases
for each row execute function private.capa_enforce_aggregate_update();

-- ---------------------------------------------------------------------------
-- RLS decision helpers
-- ---------------------------------------------------------------------------

create or replace function private.capa_is_active_member(target_organization_id uuid)
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
    where membership.organization_id = target_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and membership.effective_at <= statement_timestamp()
      and (membership.expires_at is null or membership.expires_at > statement_timestamp())
      and organization.status = 'active'
      and organization.effective_at <= statement_timestamp()
      and (organization.superseded_at is null or organization.superseded_at > statement_timestamp())
  );
$$;

create or replace function private.capa_has_permission(
  target_organization_id uuid,
  required_permission text
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.capa_is_active_member(target_organization_id)
    and exists (
      select 1
      from public.capa_role_assignments as assignment
      join public.capa_roles as role
        on role.role_id = assignment.role_id
      where assignment.organization_id = target_organization_id
        and assignment.user_id = auth.uid()
        and assignment.status = 'active'
        and assignment.effective_at <= statement_timestamp()
        and (assignment.expires_at is null or assignment.expires_at > statement_timestamp())
        and role.status = 'active'
        and required_permission = any(role.permissions)
    );
$$;

revoke all on function private.capa_is_active_member(uuid) from public;
revoke all on function private.capa_has_permission(uuid, text) from public;
grant usage on schema private to authenticated;
grant execute on function private.capa_is_active_member(uuid) to authenticated;
grant execute on function private.capa_has_permission(uuid, text) to authenticated;
grant usage on schema private to service_role;
grant execute on all functions in schema private to service_role;

-- ---------------------------------------------------------------------------
-- Row-level security and least-privilege grants
-- ---------------------------------------------------------------------------

alter table public.capa_organizations enable row level security;
alter table public.capa_organization_memberships enable row level security;
alter table public.capa_roles enable row level security;
alter table public.capa_role_assignments enable row level security;
alter table public.capa_cases enable row level security;
alter table public.capa_section_versions enable row level security;
alter table public.capa_case_versions enable row level security;
alter table public.capa_case_version_sections enable row level security;
alter table public.capa_audit_events enable row level security;

alter table public.capa_organizations force row level security;
alter table public.capa_organization_memberships force row level security;
alter table public.capa_role_assignments force row level security;
alter table public.capa_cases force row level security;
alter table public.capa_section_versions force row level security;
alter table public.capa_case_versions force row level security;
alter table public.capa_case_version_sections force row level security;
alter table public.capa_audit_events force row level security;

create policy capa_organizations_member_select
on public.capa_organizations
for select to authenticated
using (private.capa_is_active_member(organization_id));

create policy capa_memberships_self_or_admin_select
on public.capa_organization_memberships
for select to authenticated
using (
  user_id = auth.uid()
  or private.capa_has_permission(organization_id, 'capa.tenant.users.manage')
);

create policy capa_roles_authenticated_select
on public.capa_roles
for select to authenticated
using (status = 'active');

create policy capa_role_assignments_self_or_admin_select
on public.capa_role_assignments
for select to authenticated
using (
  user_id = auth.uid()
  or private.capa_has_permission(organization_id, 'capa.tenant.roles.manage')
);

create policy capa_cases_authorized_select
on public.capa_cases
for select to authenticated
using (private.capa_has_permission(organization_id, 'capa.case.view'));

create policy capa_section_versions_authorized_select
on public.capa_section_versions
for select to authenticated
using (private.capa_has_permission(organization_id, 'capa.case.view'));

create policy capa_case_versions_authorized_select
on public.capa_case_versions
for select to authenticated
using (private.capa_has_permission(organization_id, 'capa.case.view'));

create policy capa_case_version_sections_authorized_select
on public.capa_case_version_sections
for select to authenticated
using (private.capa_has_permission(organization_id, 'capa.case.view'));

create policy capa_audit_events_authorized_select
on public.capa_audit_events
for select to authenticated
using (private.capa_has_permission(organization_id, 'capa.audit.view'));

revoke all on table public.capa_organizations from anon, authenticated;
revoke all on table public.capa_organization_memberships from anon, authenticated;
revoke all on table public.capa_roles from anon, authenticated;
revoke all on table public.capa_role_assignments from anon, authenticated;
revoke all on table public.capa_cases from anon, authenticated;
revoke all on table public.capa_section_versions from anon, authenticated;
revoke all on table public.capa_case_versions from anon, authenticated;
revoke all on table public.capa_case_version_sections from anon, authenticated;
revoke all on table public.capa_audit_events from anon, authenticated;

grant select on table public.capa_organizations to authenticated;
grant select on table public.capa_organization_memberships to authenticated;
grant select on table public.capa_roles to authenticated;
grant select on table public.capa_role_assignments to authenticated;
grant select on table public.capa_cases to authenticated;
grant select on table public.capa_section_versions to authenticated;
grant select on table public.capa_case_versions to authenticated;
grant select on table public.capa_case_version_sections to authenticated;
grant select on table public.capa_audit_events to authenticated;

grant select, insert, update on table public.capa_organizations to service_role;
grant select, insert, update on table public.capa_organization_memberships to service_role;
grant select on table public.capa_roles to service_role;
grant select, insert, update on table public.capa_role_assignments to service_role;
grant select, insert, update on table public.capa_cases to service_role;
grant select, insert on table public.capa_section_versions to service_role;
grant select, insert on table public.capa_case_versions to service_role;
grant select, insert on table public.capa_case_version_sections to service_role;
grant select, insert on table public.capa_audit_events to service_role;

-- Documentation comments are retained in schema dumps and generated evidence.
comment on table public.capa_organizations is
  'Permanent CAPA tenant boundary; LVT-CAPA-DATA-008 DM-COM-001 and LVT-CAPA-SEC-009 TEN-001.';
comment on table public.capa_organization_memberships is
  'Server-resolved user-to-organization access relationship; IAM and TEN controls.';
comment on table public.capa_role_assignments is
  'Effective-dated, scoped CAPA authority assignment; AUTH and segregation-of-duties foundation.';
comment on table public.capa_cases is
  'Stable tenant-scoped CAPA aggregate with current immutable-version pointer and optimistic concurrency.';
comment on table public.capa_case_versions is
  'Append-only material CAPA case snapshot; VER-001.';
comment on table public.capa_section_versions is
  'Append-only version of controlled CAPA section content; VER-001.';
comment on table public.capa_case_version_sections is
  'Immutable ordered relationship between exact case and section versions; DM-COM-007.';
comment on table public.capa_audit_events is
  'Append-only business audit trail; AUD-001 through AUD-012.';

commit;