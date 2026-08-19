begin;

create extension if not exists pgtap;

select plan(32);

-- ---------------------------------------------------------------------------
-- Function existence and least privilege
-- ---------------------------------------------------------------------------

select ok(
  to_regprocedure(
    'private.capa_provision_organization_owner(uuid,uuid,text,text,text)'
  ) is not null,
  'controlled provisioning function exists'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = to_regprocedure(
      'private.capa_provision_organization_owner(uuid,uuid,text,text,text)'
    )
  ),
  'provisioning function is security definer'
);

select ok(
  not has_function_privilege(
    'anon',
    'private.capa_provision_organization_owner(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'anonymous clients cannot execute provisioning'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'private.capa_provision_organization_owner(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'authenticated browser clients cannot execute provisioning'
);

select ok(
  has_function_privilege(
    'service_role',
    'private.capa_provision_organization_owner(uuid,uuid,text,text,text)',
    'EXECUTE'
  ),
  'service role can execute controlled provisioning'
);

-- ---------------------------------------------------------------------------
-- Controlled authentication fixture
-- ---------------------------------------------------------------------------

insert into auth.users (
  instance_id,
  id,
  aud,
  role,
  email,
  encrypted_password,
  email_confirmed_at,
  raw_app_meta_data,
  raw_user_meta_data,
  created_at,
  updated_at
)
values (
  '00000000-0000-0000-0000-000000000000',
  '30000000-0000-4000-8000-000000000003',
  'authenticated',
  'authenticated',
  'capa-provisioning-test@example.invalid',
  '',
  statement_timestamp(),
  '{}'::jsonb,
  '{}'::jsonb,
  statement_timestamp(),
  statement_timestamp()
);

-- ---------------------------------------------------------------------------
-- Input and identity validation
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '99999999-9999-4999-8999-999999999999',
      'Missing User Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '22023',
  'The supplied Supabase user does not exist',
  'provisioning rejects an unknown Supabase user'
);

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      ' Invalid Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '22023',
  'The CAPA organization name is invalid',
  'provisioning rejects an invalid organization name'
);

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'LVT CAPA Test Organization',
      ' policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '22023',
  'The CAPA authorization-policy version is invalid',
  'provisioning rejects an invalid policy version'
);

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'LVT CAPA Test Organization',
      'policy-1.0.0',
      ''
    )
  $$,
  '22023',
  'The provisioning actor identifier is invalid',
  'provisioning rejects an invalid actor identifier'
);

-- ---------------------------------------------------------------------------
-- Initial atomic provisioning
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    create temporary table
    first_provisioning_result
    on commit drop
    as
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'LVT CAPA Test Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  'valid organization provisioning succeeds'
);

select is(
  (
    select count(*)
    from public.capa_organizations
    where organization_id =
      '40000000-0000-4000-8000-000000000004'
  ),
  1::bigint,
  'one organization is created'
);

select is(
  (
    select status
    from public.capa_organizations
    where organization_id =
      '40000000-0000-4000-8000-000000000004'
  ),
  'active'::text,
  'the organization is active'
);

select is(
  (
    select authorization_policy_version
    from public.capa_organizations
    where organization_id =
      '40000000-0000-4000-8000-000000000004'
  ),
  'policy-1.0.0'::text,
  'the controlled authorization-policy version is retained'
);

select is(
  (
    select count(*)
    from public.capa_organization_memberships
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'one organization membership is created'
);

select is(
  (
    select status
    from public.capa_organization_memberships
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
  ),
  'active'::text,
  'the organization membership is active'
);

select is(
  (
    select count(*)
    from public.capa_role_assignments
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
      and status = 'active'
  ),
  2::bigint,
  'two separate active role assignments are created'
);

select is(
  (
    select count(*)
    from public.capa_role_assignments
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
      and role_id = 'CAPA_OWNER'
      and scope_code = 'ORGANIZATION'
      and status = 'active'
  ),
  1::bigint,
  'CAPA_OWNER authority is assigned'
);

select is(
  (
    select count(*)
    from public.capa_role_assignments
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
      and role_id = 'CAPA_ORG_ADMIN'
      and scope_code = 'ORGANIZATION'
      and status = 'active'
  ),
  1::bigint,
  'CAPA_ORG_ADMIN authority is assigned separately'
);

select isnt(
  (
    select owner_role_assignment_id
    from first_provisioning_result
  ),
  (
    select administrator_role_assignment_id
    from first_provisioning_result
  ),
  'owner and administrator authorities have distinct identities'
);

-- ---------------------------------------------------------------------------
-- Exact retry idempotency
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    create temporary table
    retry_provisioning_result
    on commit drop
    as
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'LVT CAPA Test Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  'an exact provisioning retry succeeds'
);

