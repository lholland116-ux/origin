begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

set constraints all deferred;

-- ---------------------------------------------------------------------------
-- Controlled fixture identifiers
-- ---------------------------------------------------------------------------

-- Organization A
--   organization: 10000000-0000-4000-8000-000000000001
--   owner user:   10000000-0000-4000-8000-000000000002
--   auditor user: 10000000-0000-4000-8000-000000000003
--
-- Organization B
--   organization: 20000000-0000-4000-8000-000000000001
--   owner user:   20000000-0000-4000-8000-000000000002

insert into public.capa_organizations (
  organization_id,
  organization_name,
  authorization_policy_version,
  created_at,
  created_by_actor_type,
  created_by_actor_id,
  updated_at,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'CAPA Test Organization A',
    'policy-test-1.0.0',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test'
  ),
  (
    '20000000-0000-4000-8000-000000000001',
    'CAPA Test Organization B',
    'policy-test-1.0.0',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test'
  );

insert into public.capa_organization_memberships (
  membership_id,
  organization_id,
  user_id,
  status,
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
    '10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000002',
    'active',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test'
  ),
  (
    '10000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000003',
    'active',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test'
  ),
  (
    '20000000-0000-4000-8000-000000000011',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    'active',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test',
    '2026-08-12T14:00:00Z',
    'system',
    'database-test'
  );

insert into public.capa_role_assignments (
  role_assignment_id,
  organization_id,
  membership_id,
  user_id,
  role_id,
  granted_by_actor_type,
  granted_by_actor_id,
  grant_reason,
  effective_at,
  created_at,
  updated_at
)
values
  (
    '10000000-0000-4000-8000-000000000021',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000002',
    'CAPA_OWNER',
    'system',
    'database-test',
    'Controlled owner fixture',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z'
  ),
  (
    '10000000-0000-4000-8000-000000000022',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000012',
    '10000000-0000-4000-8000-000000000003',
    'CAPA_AUDITOR',
    'system',
    'database-test',
    'Controlled auditor fixture',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z'
  ),
  (
    '20000000-0000-4000-8000-000000000021',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000011',
    '20000000-0000-4000-8000-000000000002',
    'CAPA_OWNER',
    'system',
    'database-test',
    'Controlled second-tenant owner fixture',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z'
   );

-- ---------------------------------------------------------------------------
-- Two tenant-isolated CAPA aggregates
-- ---------------------------------------------------------------------------

insert into public.capa_cases (
  capa_case_id,
  organization_id,
  case_number,
  current_version_id,
  status,
  owner_user_id,
  confidentiality,
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
    '10000000-0000-4000-8000-000000000031',
    '10000000-0000-4000-8000-000000000001',
    'CAPA-TEST-A-0001',
    '10000000-0000-4000-8000-000000000041',
    'S00',
    '10000000-0000-4000-8000-000000000002',
    'CUSTOMER_CONFIDENTIAL',
    1,
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'human',
    '10000000-0000-4000-8000-000000000002',
    '2026-08-12T14:00:00Z',
    'human',
    '10000000-0000-4000-8000-000000000002'
  ),
  (
    '20000000-0000-4000-8000-000000000031',
    '20000000-0000-4000-8000-000000000001',
    'CAPA-TEST-B-0001',
    '20000000-0000-4000-8000-000000000041',
    'S00',
    '20000000-0000-4000-8000-000000000002',
    'CUSTOMER_CONFIDENTIAL',
    1,
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'human',
    '20000000-0000-4000-8000-000000000002',
    '2026-08-12T14:00:00Z',
    'human',
    '20000000-0000-4000-8000-000000000002'
  );

insert into public.capa_section_versions (
  section_version_id,
  organization_id,
  capa_case_id,
  section_type,
  version_number,
  schema_version,
  content,
  change_reason,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id
)
values (
  '10000000-0000-4000-8000-000000000051',
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000031',
  'CAPA.INTAKE',
  1,
  'intake-schema-test-1.0.0',
  '{"initiating_event":"Controlled database test"}'::jsonb,
  'Initial controlled intake',
  '2026-08-12T14:00:00Z',
  '2026-08-12T14:00:00Z',
  'human',
  '10000000-0000-4000-8000-000000000002'
);

