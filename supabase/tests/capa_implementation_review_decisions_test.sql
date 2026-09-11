begin;

create extension if not exists pgtap with schema extensions;

select plan(45);

set constraints all deferred;

select has_table(
  'public',
  'capa_implementation_review_decisions',
  'S90 implementation-review decision table exists'
);

select has_pk(
  'public',
  'capa_implementation_review_decisions',
  'one decision baseline has a tenant-qualified primary key'
);

select is(
  (
    select string_agg(
      attribute.attname,
      ',' order by position.i
    )
    from pg_catalog.pg_constraint as constraint_record
    cross join lateral generate_subscripts(constraint_record.conkey, 1) as position(i)
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid = constraint_record.conrelid
      and attribute.attnum = constraint_record.conkey[position.i]
    where constraint_record.conrelid =
      'public.capa_implementation_review_decisions'::regclass
      and constraint_record.contype = 'p'
  ),
  'organization_id,capa_case_id,source_case_version_id',
  'decision uniqueness is scoped to organization, case, and S90 source version'
);

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_schema_version'
    and pg_get_constraintdef(oid) like '%capa-implementation-review-decision-1.0.0%'
), 'decision schema version is controlled');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_decision'
    and pg_get_constraintdef(oid) like '%accept%'
    and pg_get_constraintdef(oid) like '%return%'
), 'decision is restricted to accept or return');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_rationale'
), 'rationale is required, trimmed, nonblank, and bounded');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_distinct_versions'
), 'source and resulting versions must be distinct');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_source_version_fk'
    and contype = 'f'
), 'decision binds the exact S90 source case version');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_baseline_section_fk'
    and contype = 'f'
), 'decision binds the exact implementation-review baseline section version');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_resulting_version_fk'
    and contype = 'f'
), 'decision binds the exact resulting case version');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_reviewer_fk'
    and contype = 'f'
), 'decision binds the authorized tenant reviewer');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_audit_event_fk'
    and contype = 'f'
), 'decision binds the transition audit event');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_implementation_review_decisions'::regclass
    and conname = 'capa_implementation_review_decisions_audit_event_unique'
    and contype = 'u'
), 'one decision cannot reuse a transition audit event');

select has_trigger(
  'public',
  'capa_implementation_review_decisions',
  'capa_implementation_review_decisions_reject_mutation',
  'review decisions are immutable'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_implementation_review_decisions'::regclass),
  'review-decision row-level security is enabled'
);

select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_implementation_review_decisions'::regclass),
  'review-decision row-level security is forced'
);

select ok(has_table_privilege('service_role', 'public.capa_implementation_review_decisions', 'SELECT'),
  'service role can read committed decisions');
select ok(has_table_privilege('service_role', 'public.capa_implementation_review_decisions', 'INSERT'),
  'service role can insert committed decisions');
select ok(not has_table_privilege('service_role', 'public.capa_implementation_review_decisions', 'UPDATE'),
  'service role cannot update committed decisions');
select ok(not has_table_privilege('service_role', 'public.capa_implementation_review_decisions', 'DELETE'),
  'service role cannot delete committed decisions');
select ok(not has_table_privilege('anon', 'public.capa_implementation_review_decisions', 'SELECT'),
  'anonymous clients cannot read committed decisions');
select ok(not has_table_privilege('anon', 'public.capa_implementation_review_decisions', 'INSERT'),
  'anonymous clients cannot insert committed decisions');
select ok(not has_table_privilege('authenticated', 'public.capa_implementation_review_decisions', 'SELECT'),
  'authenticated clients cannot read committed decisions directly');
select ok(not has_table_privilege('authenticated', 'public.capa_implementation_review_decisions', 'INSERT'),
  'authenticated clients cannot insert committed decisions directly');

insert into public.capa_organizations (
  organization_id, organization_name, authorization_policy_version,
  effective_at, created_at, created_by_actor_type, created_by_actor_id,
  updated_at, updated_by_actor_type, updated_by_actor_id
) values
  (
    'd1000000-0000-4000-8000-000000000001', 'S90 decision test organization',
    'qualification-1.0.0', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z',
    'system', 'sql-test', '2026-09-11T00:00:00Z', 'system', 'sql-test'
  ),
  (
    'd2000000-0000-4000-8000-000000000001', 'S90 decision other tenant',
    'qualification-1.0.0', '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z',
    'system', 'sql-test', '2026-09-11T00:00:00Z', 'system', 'sql-test'
  );

