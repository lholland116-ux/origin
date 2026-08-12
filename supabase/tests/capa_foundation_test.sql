begin;

create extension if not exists pgtap with schema extensions;

select plan(50);

-- ---------------------------------------------------------------------------
-- Required CAPA tables
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'capa_organizations',
  'CAPA organizations table exists'
);

select has_table(
  'public',
  'capa_organization_memberships',
  'CAPA organization memberships table exists'
);

select has_table(
  'public',
  'capa_roles',
  'CAPA roles table exists'
);

select has_table(
  'public',
  'capa_role_assignments',
  'CAPA role assignments table exists'
);

select has_table(
  'public',
  'capa_cases',
  'CAPA cases table exists'
);

select has_table(
  'public',
  'capa_section_versions',
  'CAPA immutable section versions table exists'
);

select has_table(
  'public',
  'capa_case_versions',
  'CAPA immutable case versions table exists'
);

select has_table(
  'public',
  'capa_case_version_sections',
  'CAPA case-version section mapping table exists'
);

select has_table(
  'public',
  'capa_audit_events',
  'CAPA append-only audit table exists'
);

-- ---------------------------------------------------------------------------
-- Security and integrity functions
-- ---------------------------------------------------------------------------

select has_function(
  'private',
  'capa_is_controlled_code',
  array['text'],
  'Controlled-code validation function exists'
);

select has_function(
  'private',
  'capa_is_string_map',
  array['jsonb'],
  'String-map validation function exists'
);

select has_function(
  'private',
  'capa_is_active_member',
  array['uuid'],
  'Active tenant membership function exists'
);

select has_function(
  'private',
  'capa_has_permission',
  array['uuid', 'text'],
  'Tenant permission evaluation function exists'
);

-- ---------------------------------------------------------------------------
-- Mutation-control triggers
-- ---------------------------------------------------------------------------

select has_trigger(
  'public',
  'capa_section_versions',
  'capa_section_versions_reject_mutation',
  'Section versions reject updates and deletes'
);

select has_trigger(
  'public',
  'capa_case_versions',
  'capa_case_versions_reject_mutation',
  'Case versions reject updates and deletes'
);

select has_trigger(
  'public',
  'capa_case_version_sections',
  'capa_case_version_sections_reject_mutation',
  'Case-version section mappings reject mutations'
);

select has_trigger(
  'public',
  'capa_audit_events',
  'capa_audit_events_reject_mutation',
  'Audit events reject updates and deletes'
);

select has_trigger(
  'public',
  'capa_cases',
  'capa_cases_enforce_update',
  'CAPA aggregate updates enforce concurrency controls'
);

-- ---------------------------------------------------------------------------
-- Row-level security enabled
-- ---------------------------------------------------------------------------

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_organizations'::regclass
  ),
  'RLS is enabled on capa_organizations'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_organization_memberships'::regclass
  ),
  'RLS is enabled on capa_organization_memberships'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_roles'::regclass
  ),
  'RLS is enabled on capa_roles'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_role_assignments'::regclass
  ),
  'RLS is enabled on capa_role_assignments'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_cases'::regclass
  ),
  'RLS is enabled on capa_cases'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_section_versions'::regclass
  ),
  'RLS is enabled on capa_section_versions'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_case_versions'::regclass
  ),
  'RLS is enabled on capa_case_versions'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_case_version_sections'::regclass
  ),
  'RLS is enabled on capa_case_version_sections'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_audit_events'::regclass
  ),
  'RLS is enabled on capa_audit_events'
);

-- ---------------------------------------------------------------------------
-- Row-level security forced on tenant-owned records
-- ---------------------------------------------------------------------------

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_organizations'::regclass
  ),
  'RLS is forced on capa_organizations'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_organization_memberships'::regclass
  ),
  'RLS is forced on capa_organization_memberships'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_role_assignments'::regclass
  ),
  'RLS is forced on capa_role_assignments'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_cases'::regclass
  ),
  'RLS is forced on capa_cases'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_section_versions'::regclass
  ),
  'RLS is forced on capa_section_versions'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_case_versions'::regclass
  ),
  'RLS is forced on capa_case_versions'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_case_version_sections'::regclass
  ),
  'RLS is forced on capa_case_version_sections'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid = 'public.capa_audit_events'::regclass
  ),
  'RLS is forced on capa_audit_events'
);

-- ---------------------------------------------------------------------------
-- Required row-level security policies
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_organizations'
      and policyname = 'capa_organizations_member_select'
  ),
  'Organization member-select policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_organization_memberships'
      and policyname = 'capa_memberships_self_or_admin_select'
  ),
  'Membership self-or-admin policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_roles'
      and policyname = 'capa_roles_authenticated_select'
  ),
  'Authenticated role-selection policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_role_assignments'
      and policyname = 'capa_role_assignments_self_or_admin_select'
  ),
  'Role-assignment self-or-admin policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_cases'
      and policyname = 'capa_cases_authorized_select'
  ),
  'Authorized CAPA-case selection policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_section_versions'
      and policyname = 'capa_section_versions_authorized_select'
  ),
  'Authorized section-version selection policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_case_versions'
      and policyname = 'capa_case_versions_authorized_select'
  ),
  'Authorized case-version selection policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_case_version_sections'
      and policyname =
        'capa_case_version_sections_authorized_select'
  ),
  'Authorized case-version section policy exists'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_policies
    where schemaname = 'public'
      and tablename = 'capa_audit_events'
      and policyname = 'capa_audit_events_authorized_select'
  ),
  'Authorized audit-event selection policy exists'
);

-- ---------------------------------------------------------------------------
-- Critical tenant and version constraints
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.capa_cases'::regclass
      and conname = 'capa_cases_owner_membership_fk'
      and contype = 'f'
  ),
  'CAPA owner must belong to the same organization'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.capa_cases'::regclass
      and conname = 'capa_cases_current_version_fk'
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  'Current-version identity and state use a deferred foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.capa_section_versions'::regclass
      and conname = 'capa_section_versions_parent_fk'
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  'Section parent versions remain within the same tenant and case'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.capa_case_versions'::regclass
      and conname = 'capa_case_versions_parent_fk'
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  'Case parent versions remain within the same tenant and case'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.capa_audit_events'::regclass
      and conname = 'capa_audit_events_organization_fk'
      and contype = 'f'
  ),
  'Audit events require an existing organization'
);

-- ---------------------------------------------------------------------------
-- Controlled baseline roles
-- ---------------------------------------------------------------------------

select is(
  (
    select count(*)::integer
    from public.capa_roles
    where role_id in (
      'CAPA_OWNER',
      'CAPA_CONTRIBUTOR',
      'CAPA_REVIEWER',
      'CAPA_AUDITOR',
      'CAPA_ORG_ADMIN'
    )
  ),
  5,
  'All five controlled baseline CAPA roles are installed'
);

select * from finish();

rollback;