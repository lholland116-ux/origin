BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(19);

SELECT has_table('public', 'execution_run_work_state', 'coordination state is separated from owner-readable execution rows');
SELECT has_column('public', 'execution_run_work_state', 'claim_id', 'claim identity is stored privately');
SELECT col_type_is('public', 'execution_run_work_state', 'lease_until', 'timestamp with time zone', 'leases use database timestamps');
SELECT col_type_is('public', 'execution_run_work_state', 'fencing_generation', 'bigint', 'fencing generation is monotonic-sized');
SELECT has_table('public', 'execution_work_claim_history', 'claim identities remain unique across retries and restarts');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_work_claim_history'::regclass AND conname = 'execution_work_claim_generation_key'), 'claim generations are unique per run');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_run_work_state'::regclass AND conname = 'execution_run_work_state_run_user_fkey'), 'coordination state is bound to run ownership');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_run_work_state'::regclass), 'coordination state RLS is enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_run_work_state'::regclass), 'coordination state RLS is forced');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_work_claim_history'::regclass), 'claim history RLS is forced');
SELECT ok(NOT has_table_privilege('anon', 'public.execution_run_work_state', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.execution_run_work_state', 'SELECT,INSERT,UPDATE,DELETE'), 'clients cannot read or mutate lease tokens');
SELECT ok(NOT has_table_privilege('service_role', 'public.execution_run_work_state', 'SELECT,INSERT,UPDATE,DELETE'), 'service operations use narrow RPCs rather than table access');
SELECT ok(NOT EXISTS (SELECT 1 FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'execution_runs' AND column_name = 'execution_work_claim_id'), 'claim token is not exposed on the owner-readable run row');
SELECT ok(to_regclass('public.execution_run_work_state_due_idx') IS NOT NULL
  AND to_regclass('public.execution_steps_work_retry_due_idx') IS NOT NULL, 'due-work and retry selection are indexed');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.execution_runs'::regclass AND tgname = 'execution_runs_create_work_state'), 'new runs receive coordination state transactionally');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.agent_provider_cost_admissions'::regclass AND tgname = 'agent_provider_cost_admission_work_claim_guard')
  AND EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.agent_provider_cost_admissions'::regclass AND tgname = 'agent_provider_cost_dispatch_work_claim_guard'), 'provider admissions and dispatch are fenced by active leases');
SELECT ok(has_function_privilege('service_role', 'public.discover_agent_execution_work(integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.claim_agent_execution_work(uuid,uuid,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.renew_agent_execution_work_claim(uuid,uuid,bigint,integer)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.release_agent_execution_work_claim(uuid,uuid,bigint,bigint)', 'EXECUTE'), 'service role can use scoped coordination RPCs');
SELECT ok(NOT has_function_privilege('anon', 'public.discover_agent_execution_work(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.discover_agent_execution_work(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.claim_agent_execution_work(uuid,uuid,integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.claim_agent_execution_work(uuid,uuid,integer)', 'EXECUTE'), 'anonymous and authenticated roles cannot discover or claim work');
SELECT ok(has_function_privilege('service_role', 'public.list_orphaned_agent_request_acceptances(integer)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.list_orphaned_agent_request_acceptances(integer)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.list_orphaned_agent_request_acceptances(integer)', 'EXECUTE'), 'orphan classification is service-only and non-replaying');

SELECT * FROM finish();
ROLLBACK;