select is(
  (
    select provisioned_organization_id
    from retry_provisioning_result
  ),
  (
    select provisioned_organization_id
    from first_provisioning_result
  ),
  'an exact retry reuses the organization identity'
);

select is(
  (
    select provisioned_membership_id
    from retry_provisioning_result
  ),
  (
    select provisioned_membership_id
    from first_provisioning_result
  ),
  'an exact retry reuses the membership identity'
);

select is(
  (
    select owner_role_assignment_id
    from retry_provisioning_result
  ),
  (
    select owner_role_assignment_id
    from first_provisioning_result
  ),
  'an exact retry reuses CAPA_OWNER authority'
);

select is(
  (
    select administrator_role_assignment_id
    from retry_provisioning_result
  ),
  (
    select administrator_role_assignment_id
    from first_provisioning_result
  ),
  'an exact retry reuses CAPA_ORG_ADMIN authority'
);

select is(
  (
    select count(*)
    from public.capa_organizations
    where organization_id =
      '40000000-0000-4000-8000-000000000004'
  ),
  1::bigint,
  'an exact retry does not duplicate the organization'
);

select is(
  (
    select count(*)
    from public.capa_organization_memberships
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
  ),
  1::bigint,
  'an exact retry does not duplicate the membership'
);

select is(
  (
    select count(*)
    from public.capa_role_assignments
    where organization_id =
        '40000000-0000-4000-8000-000000000004'
      and user_id =
        '30000000-0000-4000-8000-000000000003'
      and status = 'active'
  ),
  2::bigint,
  'an exact retry does not duplicate authority'
);

-- ---------------------------------------------------------------------------
-- Conflict and fail-closed behavior
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'Conflicting Organization Name',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '55000',
  'The CAPA organization identifier conflicts with an existing organization',
  'a conflicting organization retry fails closed'
);

update public.capa_organization_memberships
set
  status = 'suspended',
  updated_at = statement_timestamp(),
  updated_by_actor_type = 'system',
  updated_by_actor_id = 'provisioning-test'
where organization_id =
    '40000000-0000-4000-8000-000000000004'
  and user_id =
    '30000000-0000-4000-8000-000000000003';

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'LVT CAPA Test Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '55000',
  'The existing CAPA membership is not active',
  'provisioning cannot silently reactivate a suspended membership'
);

update public.capa_organization_memberships
set
  status = 'active',
  updated_at = statement_timestamp(),
  updated_by_actor_type = 'system',
  updated_by_actor_id = 'provisioning-test'
where organization_id =
    '40000000-0000-4000-8000-000000000004'
  and user_id =
    '30000000-0000-4000-8000-000000000003';

insert into public.capa_role_assignments (
  role_assignment_id,
  organization_id,
  membership_id,
  user_id,
  role_id,
  scope_code,
  status,
  effective_at,
  granted_by_actor_type,
  granted_by_actor_id,
  grant_reason,
  created_at,
  updated_at
)
select
  '50000000-0000-4000-8000-000000000005',
  organization_id,
  membership_id,
  user_id,
  'CAPA_OWNER',
  'ORGANIZATION',
  'active',
  statement_timestamp(),
  'system',
  'provisioning-test',
  'Controlled duplicate-authority test fixture',
  statement_timestamp(),
  statement_timestamp()
from public.capa_organization_memberships
where organization_id =
    '40000000-0000-4000-8000-000000000004'
  and user_id =
    '30000000-0000-4000-8000-000000000003';

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '40000000-0000-4000-8000-000000000004',
      '30000000-0000-4000-8000-000000000003',
      'LVT CAPA Test Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '55000',
  'Multiple active CAPA_OWNER assignments were found',
  'ambiguous active owner authority fails closed'
);

delete from public.capa_role_assignments
where role_assignment_id =
  '50000000-0000-4000-8000-000000000005';

update public.capa_roles
set status = 'inactive'
where role_id = 'CAPA_OWNER';

select throws_ok(
  $$
    select *
    from private.capa_provision_organization_owner(
      '60000000-0000-4000-8000-000000000006',
      '30000000-0000-4000-8000-000000000003',
      'Invalid Role Configuration Organization',
      'policy-1.0.0',
      'provisioning-test'
    )
  $$,
  '55000',
  'The required CAPA_OWNER role configuration is invalid',
  'invalid controlled role configuration fails closed'
);

select is(
  (
    select count(*)
    from public.capa_organizations
    where organization_id =
      '60000000-0000-4000-8000-000000000006'
  ),
  0::bigint,
  'failed provisioning leaves no partial organization'
);

select * from finish();

rollback;