insert into public.capa_case_versions (
  case_version_id,
  organization_id,
  capa_case_id,
  version_number,
  change_reason,
  status,
  effective_at,
  created_at,
  created_by_actor_type,
  created_by_actor_id
)
values
  (
    '10000000-0000-4000-8000-000000000041',
    '10000000-0000-4000-8000-000000000001',
    '10000000-0000-4000-8000-000000000031',
    1,
    'Initial controlled version',
    'S00',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'human',
    '10000000-0000-4000-8000-000000000002'
  ),
  (
    '20000000-0000-4000-8000-000000000041',
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000031',
    1,
    'Initial controlled version',
    'S00',
    '2026-08-12T14:00:00Z',
    '2026-08-12T14:00:00Z',
    'human',
    '20000000-0000-4000-8000-000000000002'
  );

insert into public.capa_case_version_sections (
  organization_id,
  capa_case_id,
  case_version_id,
  section_version_id,
  display_order,
  created_at,
  created_by_actor_type,
  created_by_actor_id
)
values (
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000041',
  '10000000-0000-4000-8000-000000000051',
  0,
  '2026-08-12T14:00:00Z',
  'human',
  '10000000-0000-4000-8000-000000000002'
);

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
  occurred_at,
  request_id,
  correlation_id,
  action,
  target_object_type,
  target_object_id,
  target_object_version_id,
  outcome,
  after_object_type,
  after_object_id,
  after_object_version_id,
  configuration_versions,
  metadata
)
values (
  '10000000-0000-4000-8000-000000000061',
  '10000000-0000-4000-8000-000000000001',
  'EVT-CASE-CREATED',
  'audit-schema-test-1.0.0',
  'CAPA_CASE',
  '10000000-0000-4000-8000-000000000031',
  1,
  'human',
  '10000000-0000-4000-8000-000000000002',
  '2026-08-12T14:00:00Z',
  '10000000-0000-4000-8000-000000000071',
  '10000000-0000-4000-8000-000000000072',
  'CREATE_CASE',
  'CAPA_CASE',
  '10000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000041',
  'succeeded',
  'CAPA_CASE',
  '10000000-0000-4000-8000-000000000031',
  '10000000-0000-4000-8000-000000000041',
  '{"workflow":"workflow-test-1.0.0"}'::jsonb,
  '{"case_number":"CAPA-TEST-A-0001"}'::jsonb
);

-- ---------------------------------------------------------------------------
-- Immutable material records
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    update public.capa_section_versions
    set change_reason = 'Unauthorized replacement'
    where section_version_id =
      '10000000-0000-4000-8000-000000000051'
  $$,
  '55000',
  'capa_section_versions is append-only and cannot be updated or deleted',
  'Section versions cannot be updated'
);

select throws_ok(
  $$
    delete from public.capa_section_versions
    where section_version_id =
      '10000000-0000-4000-8000-000000000051'
  $$,
  '55000',
  'capa_section_versions is append-only and cannot be updated or deleted',
  'Section versions cannot be deleted'
);

select throws_ok(
  $$
    update public.capa_case_versions
    set change_reason = 'Unauthorized replacement'
    where case_version_id =
      '10000000-0000-4000-8000-000000000041'
  $$,
  '55000',
  'capa_case_versions is append-only and cannot be updated or deleted',
  'Case versions cannot be updated'
);

select throws_ok(
  $$
    delete from public.capa_case_versions
    where case_version_id =
      '10000000-0000-4000-8000-000000000041'
  $$,
  '55000',
  'capa_case_versions is append-only and cannot be updated or deleted',
  'Case versions cannot be deleted'
);

select throws_ok(
  $$
    update public.capa_case_version_sections
    set display_order = 1
    where organization_id =
        '10000000-0000-4000-8000-000000000001'
      and case_version_id =
        '10000000-0000-4000-8000-000000000041'
      and section_version_id =
        '10000000-0000-4000-8000-000000000051'
  $$,
  '55000',
  'capa_case_version_sections is append-only and cannot be updated or deleted',
  'Case-version section mappings cannot be updated'
);

select throws_ok(
  $$
    delete from public.capa_case_version_sections
    where organization_id =
        '10000000-0000-4000-8000-000000000001'
      and case_version_id =
        '10000000-0000-4000-8000-000000000041'
      and section_version_id =
        '10000000-0000-4000-8000-000000000051'
  $$,
  '55000',
  'capa_case_version_sections is append-only and cannot be updated or deleted',
  'Case-version section mappings cannot be deleted'
);

