BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(32);

SELECT has_column('public', 'image_generation_attempts', 'execution_run_id', 'image quota attempts can be bound to a durable run');
SELECT has_column('public', 'image_generation_attempts', 'execution_step_id', 'image quota attempts are step-scoped');
SELECT has_column('public', 'image_generation_attempts', 'execution_key', 'image quota attempts are attempt-idempotent');
SELECT has_column('public', 'image_generation_attempts', 'execution_claim_id', 'image quota attempts retain their claim identity');
SELECT has_column('public', 'image_generation_attempts', 'execution_fencing_generation', 'image quota attempts retain fencing generation');
SELECT has_column('public', 'image_generation_attempts', 'generated_image_id', 'successful quota attempts bind their generated image');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.image_generation_attempts'::regclass
  AND conname = 'image_generation_attempts_execution_binding_check'), 'execution provenance columns are jointly constrained');
SELECT ok(to_regclass('public.image_generation_attempts_execution_key') IS NOT NULL, 'execution attempt identity has a partial unique index');

SELECT has_function('public', 'resolve_trusted_agent_execution_subject', ARRAY['uuid','text','uuid','uuid','bigint','boolean'], 'trusted subject resolution RPC exists');
SELECT has_function('public', 'reserve_trusted_image_generation_quota', ARRAY['uuid','text','uuid','uuid','bigint'], 'claim-bound image quota reservation exists');
SELECT has_function('public', 'start_trusted_image_generation_attempt', ARRAY['uuid','text','uuid','uuid','bigint','uuid','text','text'], 'claim-bound image attempt start exists');
SELECT has_function('public', 'release_trusted_image_generation_quota', ARRAY['uuid','text','uuid','uuid','bigint','uuid','text'], 'claim-bound image quota release exists');
SELECT has_function('public', 'complete_trusted_image_generation', ARRAY['uuid','text','uuid','uuid','bigint','uuid','text','text','text','text','text'], 'claim-bound image completion exists');
SELECT has_function('public', 'persist_trusted_generated_document_for_execution', ARRAY['uuid','text','uuid','uuid','bigint','uuid','text','text','text','text','bigint','text'], 'claim-bound document persistence exists');

SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
  WHERE oid = 'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)'::regprocedure), 'subject resolver is SECURITY DEFINER with empty search_path');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
  WHERE oid = 'public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint)'::regprocedure), 'quota RPC is SECURITY DEFINER with empty search_path');
SELECT ok((SELECT prosecdef AND proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc
  WHERE oid = 'public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)'::regprocedure), 'document RPC is SECURITY DEFINER with empty search_path');

SELECT ok(has_function_privilege('service_role', 'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.start_trusted_image_generation_attempt(uuid,text,uuid,uuid,bigint,uuid,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.release_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint,uuid,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.complete_trusted_image_generation(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)', 'EXECUTE'), 'service_role can invoke the narrow trusted RPCs');
SELECT ok(NOT has_function_privilege('anon', 'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)', 'EXECUTE'), 'client roles cannot invoke trusted subject or persistence RPCs');

SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.image_generation_attempts'::regclass), 'image attempt RLS remains enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.image_generation_attempts', 'INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('authenticated', 'public.image_generation_attempts', 'INSERT,UPDATE,DELETE'), 'clients still cannot directly mutate image quota attempts');
SELECT ok(NOT has_table_privilege('service_role', 'public.execution_run_work_state', 'SELECT,INSERT,UPDATE,DELETE')
  AND NOT has_table_privilege('service_role', 'public.execution_work_claim_history', 'SELECT,INSERT,UPDATE,DELETE'), 'trusted APIs do not widen coordination-table privileges');
SELECT ok(position('run.id = p_run_id' IN pg_catalog.pg_get_functiondef(
  'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)'::regprocedure)) > 0,
  'subject resolver locks the run before work state to match claim RPC lock order');

SELECT throws_ok($$SELECT public.resolve_trusted_agent_execution_subject(NULL, NULL, NULL, NULL, NULL, false)$$,
  '22023', 'INVALID_EXECUTION_SUBJECT', 'null caller identities are rejected');
SELECT throws_ok($$SELECT public.reserve_trusted_image_generation_quota(NULL, NULL, NULL, NULL, NULL)$$,
  '22023', 'INVALID_EXECUTION_SUBJECT', 'invalid quota identities fail closed');

SELECT ok(position('account.banned_until' IN pg_catalog.pg_get_functiondef(
  'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)'::regprocedure)) > 0,
  'database subject resolution rechecks current account disablement');
SELECT ok(position('request_options' IN pg_catalog.pg_get_functiondef(
  'public.resolve_trusted_agent_execution_subject(uuid,text,uuid,uuid,bigint,boolean)'::regprocedure)) > 0,
  'database subject resolution reads accepted reasoning selection');
SELECT ok(position('provider_started_at' IN pg_catalog.pg_get_functiondef(
  'public.release_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint,uuid,text)'::regprocedure)) > 0,
  'quota release is guarded against ambiguous provider dispatch');
SELECT ok(position('storage.objects' IN pg_catalog.pg_get_functiondef(
  'public.persist_trusted_generated_document_for_execution(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,bigint,text)'::regprocedure)) > 0,
  'document persistence verifies the private storage object exists');
SELECT ok(position('image_generation' IN pg_catalog.pg_get_functiondef(
  'public.reserve_trusted_image_generation_quota(uuid,text,uuid,uuid,bigint)'::regprocedure)) > 0,
  'image quota reservation is capability-bound');
SELECT ok(position('PROVIDER_COST_ADMISSION_REQUIRED' IN pg_catalog.pg_get_functiondef(
  'public.start_trusted_image_generation_attempt(uuid,text,uuid,uuid,bigint,uuid,text,text)'::regprocedure)) > 0,
  'provider attempt cannot start without matching durable cost admission');
SELECT ok(position('agent_provider_cost_admissions' IN pg_catalog.pg_get_functiondef(
  'public.complete_trusted_image_generation(uuid,text,uuid,uuid,bigint,uuid,text,text,text,text,text)'::regprocedure)) > 0,
  'image completion remains bound to provider cost dispatch evidence');

SELECT * FROM finish();
ROLLBACK;
