begin;

create extension if not exists pgtap;

select plan(142);

-- ---------------------------------------------------------------------------
-- Durable lineage schema and least privilege
-- ---------------------------------------------------------------------------

select has_table(
  'public',
  'image_edit_lineage',
  'image edit lineage table exists'
);

select has_pk(
  'public',
  'image_edit_lineage',
  'image edit lineage has a primary key'
);

select col_type_is('public', 'image_edit_lineage', 'derivative_generated_image_id', 'uuid', 'lineage stores the derivative generated-image identity');
select col_type_is('public', 'image_edit_lineage', 'operation', 'text', 'lineage stores the operation');
select col_type_is('public', 'image_edit_lineage', 'source_generated_image_id', 'uuid', 'lineage stores generated source identity');
select col_type_is('public', 'image_edit_lineage', 'source_uploaded_message_id', 'uuid', 'lineage stores uploaded source message identity');
select col_type_is('public', 'image_edit_lineage', 'source_uploaded_ordinal', 'integer', 'lineage stores uploaded source ordinal');
select col_type_is('public', 'image_edit_lineage', 'instruction', 'text', 'lineage stores the exact human instruction');
select col_type_is('public', 'image_edit_lineage', 'created_at', 'timestamp with time zone', 'lineage records creation time');

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_derivative_fkey'
      and contype = 'f'
      and confrelid = 'public.message_generated_images'::regclass
      and pg_get_constraintdef(oid) ilike '%on delete cascade%'
  ),
  'lineage derivative references generated-image metadata and cascades with it'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_source_generated_fkey'
      and contype = 'f'
      and confrelid = 'public.message_generated_images'::regclass
      and pg_get_constraintdef(oid) ilike '%deferrable%'
  ),
  'generated sources use a real deferred foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_source_uploaded_fkey'
      and contype = 'f'
      and confrelid = 'public.message_images'::regclass
      and pg_get_constraintdef(oid) ilike '%deferrable%'
  ),
  'uploaded sources use the existing message-and-ordinal foreign key'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_operation_check'
      and pg_get_constraintdef(oid) ilike '%edit%'
  ),
  'lineage operation is constrained to edit'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_source_check'
      and contype = 'c'
  ),
  'lineage requires exactly one valid source form'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_instruction_check'
      and contype = 'c'
  ),
  'lineage requires a bounded non-empty instruction'
);

select ok(
  exists (
    select 1
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_lineage'::regclass
      and conname = 'image_edit_lineage_derivative_key'
      and contype = 'u'
  ),
  'each derivative can have only one direct lineage parent'
);

select ok(
  (select relrowsecurity from pg_catalog.pg_class where oid = 'public.image_edit_lineage'::regclass),
  'lineage has row-level security enabled'
);

select ok(not has_table_privilege('anon', 'public.image_edit_lineage', 'SELECT'), 'anonymous clients cannot read lineage');
select ok(has_table_privilege('authenticated', 'public.image_edit_lineage', 'SELECT'), 'authenticated clients can read authorized lineage');
select ok(not has_table_privilege('authenticated', 'public.image_edit_lineage', 'INSERT'), 'authenticated clients cannot insert lineage directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_lineage', 'UPDATE'), 'authenticated clients cannot rewrite lineage directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_lineage', 'DELETE'), 'authenticated clients cannot delete lineage directly');

select ok(
  (
    select count(*) = 1
    from pg_catalog.pg_policy
    where polrelid = 'public.image_edit_lineage'::regclass
      and polcmd = 'r'
  ),
  'lineage exposes only an authenticated read policy'
);

select has_function(
  'public',
  'complete_generated_image_edit',
  array['uuid', 'uuid', 'text', 'uuid', 'uuid', 'text', 'text', 'text', 'text', 'text', 'uuid', 'uuid', 'integer'],
  'atomic generated-image edit completion RPC exists'
);

select ok(
  (
    select prosecdef
    from pg_catalog.pg_proc
    where oid = 'public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure
  ),
  'edit completion RPC is security definer'
);

