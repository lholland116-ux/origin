BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(28);

SELECT has_table('public', 'execution_runs', 'execution run table exists');
SELECT has_table('public', 'execution_steps', 'execution step table exists');
SELECT has_pk('public', 'execution_runs', 'execution runs have a primary key');
SELECT has_pk('public', 'execution_steps', 'run and step identity is unique');
SELECT col_type_is('public', 'execution_runs', 'user_id', 'uuid', 'runs have an owner');
SELECT col_type_is('public', 'execution_runs', 'snapshot_revision', 'bigint', 'snapshot revisions are monotonic integers');
SELECT col_type_is('public', 'execution_steps', 'execution_key', 'uuid', 'each step has a durable execution key');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_runs'::regclass), 'run RLS is enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_runs'::regclass), 'run RLS is forced');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_steps'::regclass), 'step RLS is enabled');
SELECT ok(NOT has_table_privilege('anon', 'public.execution_runs', 'SELECT'), 'anon cannot read runs');
SELECT ok(NOT has_table_privilege('authenticated', 'public.execution_runs', 'INSERT,UPDATE,DELETE'), 'authenticated users cannot mutate runs directly');
SELECT ok(NOT has_table_privilege('authenticated', 'public.execution_steps', 'INSERT,UPDATE,DELETE'), 'authenticated users cannot mutate steps directly');
SELECT ok(has_table_privilege('service_role', 'public.execution_runs', 'INSERT,UPDATE,DELETE') AND has_table_privilege('service_role', 'public.execution_steps', 'INSERT,UPDATE,DELETE'), 'service role can persist execution state');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_runs'::regclass AND conname = 'execution_runs_user_idempotency_key'), 'run idempotency is unique per owner');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_steps'::regclass AND conname = 'execution_steps_pkey'), 'step identity is unique per run');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_steps'::regclass AND conname = 'execution_steps_result_size_check'), 'result envelopes have a byte limit');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_trigger WHERE tgrelid = 'public.execution_runs'::regclass AND tgname = 'execution_runs_plan_immutable' AND NOT tgisinternal), 'validated plan identity is immutable');
SELECT ok(NOT has_table_privilege('authenticated', 'public.execution_steps', 'UPDATE'), 'clients cannot claim or mutate steps directly');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.execution_runs'::regclass AND polname = 'execution_runs_select_own'), 'run reads are owner-scoped by RLS');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_policy WHERE polrelid = 'public.execution_steps'::regclass AND polname = 'execution_steps_select_own'), 'step reads are owner-scoped by RLS');

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('f2000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'execution-owner@example.test'),
  ('f2000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'execution-other@example.test');

INSERT INTO public.execution_runs (
  id, user_id, handoff_version, idempotency_key, request_fingerprint,
  execution_plan, snapshot, status
) VALUES (
  'f3000000-0000-4000-8000-000000000001',
  'f2000000-0000-4000-8000-000000000001',
  1, 'test-run-1', repeat('a', 64),
  '{"version":1,"steps":[{"id":"step-1","capability":"standard","dependsOn":[]}],"orderedStepIds":["step-1"]}'::jsonb,
  '{"version":1,"runtimeVersion":1,"snapshot":{"run":{"status":"active","value":"pending","context":{},"children":{}},"steps":{"step-1":{"status":"active","value":"pending","context":{},"children":{}}}}}'::jsonb,
  'pending'
);

INSERT INTO public.execution_steps (run_id, user_id, step_id, capability_id)
VALUES ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'step-1', 'standard');

SELECT throws_ok($$INSERT INTO public.execution_runs (
  user_id, handoff_version, idempotency_key, request_fingerprint, execution_plan, snapshot
) VALUES (
  'f2000000-0000-4000-8000-000000000001', 1, 'test-run-1', repeat('a', 64),
  '{"version":1,"steps":[],"orderedStepIds":[]}'::jsonb,
  '{"version":1,"runtimeVersion":1,"snapshot":{}}'::jsonb
)$$, '23505', NULL, 'duplicate owner/idempotency key is rejected');

SELECT throws_ok($$INSERT INTO public.execution_steps (run_id, user_id, step_id, capability_id)
  VALUES ('f3000000-0000-4000-8000-000000000001', 'f2000000-0000-4000-8000-000000000001', 'step-1', 'standard')$$,
  '23505', NULL, 'duplicate run/step identity is rejected');

SELECT throws_ok($$UPDATE public.execution_runs SET execution_plan = '{"version":1,"steps":[],"orderedStepIds":[]}'::jsonb
  WHERE id = 'f3000000-0000-4000-8000-000000000001'$$,
  NULL, 'Execution plan identity is immutable', 'plan replacement is rejected');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::integer FROM public.execution_runs), 1, 'owner can read own run');
SELECT is((SELECT count(*)::integer FROM public.execution_steps), 1, 'owner can read own step');
SELECT set_config('request.jwt.claim.sub', 'f2000000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::integer FROM public.execution_runs), 0, 'other user cannot read run by UUID');
SELECT is((SELECT count(*)::integer FROM public.execution_steps), 0, 'other user cannot read run steps');

SELECT * FROM finish();
ROLLBACK;
