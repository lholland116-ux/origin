BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(24);

SELECT has_table('public', 'agent_execution_trigger_nonces', 'trigger replay nonce table exists');
SELECT has_table('public', 'agent_execution_trigger_gate', 'global invocation gate exists');
SELECT has_pk('public', 'agent_execution_trigger_nonces', 'nonce hashes are unique');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.agent_execution_trigger_nonces'::regclass), 'nonce RLS is enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.agent_execution_trigger_nonces'::regclass), 'nonce RLS is forced');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.agent_execution_trigger_gate'::regclass), 'global gate RLS is forced');
SELECT ok(NOT has_table_privilege('anon', 'public.agent_execution_trigger_nonces', 'SELECT,INSERT,UPDATE,DELETE'), 'anon cannot access nonce records');
SELECT ok(NOT has_table_privilege('authenticated', 'public.agent_execution_trigger_nonces', 'SELECT,INSERT,UPDATE,DELETE'), 'authenticated cannot access nonce records');
SELECT ok(NOT has_table_privilege('service_role', 'public.agent_execution_trigger_nonces', 'SELECT,INSERT,UPDATE,DELETE'), 'service role is restricted to nonce RPCs');
SELECT ok(has_function_privilege('service_role', 'public.consume_agent_execution_trigger_nonce(text)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.acquire_agent_execution_trigger_gate(uuid)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.renew_agent_execution_trigger_gate(uuid,bigint)', 'EXECUTE')
  AND has_function_privilege('service_role', 'public.release_agent_execution_trigger_gate(uuid,bigint)', 'EXECUTE'), 'service role can use trigger RPCs');
SELECT ok(NOT has_function_privilege('anon', 'public.consume_agent_execution_trigger_nonce(text)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.acquire_agent_execution_trigger_gate(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.renew_agent_execution_trigger_gate(uuid,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('anon', 'public.release_agent_execution_trigger_gate(uuid,bigint)', 'EXECUTE'), 'anon cannot use trigger RPCs');
SELECT ok(NOT has_function_privilege('authenticated', 'public.consume_agent_execution_trigger_nonce(text)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.acquire_agent_execution_trigger_gate(uuid)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.renew_agent_execution_trigger_gate(uuid,bigint)', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.release_agent_execution_trigger_gate(uuid,bigint)', 'EXECUTE'), 'authenticated users cannot use trigger RPCs');

-- Start from a deterministic state inside this test transaction. The singleton
-- is reset only here; pgTAP rolls the update back at the end of the file.
UPDATE public.agent_execution_trigger_gate
SET claim_id = NULL, fencing_generation = 0, lease_until = NULL
WHERE singleton;

SET LOCAL ROLE service_role;

SELECT is(public.consume_agent_execution_trigger_nonce(repeat('a', 64)), true, 'first signed nonce is consumed');
SELECT is(public.consume_agent_execution_trigger_nonce(repeat('a', 64)), false, 'duplicate nonce is rejected');
SELECT is((SELECT status FROM public.acquire_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000001')), 'acquired', 'first wake-up acquires global gate');
SELECT is(public.renew_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000001', 1), true, 'current claim can renew its live lease');
SELECT is((SELECT status FROM public.acquire_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000002')), 'busy', 'overlapping wake-up is refused');
SELECT is(public.release_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000002', 1), false, 'wrong claim cannot release gate');
SELECT is(public.release_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000001', 1), true, 'current claim releases gate');
SELECT is((SELECT fencing_generation FROM public.acquire_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000002') WHERE status = 'acquired'), 2::bigint, 'next claim advances fence');
SELECT is(public.release_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000001', 1), false, 'stale claim cannot release a newer gate');
SELECT is(public.renew_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000001', 1), false, 'stale claim cannot renew a newer gate');
RESET ROLE;
UPDATE public.agent_execution_trigger_gate SET lease_until = clock_timestamp() - interval '1 second' WHERE singleton;
SET LOCAL ROLE service_role;
SELECT is(public.renew_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000002', 2), false, 'expired claim cannot resurrect its lease');
SELECT is(public.release_agent_execution_trigger_gate('f4000000-0000-4000-8000-000000000002', 2), true, 'new claim releases its own gate');

SELECT * FROM finish();
ROLLBACK;
