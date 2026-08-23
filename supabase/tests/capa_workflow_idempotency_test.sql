begin;

create extension if not exists pgtap;

select plan(42);

-- ---------------------------------------------------------------------------
-- Schema and integrity controls
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'capa_workflow_idempotency',
  'CAPA workflow-idempotency ledger exists'
);

select has_pk(
  'public',
  'capa_workflow_idempotency',
  'workflow-idempotency ledger has a primary key'
);

select col_type_is(
  'public',
  'capa_workflow_idempotency',
  'organization_id',
  'uuid',
  'organization identity uses UUID'
);

select col_type_is(
  'public',
  'capa_workflow_idempotency',
  'idempotency_key',
  'text',
  'idempotency key uses text'
);

select col_type_is(
  'public',
  'capa_workflow_idempotency',
  'operation_code',
  'text',
  'operation code uses text'
);

select col_type_is(
  'public',
  'capa_workflow_idempotency',
  'request_fingerprint',
  'text',
  'request fingerprint uses text'
);

select col_type_is(
  'public',
  'capa_workflow_idempotency',
  'source_case_version_id',
  'uuid',
  'source case-version identity uses UUID'
);

select col_type_is(
  'public',
  'capa_workflow_idempotency',
  'resulting_case_version_id',
  'uuid',
  'resulting case-version identity uses UUID'
);

select col_has_default(
  'public',
  'capa_workflow_idempotency',
  'created_at',
  'ledger creation time has a database default'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_workflow_idempotency'::regclass
      and conname =
        'capa_workflow_idempotency_key_format'
      and contype = 'c'
  ),
  'ledger has its idempotency-key format constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_workflow_idempotency'::regclass
      and conname =
        'capa_workflow_idempotency_operation_format'
      and contype = 'c'
  ),
  'ledger has its controlled operation-code constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_workflow_idempotency'::regclass
      and conname =
        'capa_workflow_idempotency_fingerprint_format'
      and contype = 'c'
  ),
  'ledger has its SHA-256 fingerprint constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_workflow_idempotency'::regclass
      and conname =
        'capa_workflow_idempotency_distinct_versions'
      and contype = 'c'
  ),
  'ledger requires distinct source and resulting versions'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_workflow_idempotency'::regclass
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  5,
  'all five workflow-ledger foreign keys are initially deferred'
);

select has_trigger(
  'public',
  'capa_workflow_idempotency',
  'capa_workflow_idempotency_reject_mutation',
  'ledger has its immutable-record trigger'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_workflow_idempotency'::regclass
  ),
  'row-level security is enabled'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_workflow_idempotency'::regclass
  ),
  'row-level security is forced'
);

-- ---------------------------------------------------------------------------
-- Least-privilege controls
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_workflow_idempotency',
    'SELECT'
  ),
  'anonymous clients cannot read the ledger'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_workflow_idempotency',
    'INSERT'
  ),
  'anonymous clients cannot claim workflow keys'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_workflow_idempotency',
    'SELECT'
  ),
  'authenticated browser clients cannot read the ledger'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_workflow_idempotency',
    'INSERT'
  ),
  'authenticated browser clients cannot claim workflow keys directly'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_workflow_idempotency',
    'SELECT'
  ),
  'service role can resolve prior workflow claims'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_workflow_idempotency',
    'INSERT'
  ),
  'service role can claim workflow keys'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_workflow_idempotency',
    'UPDATE'
  ),
  'service role cannot rewrite workflow claims'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_workflow_idempotency',
    'DELETE'
  ),
  'service role cannot delete workflow claims'
);

-- ---------------------------------------------------------------------------
-- Controlled ledger behavior
-- ---------------------------------------------------------------------------
--
-- Foreign keys are intentionally deferred. These rows model the production
-- reservation-first transaction, and the outer test transaction rolls back
-- before deferred references are checked at commit.

select lives_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id,
      idempotency_key,
      operation_code,
      request_fingerprint,
      capa_case_id,
      source_case_version_id,
      resulting_case_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-1',
      'SUBMIT_CAPA_INTAKE',
      repeat('a', 64),
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005'
    )
  $$,
  'a valid workflow key can be reserved before transition writes'
);

select is(
  (
    select count(*)::integer
    from public.capa_workflow_idempotency
  ),
  1,
  'one workflow claim is retained'
);

select lives_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id,
      idempotency_key,
      operation_code,
      request_fingerprint,
      capa_case_id,
      source_case_version_id,
      resulting_case_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-1',
      'SUBMIT_CAPA_INTAKE',
      repeat('a', 64),
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005'
    )
    on conflict (organization_id, idempotency_key)
    do nothing
  $$,
  'an exact production-style workflow retry does not fail'
);

