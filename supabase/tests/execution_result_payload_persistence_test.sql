BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

SELECT has_table('public', 'execution_step_result_payloads', 'large result payload table exists');
SELECT has_pk('public', 'execution_step_result_payloads', 'payload UUID is the primary key');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_step_result_payloads'::regclass), 'payload RLS is enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_step_result_payloads'::regclass), 'payload RLS is forced');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_step_result_payloads'::regclass AND conname = 'execution_step_result_payloads_payload_check'), 'payload JSON and physical-size bounds are constrained');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_step_result_payloads'::regclass AND conname = 'execution_step_result_payloads_one_per_step'), 'at most one immutable payload exists per source step');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_steps'::regclass AND conname = 'execution_steps_result_payload_fkey'), 'step references are bound to their exact run, user, and step');
SELECT ok(NOT has_table_privilege('authenticated', 'public.execution_step_result_payloads', 'SELECT'), 'authenticated clients cannot query payloads as a general result lookup API');
SELECT ok(NOT has_table_privilege('authenticated', 'public.execution_step_result_payloads', 'INSERT,UPDATE,DELETE'), 'authenticated users cannot mutate payloads');
SELECT ok(NOT has_table_privilege('anon', 'public.execution_step_result_payloads', 'SELECT,INSERT,UPDATE,DELETE'), 'anonymous users cannot access payloads');
SELECT ok(has_table_privilege('service_role', 'public.execution_step_result_payloads', 'SELECT,INSERT'), 'trusted service role can persist and read payloads');
SELECT ok(NOT has_table_privilege('service_role', 'public.execution_step_result_payloads', 'UPDATE,DELETE'), 'service role cannot mutate or directly delete immutable payloads');

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('f4000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'payload-owner@example.test'),
  ('f4000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'payload-other@example.test');

INSERT INTO public.execution_runs (
  id, user_id, handoff_version, idempotency_key, request_fingerprint,
  execution_plan, snapshot, status, started_at
) VALUES (
  'f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001',
  1, 'payload-test-run', repeat('a', 64),
  '{"version":1,"steps":[{"id":"source-step","capability":"standard","dependsOn":[]}],"orderedStepIds":["source-step"]}'::jsonb,
  '{"version":1,"runtimeVersion":1,"snapshot":{"run":{},"steps":{}}}'::jsonb,
  'running', now()
);
INSERT INTO public.execution_steps (run_id, user_id, step_id, capability_id, status, started_at)
VALUES ('f5000000-0000-4000-8000-000000000001', 'f4000000-0000-4000-8000-000000000001', 'source-step', 'standard', 'running', now());
INSERT INTO public.execution_step_result_payloads (
  id, run_id, user_id, step_id, result_kind, payload, serialized_size_bytes, payload_sha256
) VALUES (
  'f6000000-0000-4000-8000-000000000001', 'f5000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001', 'source-step', 'text',
  '{"kind":"text","value":"payload"}'::jsonb, 1, repeat('a', 64)
);
UPDATE public.execution_steps SET
  status = 'succeeded', completed_at = now(),
  result_payload_id = 'f6000000-0000-4000-8000-000000000001',
  result_envelope = '{"kind":"text","value":{"storage":"payload_ref","payloadId":"f6000000-0000-4000-8000-000000000001","resultKind":"text","byteLength":1,"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}'::jsonb
WHERE run_id = 'f5000000-0000-4000-8000-000000000001' AND step_id = 'source-step';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000001', true);
SELECT throws_ok($$SELECT * FROM public.execution_step_result_payloads WHERE id = 'f6000000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'authenticated owner cannot bypass declared-predecessor result resolution');
SELECT throws_ok($$INSERT INTO public.execution_step_result_payloads (run_id,user_id,step_id,result_kind,payload,serialized_size_bytes,payload_sha256)
  VALUES ('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','source-step','text','{"kind":"text","value":"x"}'::jsonb,1,repeat('a',64))$$,
  '42501', NULL, 'authenticated users cannot inject payloads');
SELECT set_config('request.jwt.claim.sub', 'f4000000-0000-4000-8000-000000000002', true);
SELECT throws_ok($$SELECT * FROM public.execution_step_result_payloads WHERE id = 'f6000000-0000-4000-8000-000000000001'$$,
  '42501', NULL, 'another authenticated user cannot read payloads by UUID');
RESET ROLE;

SELECT throws_ok($$UPDATE public.execution_step_result_payloads SET payload = '{"kind":"text","value":"changed"}'::jsonb
  WHERE id = 'f6000000-0000-4000-8000-000000000001'$$,
  NULL, 'Execution result payloads are immutable', 'payload contents cannot be updated');
SELECT throws_ok($$INSERT INTO public.execution_step_result_payloads (run_id,user_id,step_id,result_kind,payload,serialized_size_bytes,payload_sha256)
  VALUES ('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','source-step','text','{"kind":"text","value":"x"}'::jsonb,1310721,repeat('a',64))$$,
  '23514', NULL, 'payload compact serialized-size bound is enforced');
SELECT throws_ok($$INSERT INTO public.execution_step_result_payloads (run_id,user_id,step_id,result_kind,payload,serialized_size_bytes,payload_sha256)
  VALUES ('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000001','missing-step','text','{"kind":"text","value":"x"}'::jsonb,1,repeat('a',64))$$,
  '23503', NULL, 'payload cannot attach to a nonexistent source step');
SELECT throws_ok($$INSERT INTO public.execution_step_result_payloads (run_id,user_id,step_id,result_kind,payload,serialized_size_bytes,payload_sha256)
  VALUES ('f5000000-0000-4000-8000-000000000001','f4000000-0000-4000-8000-000000000002','source-step','text','{"kind":"text","value":"x"}'::jsonb,1,repeat('a',64))$$,
  '23503', NULL, 'payload cannot be rebound across users');

DELETE FROM public.execution_runs WHERE id = 'f5000000-0000-4000-8000-000000000001';
SELECT is((SELECT count(*)::integer FROM public.execution_step_result_payloads WHERE id = 'f6000000-0000-4000-8000-000000000001'), 0, 'payload follows the owning run lifecycle');

SELECT * FROM finish();
ROLLBACK;
