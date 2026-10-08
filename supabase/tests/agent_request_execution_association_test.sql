BEGIN;
SELECT plan(12);

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.execution_runs'::regclass),
  'execution run RLS remains enabled and forced'
);
SELECT ok(
  EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'execution_runs'
      AND column_name = 'accepted_request_id')
  AND EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'execution_runs'
      AND column_name = 'acceptance_fingerprint'),
  'accepted request and acceptance fingerprint are stored separately from the plan fingerprint'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_runs'::regclass
      AND conname = 'execution_runs_accepted_request_unique' AND contype = 'u'),
  'one accepted request can be associated with at most one run'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_runs'::regclass
      AND conname = 'execution_runs_accepted_request_owner_fkey' AND contype = 'f'),
  'accepted run ownership is constrained by the acceptance ledger owner'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_runs'::regclass
      AND conname = 'execution_runs_acceptance_identity_pair_check' AND contype = 'c'),
  'acceptance identity columns must be jointly null or valid'
);
SELECT ok(
  has_function_privilege('service_role', 'public.associate_agent_request_execution_run(jsonb,jsonb)', 'EXECUTE'),
  'service role can call the association function'
);
SELECT ok(
  NOT has_function_privilege('anon', 'public.associate_agent_request_execution_run(jsonb,jsonb)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.associate_agent_request_execution_run(jsonb,jsonb)', 'EXECUTE'),
  'client roles cannot call the association function'
);
SELECT ok(
  (SELECT prosecdef FROM pg_catalog.pg_proc
    WHERE oid = 'public.associate_agent_request_execution_run(jsonb,jsonb)'::regprocedure),
  'association function uses its narrowly privileged definer context'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.execution_runs', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.execution_runs', 'INSERT,UPDATE,DELETE'),
  'clients cannot directly mutate execution runs'
);
SELECT ok(
  NOT has_table_privilege('authenticated', 'public.execution_steps', 'INSERT,UPDATE,DELETE'),
  'clients cannot directly mutate execution steps'
);
SELECT ok(
  has_table_privilege('service_role', 'public.execution_runs', 'INSERT,UPDATE,DELETE')
  AND has_table_privilege('service_role', 'public.execution_steps', 'INSERT,UPDATE,DELETE'),
  'existing service-role execution-store privileges remain available'
);
SELECT ok(
  position('accepted_request_id' IN pg_catalog.pg_get_functiondef(
    'public.prevent_execution_run_plan_mutation()'::regprocedure
  )) > 0
  AND position('acceptance_fingerprint' IN pg_catalog.pg_get_functiondef(
    'public.prevent_execution_run_plan_mutation()'::regprocedure
  )) > 0,
  'accepted request identity is covered by the existing immutable run trigger'
);

SELECT * FROM finish();
ROLLBACK;
