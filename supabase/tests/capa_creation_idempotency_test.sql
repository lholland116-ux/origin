begin;

create extension if not exists pgtap;

select plan(33);

-- ---------------------------------------------------------------------------
-- Schema and integrity controls
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'capa_creation_idempotency',
  'CAPA creation-idempotency ledger exists'
);

select has_pk(
  'public',
  'capa_creation_idempotency',
  'creation-idempotency ledger has a primary key'
);

select col_type_is(
  'public',
  'capa_creation_idempotency',
  'organization_id',
  'uuid',
  'organization identity uses UUID'
);

select col_type_is(
  'public',
  'capa_creation_idempotency',
  'idempotency_key',
  'text',
  'idempotency key uses text'
);

select col_type_is(
  'public',
  'capa_creation_idempotency',
  'request_fingerprint',
  'text',
  'request fingerprint uses text'
);

select col_has_default(
  'public',
  'capa_creation_idempotency',
  'created_at',
  'ledger creation time has a database default'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_creation_idempotency'::regclass
      and conname =
        'capa_creation_idempotency_key_format'
      and contype = 'c'
  ),
  'ledger has its idempotency-key format constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_creation_idempotency'::regclass
      and conname =
        'capa_creation_idempotency_fingerprint_format'
      and contype = 'c'
  ),
  'ledger has its SHA-256 fingerprint constraint'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_creation_idempotency'::regclass
      and contype = 'f'
      and condeferrable
      and condeferred
  ),
  5,
  'all five ledger foreign keys are initially deferred'
);

select has_trigger(
  'public',
  'capa_creation_idempotency',
  'capa_creation_idempotency_reject_mutation',
  'ledger has its immutable-record trigger'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_creation_idempotency'::regclass
  ),
  'row-level security is enabled'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_creation_idempotency'::regclass
  ),
  'row-level security is forced'
);

-- ---------------------------------------------------------------------------
-- Least-privilege controls
-- ---------------------------------------------------------------------------

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_creation_idempotency',
    'SELECT'
  ),
  'anonymous clients cannot read the ledger'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_creation_idempotency',
    'INSERT'
  ),
  'anonymous clients cannot claim keys'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_creation_idempotency',
    'SELECT'
  ),
  'authenticated browser clients cannot read the ledger'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_creation_idempotency',
    'INSERT'
  ),
  'authenticated browser clients cannot claim keys directly'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_creation_idempotency',
    'SELECT'
  ),
  'service role can resolve prior claims'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_creation_idempotency',
    'INSERT'
  ),
  'service role can claim creation keys'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_creation_idempotency',
    'UPDATE'
  ),
  'service role cannot rewrite claims'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_creation_idempotency',
    'DELETE'
  ),
  'service role cannot delete claims'
);

-- ---------------------------------------------------------------------------
-- Controlled ledger behavior
-- ---------------------------------------------------------------------------
--
-- The foreign keys are intentionally deferred, allowing these rows to model
-- the reservation-first production transaction. This test transaction is
-- rolled back before deferred references are checked at commit.

select lives_ok(
  $$
    insert into public.capa_creation_idempotency (
      organization_id,
      idempotency_key,
      request_fingerprint,
      capa_case_id,
      case_version_id,
      section_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'creation-request-1',
      repeat('a', 64),
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005'
    )
  $$,
  'a valid creation key can be claimed before aggregate insertion'
);

select is(
  (
    select count(*)::integer
    from public.capa_creation_idempotency
  ),
  1,
  'one creation claim is retained'
);

select lives_ok(
  $$
    insert into public.capa_creation_idempotency (
      organization_id,
      idempotency_key,
      request_fingerprint,
      capa_case_id,
      case_version_id,
      section_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'creation-request-1',
      repeat('a', 64),
      '20000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000004',
      '50000000-0000-4000-8000-000000000005'
    )
    on conflict (organization_id, idempotency_key)
    do nothing
  $$,
  'an exact production-style retry does not fail'
);

select is(
  (
    select count(*)::integer
    from public.capa_creation_idempotency
  ),
  1,
  'an exact retry does not create another claim'
);

select is(
  (
    select request_fingerprint
    from public.capa_creation_idempotency
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'creation-request-1'
  ),
  repeat('a', 64),
  'the original fingerprint remains authoritative'
);

select throws_ok(
  $$
    update public.capa_creation_idempotency
    set request_fingerprint = repeat('b', 64)
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'creation-request-1'
  $$,
  '55000',
  'capa_creation_idempotency is append-only and cannot be updated or deleted',
  'a creation claim cannot be rewritten'
);

select throws_ok(
  $$
    delete from public.capa_creation_idempotency
    where organization_id =
      '10000000-0000-4000-8000-000000000001'
      and idempotency_key =
        'creation-request-1'
  $$,
  '55000',
  'capa_creation_idempotency is append-only and cannot be updated or deleted',
  'a creation claim cannot be deleted'
);

select throws_ok(
  $$
    insert into public.capa_creation_idempotency (
      organization_id,
      idempotency_key,
      request_fingerprint,
      capa_case_id,
      case_version_id,
      section_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      ' creation-request-2 ',
      repeat('b', 64),
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
    insert into public.capa_creation_idempotency (
      organization_id,
      idempotency_key,
      request_fingerprint,
      capa_case_id,
      case_version_id,
      section_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'creation-request-2',
      repeat('A', 64),
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
    insert into public.capa_creation_idempotency (
      organization_id,
      idempotency_key,
      request_fingerprint,
      capa_case_id,
      case_version_id,
      section_version_id,
      audit_event_id
    )
    values (
      '10000000-0000-4000-8000-000000000001',
      'creation-request-1',
      repeat('c', 64),
      '20000000-0000-4000-8000-000000000022',
      '30000000-0000-4000-8000-000000000023',
      '40000000-0000-4000-8000-000000000024',
      '50000000-0000-4000-8000-000000000025'
    )
  $$,
  '23505',
  null,
  'the same organization cannot claim one key twice directly'
);

select lives_ok(
  $$
    insert into public.capa_creation_idempotency (
      organization_id,
      idempotency_key,
      request_fingerprint,
      capa_case_id,
      case_version_id,
      section_version_id,
      audit_event_id
    )
    values (
      '60000000-0000-4000-8000-000000000006',
      'creation-request-1',
      repeat('d', 64),
      '70000000-0000-4000-8000-000000000007',
      '80000000-0000-4000-8000-000000000008',
      '90000000-0000-4000-8000-000000000009',
      'a0000000-0000-4000-8000-000000000010'
    )
  $$,
  'a different organization can use the same opaque key'
);

select is(
  (
    select count(*)::integer
    from public.capa_creation_idempotency
    where idempotency_key =
      'creation-request-1'
  ),
  2,
  'idempotency keys are isolated by organization'
);

select is(
  (
    select count(*)::integer
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_audit_events'::regclass
      and conname =
        'capa_audit_events_org_event_unique'
      and contype = 'u'
  ),
  1,
  'audit events expose an organization-qualified unique key'
);

select * from finish();

rollback;