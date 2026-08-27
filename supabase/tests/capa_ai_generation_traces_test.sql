begin;

create extension if not exists pgtap
with schema extensions;

select plan(27);

-- ---------------------------------------------------------------------------
-- Table shape
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'capa_ai_generation_traces',
  'governed AI generation-trace table exists'
);

select has_pk(
  'public',
  'capa_ai_generation_traces',
  'generation trace has a tenant-qualified primary key'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'organization_id',
  'uuid',
  'generation trace tenant identity uses UUID'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'run_id',
  'uuid',
  'generation run identity uses UUID'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'output_id',
  'uuid',
  'generation output identity uses UUID'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'prompt_package_id',
  'uuid',
  'controlled prompt-package identity uses UUID'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'prompt_package',
  'jsonb',
  'exact controlled prompt package uses JSONB'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'evidence_manifest',
  'jsonb',
  'generation evidence manifest uses JSONB'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'policy_manifest',
  'jsonb',
  'generation policy manifest uses JSONB'
);

select col_type_is(
  'public',
  'capa_ai_generation_traces',
  'assembled_at',
  'timestamp with time zone',
  'prompt assembly time is timezone aware'
);

select col_has_default(
  'public',
  'capa_ai_generation_traces',
  'created_at',
  'generation-trace persistence time has a database default'
);

-- ---------------------------------------------------------------------------
-- Immutability and least privilege
-- ---------------------------------------------------------------------------

select has_trigger(
  'public',
  'capa_ai_generation_traces',
  'capa_ai_generation_traces_reject_mutation',
  'generation traces have the immutable-record trigger'
);

select ok(
  (
    select relrowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_ai_generation_traces'::regclass
  ),
  'generation-trace row-level security is enabled'
);

select ok(
  (
    select relforcerowsecurity
    from pg_catalog.pg_class
    where oid =
      'public.capa_ai_generation_traces'::regclass
  ),
  'generation-trace row-level security is forced'
);

select ok(
  not has_table_privilege(
    'anon',
    'public.capa_ai_generation_traces',
    'SELECT'
  ),
  'anonymous clients cannot read generation traces'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_ai_generation_traces',
    'SELECT'
  ),
  'authenticated browser clients cannot read generation traces'
);

select ok(
  not has_table_privilege(
    'authenticated',
    'public.capa_ai_generation_traces',
    'INSERT'
  ),
  'authenticated browser clients cannot create generation traces'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_ai_generation_traces',
    'SELECT'
  ),
  'service role can resolve governed generation traces'
);

select ok(
  has_table_privilege(
    'service_role',
    'public.capa_ai_generation_traces',
    'INSERT'
  ),
  'service role can append governed generation traces'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_ai_generation_traces',
    'UPDATE'
  ),
  'service role cannot rewrite generation traces'
);

select ok(
  not has_table_privilege(
    'service_role',
    'public.capa_ai_generation_traces',
    'DELETE'
  ),
  'service role cannot delete generation traces'
);

-- ---------------------------------------------------------------------------
-- Exact output/run binding
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_generation_traces'::regclass
      and conname =
        'capa_ai_generation_traces_output_fk'
      and contype = 'f'
  ),
  'generation trace is foreign-key bound to the exact AI output and run'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_generation_traces'::regclass
      and conname =
        'capa_ai_generation_traces_output_unique'
      and contype = 'u'
  ),
  'one generation trace is allowed per tenant-qualified output'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_generation_traces'::regclass
      and conname =
        'capa_ai_generation_traces_prompt_package_unique'
      and contype = 'u'
  ),
  'prompt-package identity is unique within an organization'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_outputs'::regclass
      and conname =
        'capa_ai_outputs_generation_trace_unique'
      and contype = 'u'
  ),
  'AI outputs expose the exact composite generation-trace reference'
);

-- ---------------------------------------------------------------------------
-- Controlled trace/fingerprint contract
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_generation_traces'::regclass
      and conname =
        'capa_ai_generation_traces_trace_schema_version'
      and contype = 'c'
  ),
  'generation trace schema version is database constrained'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid =
      'public.capa_ai_generation_traces'::regclass
      and conname =
        'capa_ai_generation_traces_fingerprint_algorithm'
      and contype = 'c'
  ),
  'generation fingerprint algorithm is database constrained'
);

select * from finish();

rollback;