select ok(
  not has_function_privilege(
    'authenticated',
    'public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'authenticated clients cannot complete an edit through the RPC'
);

select ok(
  not has_function_privilege(
    'anon',
    'public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'anonymous clients cannot complete an edit through the RPC'
);

select ok(
  lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
    like '%image_generation_attempts%'
    and lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
      like '%image_edit_lineage%'
    and lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
      like '%message_images%',
  'edit completion validates the attempt and relational source identities'
);

select ok(
  to_regprocedure('public.complete_generated_image_edit(uuid,uuid,text,text,text,text,text,uuid,uuid,integer)') is null,
  'obsolete pre-idempotency edit completion signature is no longer callable'
);

select ok(
  has_function_privilege(
    'service_role',
    'public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)',
    'EXECUTE'
  ),
  'only the service role can complete an edit through the RPC'
);

select ok(
  lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
    like '%clock_timestamp()%'
    and lower(pg_get_functiondef('public.complete_generated_image_edit(uuid,uuid,text,uuid,uuid,text,text,text,text,text,uuid,uuid,integer)'::regprocedure))
      not like '%current_timestamp%',
  'edit completion uses current wall-clock lease checks rather than a stale transaction timestamp'
);

select ok(
  (
    select count(*) = 3
    from pg_catalog.pg_constraint
    where conrelid = 'public.image_edit_requests'::regclass
      and conname in (
        'image_edit_requests_user_message_id_fkey',
        'image_edit_requests_assistant_message_id_fkey',
        'image_edit_requests_generated_image_id_fkey'
      )
      and pg_get_constraintdef(oid) ilike '%on delete set null%'
  ),
  'completed request result references remain authoritative when result rows are later deleted'
);

select ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'SELECT'), 'authenticated clients cannot read edit-request state directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'INSERT'), 'authenticated clients cannot insert edit-request state directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'UPDATE'), 'authenticated clients cannot rewrite edit-request state directly');
select ok(not has_table_privilege('authenticated', 'public.image_edit_requests', 'DELETE'), 'authenticated clients cannot delete edit-request state directly');

select has_function(
  'public',
  'complete_generated_image_generation',
  array['uuid', 'uuid', 'text', 'text', 'text', 'text', 'text'],
  'existing M8 generation completion RPC remains available'
);

-- Fixtures are created as the test owner. RPC assertions below run through
-- the service-role finalizer with the trusted authenticated owner ID.
reset role;

