begin;

create extension if not exists pgtap with schema extensions;

select plan(26);

set constraints all deferred;

select has_table(
  'public',
  'capa_action_plan_review_decisions',
  'S70 action-plan review decision table exists'
);

select has_pk(
  'public',
  'capa_action_plan_review_decisions',
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
      'public.capa_action_plan_review_decisions'::regclass
      and constraint_record.contype = 'p'
  ),
  'organization_id,capa_case_id,source_case_version_id',
  'decision uniqueness is scoped to organization, case, and S70 source version'
);

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_schema_version'
    and pg_get_constraintdef(oid) like '%capa-action-plan-review-decision-1.0.0%'
), 'decision schema version is controlled');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_decision'
    and pg_get_constraintdef(oid) like '%approve%'
    and pg_get_constraintdef(oid) like '%return%'
), 'decision is restricted to approve or return');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_rationale'
), 'rationale is required and trimmed nonblank');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_distinct_versions'
), 'source and resulting versions must be distinct');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_source_version_fk'
    and contype = 'f'
), 'decision binds the exact S70 source case version');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_action_plan_section_fk'
    and contype = 'f'
), 'decision binds the exact action-plan section version');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_resulting_version_fk'
    and contype = 'f'
), 'decision binds the exact resulting case version');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_reviewer_fk'
    and contype = 'f'
), 'decision binds the authorized tenant reviewer');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_audit_event_fk'
    and contype = 'f'
), 'decision binds the transition audit event');

select ok(exists (
  select 1 from pg_catalog.pg_constraint
  where conrelid = 'public.capa_action_plan_review_decisions'::regclass
    and conname = 'capa_action_plan_review_decisions_audit_event_unique'
    and contype = 'u'
), 'one decision cannot reuse a transition audit event');

select has_trigger(
  'public',
  'capa_action_plan_review_decisions',
  'capa_action_plan_review_decisions_reject_mutation',
  'review decisions are immutable'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_action_plan_review_decisions'::regclass),
  'review-decision row-level security is enabled'
);

select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_action_plan_review_decisions'::regclass),
  'review-decision row-level security is forced'
);

select ok(has_table_privilege('service_role', 'public.capa_action_plan_review_decisions', 'SELECT'),
  'service role can read committed decisions');
select ok(has_table_privilege('service_role', 'public.capa_action_plan_review_decisions', 'INSERT'),
  'service role can insert committed decisions');
select ok(not has_table_privilege('service_role', 'public.capa_action_plan_review_decisions', 'UPDATE'),
  'service role cannot update committed decisions');
select ok(not has_table_privilege('service_role', 'public.capa_action_plan_review_decisions', 'DELETE'),
  'service role cannot delete committed decisions');

insert into public.capa_organizations (
  organization_id, organization_name, authorization_policy_version,
  effective_at, created_at, created_by_actor_type, created_by_actor_id,
  updated_at, updated_by_actor_type, updated_by_actor_id
) values (
  'd1000000-0000-4000-8000-000000000001', 'S70 decision test organization',
  'qualification-1.0.0', '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z',
  'system', 'sql-test', '2026-09-09T00:00:00Z', 'system', 'sql-test'
);

insert into public.capa_organization_memberships (
  membership_id, organization_id, user_id, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'd1100000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1200000-0000-4000-8000-000000000001', 'active',
  '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'system', 'sql-test',
  '2026-09-09T00:00:00Z', 'system', 'sql-test'
);

insert into public.capa_cases (
  capa_case_id, organization_id, case_number, current_version_id, status,
  owner_user_id, confidentiality, record_version, effective_at, created_at,
  created_by_actor_type, created_by_actor_id, updated_at,
  updated_by_actor_type, updated_by_actor_id
) values (
  'd1300000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', 'CAPA-S70-DECISION',
  'd1400000-0000-4000-8000-000000000001', 'S70',
  'd1200000-0000-4000-8000-000000000001', 'CUSTOMER_CONFIDENTIAL', 5,
  '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'human', 'sql-test',
  '2026-09-09T00:00:00Z', 'human', 'sql-test'
);