select throws_ok(
  $$
    update public.capa_audit_events
    set outcome = 'failed'
    where event_id =
      '10000000-0000-4000-8000-000000000061'
  $$,
  '55000',
  'capa_audit_events is append-only and cannot be updated or deleted',
  'Audit events cannot be updated'
);

select throws_ok(
  $$
    delete from public.capa_audit_events
    where event_id =
      '10000000-0000-4000-8000-000000000061'
  $$,
  '55000',
  'capa_audit_events is append-only and cannot be updated or deleted',
  'Audit events cannot be deleted'
);

-- ---------------------------------------------------------------------------
-- Optimistic concurrency and aggregate attribution
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    update public.capa_cases
    set
      case_number = 'CAPA-TEST-A-CHANGED',
      record_version = 2,
      updated_at = '2026-08-12T14:00:01Z'
    where capa_case_id =
      '10000000-0000-4000-8000-000000000031'
  $$,
  '55000',
  'Immutable CAPA aggregate identity or attribution cannot be changed',
  'Stable CAPA aggregate identity cannot be changed'
);

select throws_ok(
  $$
    update public.capa_cases
    set
      updated_at = '2026-08-12T14:00:01Z'
    where capa_case_id =
      '10000000-0000-4000-8000-000000000031'
  $$,
  '40001',
  'CAPA record_version must increase by exactly one',
  'Aggregate updates require an exact record-version increment'
);

select throws_ok(
  $$
    update public.capa_cases
    set
      record_version = 2,
      updated_at = '2026-08-12T13:59:59Z'
    where capa_case_id =
      '10000000-0000-4000-8000-000000000031'
  $$,
  '22007',
  'CAPA updated_at cannot move backward',
  'Aggregate updated_at cannot move backward'
);

select lives_ok(
  $$
    update public.capa_cases
    set
      record_version = 2,
      updated_at = '2026-08-12T14:00:01Z',
      updated_by_actor_type = 'human',
      updated_by_actor_id =
        '10000000-0000-4000-8000-000000000002'
    where capa_case_id =
      '10000000-0000-4000-8000-000000000031'
  $$,
  'A correctly versioned aggregate update succeeds'
);

select is(
  (
    select record_version
    from public.capa_cases
    where capa_case_id =
      '10000000-0000-4000-8000-000000000031'
  ),
  2::bigint,
  'Successful aggregate update commits the next record version'
);

-- ---------------------------------------------------------------------------
-- Tenant and controlled-data constraints
-- ---------------------------------------------------------------------------

select throws_ok(
  $$
    insert into public.capa_section_versions (
      section_version_id,
      organization_id,
      capa_case_id,
      section_type,
      version_number,
      schema_version,
      content,
      change_reason,
      effective_at,
      created_at,
      created_by_actor_type,
      created_by_actor_id
    )
    values (
      '20000000-0000-4000-8000-000000000052',
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000031',
      'CAPA.INTAKE',
      2,
      'intake-schema-test-1.0.0',
      '{}'::jsonb,
      'Invalid cross-tenant section',
      '2026-08-12T14:00:00Z',
      '2026-08-12T14:00:00Z',
      'system',
      'database-test'
    )
  $$,
  '23503',
  null,
  'A section cannot cross the organization boundary'
);

select throws_ok(
  $$
    insert into public.capa_audit_events (
      event_id,
      organization_id,
      event_type,
      schema_version,
      aggregate_type,
      aggregate_id,
      actor_type,
      actor_id,
      occurred_at,
      request_id,
      correlation_id,
      action,
      target_object_type,
      target_object_id,
      outcome,
      configuration_versions,
      metadata
    )
    values (
      '10000000-0000-4000-8000-000000000062',
      '10000000-0000-4000-8000-000000000001',
      'EVT-TEST',
      'audit-schema-test-1.0.0',
      'CAPA_CASE',
      '10000000-0000-4000-8000-000000000031',
      'system',
      'database-test',
      '2026-08-12T14:00:00Z',
      '10000000-0000-4000-8000-000000000073',
      '10000000-0000-4000-8000-000000000074',
      'TEST_ACTION',
      'CAPA_CASE',
      '10000000-0000-4000-8000-000000000031',
      'succeeded',
      '{"workflow":42}'::jsonb,
      '{}'::jsonb
    )
  $$,
  '23514',
  null,
  'Audit configuration versions must be a string map'
);

