BEGIN;

CREATE EXTENSION IF NOT EXISTS pgtap;
SELECT plan(20);

INSERT INTO auth.users (id, aud, role, email) VALUES
  ('aa500000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'execution-auth-owner@example.test'),
  ('aa500000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'execution-auth-other@example.test');

INSERT INTO public.conversations (id, user_id, title) VALUES
  ('bb500000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 'Authorization owner'),
  ('bb500000-0000-4000-8000-000000000002', 'aa500000-0000-4000-8000-000000000002', 'Authorization other');

INSERT INTO public.messages (id, conversation_id, user_id, role, content) VALUES
  ('cc500000-0000-4000-8000-000000000001', 'bb500000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 'user', 'Owner request'),
  ('cc500000-0000-4000-8000-000000000002', 'bb500000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 'assistant', 'Owner output'),
  ('cc500000-0000-4000-8000-000000000003', 'bb500000-0000-4000-8000-000000000002', 'aa500000-0000-4000-8000-000000000002', 'user', 'Other request'),
  ('cc500000-0000-4000-8000-000000000004', 'bb500000-0000-4000-8000-000000000002', 'aa500000-0000-4000-8000-000000000002', 'assistant', 'Other output');

INSERT INTO public.documents (id, user_id, conversation_id, file_name, mime_type, size_bytes, storage_path, extracted_text, extraction_status)
VALUES
  ('dd500000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 'bb500000-0000-4000-8000-000000000001', 'owner.txt', 'text/plain', 10, 'owner/owner.txt', 'owner file', 'ready'),
  ('dd500000-0000-4000-8000-000000000002', 'aa500000-0000-4000-8000-000000000002', 'bb500000-0000-4000-8000-000000000002', 'other.txt', 'text/plain', 10, 'other/other.txt', 'other file', 'ready');

INSERT INTO public.message_images (id, message_id, storage_path, image_name, ordinal) VALUES
  ('ee500000-0000-4000-8000-000000000001', 'cc500000-0000-4000-8000-000000000001', 'uploads/owner.png', 'owner.png', 1),
  ('ee500000-0000-4000-8000-000000000002', 'cc500000-0000-4000-8000-000000000003', 'uploads/other.png', 'other.png', 1);

INSERT INTO public.message_generated_images (id, message_id, conversation_id, user_id, storage_path, mime_type, provider, model) VALUES
  ('ff500000-0000-4000-8000-000000000001', 'cc500000-0000-4000-8000-000000000002', 'bb500000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 'generated/aa500000-0000-4000-8000-000000000001/bb500000-0000-4000-8000-000000000001/owner.png', 'image/png', 'test', 'test'),
  ('ff500000-0000-4000-8000-000000000002', 'cc500000-0000-4000-8000-000000000004', 'bb500000-0000-4000-8000-000000000002', 'aa500000-0000-4000-8000-000000000002', 'generated/aa500000-0000-4000-8000-000000000002/bb500000-0000-4000-8000-000000000002/other.png', 'image/png', 'test', 'test');

INSERT INTO public.execution_runs (id, user_id, handoff_version, idempotency_key, request_fingerprint, execution_plan, snapshot, status) VALUES
  ('11500000-0000-4000-8000-000000000001', 'aa500000-0000-4000-8000-000000000001', 1, 'auth-owner-run', repeat('a', 64), '{"steps":[{"id":"step-1","capability":"standard","dependsOn":[]}],"orderedStepIds":["step-1"]}'::jsonb, '{"version":1,"runtimeVersion":1,"snapshot":{}}'::jsonb, 'pending'),
  ('11500000-0000-4000-8000-000000000002', 'aa500000-0000-4000-8000-000000000002', 1, 'auth-other-run', repeat('b', 64), '{"steps":[{"id":"step-1","capability":"standard","dependsOn":[]}],"orderedStepIds":["step-1"]}'::jsonb, '{"version":1,"runtimeVersion":1,"snapshot":{}}'::jsonb, 'pending');

SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.conversations'::regclass), 'conversation ownership is RLS protected');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.messages'::regclass), 'message ownership is RLS protected');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.documents'::regclass), 'document ownership is RLS protected');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.message_images'::regclass), 'uploaded-image ownership is RLS protected');
SELECT ok((SELECT relrowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.message_generated_images'::regclass), 'generated-image ownership is RLS protected');
SELECT ok((SELECT relrowsecurity AND relforcerowsecurity FROM pg_catalog.pg_class WHERE oid = 'public.execution_runs'::regclass), 'execution-run RLS is enabled and forced');
SELECT ok(NOT has_table_privilege('authenticated', 'public.agent_request_acceptances', 'SELECT'), 'acceptance identity is not directly readable by clients');
SELECT ok(NOT has_table_privilege('authenticated', 'public.generated_documents', 'SELECT'), 'generated artifacts require the scoped server-side repository');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', 'aa500000-0000-4000-8000-000000000001', true);
SELECT is((SELECT count(*)::integer FROM public.conversations), 1, 'owner can read only the owned conversation');
SELECT is((SELECT count(*)::integer FROM public.messages), 2, 'owner can read only owned message bindings');
SELECT is((SELECT count(*)::integer FROM public.documents), 1, 'owner can read only owned documents');
SELECT is((SELECT count(*)::integer FROM public.message_images), 1, 'owner can read only images attached to owned messages');
SELECT is((SELECT count(*)::integer FROM public.message_generated_images), 1, 'owner can read only generated images attached to owned messages');
SELECT is((SELECT count(*)::integer FROM public.execution_runs), 1, 'owner can read only owned execution runs');

SELECT set_config('request.jwt.claim.sub', 'aa500000-0000-4000-8000-000000000002', true);
SELECT is((SELECT count(*)::integer FROM public.conversations), 1, 'second owner sees only their conversation');
SELECT is((SELECT count(*)::integer FROM public.messages), 2, 'second owner sees only their message bindings');
SELECT is((SELECT count(*)::integer FROM public.documents), 1, 'second owner sees only their documents');
SELECT is((SELECT count(*)::integer FROM public.message_images), 1, 'second owner sees only their uploaded images');
SELECT is((SELECT count(*)::integer FROM public.message_generated_images), 1, 'second owner sees only their generated images');
SELECT is((SELECT count(*)::integer FROM public.execution_runs), 1, 'second owner sees only their execution runs');

SELECT * FROM finish();
ROLLBACK;