insert into public.capa_organization_memberships (
  membership_id, organization_id, user_id, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values
  (
    'd1100000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1200000-0000-4000-8000-000000000001', 'active',
    '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z', 'system', 'sql-test',
    '2026-09-11T00:00:00Z', 'system', 'sql-test'
  ),
  (
    'd2100000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd2200000-0000-4000-8000-000000000001', 'active',
    '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z', 'system', 'sql-test',
    '2026-09-11T00:00:00Z', 'system', 'sql-test'
  );

insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values
  (
    'd1300000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 'CAPA-S90-DECISION-A',
    'd1400000-0000-4000-8000-000000000001', 'S90',
    'd1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 8,
    '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z', 'human', 'sql-test',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1310000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 'CAPA-S90-DECISION-B',
    'd1510000-0000-4000-8000-000000000001', 'S90',
    'd1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 3,
    '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z', 'human', 'sql-test',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd2300000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001', 'CAPA-S90-DECISION-CROSS-TENANT',
    'd2400000-0000-4000-8000-000000000001', 'S90',
    'd2200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 2,
    '2026-09-11T00:00:00Z', '2026-09-11T00:00:00Z', 'human', 'sql-test',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  );

insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values
  (
    'd1400000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 8,
    'S90 decision source accept', 'S90', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1500000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 9,
    'S100 decision result accept', 'S100', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1800000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 10,
    'S90 decision source return', 'S90', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1900000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 11,
    'S80 decision result return', 'S80', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1810000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 12,
    'S90 decision source audit collision', 'S90', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1910000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 13,
    'S80 decision result audit collision', 'S80', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1510000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1310000-0000-4000-8000-000000000001', 3,
    'S90 mismatched case', 'S90', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd2400000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd2300000-0000-4000-8000-000000000001', 2,
    'S90 cross-tenant source', 'S90', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  );

insert into public.capa_section_versions (
  section_version_id, organization_id, capa_case_id, section_type,
  version_number, schema_version, content, change_reason, effective_at,
  created_at, created_by_actor_type, created_by_actor_id
) values
  (
    'd1600000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    'CAPA.IMPLEMENTATION_REVIEW_BASELINE', 1,
    'capa-implementation-review-baseline-1.0.0', '{}'::jsonb,
    'S90 decision baseline', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1610000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1310000-0000-4000-8000-000000000001',
    'CAPA.IMPLEMENTATION_REVIEW_BASELINE', 1,
    'capa-implementation-review-baseline-1.0.0', '{}'::jsonb,
    'S90 mismatched case baseline', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd2600000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    'd2300000-0000-4000-8000-000000000001',
    'CAPA.IMPLEMENTATION_REVIEW_BASELINE', 1,
    'capa-implementation-review-baseline-1.0.0', '{}'::jsonb,
    'S90 cross-tenant baseline', '2026-09-11T00:00:00Z',
    '2026-09-11T00:00:00Z', 'human', 'sql-test'
  );

insert into public.capa_audit_events (
  event_id, organization_id, event_type, schema_version, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_id, occurred_at,
  request_id, correlation_id, action, target_object_type, target_object_id,
  target_object_version_id, outcome, configuration_versions, metadata
) values
  (
    'd1700000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION',
    'audit-1.0.0', 'CAPA_CASE',
    'd1300000-0000-4000-8000-000000000001', 9, 'human',
    'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
    'd1720000-0000-4000-8000-000000000001',
    'd1730000-0000-4000-8000-000000000001', 'ACCEPT_IMPLEMENTATION',
    'CAPA_CASE', 'd1300000-0000-4000-8000-000000000001',
    'd1500000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb
  ),
  (
    'd1710000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION',
    'audit-1.0.0', 'CAPA_CASE',
    'd1300000-0000-4000-8000-000000000001', 11, 'human',
    'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
    'd1740000-0000-4000-8000-000000000001',
    'd1750000-0000-4000-8000-000000000001', 'RETURN_IMPLEMENTATION',
    'CAPA_CASE', 'd1300000-0000-4000-8000-000000000001',
    'd1900000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb
  ),
  (
    'd1760000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION',
    'audit-1.0.0', 'CAPA_CASE',
    'd1300000-0000-4000-8000-000000000001', 13, 'human',
    'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
    'd1770000-0000-4000-8000-000000000001',
    'd1780000-0000-4000-8000-000000000001', 'RETURN_IMPLEMENTATION',
    'CAPA_CASE', 'd1300000-0000-4000-8000-000000000001',
    'd1910000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb
  ),
  (
    'd2700000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION',
    'audit-1.0.0', 'CAPA_CASE',
    'd2300000-0000-4000-8000-000000000001', 2, 'human',
    'd2200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
    'd2710000-0000-4000-8000-000000000001',
    'd2720000-0000-4000-8000-000000000001', 'ACCEPT_IMPLEMENTATION',
    'CAPA_CASE', 'd2300000-0000-4000-8000-000000000001',
    'd2400000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb
  );

insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values
  (
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    'd1400000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'capa-implementation-review-decision-1.0.0', 'accept',
    'The implementation evidence is ready for acceptance.',
    'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
    'd1500000-0000-4000-8000-000000000001',
    'd1700000-0000-4000-8000-000000000001'
  ),
  (
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001',
    'd1800000-0000-4000-8000-000000000001',
    'd1600000-0000-4000-8000-000000000001',
    'capa-implementation-review-decision-1.0.0', 'return',
    'The implementation evidence requires additional owner work.',
    'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
    'd1900000-0000-4000-8000-000000000001',
    'd1710000-0000-4000-8000-000000000001'
  );

set constraints all immediate;

select is((select count(*)::integer from public.capa_implementation_review_decisions), 2,
  'valid accept and return S90 decisions persist');
select is((select decision from public.capa_implementation_review_decisions where source_case_version_id = 'd1400000-0000-4000-8000-000000000001'), 'accept',
  'persisted accept decision retains the human choice');
select is((select decision from public.capa_implementation_review_decisions where source_case_version_id = 'd1800000-0000-4000-8000-000000000001'), 'return',
  'persisted return decision retains the human choice');
select is((select implementation_review_baseline_section_version_id from public.capa_implementation_review_decisions where source_case_version_id = 'd1400000-0000-4000-8000-000000000001'), 'd1600000-0000-4000-8000-000000000001',
  'persisted decision retains the exact implementation-review baseline section');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'return', 'Conflicting decision.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1900000-0000-4000-8000-000000000001',
  'd1760000-0000-4000-8000-000000000001'
) $$, '23505', null, 'a second decision for one S90 source version is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd2000000-0000-4000-8000-000000000001',
  'd2300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd2600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Cross-tenant source.',
  'd2200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd2400000-0000-4000-8000-000000000001',
  'd2700000-0000-4000-8000-000000000001'
) $$, '23503', null, 'a source version from another tenant cannot satisfy the binding');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'wrong-schema', 'accept', 'Invalid schema.', 'd1200000-0000-4000-8000-000000000001',
  '2026-09-11T00:00:00Z', 'd1910000-0000-4000-8000-000000000001',
  'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'invalid schema version is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'approve', 'Invalid decision.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'unsupported decision is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', '',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'blank rationale is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', '   ',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'whitespace-only rationale is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', ' leading whitespace',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'leading or trailing rationale whitespace is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', repeat('x', 4001),
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'rationale maximum length is enforced');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Same source and result.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1810000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23514', null, 'source and resulting case versions must differ');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1310000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Mismatched case.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1500000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23503', null, 'mismatched CAPA case binding is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1610000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Mismatched baseline.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23503', null, 'mismatched implementation-review baseline binding is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Invalid reviewer.',
  'd1990000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23503', null, 'invalid reviewer binding is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Invalid result.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd2400000-0000-4000-8000-000000000001', 'd1760000-0000-4000-8000-000000000001'
) $$, '23503', null, 'invalid resulting case-version binding is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'accept', 'Invalid audit event.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1790000-0000-4000-8000-000000000001'
) $$, '23503', null, 'invalid transition-audit binding is rejected');

select throws_ok($$ insert into public.capa_implementation_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  implementation_review_baseline_section_version_id, schema_version,
  decision, rationale, reviewer_user_id, decided_at,
  resulting_case_version_id, transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'd1300000-0000-4000-8000-000000000001',
  'd1810000-0000-4000-8000-000000000001', 'd1600000-0000-4000-8000-000000000001',
  'capa-implementation-review-decision-1.0.0', 'return', 'Duplicate audit event.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-11T00:00:00Z',
  'd1910000-0000-4000-8000-000000000001', 'd1700000-0000-4000-8000-000000000001'
) $$, '23505', null, 'a transition audit event cannot be reused');

select throws_ok($$ update public.capa_implementation_review_decisions
  set rationale = 'Changed decision' $$,
  '55000', null, 'committed implementation-review decisions cannot be updated');

select throws_ok($$ delete from public.capa_implementation_review_decisions $$,
  '55000', null, 'committed implementation-review decisions cannot be deleted');

select * from finish();
rollback;