select throws_ok(
  $$
    update public.capa_cases
    set
      status = 'S130',
      record_version = 3,
      updated_at = '2026-08-12T14:00:02Z'
    where capa_case_id =
      '10000000-0000-4000-8000-000000000031'
  $$,
  '23514',
  null,
  'A closed CAPA requires a closure timestamp'
);

-- ---------------------------------------------------------------------------
-- Transaction rollback probe
-- ---------------------------------------------------------------------------

create or replace function pg_temp.capa_rollback_probe()
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  event_was_inserted boolean := false;
  initial_count bigint;
  final_count bigint;
begin
  select count(*)
  into initial_count
  from public.capa_audit_events;

  begin
    insert into public.capa_audit_events (
      event_id,
      organization_id,
      event_type,
      schema_version,
      aggregate_type,
      aggregate_id,
      actor_type,
      actor_id,
      occurred_at,
      request_id,
      correlation_id,
      action,
      target_object_type,
      target_object_id,
      outcome,
      configuration_versions,
      metadata
    )
    values (
      '10000000-0000-4000-8000-000000000063',
      '10000000-0000-4000-8000-000000000001',
      'EVT-ROLLBACK-PROBE',
      'audit-schema-test-1.0.0',
      'CAPA_CASE',
      '10000000-0000-4000-8000-000000000031',
      'system',
      'database-test',
      '2026-08-12T14:00:00Z',
      '10000000-0000-4000-8000-000000000075',
      '10000000-0000-4000-8000-000000000076',
      'ROLLBACK_PROBE',
      'CAPA_CASE',
      '10000000-0000-4000-8000-000000000031',
      'succeeded',
      '{"workflow":"workflow-test-1.0.0"}'::jsonb,
      '{}'::jsonb
    );

    event_was_inserted := true;

    raise exception using
      errcode = 'P0001',
      message = 'Intentional transaction rollback probe';
  exception
    when sqlstate 'P0001' then
      null;
  end;

  select count(*)
  into final_count
  from public.capa_audit_events;

  return event_was_inserted
    and final_count = initial_count
    and not exists (
      select 1
      from public.capa_audit_events
      where event_id =
        '10000000-0000-4000-8000-000000000063'
    );
end;
$$;

select ok(
  pg_temp.capa_rollback_probe(),
  'A failed transactional unit rolls back its audit write'
);

-- ---------------------------------------------------------------------------
-- Organization A owner: case access, but no audit permission
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000002',
  true
);

set local role authenticated;

select is(
  (select count(*)::integer from public.capa_organizations),
  1,
  'An authenticated member sees only their organization'
);

select is(
  (select count(*)::integer from public.capa_cases),
  1,
  'A CAPA owner sees only authorized cases in their organization'
);

select is(
  (select count(*)::integer from public.capa_audit_events),
  0,
  'A CAPA owner without audit permission cannot read audit events'
);

select is(
  (
    select count(*)::integer
    from public.capa_organization_memberships
  ),
  1,
  'A non-admin member sees only their own membership'
);

select is(
  (select count(*)::integer from public.capa_role_assignments),
  1,
  'A non-admin member sees only their own role assignments'
);

reset role;

-- ---------------------------------------------------------------------------
-- Organization A auditor: audit visibility
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '10000000-0000-4000-8000-000000000003',
  true
);

set local role authenticated;

select is(
  (select count(*)::integer from public.capa_audit_events),
  1,
  'An authorized CAPA auditor can read their tenant audit events'
);

reset role;

-- ---------------------------------------------------------------------------
-- Organization B owner: cross-tenant isolation
-- ---------------------------------------------------------------------------

select set_config(
  'request.jwt.claim.sub',
  '20000000-0000-4000-8000-000000000002',
  true
);

set local role authenticated;

select is(
  (select count(*)::integer from public.capa_cases),
  1,
  'The second-tenant owner sees exactly one authorized case'
);

select is(
  (
    select count(*)::integer
    from public.capa_cases
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  ),
  0,
  'The second-tenant owner cannot see the first tenant CAPA'
);

reset role;

-- ---------------------------------------------------------------------------
-- Anonymous callers have no CAPA table access
-- ---------------------------------------------------------------------------

set local role anon;

select throws_ok(
  $$select count(*) from public.capa_cases$$,
  '42501',
  null,
  'Anonymous callers cannot query CAPA cases'
);

reset role;

select * from finish();

rollback;