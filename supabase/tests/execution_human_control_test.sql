BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(23);

SELECT has_column('public', 'execution_runs', 'control_state', 'run control lifecycle is stored separately from execution status');
SELECT col_type_is('public', 'execution_runs', 'control_revision', 'bigint', 'control transitions use a durable revision');
SELECT has_table('public', 'execution_human_approval_checkpoints', 'step-specific human checkpoints are persisted');
SELECT has_table('public', 'execution_control_events', 'control provenance is persisted');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_human_approval_checkpoints'::regclass), 'approval checkpoint RLS is enabled');
SELECT ok((SELECT relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_human_approval_checkpoints'::regclass), 'approval checkpoint RLS is forced');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_control_events'::regclass), 'control event RLS is enabled');
SELECT ok(NOT has_table_privilege('authenticated', 'public.execution_human_approval_checkpoints', 'INSERT,UPDATE,DELETE'), 'authenticated users cannot decide checkpoints directly');
SELECT ok(has_table_privilege('authenticated', 'public.execution_human_approval_checkpoints', 'SELECT'), 'authenticated users may read only their own checkpoints through RLS');
SELECT ok(has_table_privilege('service_role', 'public.execution_human_approval_checkpoints', 'SELECT,INSERT,UPDATE') AND NOT has_table_privilege('service_role', 'public.execution_human_approval_checkpoints', 'DELETE'), 'service role may persist decisions but not directly delete checkpoints');
SELECT ok(has_table_privilege('service_role', 'public.execution_control_events', 'SELECT,INSERT') AND NOT has_table_privilege('service_role', 'public.execution_control_events', 'UPDATE,DELETE'), 'control events are append-only for the service role');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_human_approval_checkpoints'::regclass AND conname = 'execution_human_approval_run_step_key'), 'only one checkpoint may gate a run step');
SELECT ok(EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE conrelid = 'public.execution_control_events'::regclass AND conname = 'execution_control_event_run_revision_key'), 'a run has at most one event per control revision');

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('f9100000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'control-owner@example.test'),
  ('f9100000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'control-other@example.test');

INSERT INTO public.execution_runs (
  id, user_id, handoff_version, idempotency_key, request_fingerprint, execution_plan, snapshot
) VALUES (
  'f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001',
  1, 'human-control-test', repeat('d', 64),
  '{"version":1,"steps":[{"id":"gated-step","capability":"standard","dependsOn":[]}],"orderedStepIds":["gated-step"]}'::jsonb,
  '{"version":1,"runtimeVersion":1,"snapshot":{"run":{"status":"active","value":"pending","context":{},"children":{}},"steps":{"gated-step":{"status":"active","value":"pending","context":{},"children":{}}}}}'::jsonb
);
INSERT INTO public.execution_steps (run_id, user_id, step_id, capability_id)
VALUES ('f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001', 'gated-step', 'standard');
INSERT INTO public.execution_human_approval_checkpoints (
  id, run_id, user_id, step_id, plan_fingerprint, step_fingerprint, source, created_at
) VALUES (
  'f9300000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001',
  'gated-step', repeat('d', 64), repeat('e', 64), 'runtime_policy', now()
);
INSERT INTO public.execution_control_events (
  id, run_id, user_id, checkpoint_id, action, prior_state, new_state,
  prior_control_revision, control_revision, snapshot_revision
) VALUES (
  'f9400000-0000-4000-8000-000000000001', 'f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001',
  'f9300000-0000-4000-8000-000000000001', 'approval_required', 'active', 'active', 0, 1, 0
);

SELECT is((SELECT count(*)::integer FROM public.execution_human_approval_checkpoints WHERE run_id = 'f9200000-0000-4000-8000-000000000001'), 1, 'trusted runtime can persist a pending checkpoint');
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'f9100000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::integer FROM public.execution_human_approval_checkpoints), 1, 'owner can read own checkpoint');
SELECT is((SELECT count(*)::integer FROM public.execution_control_events), 1, 'owner can read own control audit');
SELECT set_config('request.jwt.claim.sub', 'f9100000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::integer FROM public.execution_human_approval_checkpoints), 0, 'another user cannot read a checkpoint by run identity');
SELECT is((SELECT count(*)::integer FROM public.execution_control_events), 0, 'another user cannot read control events by run identity');
SELECT throws_ok($$UPDATE public.execution_human_approval_checkpoints SET status = 'approved'
  WHERE id = 'f9300000-0000-4000-8000-000000000001'$$, '42501', NULL, 'authenticated users cannot forge approval decisions');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT throws_ok($$UPDATE public.execution_human_approval_checkpoints SET step_id = 'mutated-step'
  WHERE id = 'f9300000-0000-4000-8000-000000000001'$$,
  'P0001', 'Execution approval checkpoint identity is immutable', 'service role cannot mutate checkpoint identity');
RESET ROLE;
SELECT throws_ok($$UPDATE public.execution_control_events SET rationale = 'rewritten'
  WHERE id = 'f9400000-0000-4000-8000-000000000001'$$, NULL, 'Execution control events are append-only', 'control audit events cannot be rewritten');
SELECT throws_ok($$INSERT INTO public.execution_control_events (
    run_id, user_id, action, prior_state, new_state, prior_control_revision, control_revision, snapshot_revision
  ) VALUES (
    'f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001',
    'paused', 'active', 'paused', 0, 1, 0
  )$$, '23505', NULL, 'one control revision cannot be recorded twice');
SELECT throws_ok($$INSERT INTO public.execution_human_approval_checkpoints (
    run_id, user_id, step_id, plan_fingerprint, step_fingerprint, status, source, decided_by, decided_at
  ) VALUES (
    'f9200000-0000-4000-8000-000000000001', 'f9100000-0000-4000-8000-000000000001',
    'other-step', repeat('d', 64), repeat('e', 64), 'approved', 'runtime_policy',
    NULL, now()
  )$$, '23514', NULL, 'approval decisions require the owner identity and a valid source actor');

SELECT * FROM finish();
ROLLBACK;
