begin;

create extension if not exists pgtap;

select plan(49);

select has_function(
  'public',
  'complete_generated_image_generation_for_existing_messages',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid', 'text', 'text', 'text', 'text'],
  'existing-message image generation completion RPC exists'
);
select has_function(
  'public',
  'persist_generated_document_for_existing_message',
  array['uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'bigint', 'text'],
  'existing-message generated-document persistence RPC exists'
);
select has_function(
  'public',
  'complete_generated_image_edit_for_existing_messages',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'integer'],
  'existing-message image-edit completion RPC exists'
);

select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.complete_generated_image_generation_for_existing_messages(uuid,uuid,text,uuid,uuid,text,text,text,text)'::regprocedure), 'image generation RPC is SECURITY DEFINER');
select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.persist_generated_document_for_existing_message(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text)'::regprocedure), 'document RPC is SECURITY DEFINER');
select ok((select prosecdef from pg_catalog.pg_proc where oid = 'public.complete_generated_image_edit_for_existing_messages(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure), 'image edit RPC is SECURITY DEFINER');

select ok((select array_to_string(proconfig, ',') ilike '%search_path=public, auth, pg_temp%' from pg_catalog.pg_proc where oid = 'public.complete_generated_image_generation_for_existing_messages(uuid,uuid,text,uuid,uuid,text,text,text,text)'::regprocedure), 'image generation RPC has a hardened search path');
select ok((select array_to_string(proconfig, ',') ilike '%search_path=public, auth, pg_temp%' from pg_catalog.pg_proc where oid = 'public.persist_generated_document_for_existing_message(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text)'::regprocedure), 'document RPC has a hardened search path');
select ok((select array_to_string(proconfig, ',') ilike '%search_path=public, pg_temp%' from pg_catalog.pg_proc where oid = 'public.complete_generated_image_edit_for_existing_messages(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure), 'image edit RPC has a hardened search path');

select ok(has_function_privilege('authenticated', 'public.complete_generated_image_generation_for_existing_messages(uuid,uuid,text,uuid,uuid,text,text,text,text)', 'EXECUTE'), 'authenticated users can complete their own image generation');
select ok(has_function_privilege('authenticated', 'public.persist_generated_document_for_existing_message(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text)', 'EXECUTE'), 'authenticated users can persist their own documents');
select ok(not has_function_privilege('authenticated', 'public.complete_generated_image_edit_for_existing_messages(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)', 'EXECUTE'), 'authenticated users cannot invoke the service-only edit finalizer');
select ok(has_function_privilege('service_role', 'public.complete_generated_image_edit_for_existing_messages(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)', 'EXECUTE'), 'service role can invoke the edit finalizer');

reset role;

insert into auth.users (id, aud, role, email)
values
  ('a1000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'existing-artifact-owner@example.test'),
  ('a1000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'existing-artifact-other@example.test');

insert into public.conversations (id, user_id, title)
values
  ('b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'Existing artifact owner'),
  ('b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'Existing artifact other');

insert into public.messages (id, conversation_id, user_id, role, content, documents)
values
  ('c1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'user', 'Original request', '[]'::jsonb),
  ('c1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'assistant', 'Final answer', '[]'::jsonb),
  ('c1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'user', 'Other request', '[]'::jsonb),
  ('c1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000002', 'assistant', 'Other answer', '[]'::jsonb),
  ('c1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'user', 'Temporary wrong-role target', '[]'::jsonb),
  ('c1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'assistant', 'Temporary alternate assistant', '[]'::jsonb);

insert into public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at, expires_at,
  provider_started_at, provider, model, estimated_cost_microusd
)
values
  ('d1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now(), now() + interval '10 minutes', now(), 'replicate', 'flux-schnell', 3000),
  ('d1000000-0000-4000-8000-000000000002', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now(), now() + interval '10 minutes', now(), 'runware', 'runware:400@4', 0),
  ('d1000000-0000-4000-8000-000000000003', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'free', 'reserved', now(), now() + interval '10 minutes', now(), 'replicate', 'flux-schnell', 3000);

insert into public.image_edit_requests (
  id, user_id, conversation_id, idempotency_key, request_fingerprint, status,
  attempt_id, claim_expires_at
)
values
  ('e1000000-0000-4000-8000-000000000001', 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', repeat('b', 64), 'in_progress', 'd1000000-0000-4000-8000-000000000002', now() + interval '10 minutes');

insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name, metadata)
values (
  'chat-images',
  'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.png',
  '{"mimetype":"image/png"}'::jsonb
);

select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select * from public.complete_generated_image_generation_for_existing_messages(
    'd1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'prompt',
    'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004',
    'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333.webp',
    'image/webp', 'replicate', 'flux-schnell'
  )$$,
  'P0001', 'ASSISTANT_MESSAGE_NOT_FOUND',
  'generation rejects another user and conversation assistant message'
);
select throws_ok(
  $$select * from public.complete_generated_image_generation_for_existing_messages(
    'd1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'prompt',
    'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000005',
    'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333.webp',
    'image/webp', 'replicate', 'flux-schnell'
  )$$,
  'P0001', 'ASSISTANT_MESSAGE_NOT_FOUND',
  'generation rejects a user-role assistant target'
);
select throws_ok(
  $$select * from public.complete_generated_image_generation_for_existing_messages(
    'd1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000001', 'prompt',
    'c1000000-0000-4000-8000-000000000001', 'c9999999-9999-4999-8999-999999999999',
    'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/33333333-3333-4333-8333-333333333333.webp',
    'image/webp', 'replicate', 'flux-schnell'
  )$$,
  'P0001', 'ASSISTANT_MESSAGE_NOT_FOUND',
  'generation rejects a random nonexistent assistant message ID'
);
reset role;
select is((select status from public.image_generation_attempts where id = 'd1000000-0000-4000-8000-000000000003'), 'reserved', 'invalid linkage leaves the generation attempt reserved');
select is((select count(*)::integer from public.message_generated_images where user_id = 'a1000000-0000-4000-8000-000000000001'), 0, 'invalid generation linkage inserts no image rows');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select results_eq(
  $$select user_message_id, assistant_message_id from public.complete_generated_image_generation_for_existing_messages(
    'd1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'A generated image',
    'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
    'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp',
    'image/webp', 'replicate', 'flux-schnell'
  )$$,
  $$values ('c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid)$$,
  'generation returns the supplied original user and final assistant messages'
);
select throws_ok(
  $$select * from public.complete_generated_image_generation_for_existing_messages(
    'd1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 'A duplicate completion',
    'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
    'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/44444444-4444-4444-8444-444444444444.webp',
    'image/webp', 'replicate', 'flux-schnell'
  )$$,
  'P0001', 'IMAGE_ATTEMPT_NOT_RESERVED',
  'a completed generation attempt cannot persist a second image'
);
select results_eq(
  $$select assistant_message_id, generated_document_id, was_existing from public.persist_generated_document_for_existing_message(
    'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000001',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000001/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template'
  )$$,
  $$values ('c1000000-0000-4000-8000-000000000002'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, false)$$,
  'document persistence reuses the supplied assistant message'
);
select results_eq(
  $$select assistant_message_id, generated_document_id, was_existing from public.persist_generated_document_for_existing_message(
    'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
    'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000099',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000099/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template'
  )$$,
  $$values ('c1000000-0000-4000-8000-000000000002'::uuid, 'f3000000-0000-4000-8000-000000000001'::uuid, true)$$,
  'document replay returns the existing document and target without duplicating it'
);
select throws_ok(
  $$select * from public.persist_generated_document_for_existing_message(
    'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000006',
    'f2000000-0000-4000-8000-000000000001', 'f3000000-0000-4000-8000-000000000098',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000098/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template'
  )$$,
  'P0001', 'GENERATED_DOCUMENT_LINKAGE_CONFLICT',
  'document idempotency replay cannot be rebound to another assistant message'
);
select throws_ok(
  $$select * from public.persist_generated_document_for_existing_message(
    'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000002', 'f3000000-0000-4000-8000-000000000002',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000002/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template'
  )$$,
  'P0001', 'ASSISTANT_MESSAGE_NOT_FOUND',
  'document persistence rejects a user-role assistant target'
);
select throws_ok(
  $$select * from public.persist_generated_document_for_existing_message(
    'b1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000004',
    'f2000000-0000-4000-8000-000000000003', 'f3000000-0000-4000-8000-000000000003',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000003/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template'
  )$$,
  'P0001', 'ASSISTANT_MESSAGE_NOT_FOUND',
  'document persistence rejects another user and conversation assistant message'
);
select throws_ok(
  $$select * from public.persist_generated_document_for_existing_message(
    'b1000000-0000-4000-8000-000000000001', 'c9999999-9999-4999-8999-999999999999',
    'f2000000-0000-4000-8000-000000000004', 'f3000000-0000-4000-8000-000000000004',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000004/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template'
  )$$,
  'P0001', 'ASSISTANT_MESSAGE_NOT_FOUND',
  'document persistence rejects a random nonexistent assistant message ID'
);
reset role;
delete from public.messages where id in ('c1000000-0000-4000-8000-000000000005', 'c1000000-0000-4000-8000-000000000006');
select is((select count(*)::integer from public.generated_documents where conversation_id = 'b1000000-0000-4000-8000-000000000001'), 1, 'failed document linkage creates no extra document');

set local role service_role;
select throws_ok(
  $$select * from public.complete_generated_image_edit_for_existing_messages(
    'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', repeat('b', 64),
    'd1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000002', 'c1000000-0000-4000-8000-000000000001',
    'Remove the object.', 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.png',
    'image/png', 'runware', 'runware:400@4',
    (select id from public.message_generated_images where storage_path = 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'), null, null
  )$$,
  'P0001', 'USER_MESSAGE_NOT_FOUND',
  'edit persistence rejects an assistant-role original user message'
);
select throws_ok(
  $$select * from public.complete_generated_image_edit_for_existing_messages(
    'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', repeat('b', 64),
    'd1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
    'c9999999-9999-4999-8999-999999999999', 'c1000000-0000-4000-8000-000000000002',
    'Remove the object.', 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.png',
    'image/png', 'runware', 'runware:400@4',
    (select id from public.message_generated_images where storage_path = 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'), null, null
  )$$,
  'P0001', 'USER_MESSAGE_NOT_FOUND',
  'edit persistence rejects a random nonexistent original user message ID'
);
reset role;
select ok(
  (select status = 'reserved' from public.image_generation_attempts where id = 'd1000000-0000-4000-8000-000000000002')
  and (select status = 'in_progress' and user_message_id is null and assistant_message_id is null and generated_image_id is null from public.image_edit_requests where id = 'e1000000-0000-4000-8000-000000000001'),
  'invalid edit linkage leaves quota attempt and idempotency state unchanged'
);

set local role service_role;
select results_eq(
  $$select user_message_id, assistant_message_id from public.complete_generated_image_edit_for_existing_messages(
    'a1000000-0000-4000-8000-000000000001', 'e1000000-0000-4000-8000-000000000001', repeat('b', 64),
    'd1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000001',
    'c1000000-0000-4000-8000-000000000001', 'c1000000-0000-4000-8000-000000000002',
    'Remove the object.', 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.png',
    'image/png', 'runware', 'runware:400@4',
    (select id from public.message_generated_images where storage_path = 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'), null, null
  )$$,
  $$values ('c1000000-0000-4000-8000-000000000001'::uuid, 'c1000000-0000-4000-8000-000000000002'::uuid)$$,
  'edit persistence reuses the supplied messages'
);
reset role;

select is((select count(*)::integer from public.messages where conversation_id = 'b1000000-0000-4000-8000-000000000001'), 2, 'all artifact persistence preserves exactly one user and one assistant message');
select is((select count(*)::integer from public.message_generated_images where message_id = 'c1000000-0000-4000-8000-000000000002'), 2, 'generated and edited images coexist on the final assistant message');
select is((select count(distinct id)::integer from public.message_generated_images where message_id = 'c1000000-0000-4000-8000-000000000002'), 2, 'each co-located image retains a unique identity');
select is((select count(*)::integer from public.generated_documents where message_id = 'c1000000-0000-4000-8000-000000000002' and user_id = 'a1000000-0000-4000-8000-000000000001'), 1, 'document metadata is owned by the same assistant message and user');
select is((select count(*)::integer from public.image_edit_lineage lineage join public.message_generated_images derivative on derivative.id = lineage.derivative_generated_image_id join public.message_generated_images source on source.id = lineage.source_generated_image_id where derivative.message_id = 'c1000000-0000-4000-8000-000000000002' and source.storage_path = 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/11111111-1111-4111-8111-111111111111.webp'), 1, 'edited image lineage points to the exact generated source image ID');
select ok((select status = 'succeeded' from public.image_generation_attempts where id = 'd1000000-0000-4000-8000-000000000001'), 'generation attempt completes once');
select ok((select status = 'succeeded' from public.image_generation_attempts where id = 'd1000000-0000-4000-8000-000000000002'), 'edit attempt completes once');
select ok((select status = 'completed' and user_message_id = 'c1000000-0000-4000-8000-000000000001' and assistant_message_id = 'c1000000-0000-4000-8000-000000000002' and generated_image_id = (select id from public.message_generated_images where storage_path = 'generated/a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/22222222-2222-4222-8222-222222222222.png') from public.image_edit_requests where id = 'e1000000-0000-4000-8000-000000000001'), 'edit request stores the final target IDs and generated result');

set local role authenticated;
select set_config('request.jwt.claim.sub', 'a1000000-0000-4000-8000-000000000001', true);
select is((select disposition from public.claim_image_edit_request('b1000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001', repeat('b', 64))), 'completed', 'same edit idempotency request replays the completed result');

select results_eq(
  $$select generated_document_id, was_existing from public.persist_generated_document_chat(
    'b1000000-0000-4000-8000-000000000001',
    'f2000000-0000-4000-8000-000000000005',
    'f3000000-0000-4000-8000-000000000005',
    'a1000000-0000-4000-8000-000000000001/b1000000-0000-4000-8000-000000000001/generated/f3000000-0000-4000-8000-000000000005/report.txt',
    'report.txt', 'txt', 'text/plain', 11, 'test-template', 'Direct document response'
  )$$,
  $$values ('f3000000-0000-4000-8000-000000000005'::uuid, false)$$,
  'direct document persistence keeps its original result shape and creates a new result'
);
select is((select count(*)::integer from public.messages where conversation_id = 'b1000000-0000-4000-8000-000000000001'), 3, 'direct document persistence still creates one assistant message');
reset role;
select is((select count(*)::integer from public.generated_documents document join public.messages message on message.id = document.message_id where document.id = 'f3000000-0000-4000-8000-000000000005' and message.user_id = 'a1000000-0000-4000-8000-000000000001' and message.conversation_id = 'b1000000-0000-4000-8000-000000000001' and message.role = 'assistant' and message.content = 'Direct document response'), 1, 'direct document metadata links to its newly created assistant message');

select ok(lower(pg_get_functiondef('public.complete_generated_image_generation_for_existing_messages(uuid,uuid,text,uuid,uuid,text,text,text,text)'::regprocedure)) not like '%insert into public.messages%', 'existing-message generation RPC creates no messages');
select ok(lower(pg_get_functiondef('public.persist_generated_document_for_existing_message(uuid,uuid,uuid,uuid,text,text,text,text,bigint,text)'::regprocedure)) not like '%insert into public.messages%', 'existing-message document RPC creates no messages');
select ok(lower(pg_get_functiondef('public.complete_generated_image_edit_for_existing_messages(uuid,uuid,text,uuid,uuid,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure)) not like '%insert into public.messages%', 'existing-message edit RPC creates no messages');
select ok(lower(pg_get_functiondef('public.complete_generated_image_generation(uuid,uuid,text,text,text,text,text)'::regprocedure)) like '%insert into public.messages%', 'direct image generation still creates its established chat messages');
select ok(lower(pg_get_functiondef('public.persist_generated_document_chat(uuid,uuid,uuid,text,text,text,text,bigint,text,text)'::regprocedure)) like '%insert into public.messages%', 'direct document persistence still creates its established assistant message');
select ok(lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure)) like '%insert into public.messages%', 'direct image edit still creates its established chat messages');

select * from finish();
rollback;
