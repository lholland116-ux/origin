begin;

create extension if not exists pgtap
with schema extensions;

select plan(31);

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

select is(
  (
    select string_agg(
      attribute.attname,
      ','
      order by position.i
    )
    from pg_catalog.pg_constraint as constraint_record
    cross join lateral
      generate_subscripts(
        constraint_record.conkey,
        1
      ) as position(i)
    join pg_catalog.pg_attribute as attribute
      on attribute.attrelid =
        constraint_record.conrelid
      and attribute.attnum =
        constraint_record.conkey[position.i]
    where constraint_record.conrelid =
      'public.capa_ai_outputs'::regclass
      and constraint_record.conname =
        'capa_ai_outputs_generation_trace_unique'
  ),
  'organization_id,output_id,run_id,capa_case_id,case_version_id,record_version,request_id,correlation_id,status',
  'AI output generation-trace identity includes request and correlation provenance'
);

select is(
  (
    select string_agg(
      child_attribute.attname ||
      '->' ||
      parent_attribute.attname,
      ','
      order by position.i
    )
    from pg_catalog.pg_constraint as constraint_record
    cross join lateral
      generate_subscripts(
        constraint_record.conkey,
        1
      ) as position(i)
    join pg_catalog.pg_attribute as child_attribute
      on child_attribute.attrelid =
        constraint_record.conrelid
      and child_attribute.attnum =
        constraint_record.conkey[position.i]
    join pg_catalog.pg_attribute as parent_attribute
      on parent_attribute.attrelid =
        constraint_record.confrelid
      and parent_attribute.attnum =
        constraint_record.confkey[position.i]
    where constraint_record.conrelid =
      'public.capa_ai_generation_traces'::regclass
      and constraint_record.conname =
        'capa_ai_generation_traces_output_fk'
  ),
  'organization_id->organization_id,output_id->output_id,run_id->run_id,capa_case_id->capa_case_id,case_version_id->case_version_id,record_version->record_version,request_id->request_id,correlation_id->correlation_id,output_status->status',
  'generation trace FK binds exact output, run, snapshot, request and correlation identity'
);

-- ---------------------------------------------------------------------------
-- Mandatory future output-to-trace enforcement
-- ---------------------------------------------------------------------------

select ok(
  exists (
    select 1
    from pg_catalog.pg_trigger as trigger_record
    join pg_catalog.pg_proc as function_record
      on function_record.oid =
        trigger_record.tgfoid
    join pg_catalog.pg_namespace as namespace_record
      on namespace_record.oid =
        function_record.pronamespace
    where trigger_record.tgrelid =
      'public.capa_ai_outputs'::regclass
      and trigger_record.tgname =
        'capa_ai_outputs_require_generation_trace'
      and not trigger_record.tgisinternal
      and trigger_record.tgconstraint <> 0
      and trigger_record.tgdeferrable
      and trigger_record.tginitdeferred
      and (trigger_record.tgtype & 1) = 1
      and (trigger_record.tgtype & 2) = 0
      and (trigger_record.tgtype & 4) = 4
      and namespace_record.nspname = 'private'
      and function_record.proname =
        'capa_require_ai_generation_trace'
  ),
  'future AI outputs require a row-level deferred generation-trace constraint'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_proc as function_record
    join pg_catalog.pg_namespace as namespace_record
      on namespace_record.oid =
        function_record.pronamespace
    where namespace_record.nspname = 'private'
      and function_record.proname =
        'capa_require_ai_generation_trace'
      and function_record.pronargs = 0
      and function_record.prosecdef
      and function_record.prosrc like
        '%generation_trace.organization_id = new.organization_id%'
      and function_record.prosrc like
        '%generation_trace.output_id = new.output_id%'
      and function_record.prosrc like
        '%generation_trace.run_id = new.run_id%'
      and function_record.prosrc like
        '%generation_trace.capa_case_id = new.capa_case_id%'
      and function_record.prosrc like
        '%generation_trace.case_version_id = new.case_version_id%'
      and function_record.prosrc like
        '%generation_trace.record_version = new.record_version%'
      and function_record.prosrc like
        '%generation_trace.request_id = new.request_id%'
      and function_record.prosrc like
        '%generation_trace.correlation_id = new.correlation_id%'
      and function_record.prosrc like
        '%generation_trace.output_status = new.status%'
  ),
  'generation-trace enforcement checks the complete output provenance identity'
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