select is(
  (
    select count(*)::integer
    from public.capa_workflow_idempotency
  ),
  1,
  'an exact retry does not create another workflow claim'
);

select is(
  (
    select operation_code
    from public.capa_workflow_idempotency
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'workflow-request-1'
  ),
  'SUBMIT_CAPA_INTAKE',
  'the original operation remains authoritative'
);

select is(
  (
    select request_fingerprint
    from public.capa_workflow_idempotency
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'workflow-request-1'
  ),
  repeat('a', 64),
  'the original fingerprint remains authoritative'
);

select is(
  (
    select source_case_version_id::text || ':' ||
      resulting_case_version_id::text
    from public.capa_workflow_idempotency
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'workflow-request-1'
  ),
  '30000000-0000-4000-8000-000000000003:' ||
    '40000000-0000-4000-8000-000000000004',
  'the source and resulting version identities remain authoritative'
);

select throws_ok(
  $$
    update public.capa_workflow_idempotency
    set request_fingerprint = repeat('b', 64)
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'workflow-request-1'
  $$,
  '55000',
  'capa_workflow_idempotency is append-only and cannot be updated or deleted',
  'a workflow claim cannot be rewritten'
);

select throws_ok(
  $$
    delete from public.capa_workflow_idempotency
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'workflow-request-1'
  $$,
  '55000',
  'capa_workflow_idempotency is append-only and cannot be updated or deleted',
  'a workflow claim cannot be deleted'
);

select throws_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      ' workflow-request-2 ', 'SUBMIT_CAPA_INTAKE', repeat('b', 64),
      '20000000-0000-4000-8000-000000000012',
      '30000000-0000-4000-8000-000000000013',
      '40000000-0000-4000-8000-000000000014',
      '50000000-0000-4000-8000-000000000015'
    )
  $$,
  '23514',
  null,
  'an idempotency key with surrounding whitespace is rejected'
);

select throws_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-2', 'INVALID OPERATION', repeat('b', 64),
      '20000000-0000-4000-8000-000000000012',
      '30000000-0000-4000-8000-000000000013',
      '40000000-0000-4000-8000-000000000014',
      '50000000-0000-4000-8000-000000000015'
    )
  $$,
  '23514',
  null,
  'an uncontrolled operation code is rejected'
);

select throws_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-2', repeat('A', 65), repeat('b', 64),
      '20000000-0000-4000-8000-000000000012',
      '30000000-0000-4000-8000-000000000013',
      '40000000-0000-4000-8000-000000000014',
      '50000000-0000-4000-8000-000000000015'
    )
  $$,
  '23514',
  null,
  'an operation code above the controlled maximum is rejected'
);

select throws_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-2', 'SUBMIT_CAPA_INTAKE', repeat('A', 64),
      '20000000-0000-4000-8000-000000000012',
      '30000000-0000-4000-8000-000000000013',
      '40000000-0000-4000-8000-000000000014',
      '50000000-0000-4000-8000-000000000015'
    )
  $$,
  '23514',
  null,
  'a noncanonical fingerprint is rejected'
);

select throws_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-2', 'SUBMIT_CAPA_INTAKE', repeat('b', 64),
      '20000000-0000-4000-8000-000000000012',
      '30000000-0000-4000-8000-000000000013',
      '30000000-0000-4000-8000-000000000013',
      '50000000-0000-4000-8000-000000000015'
    )
  $$,
  '23514',
  null,
  'source and resulting versions must be distinct'
);

select throws_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '10000000-0000-4000-8000-000000000001',
      'workflow-request-1', 'OTHER_OPERATION', repeat('c', 64),
      '20000000-0000-4000-8000-000000000022',
      '30000000-0000-4000-8000-000000000023',
      '40000000-0000-4000-8000-000000000024',
      '50000000-0000-4000-8000-000000000025'
    )
  $$,
  '23505',
  null,
  'the same organization cannot claim one workflow key twice directly'
);

select lives_ok(
  $$
    insert into public.capa_workflow_idempotency (
      organization_id, idempotency_key, operation_code,
      request_fingerprint, capa_case_id, source_case_version_id,
      resulting_case_version_id, audit_event_id
    ) values (
      '60000000-0000-4000-8000-000000000006',
      'workflow-request-1', 'SUBMIT_CAPA_INTAKE', repeat('d', 64),
      '70000000-0000-4000-8000-000000000007',
      '80000000-0000-4000-8000-000000000008',
      '90000000-0000-4000-8000-000000000009',
      'a0000000-0000-4000-8000-000000000010'
    )
  $$,
  'a different organization can use the same opaque workflow key'
);

select is(
  (
    select count(*)::integer
    from public.capa_workflow_idempotency
    where idempotency_key =
      'workflow-request-1'
  ),
  2,
  'workflow idempotency keys are isolated by organization'
);

select * from finish();

rollback;