insert into public.capa_case_versions (
  case_version_id, organization_id, capa_case_id, version_number,
  change_reason, status, effective_at, created_at,
  created_by_actor_type, created_by_actor_id
) values
  (
    'd1400000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 5,
    'S70 decision source', 'S70', '2026-09-09T00:00:00Z',
    '2026-09-09T00:00:00Z', 'human', 'sql-test'
  ),
  (
    'd1500000-0000-4000-8000-000000000001',
    'd1000000-0000-4000-8000-000000000001',
    'd1300000-0000-4000-8000-000000000001', 6,
    'S80 decision result', 'S80', '2026-09-09T00:00:00Z',
    '2026-09-09T00:00:00Z', 'human', 'sql-test'
  );

insert into public.capa_section_versions (
  section_version_id, organization_id, capa_case_id, section_type,
  version_number, schema_version, content, change_reason, effective_at,
  created_at, created_by_actor_type, created_by_actor_id
) values (
  'd1600000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001', 'CAPA.ACTION_PLAN', 1,
  'capa-action-plan-1.0.0', '{}'::jsonb, 'S70 decision source',
  '2026-09-09T00:00:00Z', '2026-09-09T00:00:00Z', 'human', 'sql-test'
);

insert into public.capa_audit_events (
  event_id, organization_id, event_type, schema_version, aggregate_type,
  aggregate_id, aggregate_version, actor_type, actor_id, occurred_at,
  request_id, correlation_id, action, target_object_type, target_object_id,
  target_object_version_id, outcome, configuration_versions, metadata
) values (
  'd1700000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000001', 'EVT-STATE-TRANSITION',
  'audit-1.0.0', 'CAPA_CASE', 'd1300000-0000-4000-8000-000000000001', 6,
  'human', 'd1200000-0000-4000-8000-000000000001', '2026-09-09T00:00:00Z',
  'd1800000-0000-4000-8000-000000000001',
  'd1900000-0000-4000-8000-000000000001', 'DECIDE_CAPA_ACTION_PLAN',
  'CAPA_CASE', 'd1300000-0000-4000-8000-000000000001',
  'd1500000-0000-4000-8000-000000000001', 'succeeded', '{}'::jsonb, '{}'::jsonb
);

insert into public.capa_action_plan_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  action_plan_section_version_id, schema_version, decision, rationale,
  reviewer_user_id, decided_at, resulting_case_version_id,
  transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'capa-action-plan-review-decision-1.0.0', 'approve',
  'The submitted action plan is suitable for implementation.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-09T00:00:00Z',
  'd1500000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000001'
);

set constraints all immediate;

select is((select count(*)::integer from public.capa_action_plan_review_decisions), 1,
  'one valid S70 decision persists');
select is((select decision from public.capa_action_plan_review_decisions limit 1), 'approve',
  'persisted decision retains the human choice');
select is((select source_case_version_id from public.capa_action_plan_review_decisions limit 1), 'd1400000-0000-4000-8000-000000000001',
  'persisted decision retains the exact S70 source version');

select throws_ok($$ insert into public.capa_action_plan_review_decisions (
  organization_id, capa_case_id, source_case_version_id,
  action_plan_section_version_id, schema_version, decision, rationale,
  reviewer_user_id, decided_at, resulting_case_version_id,
  transition_audit_event_id
) values (
  'd1000000-0000-4000-8000-000000000001',
  'd1300000-0000-4000-8000-000000000001',
  'd1400000-0000-4000-8000-000000000001',
  'd1600000-0000-4000-8000-000000000001',
  'capa-action-plan-review-decision-1.0.0', 'return', 'Conflicting decision.',
  'd1200000-0000-4000-8000-000000000001', '2026-09-09T00:00:00Z',
  'd1500000-0000-4000-8000-000000000001',
  'd1700000-0000-4000-8000-000000000001'
) $$, '23505', null, 'a second decision for one S70 source version is rejected');

select throws_ok($$ update public.capa_action_plan_review_decisions
  set rationale = 'Changed decision' $$,
  '55000', null, 'committed action-plan review decisions cannot be updated');

select throws_ok($$ delete from public.capa_action_plan_review_decisions $$,
  '55000', null, 'committed action-plan review decisions cannot be deleted');

select * from finish();
rollback;
