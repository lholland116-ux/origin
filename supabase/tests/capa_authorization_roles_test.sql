begin;

create extension if not exists pgtap
with schema extensions;

select plan(18);

-- ---------------------------------------------------------------------------
-- Controlled role-template verification
-- ---------------------------------------------------------------------------

select is(
  (
    select status
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'active',
  'CAPA_REVIEWER is active'
);

select is(
  (
    select role_version
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  '1.2.0',
  'CAPA_REVIEWER uses controlled role version 1.2.0'
);

select ok(
  (
    select
      'capa.review.disposition' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA_REVIEWER has review-disposition permission'
);

select ok(
  not (
    select
      'capa.gate.approve' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA_REVIEWER does not have final gate-approval permission'
);

select ok(
  (
    select human_authority
    from public.capa_roles
    where role_id = 'CAPA_REVIEWER'
  ),
  'CAPA_REVIEWER is designated as human authority'
);

select is(
  (
    select status
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'active',
  'CAPA_APPROVER exists and is active'
);

select is(
  (
    select role_version
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  '1.0.0',
  'CAPA_APPROVER uses controlled role version 1.0.0'
);

select ok(
  (
    select
      'capa.case.view' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA_APPROVER can view CAPA cases'
);

select ok(
  (
    select
      'capa.review.disposition' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA_APPROVER can perform review dispositions'
);

select ok(
  (
    select
      'capa.gate.approve' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA_APPROVER has final gate-approval permission'
);

select ok(
  (
    select human_authority
    from public.capa_roles
    where role_id = 'CAPA_APPROVER'
  ),
  'CAPA_APPROVER is designated as human authority'
);

select ok(
  not (
    select
      'capa.review.disposition' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_ORG_ADMIN'
  ),
  'CAPA_ORG_ADMIN does not receive review authority'
);

select ok(
  not (
    select
      'capa.gate.approve' =
      any(permissions)
    from public.capa_roles
    where role_id = 'CAPA_ORG_ADMIN'
  ),
  'CAPA_ORG_ADMIN does not receive approval authority'
);

-- ---------------------------------------------------------------------------
-- Tenant, membership and role-assignment fixtures
-- ---------------------------------------------------------------------------

insert into public.capa_organizations (
  organization_id,
  organization_name,
  status,
  authorization_policy_version,
  sensitivity_class,
  record_version,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id,
  updated_at,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    '30000000-0000-4000-8000-000000000001',
    'Authorization Test Organization A',
    'active',
    'authorization-test-1.0.0',
    'CUSTOMER_CONFIDENTIAL',
    1,
    statement_timestamp(),
    statement_timestamp(),
    'system',
    'database-test',
    statement_timestamp(),
    'system',
    'database-test'
  ),
  (
    '40000000-0000-4000-8000-000000000001',
    'Authorization Test Organization B',
    'active',
    'authorization-test-1.0.0',
    'CUSTOMER_CONFIDENTIAL',
    1,
    statement_timestamp(),
    statement_timestamp(),
    'system',
    'database-test',
    statement_timestamp(),
    'system',
    'database-test'
  );

insert into public.capa_organization_memberships (
  membership_id,
  organization_id,
  user_id,
  status,
  effective_at,
  record_version,
  created_at,
  created_by_actor_type,
  created_by_actor_id,
  updated_at,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    '30000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000002',
    'active',
    statement_timestamp(),
    1,
    statement_timestamp(),
    'system',
    'database-test',
    statement_timestamp(),
    'system',
    'database-test'
  ),
  (
    '30000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000003',
    'active',
    statement_timestamp(),
    1,
    statement_timestamp(),
    'system',
    'database-test',
    statement_timestamp(),
    'system',
    'database-test'
  );

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
  record_version,
  created_at,
  updated_at
)
values
  (
    '30000000-0000-4000-8000-000000000021',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000002',
    'CAPA_REVIEWER',
    'ORGANIZATION',
    'active',
    statement_timestamp(),
    'system',
    'database-test',
    'Controlled reviewer authorization fixture',
    1,
    statement_timestamp(),
    statement_timestamp()
  ),
  (
    '30000000-0000-4000-8000-000000000022',
    '30000000-0000-4000-8000-000000000001',
    '30000000-0000-4000-8000-000000000012',
    '30000000-0000-4000-8000-000000000003',
    'CAPA_APPROVER',
    'ORGANIZATION',
    'active',
    statement_timestamp(),
    'system',
    'database-test',
    'Controlled approver authorization fixture',
    1,
    statement_timestamp(),
    statement_timestamp()
  );

-- ---------------------------------------------------------------------------
-- Runtime permission-helper behavior
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-4000-8000-000000000002',
  true
);

set local role authenticated;

select ok(
  private.capa_has_permission(
    '30000000-0000-4000-8000-000000000001',
    'capa.review.disposition'
  ),
  'Assigned reviewer receives review-disposition permission'
);

select ok(
  not private.capa_has_permission(
    '30000000-0000-4000-8000-000000000001',
    'capa.gate.approve'
  ),
  'Assigned reviewer is denied final gate-approval permission'
);

reset role;

select set_config(
  'request.jwt.claim.sub',
  '30000000-0000-4000-8000-000000000003',
  true
);

set local role authenticated;

select ok(
  private.capa_has_permission(
    '30000000-0000-4000-8000-000000000001',
    'capa.review.disposition'
  ),
  'Assigned approver receives review-disposition permission'
);

select ok(
  private.capa_has_permission(
    '30000000-0000-4000-8000-000000000001',
    'capa.gate.approve'
  ),
  'Assigned approver receives final gate-approval permission'
);

select ok(
  not private.capa_has_permission(
    '40000000-0000-4000-8000-000000000001',
    'capa.gate.approve'
  ),
  'Approver authority does not cross the organization boundary'
);

reset role;

select * from finish();

rollback;