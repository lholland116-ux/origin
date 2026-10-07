BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(12);

SELECT has_column('public', 'execution_steps', 'next_retry_at', 'retry eligibility is durable on the step row');
SELECT col_type_is('public', 'execution_steps', 'next_retry_at', 'timestamp with time zone', 'retry eligibility uses timestamptz');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_steps'::regclass AND conname = 'execution_steps_attempt_check'), 'bounded attempt constraint exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_steps'::regclass AND conname = 'execution_steps_status_check'), 'retry-pending status constraint exists');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_steps'::regclass AND conname = 'execution_steps_status_data_check'), 'retry state data constraint exists');

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('f7000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'retry-owner@example.test');
INSERT INTO public.execution_runs (
  id, user_id, handoff_version, idempotency_key, request_fingerprint,
  execution_plan, snapshot, status, started_at
) VALUES (
  'f8000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001',
  1, 'retry-state-test', repeat('b', 64),
  '{"version":1,"steps":[{"id":"retry-step","capability":"standard","dependsOn":[]}],"orderedStepIds":["retry-step"]}'::jsonb,
  '{"version":1,"runtimeVersion":1,"snapshot":{"run":{"status":"active","value":"running","context":{},"children":{}},"steps":{"retry-step":{"status":"active","value":"running","context":{},"children":{}}}}}'::jsonb,
  'running', now()
);
INSERT INTO public.execution_steps (run_id, user_id, step_id, capability_id)
VALUES ('f8000000-0000-4000-8000-000000000001', 'f7000000-0000-4000-8000-000000000001', 'retry-step', 'standard');

SELECT is((SELECT attempt::integer FROM public.execution_steps WHERE run_id = 'f8000000-0000-4000-8000-000000000001'), 1, 'existing/default attempt remains one');
UPDATE public.execution_steps SET status = 'running', started_at = now()
WHERE run_id = 'f8000000-0000-4000-8000-000000000001';
SELECT throws_ok($$UPDATE public.execution_steps SET status = 'retry_pending'
  WHERE run_id = 'f8000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'retry_pending requires next_retry_at');
SELECT throws_ok($$UPDATE public.execution_steps SET attempt = 0
  WHERE run_id = 'f8000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'attempt zero is rejected');
SELECT throws_ok($$UPDATE public.execution_steps SET attempt = 4
  WHERE run_id = 'f8000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'attempt above the hard maximum is rejected');
UPDATE public.execution_steps SET status = 'retry_pending', attempt = 3, next_retry_at = now() + interval '5 minutes'
WHERE run_id = 'f8000000-0000-4000-8000-000000000001';
SELECT is((SELECT status FROM public.execution_steps WHERE run_id = 'f8000000-0000-4000-8000-000000000001'), 'retry_pending', 'bounded retry state accepts a durable eligibility time');
SELECT throws_ok($$UPDATE public.execution_steps SET status = 'running', next_retry_at = now()
  WHERE run_id = 'f8000000-0000-4000-8000-000000000001'$$,
  '23514', NULL, 'non-retry states reject retry eligibility timestamps');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f7000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$UPDATE public.execution_steps SET status = 'running'
  WHERE run_id = 'f8000000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'authenticated users cannot schedule or claim retries directly');

SELECT * FROM finish();
ROLLBACK;