insert into auth.users (id, aud, role, email)
values
  ('91000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'edit-owner@example.test'),
  ('91000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'edit-other@example.test');

insert into public.conversations (id, user_id, title)
values
  ('92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'Edit owner conversation'),
  ('92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'Edit other conversation');

insert into public.messages (id, conversation_id, user_id, role, content, documents)
values
  ('93000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'user', 'uploaded source message', '[]'::jsonb),
  ('93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'assistant', '', '[]'::jsonb),
  ('93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'assistant', '', '[]'::jsonb),
  ('93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'assistant', '', '[]'::jsonb);

insert into public.message_images (message_id, storage_path, image_name, ordinal)
values
  ('93000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001/source.png', 'source.png', 1),
  ('93000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001/assistant-source.png', 'assistant-source.png', 1);

insert into public.message_generated_images (
  id, message_id, conversation_id, user_id, storage_path, mime_type, provider, model
)
values
  ('94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/original.webp', 'image/webp', 'test-provider', 'test-model'),
  ('94000000-0000-4000-8000-000000000002', '93000000-0000-4000-8000-000000000003', '92000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png', 'image/png', 'runware', 'runware:400@4'),
  ('94000000-0000-4000-8000-000000000003', '93000000-0000-4000-8000-000000000004', '92000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000002', 'generated/91000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000002/other.webp', 'image/webp', 'test-provider', 'test-model');

insert into storage.buckets (id, name, public)
values ('chat-images', 'chat-images', false)
on conflict (id) do nothing;

insert into storage.objects (bucket_id, name, metadata)
values
  ('chat-images', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png', '{"mimetype":"image/png"}'::jsonb),
  ('chat-images', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png', '{"mimetype":"image/png"}'::jsonb),
  ('chat-images', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png', '{"mimetype":"image/png"}'::jsonb),
  ('chat-images', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png', '{"mimetype":"image/png"}'::jsonb),
  ('chat-images', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png', '{"mimetype":"image/png"}'::jsonb);

insert into public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at, expires_at,
  provider_started_at, provider, model, estimated_cost_microusd
)
values
  ('95000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', 'runware', 'runware:400@4', 0);

insert into public.image_edit_requests (
  id, user_id, conversation_id, idempotency_key, request_fingerprint, status,
  attempt_id, claim_expires_at
)
values
  ('96000000-0000-4000-8000-000000000001', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000001', repeat('1', 64), 'in_progress', '95000000-0000-4000-8000-000000000001', now() + interval '10 minutes'),
  ('96000000-0000-4000-8000-000000000002', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000002', repeat('2', 64), 'in_progress', '95000000-0000-4000-8000-000000000002', now() + interval '10 minutes'),
  ('96000000-0000-4000-8000-000000000003', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000003', repeat('3', 64), 'in_progress', '95000000-0000-4000-8000-000000000003', now() + interval '10 minutes'),
  ('96000000-0000-4000-8000-000000000004', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000004', repeat('4', 64), 'in_progress', '95000000-0000-4000-8000-000000000004', now() + interval '10 minutes'),
  ('96000000-0000-4000-8000-000000000005', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000005', repeat('5', 64), 'in_progress', '95000000-0000-4000-8000-000000000005', now() + interval '10 minutes'),
  ('96000000-0000-4000-8000-000000000006', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000006', repeat('6', 64), 'in_progress', '95000000-0000-4000-8000-000000000006', now() + interval '10 minutes'),
  ('96000000-0000-4000-8000-000000000007', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000007', repeat('7', 64), 'in_progress', '95000000-0000-4000-8000-000000000007', now() + interval '10 minutes');

insert into public.image_generation_attempts (
  id, user_id, conversation_id, plan_snapshot, status, reserved_at, expires_at,
  provider_started_at, completed_at, released_at, release_reason, provider, model,
  estimated_cost_microusd
)
values
  ('95000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '1 minute', now() + interval '10 minutes', null, null, null, null, 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'released', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', null, now(), 'internal_failure', 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'succeeded', now() - interval '1 minute', now() + interval '10 minutes', now() - interval '30 seconds', now(), null, null, 'runware', 'runware:400@4', 0),
  ('95000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', 'free', 'reserved', now() - interval '2 minutes', now() - interval '1 minute', now() - interval '90 seconds', null, null, null, 'runware', 'runware:400@4', 0);

insert into public.image_edit_requests (
  id, user_id, conversation_id, idempotency_key, request_fingerprint, status,
  attempt_id, claim_expires_at, updated_at, failure_code, failed_at,
  user_message_id, assistant_message_id, generated_image_id, completed_at
)
values
  ('96000000-0000-4000-8000-000000000008', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000008', repeat('8', 64), 'in_progress', '95000000-0000-4000-8000-000000000008', now() + interval '10 minutes', now(), null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000009', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000009', repeat('9', 64), 'in_progress', '95000000-0000-4000-8000-000000000009', now() + interval '10 minutes', now(), null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000010', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000010', repeat('a', 64), 'in_progress', '95000000-0000-4000-8000-000000000010', now() + interval '10 minutes', now(), null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000011', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000011', repeat('b', 64), 'in_progress', '95000000-0000-4000-8000-000000000011', now() + interval '10 minutes', now(), null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000012', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000012', repeat('c', 64), 'failed', '95000000-0000-4000-8000-000000000007', now() + interval '10 minutes', now(), 'internal_failure', now(), null, null, null, null),
  ('96000000-0000-4000-8000-000000000013', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000013', repeat('d', 64), 'completed', '95000000-0000-4000-8000-000000000007', now() + interval '10 minutes', now(), null, null, '93000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000002', '94000000-0000-4000-8000-000000000001', now()),
  ('96000000-0000-4000-8000-000000000014', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000014', repeat('e', 64), 'in_progress', '95000000-0000-4000-8000-000000000006', now() - interval '1 minute', now() - interval '2 minutes', null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000015', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000015', repeat('f', 64), 'in_progress', '95000000-0000-4000-8000-000000000006', now() + interval '10 minutes', now(), null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000016', '91000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001', '97000000-0000-4000-8000-000000000016', repeat('0', 64), 'in_progress', null, now() + interval '10 minutes', now(), null, null, null, null, null, null),
  ('96000000-0000-4000-8000-000000000020', '91000000-0000-4000-8000-000000000002', '92000000-0000-4000-8000-000000000002', '97000000-0000-4000-8000-000000000020', repeat('2', 64), 'in_progress', null, now() + interval '10 minutes', now(), null, null, null, null, null, null);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role authenticated;

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001', repeat('1', 64),
    '95000000-0000-4000-8000-000000000001', '92000000-0000-4000-8000-000000000001',
    'Direct authenticated invocation.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000099.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '42501', NULL::text,
  'authenticated clients cannot directly invoke the service-only finalizer'
);

set local role service_role;

create temporary table generated_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '91000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000001',
  repeat('1', 64),
  '95000000-0000-4000-8000-000000000001',
  '92000000-0000-4000-8000-000000000001',
  '  Add a soft blue glow; preserve the subject.  ',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png',
  'image/png',
  'runware',
  'runware:400@4',
  '94000000-0000-4000-8000-000000000001',
  null::uuid,
  null::integer
);

select is((select count(*)::integer from generated_edit), 1, 'generated source edit completion returns durable IDs');
select is((select source_generated_image_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), '94000000-0000-4000-8000-000000000001'::uuid, 'generated source identity is persisted');
select is((select operation from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), 'edit', 'edit operation is persisted');
select is((select instruction from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), '  Add a soft blue glow; preserve the subject.  ', 'the exact human instruction is preserved');
select is((select content from public.messages where id = (select user_message_id from generated_edit)), '  Add a soft blue glow; preserve the subject.  ', 'the edit instruction is persisted as the user message');
select is((select status from public.image_generation_attempts where id = '95000000-0000-4000-8000-000000000001'), 'succeeded', 'successful edit completion consumes the existing attempt');
set local role service_role;
select is((select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), 'completed', 'successful edit completion completes its idempotency request');
select is((select attempt_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), '95000000-0000-4000-8000-000000000001'::uuid, 'completed request retains the bound attempt');
select ok((select user_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') is not null and exists (select 1 from public.messages where id = (select user_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') and content = '  Add a soft blue glow; preserve the subject.  '), 'completed request stores the user message result');
select ok((select assistant_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') is not null and exists (select 1 from public.message_generated_images where message_id = (select assistant_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') and storage_path like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'), 'completed request stores the assistant message result');
select is((select generated_image_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), (select id from public.message_generated_images where storage_path like '%/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa.png'), 'completed request stores the generated-image result');
select ok(exists (select 1 from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)), 'edit completion creates the durable lineage row');
set local role authenticated;
select is((select count(*)::integer from public.image_edit_lineage where source_generated_image_id = '94000000-0000-4000-8000-000000000001'), 1, 'one generated source can produce its first derivative');
select is((select count(*)::integer from public.image_edit_lineage where derivative_generated_image_id = '94000000-0000-4000-8000-000000000001'), 0, 'normal M8 generated images remain valid without lineage');

set local role service_role;
create temporary table uploaded_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '91000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000002',
  repeat('2', 64),
  '95000000-0000-4000-8000-000000000002',
  '92000000-0000-4000-8000-000000000001',
  'Remove the uploaded background.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb.png',
  'image/png',
  'runware',
  'runware:400@4',
  null::uuid,
  '93000000-0000-4000-8000-000000000001',
  1
);

select is((select count(*)::integer from uploaded_edit), 1, 'uploaded source edit completion returns durable IDs');
select is((select source_uploaded_message_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), '93000000-0000-4000-8000-000000000001'::uuid, 'uploaded source message identity is persisted');
select is((select source_uploaded_ordinal from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), 1, 'uploaded source ordinal is persisted');
select is((select source_generated_image_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), null::uuid, 'uploaded lineage has no generated source field');
select ok(exists (select 1 from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from uploaded_edit)), 'uploaded edit completion creates the durable lineage row');
set local role service_role;
select is((select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000002'), 'completed', 'uploaded edit completion completes its idempotency request');
set local role authenticated;

set local role service_role;
create temporary table chained_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '91000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000003',
  repeat('3', 64),
  '95000000-0000-4000-8000-000000000003',
  '92000000-0000-4000-8000-000000000001',
  'Add soft rain to the edited image.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.png',
  'image/png',
  'runware',
  'runware:400@4',
  (select generated_image_id from generated_edit),
  null::uuid,
  null::integer
);

select is((select count(*)::integer from chained_edit), 1, 'an edit derivative can be used as the next generated source');
select is((select source_generated_image_id from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from chained_edit)), (select generated_image_id from generated_edit), 'edit-to-edit lineage points to the prior derivative');

set local role service_role;
create temporary table branched_edit on commit drop as
select *
from public.complete_generated_image_edit(
  '91000000-0000-4000-8000-000000000001',
  '96000000-0000-4000-8000-000000000004',
  repeat('4', 64),
  '95000000-0000-4000-8000-000000000004',
  '92000000-0000-4000-8000-000000000001',
  'Make a warm monochrome version.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/dddddddd-dddd-4ddd-8ddd-dddddddddddd.png',
  'image/png',
  'runware',
  'runware:400@4',
  '94000000-0000-4000-8000-000000000001',
  null::uuid,
  null::integer
);

select is((select count(*)::integer from public.image_edit_lineage where source_generated_image_id = '94000000-0000-4000-8000-000000000001'), 2, 'one generated source can produce multiple derivatives');
select is((select count(*)::integer from public.image_edit_lineage where derivative_generated_image_id in ((select generated_image_id from generated_edit), (select generated_image_id from uploaded_edit), (select generated_image_id from chained_edit), (select generated_image_id from branched_edit))), 4, 'each successful derivative has one direct lineage record');
select is((select count(*)::integer from public.message_generated_images where id in ((select generated_image_id from generated_edit), (select generated_image_id from uploaded_edit), (select generated_image_id from chained_edit), (select generated_image_id from branched_edit))), 4, 'successful edit completion creates ordinary generated-image metadata rows');

create temporary table replay_before on commit drop as
select
  (select count(*)::integer from public.messages) as message_count,
  (select count(*)::integer from public.message_generated_images) as generated_image_count,
  (select count(*)::integer from public.image_edit_lineage) as lineage_count,
  (select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') as request_status,
  (select user_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') as user_message_id,
  (select assistant_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') as assistant_message_id,
  (select generated_image_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001') as generated_image_id;

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000001',
    repeat('1', 64),
    '95000000-0000-4000-8000-000000000001',
    '92000000-0000-4000-8000-000000000001',
    'Replay the first edit.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000015.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001',
  'IMAGE_EDIT_REQUEST_UNAVAILABLE',
  'replaying a succeeded edit attempt cannot create another derivative'
);

select is((select count(*)::integer from public.messages), (select message_count from replay_before), 'replay creates no additional messages');
select is((select count(*)::integer from public.message_generated_images), (select generated_image_count from replay_before), 'replay creates no second generated image');
select is((select count(*)::integer from public.image_edit_lineage), (select lineage_count from replay_before), 'replay creates no second lineage row');
select is((select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), (select request_status from replay_before), 'replay leaves the original request completed');
select is((select user_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), (select user_message_id from replay_before), 'replay leaves the original user result ID unchanged');
select is((select assistant_message_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), (select assistant_message_id from replay_before), 'replay leaves the original assistant result ID unchanged');
select is((select generated_image_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000001'), (select generated_image_id from replay_before), 'replay leaves the original generated-image result ID unchanged');

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000006',
    repeat('6', 64),
    '95000000-0000-4000-8000-000000000006',
    '92000000-0000-4000-8000-000000000001',
    'Use another user source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000003', null::uuid, null::integer
  )$$,
  'P0001',
  'IMAGE_SOURCE_NOT_FOUND',
  'edit completion enforces source tenant and conversation ownership'
);

create temporary table rollback_before on commit drop as
select
  count(*) filter (where role = 'user')::integer as user_message_count,
  count(*) filter (where role = 'assistant')::integer as assistant_message_count,
  (select count(*)::integer from public.message_generated_images) as generated_image_count,
  (select count(*)::integer from public.image_edit_lineage) as lineage_count,
  (select updated_at from public.conversations where id = '92000000-0000-4000-8000-000000000001') as conversation_updated_at,
  (select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000005') as request_status,
  (select user_message_id is null and assistant_message_id is null and generated_image_id is null from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000005') as request_results_empty
from public.messages;

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000005',
    repeat('5', 64),
    '95000000-0000-4000-8000-000000000005',
    '92000000-0000-4000-8000-000000000001',
    'This edit must roll back.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '23505',
  NULL::text,
  'a later metadata failure rolls back the complete edit transaction'
);

select is((select count(*)::integer from public.messages where content = 'This edit must roll back.'), 0, 'failed edit completion leaves no user message partial');
select is((select count(*)::integer from public.image_edit_lineage where instruction = 'This edit must roll back.'), 0, 'failed edit completion leaves no lineage partial');
select is((select count(*) filter (where role = 'user')::integer from public.messages), (select user_message_count from rollback_before), 'failed edit completion rolls back the user-message row count');
select is((select count(*) filter (where role = 'assistant')::integer from public.messages), (select assistant_message_count from rollback_before), 'failed edit completion rolls back the assistant-message row count');
select is((select count(*)::integer from public.message_generated_images), (select generated_image_count from rollback_before), 'failed edit completion rolls back the generated-image row');
select is((select count(*)::integer from public.image_edit_lineage), (select lineage_count from rollback_before), 'failed edit completion rolls back the lineage row');
select is((select updated_at from public.conversations where id = '92000000-0000-4000-8000-000000000001'), (select conversation_updated_at from rollback_before), 'failed edit completion leaves conversation updated_at unchanged');
select is((select status from public.image_generation_attempts where id = '95000000-0000-4000-8000-000000000005'), 'reserved', 'failed edit completion leaves the attempt available for controlled failure handling');
select is((select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000005'), (select request_status from rollback_before), 'failed edit completion leaves the request status unchanged');
select is((select user_message_id is null and assistant_message_id is null and generated_image_id is null from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000005'), (select request_results_empty from rollback_before), 'failed edit completion leaves request result IDs unchanged');

create temporary table missing_storage_before on commit drop as
select
  (select count(*) filter (where role = 'assistant')::integer from public.messages) as assistant_message_count,
  (select count(*)::integer from public.message_generated_images) as generated_image_count,
  (select count(*)::integer from public.image_edit_lineage) as lineage_count;

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing storage object.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000099.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_STORAGE_OBJECT_NOT_FOUND',
  'missing derivative Storage objects cannot be finalized'
);

select is((select count(*)::integer from public.messages where content = 'Missing storage object.'), 0, 'missing Storage objects create no user message');
select is((select count(*) filter (where role = 'assistant')::integer from public.messages), (select assistant_message_count from missing_storage_before), 'missing Storage objects create no assistant message');
select is((select count(*)::integer from public.message_generated_images), (select generated_image_count from missing_storage_before), 'missing Storage objects create no generated-image metadata');
select is((select count(*)::integer from public.image_edit_lineage where instruction = 'Missing storage object.'), 0, 'missing Storage objects create no lineage row');
select is((select status from public.image_generation_attempts where id = '95000000-0000-4000-8000-000000000007'), 'reserved', 'missing Storage objects leave the attempt reserved');
select is((select status from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000007'), 'in_progress', 'missing Storage objects leave the request in progress');
select ok((select user_message_id is null and assistant_message_id is null and generated_image_id is null from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000007'), 'missing Storage objects leave request result IDs null');

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Missing filename.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'empty output filenames are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Non UUID filename.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/not-a-uuid.png',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'non-UUID output filenames are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'JPEG output.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000016.jpg',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'JPEG output filenames are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'JPEG output.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000017.jpeg',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'JPEG output filenames are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'WebP output.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000018.webp',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'WebP output filenames are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Uppercase output.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000019.PNG',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'uppercase output extensions are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001', '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Wrong user path.', 'generated/91000000-0000-4000-8000-000000000002/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000020.png',
    'image/png', 'runware', 'runware:400@4', '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'wrong user output namespaces are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000008.png',
    'image/png', 'runware', 'runware:400@4',
    null::uuid, null::uuid, null::integer
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'source-less edit completion is rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Ambiguous source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000009.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'an edit cannot claim generated and uploaded source classes together'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Generated source with ordinal.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000010.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, 1
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'generated source cannot carry uploaded ordinal fields'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Uploaded source with generated identity.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000011.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'uploaded source cannot carry generated identity'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Invalid ordinal.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000012.png',
    'image/png', 'runware', 'runware:400@4',
    null::uuid, '93000000-0000-4000-8000-000000000001', 0
  )$$,
  '22023',
  'INVALID_IMAGE_EDIT_SOURCE',
  'uploaded source ordinals must be positive'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing generated source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000013.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000099', null::uuid, null::integer
  )$$,
  'P0001',
  'IMAGE_SOURCE_NOT_FOUND',
  'nonexistent generated sources are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007',
    repeat('7', 64),
    '95000000-0000-4000-8000-000000000007',
    '92000000-0000-4000-8000-000000000001',
    'Missing uploaded source.',
    'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000014.png',
    'image/png', 'runware', 'runware:400@4',
    null::uuid, '93000000-0000-4000-8000-000000000099', 1
  )$$,
  'P0001',
  'IMAGE_SOURCE_NOT_FOUND',
  'nonexistent uploaded sources are rejected'
);

reset role;
select set_config('request.jwt.claim.sub', null, true);

select throws_ok(
  $$select public.complete_generated_image_edit(
    null::uuid,
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Unauthenticated edit.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/unauthenticated.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '42501', 'UNAUTHORIZED', 'unauthenticated finalization is rejected'
);

select set_config('request.jwt.claim.sub', '91000000-0000-4000-8000-000000000001', true);
set local role service_role;

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000020', repeat('2', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Foreign request.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/foreign.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'foreign edit requests fail closed'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000002',
    'Wrong conversation.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000002/wrong-conversation.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'wrong edit conversations fail closed'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('1', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Wrong fingerprint.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/wrong-fingerprint.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'wrong request fingerprints fail closed'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001',
    'Wrong attempt.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/wrong-attempt.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'wrong bound attempts fail closed'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000016', repeat('0', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Unbound attempt.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/unbound.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'unbound attempts cannot finalize an edit'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000008', repeat('8', 64),
    '95000000-0000-4000-8000-000000000008', '92000000-0000-4000-8000-000000000001',
    'Provider not started.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/not-started.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_PROVIDER_NOT_STARTED', 'an attempt must be provider-started before finalization'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000009', repeat('9', 64),
    '95000000-0000-4000-8000-000000000009', '92000000-0000-4000-8000-000000000001',
    'Released attempt.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/released.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_ATTEMPT_NOT_RESERVED', 'released attempts cannot finalize an edit'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000010', repeat('a', 64),
    '95000000-0000-4000-8000-000000000010', '92000000-0000-4000-8000-000000000001',
    'Succeeded attempt.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/succeeded.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_ATTEMPT_NOT_RESERVED', 'succeeded attempts cannot finalize an edit twice'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000011', repeat('b', 64),
    '95000000-0000-4000-8000-000000000011', '92000000-0000-4000-8000-000000000001',
    'Expired attempt.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/expired.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_RESERVATION_EXPIRED', 'expired attempts cannot finalize an edit'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000012', repeat('c', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Failed request.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/failed.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'failed edit requests cannot be finalized'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000013', repeat('d', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Completed request.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/completed.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'completed edit requests cannot be finalized again'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000014', repeat('e', 64),
    '95000000-0000-4000-8000-000000000006', '92000000-0000-4000-8000-000000000001',
    'Expired claim.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/expired-claim.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'expired request claims cannot be finalized'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000015', repeat('f', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Stale worker.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/stale.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  'P0001', 'IMAGE_EDIT_REQUEST_UNAVAILABLE', 'a stale worker bound to a superseded attempt fails closed'
);

set local role service_role;
select is((select attempt_id from public.image_edit_requests where id = '96000000-0000-4000-8000-000000000015'), '95000000-0000-4000-8000-000000000006'::uuid, 'stale finalization does not replace the current request attempt');
select is((select status from public.image_generation_attempts where id = '95000000-0000-4000-8000-000000000007'), 'reserved', 'stale finalization does not mark its old attempt succeeded');
select is((select count(*)::integer from public.messages where content = 'Stale worker.'), 0, 'stale finalization creates no partial messages');
set local role service_role;

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Assistant uploaded source.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000004.png',
    'image/png', 'runware', 'runware:400@4',
    null::uuid, '93000000-0000-4000-8000-000000000002', 1
  )$$,
  'P0001', 'IMAGE_SOURCE_NOT_FOUND', 'uploaded assistant messages cannot be used as edit sources'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Invalid path.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000002/outside.png',
    'image/png', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'storage paths outside the owner conversation namespace are rejected'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Wrong MIME.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000005.png',
    'image/webp', 'runware', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'finalization requires PNG output'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Wrong provider.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000006.png',
    'image/png', 'other-provider', 'runware:400@4',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'finalization rejects a provider mismatch'
);

select throws_ok(
  $$select public.complete_generated_image_edit(
    '91000000-0000-4000-8000-000000000001',
    '96000000-0000-4000-8000-000000000007', repeat('7', 64),
    '95000000-0000-4000-8000-000000000007', '92000000-0000-4000-8000-000000000001',
    'Wrong model.', 'generated/91000000-0000-4000-8000-000000000001/92000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000007.png',
    'image/png', 'runware', 'other-model',
    '94000000-0000-4000-8000-000000000001', null::uuid, null::integer
  )$$,
  '22023', 'INVALID_GENERATED_IMAGE_EDIT', 'finalization rejects a model mismatch'
);

-- The following checks exercise database constraints directly as service_role;
-- ordinary authenticated clients do not receive this write privilege.
set local role service_role;
set constraints image_edit_lineage_source_generated_fkey, image_edit_lineage_source_uploaded_fkey immediate;

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ((select derivative_generated_image_id from public.image_edit_lineage where instruction = '  Add a soft blue glow; preserve the subject.  '), 'edit', '94000000-0000-4000-8000-000000000001', 'duplicate parent')$$,
  '23505',
  NULL::text,
  'a derivative cannot receive a second direct lineage parent'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', 'source-less')$$,
  '23514',
  NULL::text,
  'database rejects source-less lineage rows'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1, 'ambiguous')$$,
  '23514',
  NULL::text,
  'database rejects ambiguous source lineage rows'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000001', 1, 'generated with ordinal')$$,
  '23514',
  NULL::text,
  'database rejects generated sources with uploaded fields'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000001', '93000000-0000-4000-8000-000000000001', 1, 'uploaded with generated identity')$$,
  '23514',
  NULL::text,
  'database rejects uploaded sources with generated fields'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '93000000-0000-4000-8000-000000000001', 0, 'invalid ordinal')$$,
  '23514',
  NULL::text,
  'database rejects invalid uploaded ordinals'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ('94000000-0000-0000-0000-000000000099', 'edit', '94000000-0000-4000-8000-000000000001', 'missing derivative')$$,
  '23503',
  NULL::text,
  'database rejects a nonexistent derivative generated image'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '94000000-0000-4000-8000-000000000099', 'missing generated source')$$,
  '23503',
  NULL::text,
  'database rejects a nonexistent generated source'
);

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_uploaded_message_id, source_uploaded_ordinal, instruction)
    values ('94000000-0000-4000-8000-000000000002', 'edit', '93000000-0000-4000-8000-000000000099', 1, 'missing uploaded source')$$,
  '23503',
  NULL::text,
  'database rejects a nonexistent uploaded source relationship'
);

set local role authenticated;

select throws_ok(
  $$insert into public.image_edit_lineage (derivative_generated_image_id, operation, source_generated_image_id, instruction)
    values ((select generated_image_id from generated_edit), 'edit', '94000000-0000-4000-8000-000000000001', 'direct insert')$$,
  '42501',
  NULL::text,
  'ordinary authenticated clients cannot directly insert lineage'
);

select throws_ok(
  $$update public.image_edit_lineage set instruction = 'rewritten' where derivative_generated_image_id = (select generated_image_id from generated_edit)$$,
  '42501',
  NULL::text,
  'ordinary authenticated clients cannot rewrite lineage'
);

select throws_ok(
  $$delete from public.image_edit_lineage where derivative_generated_image_id = (select generated_image_id from generated_edit)$$,
  '42501',
  NULL::text,
  'ordinary authenticated clients cannot independently delete lineage'
);

set local role service_role;

select throws_ok(
  $$delete from public.message_generated_images where id = '94000000-0000-4000-8000-000000000001'$$,
  '23503',
  NULL::text,
  'a generated source cannot be deleted while derivatives reference it'
);

set constraints image_edit_lineage_source_generated_fkey, image_edit_lineage_source_uploaded_fkey deferred;

reset role;

select lives_ok(
  $$delete from public.conversations where id = '92000000-0000-4000-8000-000000000001'$$,
  'deleting the complete conversation remains referentially safe'
);

select is((select count(*)::integer from public.image_edit_lineage), 0, 'conversation cleanup leaves no orphan lineage rows');

select * from finish();

rollback;
