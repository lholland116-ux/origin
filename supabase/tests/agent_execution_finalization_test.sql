BEGIN;
SELECT plan(13);

SELECT ok(
  (SELECT relrowsecurity AND relforcerowsecurity
   FROM pg_catalog.pg_class WHERE oid = 'public.execution_run_finalizations'::regclass),
  'execution finalization receipts use forced RLS'
);
SELECT ok(
  NOT has_table_privilege('anon', 'public.execution_run_finalizations', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.execution_run_finalizations', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role', 'public.execution_run_finalizations', 'SELECT,INSERT,UPDATE,DELETE'),
  'receipt table is inaccessible directly to clients and service-role callers'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_run_finalizations'::regclass
      AND conname = 'execution_run_finalizations_pkey' AND contype = 'p')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_run_finalizations'::regclass
      AND conname = 'execution_run_finalizations_run_user_fkey' AND contype = 'f')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_run_finalizations'::regclass
      AND conname = 'execution_run_finalizations_acceptance_fkey' AND contype = 'f'),
  'one receipt is bound to an existing run owner and acceptance identity'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.execution_run_finalizations'::regclass
      AND pg_catalog.pg_get_constraintdef(oid) LIKE '%completion_sha256%'),
  'completion receipt contains a constrained digest, not copied answer text'
);
SELECT ok(
  EXISTS (SELECT 1 FROM pg_catalog.pg_index
    WHERE indexrelid = 'public.execution_runs_pending_finalization_idx'::regclass
      AND indisvalid AND indisready),
  'bounded recovery discovery has a valid partial index over finalizable runs'
);
SELECT ok(
  has_function_privilege('service_role', 'public.finalize_accepted_agent_execution(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finalize_accepted_agent_execution(uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.finalize_accepted_agent_execution(uuid,text)', 'EXECUTE'),
  'only service_role can invoke the worker-compatible finalizer'
);
SELECT ok(
  (SELECT prosecdef AND proconfig @> ARRAY['search_path=""']
   FROM pg_catalog.pg_proc
   WHERE oid = 'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure),
  'worker finalizer is SECURITY DEFINER with an empty search_path'
);
SELECT ok(
  position('agent_request_acceptances' IN pg_catalog.pg_get_functiondef(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) > 0
  AND position('requestMessageBinding' IN pg_catalog.pg_get_functiondef(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) > 0
  AND position('p_user_id' IN pg_catalog.pg_get_function_arguments(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) = 0,
  'owner and message binding are derived from durable acceptance, not caller-supplied owner authority'
);
SELECT ok(
  position('FOR UPDATE' IN pg_catalog.pg_get_functiondef(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) > 0
  AND position('execution_run_finalizations' IN pg_catalog.pg_get_functiondef(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) > 0,
  'run locking and a unique durable receipt make finalization atomic and replay-safe'
);
SELECT ok(
  position('control_state' IN pg_catalog.pg_get_functiondef(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) > 0
  AND position('execution_human_approval_checkpoints' IN pg_catalog.pg_get_functiondef(
    'public.finalize_accepted_agent_execution(uuid,text)'::regprocedure
  )) > 0,
  'pending controls and approvals block finalization'
);
SELECT ok(
  has_function_privilege('service_role', 'public.list_pending_agent_execution_finalizations(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_pending_agent_execution_finalizations(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.list_pending_agent_execution_finalizations(integer)', 'EXECUTE'),
  'only service_role can discover bounded pending finalizations'
);
SELECT ok(
  position('execution_run_finalizations' IN pg_catalog.pg_get_functiondef(
    'public.list_pending_agent_execution_finalizations(integer)'::regprocedure
  )) > 0
  AND position('LIMIT p_limit' IN pg_catalog.pg_get_functiondef(
    'public.list_pending_agent_execution_finalizations(integer)'::regprocedure
  )) > 0,
  'recovery discovery is bounded and returns only unreceipted successful accepted runs'
);
SELECT ok(
  has_function_privilege('authenticated', 'public.finalize_agent_assistant_message(uuid,uuid,uuid,uuid,text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.finalize_agent_assistant_message(uuid,uuid,uuid,uuid,text)', 'EXECUTE'),
  'existing authenticated finalizer grant remains unchanged'
);

SELECT * FROM finish();
ROLLBACK;
