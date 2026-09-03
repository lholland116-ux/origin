begin;

create extension if not exists pgtap with schema extensions;

select plan(22);

select has_table(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'S30 adoption evidence table exists'
);

select has_pk(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'S30 adoption evidence has a tenant-qualified primary key'
);

select col_type_is(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'organization_id',
  'uuid',
  'adoption organization identity uses UUID'
);

select col_type_is(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'adoption_id',
  'uuid',
  'adoption identity uses UUID'
);

select col_type_is(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'adopted_item',
  'jsonb',
  'adopted item snapshot uses structured JSON'
);

select col_type_is(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'audit_event_id',
  'uuid',
  'adoption audit identity uses UUID'
);

select col_has_default(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'created_at',
  'adoption persistence has a database timestamp default'
);

select has_trigger(
  'public',
  'capa_investigation_planning_ai_adoptions',
  'capa_s30_adoptions_reject_mutation',
  'adoption evidence has an immutable-record trigger'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_investigation_planning_ai_adoptions'::regclass),
  'adoption row-level security is enabled'
);

select ok(
  (select relforcerowsecurity from pg_catalog.pg_class
   where oid = 'public.capa_investigation_planning_ai_adoptions'::regclass),
  'adoption row-level security is forced'
);

select ok(
  not has_table_privilege('anon', 'public.capa_investigation_planning_ai_adoptions', 'SELECT'),
  'anonymous clients cannot read adoption evidence'
);

select ok(
  not has_table_privilege('authenticated', 'public.capa_investigation_planning_ai_adoptions', 'INSERT'),
  'authenticated browser clients cannot create adoption evidence directly'
);

select ok(
  has_table_privilege('service_role', 'public.capa_investigation_planning_ai_adoptions', 'SELECT'),
  'service role can resolve adoption evidence'
);

select ok(
  has_table_privilege('service_role', 'public.capa_investigation_planning_ai_adoptions', 'INSERT'),
  'service role can append adoption evidence'
);

select ok(
  not has_table_privilege('service_role', 'public.capa_investigation_planning_ai_adoptions', 'UPDATE'),
  'service role cannot update adoption evidence'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_idempotency_unique'
      and contype = 'u'
  ),
  'adoption idempotency is unique per organization and proposal key'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_output_snapshot_fk'
      and contype = 'f'
  ),
  'adoption is foreign-key bound to the exact immutable S30 output snapshot'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_audit_event_fk'
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  'adoption-to-audit linkage is transactionally deferred'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_no_workflow_mutation'
      and contype = 'c'
  ),
  'adoption evidence cannot mutate workflow'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_no_controlled_record_mutation'
      and contype = 'c'
  ),
  'adoption evidence cannot mutate controlled records'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_not_gate_approval'
      and contype = 'c'
  ),
  'adoption evidence cannot approve the release gate'
);

select ok(
  exists (
    select 1 from pg_catalog.pg_constraint
    where conrelid = 'public.capa_investigation_planning_ai_adoptions'::regclass
      and conname = 'capa_s30_adoptions_proposal_key_format'
      and contype = 'c'
  ),
  'adoption evidence enforces advisory-local proposal keys'
);

select * from finish();

rollback;
