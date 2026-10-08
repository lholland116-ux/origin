BEGIN;
SELECT plan(27);

SELECT has_table('public', 'agent_provider_cost_policies', 'immutable cost policy table exists');
SELECT has_table('public', 'agent_provider_cost_active_policy', 'single active policy pointer exists');
SELECT has_table('public', 'agent_provider_cost_prices', 'versioned provider price table exists');
SELECT has_table('public', 'agent_provider_cost_budget_locks', 'atomic budget-lock table exists');
SELECT has_table('public', 'agent_provider_cost_admissions', 'durable invocation ledger exists');

SELECT ok((
  SELECT pg_catalog.bool_and(class.relrowsecurity AND class.relforcerowsecurity)
  FROM pg_catalog.pg_class AS class
  JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = class.relnamespace
  WHERE namespace.nspname = 'public'
    AND class.relname IN (
      'agent_provider_cost_policies', 'agent_provider_cost_active_policy',
      'agent_provider_cost_prices', 'agent_provider_cost_budget_locks',
      'agent_provider_cost_admissions'
    )
), 'all cost ledger tables enable and force row-level security');

SELECT ok(
  NOT has_table_privilege('anon', 'public.agent_provider_cost_admissions', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.agent_provider_cost_admissions', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role', 'public.agent_provider_cost_admissions', 'INSERT,UPDATE,DELETE'),
  'clients cannot read or mutate admissions and service_role has read-only table access'
);
SELECT ok(
  has_table_privilege('service_role', 'public.agent_provider_cost_policies', 'SELECT')
  AND has_table_privilege('service_role', 'public.agent_provider_cost_prices', 'SELECT')
  AND has_table_privilege('service_role', 'public.agent_provider_cost_admissions', 'SELECT'),
  'service_role can inspect policy, prices, and durable admissions'
);

SELECT ok(
  has_function_privilege('service_role', 'public.admit_agent_provider_cost(uuid,text,uuid,smallint,smallint,text,text,text,integer,integer,smallint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.admit_agent_provider_cost(uuid,text,uuid,smallint,smallint,text,text,text,integer,integer,smallint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.admit_agent_provider_cost(uuid,text,uuid,smallint,smallint,text,text,text,integer,integer,smallint)', 'EXECUTE'),
  'only service_role can admit provider expenditure'
);
SELECT ok(
  has_function_privilege('service_role', 'public.begin_agent_provider_cost_dispatch(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.begin_agent_provider_cost_dispatch(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.begin_agent_provider_cost_dispatch(uuid)', 'EXECUTE'),
  'only service_role can cross the durable dispatch boundary'
);
SELECT ok(
  has_function_privilege('service_role', 'public.settle_agent_provider_cost(uuid,text,text,integer,integer,integer,integer,smallint,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.settle_agent_provider_cost(uuid,text,text,integer,integer,integer,integer,smallint,text,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.settle_agent_provider_cost(uuid,text,text,integer,integer,integer,integer,smallint,text,text)', 'EXECUTE'),
  'only service_role can settle provider expenditure'
);

SELECT ok((
  SELECT policy.allowed_capabilities = ARRAY['standard', 'file_analysis', 'document_generation', 'image_generation']::text[]
    AND policy.max_run_nano_usd = 250000000
    AND policy.max_user_day_nano_usd = 500000000
    AND policy.max_global_day_nano_usd = 3000000000
    AND policy.max_input_tokens = 16000
    AND policy.max_output_tokens = 4096
    AND policy.max_openai_invocations = 2
    AND policy.max_images = 1
  FROM public.agent_provider_cost_active_policy AS active
  JOIN public.agent_provider_cost_policies AS policy ON policy.version = active.policy_version
  WHERE active.singleton
), 'active policy matches the human-approved four-capability bounds');

