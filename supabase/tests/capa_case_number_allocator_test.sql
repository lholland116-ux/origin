begin;

create extension if not exists pgtap;

select plan(35);

-- ---------------------------------------------------------------------------
-- Schema and integrity controls
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'capa_case_number_counters',
  'CAPA case-number counter table exists'
);

select has_pk(
  'public',
  'capa_case_number_counters',
  'CAPA case-number counter has a primary key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_case_number_counters'::regclass
      and conname =
        'capa_case_number_counters_organization_fk'
      and contype = 'f'
  ),
  'counter has its organization foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_case_number_counters'::regclass
      and conname =
        'capa_case_number_counters_range'
      and contype = 'c'
  ),
  'counter has its controlled numeric range'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_case_number_counters'::regclass
      and conname =
        'capa_case_number_counters_times'
      and contype = 'c'
  ),
  'counter has its timestamp-order constraint'
);

select has_trigger(
  'public',
  'capa_case_number_counters',
  'capa_case_number_counters_controlled_mutation',
  'counter has its controlled-mutation trigger'
);

select col_type_is(
  'public',
  'capa_case_number_counters',
  'organization_id',
  'uuid',
  'organization identity uses UUID'
);

select col_type_is(
  'public',
  'capa_case_number_counters',
  'last_allocated_number',
  'bigint',
  'last allocated number uses bigint'
);

select col_has_default(
  'public',
  'capa_case_number_counters',
  'created_at',
  'creation time has a database default'
);

select col_has_default(
  'public',
  'capa_case_number_counters',
  'updated_at',
  'update time has a database default'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_case_number_counters'::regclass
  ),
  'row-level security is enabled'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_case_number_counters'::regclass
  ),
  'row-level security is forced'
);

-- ---------------------------------------------------------------------------
-- Least-privilege controls
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_case_number_counters',
    'SELECT'
  ),
  'anonymous clients cannot read counters'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_case_number_counters',
    'INSERT'
  ),
  'anonymous clients cannot create counters'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_case_number_counters',
    'SELECT'
  ),
  'authenticated browser clients cannot read counters'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_case_number_counters',
    'UPDATE'
  ),
  'authenticated browser clients cannot update counters'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_case_number_counters',
    'SELECT'
  ),
  'service role can read counters'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_case_number_counters',
    'INSERT'
  ),
  'service role can initialize counters'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_case_number_counters',
    'UPDATE'
  ),
  'service role can advance counters'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_case_number_counters',
    'DELETE'
  ),
  'service role cannot delete counters'
);

-- ---------------------------------------------------------------------------
-- Controlled organization fixtures
-- ---------------------------------------------------------------------------

insert into public.capa_organizations (
  organization_id,
  organization_name,
  authorization_policy_version,
  created_by_actor_type,
  created_by_actor_id,
  updated_by_actor_type,
  updated_by_actor_id
)
values
  (
    '10000000-0000-4000-8000-000000000001',
    'Allocator Test Organization A',
    'test-policy-1.0.0',
    'system',
    'allocator-database-test',
    'system',
    'allocator-database-test'
  ),
  (
    '20000000-0000-4000-8000-000000000002',
    'Allocator Test Organization B',
    'test-policy-1.0.0',
    'system',
    'allocator-database-test',
    'system',
    'allocator-database-test'
  );

-- ---------------------------------------------------------------------------
-- Initialization and organization isolation
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.capa_case_number_counters (
      organization_id,
      last_allocated_number
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      1
    )
  $$,
  'an organization counter can begin at one'
);

select is(
  (
    select last_allocated_number
    from public.capa_case_number_counters
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  ),
  1::bigint,
  'the first organization begins at numeric value one'
);

select throws_ok(
  $$
    insert into public.capa_case_number_counters (
      organization_id,
      last_allocated_number
    )
    values (
      '20000000-0000-4000-8000-000000000002',
      2
    )
  $$,
  '55000',
  'A CAPA case-number counter must begin at one',
  'a new organization cannot begin above one'
);

select lives_ok(
  $$
    insert into public.capa_case_number_counters (
      organization_id,
      last_allocated_number
    )
    values (
      '20000000-0000-4000-8000-000000000002',
      1
    )
  $$,
  'a second organization can initialize independently'
);

select results_eq(
  $$
    select
      organization_id::text,
      last_allocated_number
    from public.capa_case_number_counters
    order by organization_id
  $$,
  $$
    values
      (
        '10000000-0000-4000-8000-000000000001'::text,
        1::bigint
      ),
      (
        '20000000-0000-4000-8000-000000000002'::text,
        1::bigint
      )
  $$,
  'each organization owns an independent sequence'
);

-- ---------------------------------------------------------------------------
-- Monotonic advancement and immutability
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    update public.capa_case_number_counters
    set
      last_allocated_number =
        last_allocated_number + 1,
      updated_at = statement_timestamp()
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  'a counter can advance by exactly one'
);

select is(
  (
    select last_allocated_number
    from public.capa_case_number_counters
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  ),
  2::bigint,
  'the successful increment is retained'
);

select throws_ok(
  $$
    update public.capa_case_number_counters
    set last_allocated_number = 2
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A CAPA case-number counter must advance by exactly one',
  'a counter cannot reuse its current number'
);

select throws_ok(
  $$
    update public.capa_case_number_counters
    set last_allocated_number = 4
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A CAPA case-number counter must advance by exactly one',
  'a counter cannot skip a number'
);

select throws_ok(
  $$
    update public.capa_case_number_counters
    set
      organization_id =
        '20000000-0000-4000-8000-000000000002',
      last_allocated_number = 3
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A CAPA case-number counter organization is immutable',
  'a counter cannot be reassigned to another organization'
);

select throws_ok(
  $$
    update public.capa_case_number_counters
    set
      last_allocated_number = 3,
      created_at =
        created_at + interval '1 second'
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A CAPA case-number counter creation time is immutable',
  'a counter creation timestamp cannot be rewritten'
);

select throws_ok(
  $$
    update public.capa_case_number_counters
    set
      last_allocated_number = 3,
      updated_at =
        updated_at - interval '1 second'
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A CAPA case-number counter update time cannot move backward',
  'a counter update timestamp cannot move backward'
);

select throws_ok(
  $$
    delete from public.capa_case_number_counters
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  $$,
  '55000',
  'A CAPA case-number counter cannot be deleted',
  'a counter cannot be deleted and recreated'
);

-- ---------------------------------------------------------------------------
-- Atomic upsert used by the production allocator
-- ---------------------------------------------------------------------------

select lives_ok(
  $$
    insert into public.capa_case_number_counters (
      organization_id,
      last_allocated_number
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      1
    )
    on conflict (organization_id)
    do update
    set
      last_allocated_number =
        public.capa_case_number_counters
          .last_allocated_number + 1,
      updated_at = statement_timestamp()
  $$,
  'the production upsert advances an existing counter atomically'
);

select is(
  (
    select last_allocated_number
    from public.capa_case_number_counters
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
  ),
  3::bigint,
  'the atomic upsert allocates the next organization-local number'
);

select * from finish();

rollback;