SELECT ok((
  SELECT pg_catalog.count(*) = 1
    AND pg_catalog.min(input_nano_usd_per_token) = 100
    AND pg_catalog.min(cached_input_nano_usd_per_token) = 10
    AND pg_catalog.min(cache_write_nano_usd_per_token) = 125
    AND pg_catalog.min(output_nano_usd_per_token) = 500
  FROM public.agent_provider_cost_prices
  WHERE provider = 'openai' AND model = 'gpt-6-luna'
    AND version = 'openai-gpt-6-luna-2026-10-03'
), 'the OpenAI price schedule is versioned with separate input, cache, and output rates');
SELECT ok((
  SELECT pg_catalog.count(*) = 1 AND pg_catalog.min(image_nano_usd_per_output) = 3000000
  FROM public.agent_provider_cost_prices
  WHERE provider = 'replicate' AND model = 'flux-schnell'
    AND version = 'replicate-flux-schnell-2026-10-08'
), 'the Replicate image schedule records one fixed output price');

SELECT has_index('public', 'agent_provider_cost_admissions', 'agent_provider_cost_admission_identity', 'invocation identity is unique');
SELECT has_index('public', 'agent_provider_cost_admissions', 'agent_provider_cost_admissions_provider_operation_idx', 'provider operation identity is unique');
SELECT has_index('public', 'agent_provider_cost_budget_locks', 'agent_provider_cost_budget_locks_pkey', 'budget lock scopes are unique');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.agent_provider_cost_admissions'::regclass
    AND conname = 'agent_provider_cost_admission_settlement_check'
), 'admission status and settlement evidence are constrained');
SELECT ok(EXISTS (
  SELECT 1 FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.agent_provider_cost_admissions'::regclass
    AND conname = 'agent_provider_cost_admission_shape_check'
), 'capability, provider, and bounded request shape are constrained');

SELECT ok(position('FOR UPDATE' IN pg_catalog.pg_get_functiondef(
  'public.admit_agent_provider_cost(uuid,text,uuid,smallint,smallint,text,text,text,integer,integer,smallint)'::regprocedure
)) > 0, 'admission uses transaction-scoped PostgreSQL locks');
SELECT ok(position('control_state' IN pg_catalog.pg_get_functiondef(
  'public.begin_agent_provider_cost_dispatch(uuid)'::regprocedure
)) > 0, 'dispatch boundary rechecks persisted human control state');
SELECT ok(position('accepted_request_id' IN pg_catalog.pg_get_functiondef(
  'public.admit_agent_provider_cost(uuid,text,uuid,smallint,smallint,text,text,text,integer,integer,smallint)'::regprocedure
)) > 0, 'admission remains bound to an accepted request identity');
SELECT ok(position('provider_cost_overrun' IN pg_catalog.pg_get_functiondef(
  'public.settle_agent_provider_cost(uuid,text,text,integer,integer,integer,integer,smallint,text,text)'::regprocedure
)) > 0, 'settlement records observed cost over reservation without clamping');
SELECT ok(position('immutable' IN pg_catalog.pg_get_functiondef(
  'public.reject_agent_provider_cost_policy_mutation()'::regprocedure
)) > 0, 'price and policy versions cannot be rewritten');
SELECT ok(NOT has_table_privilege('anon', 'public.agent_provider_cost_budget_locks', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.agent_provider_cost_budget_locks', 'SELECT,INSERT,UPDATE,DELETE'),
  'budget lock state is inaccessible to client roles');
SELECT ok(
  pg_catalog.pg_get_constraintdef((SELECT oid FROM pg_catalog.pg_constraint WHERE conname = 'agent_provider_cost_admission_identity'))
    LIKE '%UNIQUE (run_id, step_id, attempt_id, invocation_sequence)%',
  'an attempt and invocation sequence cannot be admitted twice'
);
SELECT ok(
  (SELECT relkind = 'r' FROM pg_catalog.pg_class WHERE oid = 'public.agent_provider_cost_admissions'::regclass),
  'provider cost evidence is stored in durable PostgreSQL rows'
);

SELECT * FROM finish();
ROLLBACK;
